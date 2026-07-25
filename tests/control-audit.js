/* Audits every form control in the app: resolves the CSS cascade (specificity +
   source order + !important + inline styles) to find which background/color
   actually wins, in dark and light mode. Flags controls that fall through to the
   browser's default (white) or to a hard-coded colour. */
const fs = require('fs');
const path = require('path');
const csstree = require('css-tree');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const quotesRaw = fs.readFileSync(path.join(ROOT, 'quotes.json'), 'utf8');

/* ---------- parse stylesheet into ordered rules ---------- */
const ast = csstree.parse(css);
const rules = [];
let order = 0;
csstree.walk(ast, {
  visit: 'Rule',
  enter(node) {
    const decls = [];
    node.block.children.forEach(d => {
      if (d.type === 'Declaration') {
        decls.push({ prop: d.property, value: csstree.generate(d.value).trim(), important: !!d.important });
      }
    });
    csstree.generate(node.prelude).split(',').forEach(sel => {
      rules.push({ sel: sel.trim(), decls, order: order++ });
    });
  },
});

function specificity(sel) {
  const s = sel.replace(/::[a-z-]+/g, ' ');           // pseudo-elements -> type
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const classes = (s.match(/\.[\w\\-]+|\[[^\]]+\]|:(?!:)[a-z-]+(\([^)]*\))?/g) || []).length;
  const types = (s.replace(/#[\w-]+|\.[\w\\-]+|\[[^\]]+\]|:(?!:)[a-z-]+(\([^)]*\))?/g, ' ')
    .match(/\b[a-z][\w-]*\b/g) || []).length;
  return ids * 10000 + classes * 100 + types;
}
/* index.html loads cdn.tailwindcss.com?plugins=forms. The @tailwindcss/forms
   base layer styles bare form controls and is injected AFTER style.css, so it
   wins any specificity tie. Modelled here or the audit is blind to it. */
const FORMS_PLUGIN = [
  {
    sels: ["[type='text']", "input:where(:not([type]))", "[type='email']", "[type='url']",
      "[type='password']", "[type='number']", "[type='date']", "[type='datetime-local']",
      "[type='month']", "[type='search']", "[type='tel']", "[type='time']", "[type='week']",
      '[multiple]', 'textarea', 'select'],
    decls: [
      { prop: 'background-color', value: '#fff', important: false },
      { prop: 'border-color', value: '#6b7280', important: false },
      { prop: 'border-radius', value: '0px', important: false },
    ],
  },
  {
    sels: ["[type='checkbox']", "[type='radio']"],
    decls: [
      { prop: 'background-color', value: '#fff', important: false },
      { prop: 'border-color', value: '#6b7280', important: false },
    ],
  },
  {
    sels: ["[type='checkbox']:checked", "[type='radio']:checked"],
    decls: [
      { prop: 'background-color', value: 'currentColor', important: false },
      { prop: 'border-color', value: 'transparent', important: false },
    ],
  },
];
FORMS_PLUGIN.forEach(group => group.sels.forEach(sel => {
  rules.push({ sel, decls: group.decls, order: order++, plugin: true });
}));

rules.forEach(r => { r.spec = specificity(r.sel); });

/* ---------- resolve a property for one element ---------- */
function resolve(el, props) {
  let best = null;
  for (const r of rules) {
    let m = false;
    try { m = el.matches(r.sel); } catch { m = false; }
    if (!m) continue;
    for (const d of r.decls) {
      if (!props.includes(d.prop)) continue;
      const rank = (d.important ? 1e9 : 0) + r.spec;
      if (!best || rank > best.rank || (rank === best.rank && r.order >= best.order)) {
        best = { rank, order: r.order, sel: r.sel, prop: d.prop, value: d.value, important: d.important, plugin: !!r.plugin };
      }
    }
  }
  // Inline style beats everything non-important.
  const inline = el.getAttribute && el.getAttribute('style');
  if (inline) {
    for (const p of props) {
      const m = new RegExp('(?:^|;)\\s*' + p + '\\s*:\\s*([^;]+)').exec(inline);
      if (m && (!best || !best.important)) best = { rank: 1e8, order: 1e8, sel: 'inline style', prop: p, value: m[1].trim(), important: false };
    }
  }
  return best;
}

