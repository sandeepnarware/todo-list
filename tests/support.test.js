/* jsdom harness: Help & Support composer -> mailto handoff. */
const fs = require('fs');
const path = require('path');
const csstree = require('css-tree');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJsRaw = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
// This suite exercises the mail-client handoff, so pin the app to mailto mode
// regardless of whether a Web3Forms key is configured in the repo.
const KEY_RE = /const WEB3FORMS_ACCESS_KEY\s*=\s*["'][^"']*["'];/;
const appJs = appJsRaw.replace(KEY_RE, 'const WEB3FORMS_ACCESS_KEY = "";');
if (appJs === appJsRaw) throw new Error('could not pin mailto mode: key line not found');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const quotesRaw = fs.readFileSync(path.join(ROOT, 'quotes.json'), 'utf8');

const EMAIL = 'sandeep.kumar.narware@gmail.com';
let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log('  PASS  ' + label);
  else { fails++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!/tailwind|Could not load|Not implemented|navigation/i.test(e.message)) console.log('JSDOM ERR:', e.message); });
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/', virtualConsole: vc, pretendToBeVisual: true });
const w = dom.window;
w.Notification = { permission: 'denied', requestPermission() {} };
w.AudioContext = function () { throw new Error('no audio'); };
w.documentPictureInPicture = null;
let n = 0;
w.crypto = Object.assign({}, w.crypto, { randomUUID: () => `uuid-${++n}` });
w.alert = () => {};
w.fetch = (url) => {
  if (String(url) === 'quotes.json') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(quotesRaw)) });
  if (String(url) === 'version.json') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ major: 2, minor: 0, patch: 66, commit: 'abc1234', released: '2026-07-25' }) });
  return Promise.reject(new Error('blocked'));
};
// Capture mailto navigation instead of performing it.
const navigations = [];
let clipboard = null;
w.navigator.clipboard = { writeText: (t) => { clipboard = t; return Promise.resolve(); } };

w.localStorage.setItem('todos', JSON.stringify([{
  id: 'A', title: 'My Secret Project Task', description: 'confidential notes', dueDate: null,
  priority: 'none', project: 'TopSecret', frequency: 'none', tags: ['private'], done: false,
  completedAt: null, createdAt: 1, pomodoros: 3, estPomodoros: 5, wasGolden: false, subtasks: [],
}]));

const s = w.document.createElement('script');
s.textContent = appJs + '\nwindow.__t = { openSupportModal, closeSupportModal, sendSupportEmail, buildSupportMailto, supportDiagnosticsBlock, SUPPORT_EMAIL, defaultSubjectFor };';
w.document.body.appendChild(s);

const doc = w.document;
const $ = (id) => doc.getElementById(id);
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const input = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
const change = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };

// jsdom cannot intercept location.href, so URLs are asserted via buildSupportMailto()
// and the send side effects (close + toast) are asserted by clicking Send.
const compose = () => w.__t.buildSupportMailto();

const parseMailto = (url) => {
  const m = /^mailto:([^?]*)\?(.*)$/.exec(url);
  if (!m) return null;
  const params = new w.URLSearchParams(m[2]);
  return { to: decodeURIComponent(m[1]), subject: params.get('subject'), body: params.get('body') };
};

