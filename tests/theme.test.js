/* Verifies the subtask inputs follow the app's own input theme, by comparing
   their declarations against .form-group input (the app's reference input). */
const fs = require('fs');
const path = require('path');
const csstree = require('css-tree');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const quotesRaw = fs.readFileSync(path.join(ROOT, 'quotes.json'), 'utf8');
const versionRaw = fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8');

let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log('  PASS  ' + label);
  else { fails++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

// --- Parse the stylesheet ---
const ast = csstree.parse(css);
const rules = [];
csstree.walk(ast, {
  visit: 'Rule',
  enter(node) {
    const prelude = csstree.generate(node.prelude);
    const decls = {};
    node.block.children.forEach(d => {
      if (d.type === 'Declaration') decls[d.property] = csstree.generate(d.value).trim();
    });
    rules.push({ prelude, selectors: prelude.split(',').map(s => s.trim()), decls });
  },
});
// Later rules win for equal specificity, so merge in source order.
function declsFor(selector) {
  const merged = {};
  rules.filter(r => r.selectors.includes(selector)).forEach(r => Object.assign(merged, r.decls));
  return merged;
}
const has = (selector) => rules.some(r => r.selectors.includes(selector));

/* Match by trailing class + pseudo, so qualifying a selector (e.g. .foo ->
   input.foo to outrank a plugin) doesn't break the lookup. */
function declsLike(cls, pseudo = '') {
  const suffix = '.' + cls + pseudo;
  const merged = {};
  rules.filter(r => r.selectors.some(s => s.endsWith(suffix))).forEach(r => Object.assign(merged, r.decls));
  return merged;
}
const hasLike = (cls, pseudo = '') => rules.some(r => r.selectors.some(s => s.endsWith('.' + cls + pseudo)));

// Locate the app's reference input rule by shape, not by an exact selector
// string, so tightening the selector doesn't break the comparison.
function findRule(pred) {
  const merged = {};
  rules.filter(r => r.selectors.some(pred)).forEach(r => Object.assign(merged, r.decls));
  return merged;
}
const REF = findRule(s => /^\.form-group input/.test(s) && !/:focus/.test(s) && !s.includes('::'));
const REF_FOCUS = findRule(s => /^\.form-group input/.test(s) && /:focus$/.test(s));
const PLACEHOLDER_REF = declsFor('#quickAddInput::placeholder');

console.log('\n0. Reference styles found in the stylesheet');
check("reference form input rule found", Object.keys(REF).length > 0, REF);
check("reference focus rule found", Object.keys(REF_FOCUS).length > 0, REF_FOCUS);
check('#quickAddInput::placeholder exists', Object.keys(PLACEHOLDER_REF).length > 0, PLACEHOLDER_REF);
console.log('  reference:', JSON.stringify({
  radius: REF['border-radius'], border: REF.border, bg: REF.background,
  font: REF['font-family'], focus: REF_FOCUS['box-shadow'],
}));

// Properties that define "the app's input look". `background` is checked
// separately via contrast against each field's own container: matching the
// reference token literally is wrong when the container differs.
const THEME_PROPS = ['border-radius', 'border', 'color', 'font-family', 'outline'];

/* ---- colour helpers for the contrast assertions ---- */
const rootTokens = declsFor(':root');
const darkBlock = rules.find(r => r.selectors.includes('.dark'));
const darkTokens = darkBlock ? darkBlock.decls : {};
const tokenValue = (name, mode) => (mode === 'dark' ? (darkTokens[name] || rootTokens[name]) : rootTokens[name]);
const resolveColour = (decl, mode) => {
  const m = /var\(\s*(--[\w-]+)/.exec(decl || '');
  return m ? tokenValue(m[1], mode) : decl;
};
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const relLum = (hex) => {
  const m = /^#([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const contrast = (a, b) => {
  const la = relLum(a), lb = relLum(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

function assertMatchesTheme(name, cls) {
  console.log(`\n— ${name} (.${cls})`);
  const d = declsLike(cls);
  check('rule exists', Object.keys(d).length > 0);
  THEME_PROPS.forEach(prop => {
    check(`${prop} matches the app input`, d[prop] === REF[prop], { got: d[prop], want: REF[prop] });
  });
  const f = declsLike(cls, ':focus');
  check('has a focus state', Object.keys(f).length > 0);
  check('focus border-color matches', f['border-color'] === REF_FOCUS['border-color'],
    { got: f['border-color'], want: REF_FOCUS['border-color'] });
  check('focus ring matches the app input', f['box-shadow'] === REF_FOCUS['box-shadow'],
    { got: f['box-shadow'], want: REF_FOCUS['box-shadow'] });
  check('transitions box-shadow so the ring animates',
    /box-shadow/.test(d.transition || ''), d.transition);
  // Colour tokens only — otherwise dark/light would break.
  const colourish = [d.background, d.color, d.border, f['border-color'], f['box-shadow']].filter(Boolean).join(' ');
  check('uses CSS variables, no hard-coded colours',
    !/#[0-9a-f]{3,8}\b|\brgba?\(/i.test(colourish), colourish);
}

console.log('\n1. Inline "add a subtask" box (task list) follows the theme');
assertMatchesTheme('inline subtask input', 'subtask-input');

console.log('\n2. Subtask title boxes in the edit modal follow the theme');
assertMatchesTheme('modal subtask title', 'modal-subtask-title');

console.log('\n2b. Each field is visibly distinct from the container it sits on');
// Reference relationship: a modal field on the modal surface.
const modalBg = declsFor('.modal').background;
const refFieldBg = REF.background;
const panelBg = declsFor('.subtask-panel').background;
const inlineFieldBg = declsLike('subtask-input').background;
check('.subtask-panel has a background to compare against', !!panelBg, panelBg);
['light', 'dark'].forEach(mode => {
  const refC = contrast(resolveColour(modalBg, mode), resolveColour(refFieldBg, mode));
  const inlineC = contrast(resolveColour(panelBg, mode), resolveColour(inlineFieldBg, mode));
  console.log(`  ${mode}: modal field vs modal surface = ${refC && refC.toFixed(2)}; ` +
    `inline field vs panel = ${inlineC && inlineC.toFixed(2)}`);
  check(`${mode}: inline field is not the same colour as its panel`, inlineC !== null && inlineC > 1.02, inlineC);
  check(`${mode}: inline field separation is at least as good as the modal's`,
    inlineC !== null && refC !== null && inlineC >= refC - 0.02, { inlineC, refC });
});
// Text must stay legible on whatever fill we chose.
['light', 'dark'].forEach(mode => {
  const c = contrast(resolveColour(inlineFieldBg, mode), resolveColour(declsLike('subtask-input').color, mode));
  check(`${mode}: text on the inline field passes WCAG AA (>=4.5)`, c !== null && c >= 4.5, c && c.toFixed(2));
});
check('inline field background is a theme token', /var\(--/.test(inlineFieldBg), inlineFieldBg);

console.log('\n3. Placeholder is themed, not the browser default');
const ph = declsLike('subtask-input', '::placeholder');
check('placeholder rule exists', hasLike('subtask-input', '::placeholder'));
check('placeholder colour matches the app', ph.color === PLACEHOLDER_REF.color,
  { got: ph.color, want: PLACEHOLDER_REF.color });
check('placeholder opacity matches the app', ph.opacity === PLACEHOLDER_REF.opacity,
  { got: ph.opacity, want: PLACEHOLDER_REF.opacity });

console.log('\n4. Old off-theme values are gone');
const inputD = declsLike('subtask-input');
const modalD = declsLike('modal-subtask-title');
const btnD = declsFor('.subtask-add-btn');
[['.subtask-input', inputD], ['.modal-subtask-title', modalD]].forEach(([sel, d]) => {
  check(`${sel}: no 8px radius`, d['border-radius'] !== '8px', d['border-radius']);
  check(`${sel}: no 1px hairline border`, !/^1px/.test(d.border || ''), d.border);
  check(`${sel}: no surface-container-lowest fill`, !/lowest/.test(d.background || ''), d.background);
  check(`${sel}: font-family not "inherit"`, d['font-family'] !== 'inherit', d['font-family']);
});

console.log('\n5. The Add button matches the app\'s button language');
const BTN_REF = declsFor('.btn-primary');
check('pill shape like other app buttons', btnD['border-radius'] === '999px', btnD['border-radius']);
check('body font, not monospace', !/JetBrains|monospace/.test(btnD['font-family'] || ''), btnD['font-family']);
check('uses container colour tokens',
  btnD.background === 'var(--primary-container)' && btnD.color === 'var(--on-primary-container)',
  { bg: btnD.background, fg: btnD.color });
check('has a press effect like .squishy-button/.press-effect',
  /scale\(0\.9/.test(declsFor('.subtask-add-btn:active').transform || ''),
  declsFor('.subtask-add-btn:active').transform);
check('btn-primary reference is also a pill (same language)',
  BTN_REF['border-radius'] === '999px', BTN_REF['border-radius']);

console.log('\n6. Every token used is defined for BOTH light and dark themes');
const tokens = new Set();
[inputD, modalD, btnD, declsLike('subtask-input', ':focus'), declsLike('modal-subtask-title', ':focus'), ph]
  .forEach(d => Object.values(d).forEach(v => {
    [...String(v).matchAll(/var\(\s*(--[\w-]+)/g)].forEach(m => tokens.add(m[1]));
  }));
const rootDecls = declsFor(':root');
const darkRule = rules.find(r => r.selectors.some(s => /^(\.dark|html\.dark|:root\.dark)$/.test(s)));
check('found a dark-theme block', !!darkRule, darkRule && darkRule.prelude);
const darkDecls = darkRule ? darkRule.decls : {};
console.log('  tokens used:', [...tokens].join(', '));
const missingLight = [...tokens].filter(t => !(t in rootDecls));
check('all tokens defined in :root (light)', missingLight.length === 0, missingLight);
// A token resolves in dark mode if .dark overrides it OR it inherits from :root.
const unresolvedDark = [...tokens].filter(t => !(t in darkDecls) && !(t in rootDecls));
check('all tokens resolve in dark mode (override or inherit)', unresolvedDark.length === 0, unresolvedDark);
const inherited = [...tokens].filter(t => !(t in darkDecls));
console.log('  inherited from :root in dark mode:', inherited.join(', ') || '(none)');
// Whatever the reference input does with those tokens, we must do the same —
// that is what "follows the app theme" means here.
const refTokens = new Set();
[REF, REF_FOCUS].forEach(d => Object.values(d).forEach(v => {
  [...String(v).matchAll(/var\(\s*(--[\w-]+)/g)].forEach(m => refTokens.add(m[1]));
}));
check('any token we inherit in dark mode is one the app input inherits too',
  inherited.every(t => !(t in darkDecls)) && inherited.every(t => refTokens.has(t) || (t in rootDecls)),
  { inherited, refTokens: [...refTokens] });
check('focus ring uses the same token as every other app input',
  /--primary-fixed/.test(declsLike('subtask-input', ':focus')['box-shadow'] || '') &&
  /--primary-fixed/.test(REF_FOCUS['box-shadow'] || ''),
  { ours: declsLike('subtask-input', ':focus')['box-shadow'], app: REF_FOCUS['box-shadow'] });

console.log('\n7. The real elements carry these classes');
const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!/tailwind|Could not load|Not implemented/.test(e.message)) console.log('JSDOM ERR:', e.message); });
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
  if (String(url) === 'version.json') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(versionRaw)) });
  return Promise.reject(new Error('blocked'));
};
w.localStorage.setItem('todos', JSON.stringify([{
  id: 'A', title: 'Parent', description: '', dueDate: null, priority: 'none', project: '', frequency: 'none',
  tags: [], done: false, completedAt: null, createdAt: 1, pomodoros: 0, estPomodoros: 0, wasGolden: false,
  subtasks: [{ id: 'A-s0', title: 'Step one', done: false, createdAt: 1 }],
}]));
const s = w.document.createElement('script');
s.textContent = appJs + '\nwindow.__t = { switchTab, openEditModal, toggleSubtaskPanel };';
w.document.body.appendChild(s);
const doc = w.document;

check('modal add-subtask box uses .subtask-input',
  doc.getElementById('taskSubtaskInput').classList.contains('subtask-input'));
check('modal add button uses .subtask-add-btn',
  doc.getElementById('taskSubtaskAdd').classList.contains('subtask-add-btn'));

w.__t.switchTab('tasks');
w.__t.toggleSubtaskPanel('A');
const panel = doc.querySelector('.subtask-panel');
check('inline panel rendered', !!panel);
check('inline add box uses .subtask-input', !!panel.querySelector('input.subtask-input'));
check('inline add button uses .subtask-add-btn', !!panel.querySelector('button.subtask-add-btn'));
check('inline add box has a placeholder to style',
  !!panel.querySelector('.subtask-input').getAttribute('placeholder'),
  panel.querySelector('.subtask-input').getAttribute('placeholder'));

w.__t.openEditModal(0);
check('modal subtask row input uses .modal-subtask-title',
  !!doc.querySelector('#modalSubtaskList .modal-subtask-title'));

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