/* ---------- boot the app so JS-created controls exist ---------- */
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
  if (String(url) === 'version.json') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ major: 2, minor: 0, patch: 66, commit: 'a', released: '2026-07-25' }) });
  return Promise.reject(new Error('blocked'));
};
w.localStorage.setItem('todos', JSON.stringify([{
  id: 'A', title: 'Parent', description: '', dueDate: null, priority: 'none', project: '', frequency: 'none',
  tags: [], done: false, completedAt: null, createdAt: 1, pomodoros: 0, estPomodoros: 0, wasGolden: false,
  subtasks: [{ id: 'A-s0', title: 'Step', done: false, createdAt: 1 }],
}]));
const s = w.document.createElement('script');
s.textContent = appJs + '\nwindow.__t = { switchTab, toggleSubtaskPanel, openEditModal, openSupportModal, openAddModal, renderQuarterlyGoals };';
w.document.body.appendChild(s);
const doc = w.document;

// Reveal every dynamically-built control.
w.__t.switchTab('tasks');
w.__t.toggleSubtaskPanel('A');
w.__t.openEditModal(0);
w.__t.openSupportModal();
w.__t.switchTab('goals');

/* ---------- collect controls ---------- */
const controls = [...doc.querySelectorAll('input, textarea, select')]
  .filter(el => el.type !== 'hidden' && el.id !== 'supportBotcheck');

const label = (el) => {
  const tag = el.tagName.toLowerCase();
  const t = el.getAttribute('type');
  const id = el.id ? '#' + el.id : '';
  const cls = el.className && typeof el.className === 'string' && el.className.trim()
    ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
  // Nearest identifiable ancestor, so unnamed controls are still recognisable.
  let p = el.parentElement, where = '';
  while (p && !where) {
    if (p.id) where = '#' + p.id;
    else if (p.className && typeof p.className === 'string' && /^[a-z-]+$/.test(p.className.split(/\s+/)[0])) where = '.' + p.className.split(/\s+/)[0];
    p = p.parentElement;
  }
  return `${tag}${t ? `[${t}]` : ''}${id}${cls}  in ${where || '?'}`;
};

// Tailwind utility classes are injected at runtime by the CDN, so they are not in
// style.css; treat a bg-* utility as "themed elsewhere" but report it.
const hasTailwindBg = (el) => /(^|\s)(bg-|dark:bg-)/.test(el.className || '');
const LIGHT_LITERALS = /#(fff|ffffff|f\w{5}|e\w{5})\b|\bwhite\b|rgba?\(\s*2[0-9]{2}/i;

const BG_PROPS = ['background', 'background-color'];
const FG_PROPS = ['color'];

