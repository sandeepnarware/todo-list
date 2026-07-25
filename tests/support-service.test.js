/* jsdom harness: Web3Forms in-app sending + mailto fallback. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJsRaw = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const quotesRaw = fs.readFileSync(path.join(ROOT, 'quotes.json'), 'utf8');

const KEY_RE = /const WEB3FORMS_ACCESS_KEY\s*=\s*["'][^"']*["'];/;
const TEST_KEY = '11111111-2222-3333-4444-555555555555';
const ENDPOINT = 'https://api.web3forms.com/submit';

let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log('  PASS  ' + label);
  else { fails++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

console.log('\n0. Config shape');
check('access key constant present and configurable', KEY_RE.test(appJsRaw),
  (appJsRaw.match(KEY_RE) || [])[0]);
check('endpoint is the documented Web3Forms API', appJsRaw.includes(ENDPOINT),
  (appJsRaw.match(/WEB3FORMS_ENDPOINT\s*=.*/) || [])[0]);
check('comment tells you where to get a key', /web3forms\.com\/#start/.test(appJsRaw));
check('notes the key is safe to be public', /meant to be public/i.test(appJsRaw));

/* Boot the app with an optional access key and a scripted fetch. */
function boot({ key = '', postHandler = null, online = true } = {}) {
  // Always rewrite the key so the suite is independent of what the repo holds:
  // '' exercises mailto mode, a UUID exercises in-app sending.
  const appJs = appJsRaw.replace(KEY_RE, `const WEB3FORMS_ACCESS_KEY = "${key}";`);
  if (appJs === appJsRaw) throw new Error('key injection failed');
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    if (!/tailwind|Could not load|Not implemented|navigation/i.test(e.message)) console.log('JSDOM ERR:', e.message);
  });
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/', virtualConsole: vc, pretendToBeVisual: true });
  const w = dom.window;
  w.Notification = { permission: 'denied', requestPermission() {} };
  w.AudioContext = function () { throw new Error('no audio'); };
  w.documentPictureInPicture = null;
  let n = 0;
  w.crypto = Object.assign({}, w.crypto, { randomUUID: () => `uuid-${++n}` });
  w.alert = () => {};
  let clipboard = null;
  w.navigator.clipboard = { writeText: (t) => { clipboard = t; return Promise.resolve(); } };
  if (!online) {
    try { Object.defineProperty(w.navigator, 'onLine', { value: false, configurable: true }); } catch { /* ignore */ }
  }
  const posts = [];
  w.fetch = (url, opts) => {
    if (String(url) === 'quotes.json') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(quotesRaw)) });
    if (String(url) === 'version.json') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ major: 2, minor: 0, patch: 66, commit: 'abc1234', released: '2026-07-25' }) });
    if (String(url) === ENDPOINT) {
      posts.push({ url: String(url), opts });
      return postHandler ? postHandler(opts) : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });
    }
    return Promise.reject(new Error('unexpected fetch ' + url));
  };
  w.localStorage.setItem('todos', JSON.stringify([{
    id: 'A', title: 'SECRET_TASK_TITLE', description: 'SECRET_NOTES', dueDate: null, priority: 'none',
    project: 'SECRET_PROJECT', frequency: 'none', tags: ['SECRET_TAG'], done: false, completedAt: null,
    createdAt: 1, pomodoros: 0, estPomodoros: 0, wasGolden: false, subtasks: [],
  }]));
  const s = w.document.createElement('script');
  s.textContent = appJs + '\nwindow.__t = { openSupportModal, submitSupportViaService, sendSupportEmail, buildSupportMailto, supportServiceEnabled };';
  w.document.body.appendChild(s);
  const doc = w.document;
  return {
    w, doc, posts,
    getClipboard: () => clipboard,
    $: (id) => doc.getElementById(id),
    click: (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })),
    input: (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); },
    body: () => JSON.parse(posts[posts.length - 1].opts.body),
  };
}

const tick = () => new Promise(r => setTimeout(r, 20));