(async () => {
  await new Promise(r => setTimeout(r, 30)); // let version.json settle

  console.log('\n1. Entry point exists in the header');
  const btn = $('supportBtn');
  check('support button rendered', !!btn);
  check('has an accessible label', /support/i.test(btn.getAttribute('aria-label') || ''), btn.getAttribute('aria-label'));
  check('has a hover title', /Help/i.test(btn.getAttribute('title') || ''), btn.getAttribute('title'));
  check('sits next to the existing help button',
    btn.previousElementSibling && btn.previousElementSibling.id === 'helpBtn',
    btn.previousElementSibling && btn.previousElementSibling.id);

  // Identifiability: it must not look like a second "help" button.
  const supportIcon = btn.querySelector('.material-symbols-outlined').textContent.trim();
  const helpIcon = $('helpBtn').querySelector('.material-symbols-outlined').textContent.trim();
  console.log(`  icons -> help: "${helpIcon}", support: "${supportIcon}"`);
  check('support icon differs from the help icon', supportIcon !== helpIcon, { helpIcon, supportIcon });
  check('not another question-mark glyph', !/help|question|contact_support/.test(supportIcon), supportIcon);
  check('icon is a known Material Symbols name', /^[a-z0-9_]+$/.test(supportIcon), supportIcon);
  check('icon font is loaded unsubsetted (no icon_names=), so the glyph resolves',
    /Material\+Symbols\+Outlined/.test(html) && !/icon_names=/.test(html));
  check('every header icon button is visually distinct', (() => {
    const icons = [...doc.querySelectorAll('header button .material-symbols-outlined')].map(e => e.textContent.trim());
    return new Set(icons).size === icons.length;
  })(), [...doc.querySelectorAll('header button .material-symbols-outlined')].map(e => e.textContent.trim()));
  check('aria-label spells out what it does',
    /bug|feature|reach out/i.test(btn.getAttribute('aria-label')), btn.getAttribute('aria-label'));
  check('modal starts hidden', $('supportModal').classList.contains('hidden'));

  console.log('\n2. Opening the modal');
  click(btn);
  check('modal visible', !$('supportModal').classList.contains('hidden'));
  check('offers all three purposes',
    [...$('supportType').options].map(o => o.value).join(',') === 'bug,feature,hello',
    [...$('supportType').options].map(o => o.value));
  check('option labels cover bug / feature / reach out',
    /report a bug/i.test($('supportType').options[0].text) &&
    /request a feature/i.test($('supportType').options[1].text) &&
    /reaching out/i.test($('supportType').options[2].text),
    [...$('supportType').options].map(o => o.text));
  check('subject prefilled with version + type',
    $('supportSubject').value === 'PomoDone v2.0.66 — Bug report', $('supportSubject').value);
  check('diagnostics on by default for a bug', $('supportDiagnostics').checked);
  check('message starts empty', $('supportMessage').value === '');
  check('character counter shown', $('supportCount').textContent === '0 / 1500', $('supportCount').textContent);

  console.log('\n3. Switching purpose updates subject + diagnostics default');
  change($('supportType'), 'feature');
  check('subject follows the type', $('supportSubject').value === 'PomoDone v2.0.66 — Feature request', $('supportSubject').value);
  check('diagnostics off for a feature request', $('supportDiagnostics').checked === false);
  change($('supportType'), 'hello');
  check('subject follows again', $('supportSubject').value === 'PomoDone v2.0.66 — Hello', $('supportSubject').value);
  change($('supportType'), 'bug');
  check('diagnostics back on for a bug', $('supportDiagnostics').checked === true);

  console.log('\n4. A custom subject is never overwritten');
  input($('supportSubject'), 'My own subject');
  change($('supportType'), 'feature');
  check('user subject preserved on type change', $('supportSubject').value === 'My own subject', $('supportSubject').value);

  console.log('\n5. Empty message is refused (no mail app opened)');
  input($('supportMessage'), '   ');
  check('composes nothing for a blank message', compose() === null, compose());
  click($('supportSend'));
  check('modal stays open', !$('supportModal').classList.contains('hidden'));

  console.log('\n6. Sending composes the right mailto');
  change($('supportType'), 'bug');
  input($('supportSubject'), 'Timer drifts when tab is hidden');
  input($('supportMessage'), 'Steps:\n1. Start timer\n2. Switch tab\n\nIt drifts by ~5s. Special chars: & ? = # "quotes"');
  $('supportDiagnostics').checked = true;
  const composed = compose();
  click($('supportSend'));
  const mail = parseMailto(composed);
  check('is a mailto: URL', !!mail, composed);
  check('addressed to the right inbox', mail.to === EMAIL, mail.to);
  check('SUPPORT_EMAIL constant matches', w.__t.SUPPORT_EMAIL === EMAIL, w.__t.SUPPORT_EMAIL);
  check('subject carried through', mail.subject === 'Timer drifts when tab is hidden', mail.subject);
  check('message body carried through', mail.body.startsWith('Steps:\n1. Start timer'), mail.body.slice(0, 40));
  check('special characters survive encoding',
    mail.body.includes('& ? = # "quotes"'), mail.body.slice(-40));
  check('newlines preserved', mail.body.split('\n').length > 3);
  check('modal closed after sending', $('supportModal').classList.contains('hidden'));
  check('toast explains nothing was sent yet',
    /nothing is sent until you hit send/i.test($('toastMsg').textContent), $('toastMsg').textContent);

  console.log('\n7. Diagnostics: environment only, never task data');
  check('includes app version', /App: PomoDone v2\.0\.66/.test(mail.body), mail.body.slice(-300));
  check('includes browser', /Browser: /.test(mail.body));
  check('includes screen size', /Screen: \d+x\d+/.test(mail.body));
  check('includes theme', /Theme: (dark|light)/.test(mail.body));
  check('separated by a divider', /\n---\nTechnical details\n/.test(mail.body));
  const leaks = ['My Secret Project Task', 'confidential notes', 'TopSecret', 'private'];
  check('no task titles / notes / projects / tags leak',
    leaks.every(x => !mail.body.includes(x)), leaks.filter(x => mail.body.includes(x)));
  check('no localStorage dump', !/\{"id"|todos/.test(mail.body));

  console.log('\n8. Opting out of diagnostics');
  click($('supportBtn'));
  input($('supportMessage'), 'Just a plain note');
  $('supportDiagnostics').checked = false;
  const mail2 = parseMailto(compose());
  click($('supportSend'));
  check('body is only the message', mail2.body === 'Just a plain note', mail2.body);
  check('no technical block appended', !/Technical details/.test(mail2.body));

  console.log('\n9. Message length is capped so the mailto URL stays valid');
  check('textarea has maxlength', $('supportMessage').getAttribute('maxlength') === '1500',
    $('supportMessage').getAttribute('maxlength'));
  click($('supportBtn'));
  input($('supportMessage'), 'x'.repeat(1500));
  $('supportDiagnostics').checked = true; // worst case: max message + diagnostics
  check('counter reflects the cap', $('supportCount').textContent === '1500 / 1500', $('supportCount').textContent);
  const long = compose();
  click($('supportSend'));
  check('worst-case URL stays under common client limits (~8k)', long.length < 8000, long.length);

  console.log('\n10. Closing the modal every way');
  const ways = [
    ['close button', () => click($('supportClose'))],
    ['cancel button', () => click($('supportCancel'))],
    ['clicking the backdrop', () => $('supportModal').dispatchEvent(new w.MouseEvent('click', { bubbles: true }))],
    ['Escape key', () => doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))],
  ];
  ways.forEach(([name, act]) => {
    click($('supportBtn'));
    act();
    check(`closes via ${name}`, $('supportModal').classList.contains('hidden'));
  });
  check('reopening resets the message', (() => {
    click($('supportBtn'));
    input($('supportMessage'), 'draft text');
    click($('supportCancel'));
    click($('supportBtn'));
    return $('supportMessage').value === '';
  })());

  console.log('\n11. Direct-email fallback (for users with no mail client)');
  check('address shown verbatim', $('supportMailLink').textContent === EMAIL, $('supportMailLink').textContent);
  check('address is a mailto link', $('supportMailLink').getAttribute('href') === 'mailto:' + EMAIL,
    $('supportMailLink').getAttribute('href'));
  click($('supportCopy'));
  await new Promise(r => setTimeout(r, 10));
  check('copy button copies the address', clipboard === EMAIL, clipboard);
  check('copy confirmed via toast', /copied/i.test($('toastMsg').textContent), $('toastMsg').textContent);

  console.log('\n12. Ctrl+Enter sends from the textarea');
  click($('supportBtn'));
  input($('supportMessage'), 'quick send');
  check('composes from the typed message', parseMailto(compose()).body.startsWith('quick send'));
  $('supportMessage').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
  check('Ctrl+Enter closed the modal (send path ran)', $('supportModal').classList.contains('hidden'));
  check('Ctrl+Enter showed the send toast', /Opening your email app/i.test($('toastMsg').textContent),
    $('toastMsg').textContent);

  console.log('\n13. Built from the app\'s own modal/form classes (theme consistency)');
  const modal = $('supportModal');
  check('uses .modal-overlay', modal.classList.contains('modal-overlay'));
  check('uses .modal', !!modal.querySelector('.modal'));
  check('uses .modal-header / .modal-body', !!modal.querySelector('.modal-header') && !!modal.querySelector('.modal-body'));
  // type, subject, reply-to, message
  check('fields wrapped in .form-group', modal.querySelectorAll('.form-group').length === 4,
    modal.querySelectorAll('.form-group').length);
  check('primary/secondary buttons reused',
    !!modal.querySelector('.btn-primary') && !!modal.querySelector('.btn-secondary'));
  check('checkbox reuses .stitch-checkbox', $('supportDiagnostics').classList.contains('stitch-checkbox'));
  check('actions row reuses .modal-actions', !!modal.querySelector('.modal-actions'));
  // New classes must be themed with variables only.
  const ast = csstree.parse(css);
  const rules = [];
  csstree.walk(ast, { visit: 'Rule', enter(node) {
    const decls = {};
    node.block.children.forEach(d => { if (d.type === 'Declaration') decls[d.property] = csstree.generate(d.value).trim(); });
    rules.push({ sels: csstree.generate(node.prelude).split(',').map(x => x.trim()), decls });
  }});
  const declsFor = (sel) => Object.assign({}, ...rules.filter(r => r.sels.includes(sel)).map(r => r.decls));
  ['.support-hint', '.support-diag', '.support-direct', '.support-email', '.support-copy-btn'].forEach(sel => {
    const d = declsFor(sel);
    check(`${sel} styled`, Object.keys(d).length > 0);
    const colours = [d.color, d.background, d['border-top'], d.border].filter(Boolean).join(' ');
    check(`${sel} uses theme variables only`, !/#[0-9a-f]{3,8}\b|\brgba?\(/i.test(colours), colours);
  });
  check('copy button is a pill like other app buttons',
    declsFor('.support-copy-btn')['border-radius'] === '999px');

  console.log('\n14. Nothing is transmitted from the page itself');
  check('no fetch/XHR to any support endpoint',
    !/fetch\([^)]*(support|feedback|formspree|mail)/i.test(appJs));
  check('handoff is via mailto only', /mailto:\$\{SUPPORT_EMAIL\}/.test(appJs));

  console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