/* Resolve a var() to its hex value for the given theme, then contrast. */
const themeBlocks = {};
csstree.walk(ast, { visit: 'Rule', enter(node) {
  const sel = csstree.generate(node.prelude);
  if (sel !== ':root' && sel !== '.dark') return;
  themeBlocks[sel] = themeBlocks[sel] || {};
  node.block.children.forEach(d => {
    if (d.type === 'Declaration' && d.property.startsWith('--')) themeBlocks[sel][d.property] = csstree.generate(d.value).trim();
  });
}});
function tokenOf(decl, mode) {
  const m = /var\(\s*(--[\w-]+)/.exec(decl || '');
  if (!m) return decl;
  const dark = themeBlocks['.dark'] || {}, light = themeBlocks[':root'] || {};
  return mode === 'dark' ? (dark[m[1]] || light[m[1]]) : light[m[1]];
}
const linC = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
function lumOf(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return 0.2126 * linC((n >> 16) & 255) + 0.7152 * linC((n >> 8) & 255) + 0.0722 * linC(n & 255);
}
function contrastOf(a, b) {
  const la = lumOf(a), lb = lumOf(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function audit(mode) {
  doc.documentElement.classList.toggle('dark', mode === 'dark');
  const findings = [];
  const rows = [];
  controls.forEach(el => {
    const bg = resolve(el, BG_PROPS);
    const fg = resolve(el, FG_PROPS);
    const tw = hasTailwindBg(el);
    let status = 'ok';
    let note = '';
    // Tailwind's utility layer is emitted after the forms base layer, so a bg-*
    // utility legitimately beats the plugin. An app rule losing to it does not.
    if (bg && bg.plugin && tw) {
      status = 'ok';
      note = '';
      rows.push({ control: label(el), bg: '(tailwind bg-* utility beats the forms plugin)', fg: fg ? fg.value : '—', status, note });
      return;
    }
    if (bg && bg.plugin) {
      status = 'FAIL';
      note = `@tailwindcss/forms wins (${bg.sel} -> ${bg.value}). The app rule ties on specificity and the CDN loads later.`;
      rows.push({ control: label(el), bg: `${bg.value}  [${bg.sel}]`, fg: fg ? fg.value : '—', status, note });
      findings.push({ control: label(el), status, note });
      return;
    }
    if (!bg && !tw) {
      // Radio/checkbox with appearance:none and an explicit border is fine.
      const appearance = resolve(el, ['appearance', '-webkit-appearance']);
      if ((el.type === 'checkbox' || el.type === 'radio') && appearance && /none/.test(appearance.value)) {
        status = 'ok'; note = 'custom-drawn control';
      } else {
        status = 'FAIL'; note = 'no background rule -> browser default (white in dark mode)';
      }
    } else if (bg && LIGHT_LITERALS.test(bg.value)) {
      status = 'FAIL'; note = `hard-coded light background ${bg.value}`;
    } else if (bg && !/var\(--/.test(bg.value) && !/transparent|none|inherit/.test(bg.value)) {
      status = 'WARN'; note = `background not a theme token: ${bg.value}`;
    }
    if (status === 'ok' && fg && LIGHT_LITERALS.test(fg.value) && !/var\(--/.test(fg.value)) {
      status = 'WARN'; note = `hard-coded text colour ${fg.value}`;
    }
    if (status === 'ok' && !fg && !tw && !/checkbox|radio/.test(el.type || '')) {
      status = 'WARN'; note = 'no colour rule -> inherits UA text colour';
    }
    // A field the same colour as its container has no visible box at all.
    if (status === 'ok' && bg && /var\(--/.test(bg.value) && !/checkbox|radio/.test(el.type || '')) {
      let p = el.parentElement, parentBg = null;
      while (p && !parentBg) { const r = resolve(p, BG_PROPS); if (r && /var\(--/.test(r.value)) parentBg = r; p = p.parentElement; }
      if (parentBg) {
        const c = contrastOf(tokenOf(bg.value, mode), tokenOf(parentBg.value, mode));
        if (c !== null && c <= 1.02) {
          status = 'FAIL';
          note = `same colour as its container (${parentBg.sel}) — no visible field (contrast ${c.toFixed(2)})`;
        }
      }
    }
    rows.push({
      control: label(el),
      bg: bg ? `${bg.value}  [${bg.sel}]` : (tw ? '(tailwind bg-* utility)' : '—'),
      fg: fg ? fg.value : '—',
      status, note,
    });
    if (status !== 'ok') findings.push({ control: label(el), status, note });
  });
  return { rows, findings };
}

for (const mode of ['dark', 'light']) {
  const { rows, findings } = audit(mode);
  console.log(`\n================ ${mode.toUpperCase()} MODE — ${rows.length} controls ================`);
  rows.forEach(r => {
    const flag = r.status === 'ok' ? '   ' : (r.status === 'FAIL' ? '!! ' : ' ? ');
    console.log(`${flag}${r.control.padEnd(38)} bg: ${r.bg}`);
    if (r.note) console.log(`${' '.repeat(41)}${r.status}: ${r.note}`);
  });
  console.log(`\n--- ${mode}: ${findings.filter(f => f.status === 'FAIL').length} FAIL, ${findings.filter(f => f.status === 'WARN').length} WARN`);
}