(async () => {
  // ---------------------------------------------------------------- unconfigured
  console.log('\n1. With no key configured, nothing changes (mailto only)');
  {
    const t = boot();
    await tick();
    check('service reports disabled', t.w.__t.supportServiceEnabled() === false);
    t.click(t.$('supportBtn'));
    check('button still says "Open in email app"', t.$('supportSend').textContent === 'Open in email app', t.$('supportSend').textContent);
    check('reply-to field hidden', t.$('supportEmailGroup').classList.contains('hidden'));
    check('fallback link hidden (it would be redundant)', t.$('supportMailtoFallback').classList.contains('hidden'));
    t.input(t.$('supportMessage'), 'hello');
    t.click(t.$('supportSend'));
    await tick();
    check('no POST attempted', t.posts.length === 0, t.posts.length);
    check('mailto path ran (modal closed)', t.$('supportModal').classList.contains('hidden'));
  }

  // ------------------------------------------------------------------ configured
  console.log('\n2. With a key configured, the composer switches to in-app sending');
  {
    const t = boot({ key: TEST_KEY });
    await tick();
    check('service reports enabled', t.w.__t.supportServiceEnabled() === true);
    t.click(t.$('supportBtn'));
    check('button says "Send message"', t.$('supportSend').textContent === 'Send message', t.$('supportSend').textContent);
    check('reply-to field shown', !t.$('supportEmailGroup').classList.contains('hidden'));
    check('reply-to is an email input', t.$('supportReplyTo').type === 'email');
    check('reply-to labelled as optional but needed for a reply',
      /can't reply without it/i.test(t.$('supportEmailGroup').textContent), t.$('supportEmailGroup').textContent.trim());
    check('mailto fallback offered', !t.$('supportMailtoFallback').classList.contains('hidden'));
    check('honeypot present and hidden', !!t.$('supportBotcheck') && /display:\s*none/.test(css.match(/\.support-botcheck\s*\{[^}]*\}/)[0]));
    check('honeypot starts unchecked', t.$('supportBotcheck').checked === false);
    check('honeypot is out of the tab order', t.$('supportBotcheck').getAttribute('tabindex') === '-1');
  }

  console.log('\n3. A successful send posts the right payload');
  {
    const t = boot({ key: TEST_KEY });
    await tick();
    t.click(t.$('supportBtn'));
    t.input(t.$('supportSubject'), 'Timer drifts');
    t.input(t.$('supportReplyTo'), 'user@example.com');
    t.input(t.$('supportMessage'), 'It drifts by 5s.\nSecond line.');
    t.$('supportDiagnostics').checked = true;
    t.click(t.$('supportSend'));
    await tick();
    check('exactly one POST', t.posts.length === 1, t.posts.length);
    const p = t.posts[0];
    check('posts to the Web3Forms endpoint', p.url === ENDPOINT, p.url);
    check('uses POST', p.opts.method === 'POST', p.opts.method);
    check('sends JSON content-type', p.opts.headers['Content-Type'] === 'application/json', p.opts.headers);
    check('asks for a JSON response', p.opts.headers.Accept === 'application/json');
    const b = t.body();
    check('includes the access key', b.access_key === TEST_KEY, b.access_key);
    check('subject carried through', b.subject === 'Timer drifts', b.subject);
    check('message carried through', b.message.startsWith('It drifts by 5s.\nSecond line.'), b.message.slice(0, 40));
    check('reply-to sent as email', b.email === 'user@example.com', b.email);
    check('botcheck sent false', b.botcheck === false, b.botcheck);
    check('diagnostics appended', /App: PomoDone v2\.0\.66/.test(b.message));
    check('no task data leaks into the payload',
      !['SECRET_TASK_TITLE', 'SECRET_NOTES', 'SECRET_PROJECT', 'SECRET_TAG'].some(x => JSON.stringify(b).includes(x)));
    check('modal closed on success', t.$('supportModal').classList.contains('hidden'));
    check('toast confirms and names the reply address',
      /sent/i.test(t.$('toastMsg').textContent) && /user@example\.com/.test(t.$('toastMsg').textContent),
      t.$('toastMsg').textContent);
    check('reply-to remembered for next time',
      t.w.localStorage.getItem('supportReplyTo') === 'user@example.com',
      t.w.localStorage.getItem('supportReplyTo'));
    t.click(t.$('supportBtn'));
    check('reply-to prefilled on reopen', t.$('supportReplyTo').value === 'user@example.com');
    check('message NOT carried over on reopen', t.$('supportMessage').value === '');
  }

  console.log('\n4. Diagnostics opt-out is respected');
  {
    const t = boot({ key: TEST_KEY });
    await tick();
    t.click(t.$('supportBtn'));
    t.input(t.$('supportMessage'), 'plain note');
    t.$('supportDiagnostics').checked = false;
    t.click(t.$('supportSend'));
    await tick();
    check('message is exactly what was typed', t.body().message === 'plain note', t.body().message);
    check('no technical block', !/Technical details/.test(t.body().message));
  }

  console.log('\n5. Anonymous send (no reply address) omits the email field');
  {
    const t = boot({ key: TEST_KEY });
    await tick();
    t.click(t.$('supportBtn'));
    t.input(t.$('supportReplyTo'), '');
    t.input(t.$('supportMessage'), 'anonymous feedback');
    t.click(t.$('supportSend'));
    await tick();
    const b = t.body();
    check('no empty email field sent', !('email' in b), Object.keys(b));
    check('still sends the message', b.message.startsWith('anonymous feedback'), b.message.slice(0, 30));
    check('toast omits a reply promise', !/reply to/i.test(t.$('toastMsg').textContent), t.$('toastMsg').textContent);
  }

  console.log('\n6. Service failure keeps the message and points at the fallback');
  {
    const t = boot({
      key: TEST_KEY,
      postHandler: () => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({ success: false, message: 'Monthly limit reached' }) }),
    });
    await tick();
    t.click(t.$('supportBtn'));
    t.input(t.$('supportMessage'), 'important bug report');
    t.click(t.$('supportSend'));
    await tick();
    check('modal stays open', !t.$('supportModal').classList.contains('hidden'));
    check('message preserved', t.$('supportMessage').value === 'important bug report');
    check('error shown', !t.$('supportStatus').classList.contains('hidden'));
    check('error styled as an error', t.$('supportStatus').className.includes('error'));
    check('error quotes the service reason', /Monthly limit reached/.test(t.$('supportStatus').textContent), t.$('supportStatus').textContent);
    check('error points at the email-app fallback', /email app/i.test(t.$('supportStatus').textContent));
    check('no false success toast', !/sent/i.test(t.$('toastMsg').textContent || ''), t.$('toastMsg').textContent);
    check('send button re-enabled for a retry', t.$('supportSend').disabled === false);
    check('button label restored', t.$('supportSend').textContent === 'Send message', t.$('supportSend').textContent);
    check('reply-to not persisted on failure', t.w.localStorage.getItem('supportReplyTo') === null);
  }

  console.log('\n7. Network error degrades the same way');
  {
    const t = boot({ key: TEST_KEY, postHandler: () => Promise.reject(new Error('Failed to fetch')) });
    await tick();
    t.click(t.$('supportBtn'));
    t.input(t.$('supportMessage'), 'note');
    t.click(t.$('supportSend'));
    await tick();
    check('modal stays open', !t.$('supportModal').classList.contains('hidden'));
    check('error mentions the failure', /Failed to fetch/.test(t.$('supportStatus').textContent), t.$('supportStatus').textContent);
    check('button usable again', t.$('supportSend').disabled === false);
  }

  console.log('\n8. Non-JSON error response is handled');
  {
    const t = boot({ key: TEST_KEY, postHandler: () => Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error('not json')) }) });
    await tick();
    t.click(t.$('supportBtn'));
    t.input(t.$('supportMessage'), 'note');
    t.click(t.$('supportSend'));
    await tick();
    check('falls back to the status code', /502/.test(t.$('supportStatus').textContent), t.$('supportStatus').textContent);
    check('did not throw past the handler', !t.$('supportModal').classList.contains('hidden'));
  }

  console.log('\n9. Offline: no pointless request, clear guidance');
  {
    const t = boot({ key: TEST_KEY, online: false });
    await tick();
    if (t.w.navigator.onLine !== false) {
      console.log('  SKIP  navigator.onLine not overridable in this jsdom');
    } else {
      t.click(t.$('supportBtn'));
      t.input(t.$('supportMessage'), 'offline note');
      t.click(t.$('supportSend'));
      await tick();
      check('no POST attempted while offline', t.posts.length === 0, t.posts.length);
      check('explains the situation', /offline/i.test(t.$('supportStatus').textContent), t.$('supportStatus').textContent);
      check('points at the draft fallback', /email app/i.test(t.$('supportStatus').textContent));
      check('message kept', t.$('supportMessage').value === 'offline note');
    }
  }

  console.log('\n10. Validation and abuse guards');
  {
    const t = boot({ key: TEST_KEY });
    await tick();
    t.click(t.$('supportBtn'));
    // bad email
    t.input(t.$('supportReplyTo'), 'not-an-email');
    t.input(t.$('supportMessage'), 'msg');
    t.click(t.$('supportSend'));
    await tick();
    check('invalid email blocks the send', t.posts.length === 0, t.posts.length);
    check('tells the user what to fix', /email address looks incomplete/i.test(t.$('supportStatus').textContent), t.$('supportStatus').textContent);
    // fix it
    t.input(t.$('supportReplyTo'), 'ok@example.com');
    t.click(t.$('supportSend'));
    await tick();
    check('valid email lets it through', t.posts.length === 1, t.posts.length);
    // empty message
    t.click(t.$('supportBtn'));
    t.input(t.$('supportMessage'), '   ');
    t.click(t.$('supportSend'));
    await tick();
    check('blank message blocks the send', t.posts.length === 1, t.posts.length);
    // honeypot
    t.input(t.$('supportMessage'), 'bot message');
    t.$('supportBotcheck').checked = true;
    t.click(t.$('supportSend'));
    await tick();
    check('honeypot submission silently dropped', t.posts.length === 1, t.posts.length);
  }

  console.log('\n11. No double-send while a request is in flight');
  {
    let release;
    const t = boot({
      key: TEST_KEY,
      postHandler: () => new Promise(r => { release = () => r({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) }); }),
    });
    await tick();
    t.click(t.$('supportBtn'));
    t.input(t.$('supportMessage'), 'slow send');
    t.click(t.$('supportSend'));
    await tick();
    check('button disabled during flight', t.$('supportSend').disabled === true);
    check('button shows progress', t.$('supportSend').textContent === 'Sending…', t.$('supportSend').textContent);
    check('status shows sending', /Sending/.test(t.$('supportStatus').textContent), t.$('supportStatus').textContent);
    t.click(t.$('supportSend'));
    t.click(t.$('supportSend'));
    await tick();
    check('extra clicks did not queue more POSTs', t.posts.length === 1, t.posts.length);
    // Ctrl+Enter bypasses the disabled button, so it needs its own guard.
    t.$('supportMessage').dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    t.$('supportMessage').dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
    await tick();
    check('Ctrl/Cmd+Enter mid-flight does not double-send', t.posts.length === 1, t.posts.length);
    release();
    await tick();
    check('completes normally', t.$('supportModal').classList.contains('hidden'));
  }

  console.log('\n12. The fallback button still opens a mail draft');
  {
    const t = boot({ key: TEST_KEY });
    await tick();
    t.click(t.$('supportBtn'));
    t.input(t.$('supportMessage'), 'draft me');
    const url = t.w.__t.buildSupportMailto();
    check('mailto still composes correctly',
      url.startsWith('mailto:sandeep.kumar.narware@gmail.com?') && /draft%20me/.test(url), url && url.slice(0, 80));
    t.click(t.$('supportMailtoFallback'));
    await tick();
    check('no POST when using the fallback', t.posts.length === 0, t.posts.length);
    check('modal closed via the mailto path', t.$('supportModal').classList.contains('hidden'));
    check('toast is the mailto one', /nothing is sent until/i.test(t.$('toastMsg').textContent), t.$('toastMsg').textContent);
  }

  console.log('\n13. Ctrl+Enter routes to the service when configured');
  {
    const t = boot({ key: TEST_KEY });
    await tick();
    t.click(t.$('supportBtn'));
    t.input(t.$('supportMessage'), 'quick');
    t.$('supportMessage').dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await tick();
    check('POSTed instead of opening a draft', t.posts.length === 1, t.posts.length);
  }

  console.log('\n14. Service worker must not intercept the POST');
  {
    const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    check('non-GET requests bypass the SW', /method !== 'GET'/.test(swJs));
    check('cross-origin requests bypass the SW', /origin !== self\.location\.origin/.test(swJs));
  }

  console.log('\n15. Status styling uses theme tokens');
  {
    const rule = css.match(/\.support-status\.error\s*\{[^}]*\}/);
    check('error state styled', !!rule, rule && rule[0]);
    check('uses error tokens, no literal colours',
      /var\(--error-container\)/.test(rule[0]) && !/#[0-9a-f]{3,6}\b/i.test(rule[0]), rule[0]);
    const info = css.match(/\.support-status\.info\s*\{[^}]*\}/);
    check('info state uses theme tokens', /var\(--/.test(info[0]) && !/#[0-9a-f]{3,6}\b/i.test(info[0]), info[0]);
  }

  console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
