/* Finds theme tokens that :root defines but .dark never overrides, and flags any
   whose light value is bright enough to read as "white" on a dark surface. */
const fs = require('fs');
const path = require('path');
const csstree = require('css-tree');

const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
const ast = csstree.parse(css);

const blocks = {};
csstree.walk(ast, {
  visit: 'Rule',
  enter(node) {
    const sel = csstree.generate(node.prelude);
    if (sel !== ':root' && sel !== '.dark') return;
    blocks[sel] = blocks[sel] || {};
    node.block.children.forEach(d => {
      if (d.type === 'Declaration' && (d.property.startsWith('--') || d.property === 'color-scheme')) {
        blocks[sel][d.property] = csstree.generate(d.value).trim();
      }
    });
  },
});
const light = blocks[':root'] || {};
const dark = blocks['.dark'] || {};

function lum(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Where is each token actually used? Tokens used as a fill/ring matter most.
const usage = {};
csstree.walk(ast, {
  visit: 'Declaration',
  enter(d) {
    const val = csstree.generate(d.value);
    [...val.matchAll(/var\(\s*(--[\w-]+)/g)].forEach(m => {
      (usage[m[1]] = usage[m[1]] || new Set()).add(d.property);
    });
  },
});
const PAINT = /^(background|background-color|box-shadow|border|border-color|border-top|border-left|fill|stroke)/;

console.log(`:root defines ${Object.keys(light).length} tokens; .dark overrides ${Object.keys(dark).length}\n`);

const missing = Object.keys(light).filter(k => !(k in dark));
const problems = [];
console.log('Tokens NOT overridden in .dark (they keep their light value):');
missing.forEach(k => {
  const l = lum(light[k]);
  const props = [...(usage[k] || [])];
  const paints = props.filter(p => PAINT.test(p));
  const bright = l !== null && l > 0.72;
  const flag = bright && paints.length ? '   <== BRIGHT + used as a surface/ring' : (bright ? '   <== bright (text/accent use only)' : '');
  console.log(`  ${k.padEnd(24)} ${light[k].padEnd(11)} ${l !== null ? 'lum ' + l.toFixed(2) : '        '}  used by: ${props.join(', ') || '(unused)'}${flag}`);
  const INTENTIONAL = ['--tertiary-fixed-dim']; // gold golden-task accent, meant to glow on dark
  if (bright && paints.length && !INTENTIONAL.includes(k)) problems.push({ token: k, value: light[k], lum: l, paints });
});

console.log('\n--- Verdict ---');
if (!problems.length) console.log('No bright surface tokens leak into dark mode.');
problems.forEach(p => {
  console.log(`FAIL ${p.token} = ${p.value} (lum ${p.lum.toFixed(2)}) painted via ${p.paints.join(', ')} — near-white on dark surfaces.`);
});

/* ---- foreground legibility ----
   A token used as a text/icon colour has to stay readable on the surfaces it is
   actually painted on, in BOTH themes. This is what caught the PiP icon being
   near-invisible in dark mode. */
console.log('\nForeground tokens vs the surfaces they sit on:');
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
function wcagLum(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
function ratio(a, b) {
  const x = wcagLum(a), y = wcagLum(b);
  if (x === null || y === null) return null;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const tokenIn = (name, mode) => (mode === 'dark' ? (dark[name] || light[name]) : light[name]);

// Surfaces that content is actually drawn on.
const SURFACES = ['--surface', '--surface-container-lowest', '--surface-container-low',
  '--surface-container', '--surface-container-high'];
// Tokens used in a `color:` declaration somewhere in the stylesheet.
const foregrounds = Object.keys(usage).filter((t) => (usage[t] || new Set()).has('color'));
// Only audit tokens that genuinely act as text/icon colours on app surfaces:
//  - "on-*" / "inverse-*" are paired with their own container, not a surface
//  - "surface-*" are surfaces themselves
//  - outline-variant and tertiary-fixed are dividers / decorative fills
//  - trend-* are categorical chart colours, judged as data not as text
const NOT_A_FOREGROUND = /^--on-|^--inverse-|^--surface|^--outline-variant$|^--tertiary-fixed|^--trend-|^--primary-fixed|^--shadow|^--color-scheme/;
const generic = foregrounds.filter((t) => !NOT_A_FOREGROUND.test(t));

const MIN_ICON = 3.0; // WCAG non-text / large-text minimum
const fgProblems = [];
generic.forEach((tok) => {
  ['light', 'dark'].forEach((mode) => {
    const fg = tokenIn(tok, mode);
    if (!/^#[0-9a-f]{6}$/i.test(fg || '')) return;
    let worst = null;
    SURFACES.forEach((surf) => {
      const bg = tokenIn(surf, mode);
      const r = ratio(fg, bg);
      if (r !== null && (worst === null || r < worst.r)) worst = { r, surf, bg };
    });
    if (!worst) return;
    const ok = worst.r >= MIN_ICON;
    console.log(`  ${mode.padEnd(5)} ${tok.padEnd(22)} ${fg}  worst ${worst.r.toFixed(2)} vs ${worst.surf}${ok ? '' : '   <== TOO LOW'}`);
    if (!ok) fgProblems.push({ tok, mode, fg, ...worst });
  });
});
fgProblems.forEach((p) => {
  console.log(`FAIL ${p.tok} = ${p.fg} only reaches ${p.r.toFixed(2)}:1 on ${p.surf} in ${p.mode} mode (need ${MIN_ICON}).`);
});

console.log('\nDocument color-scheme declared?');
const hasRootScheme = /(^|\s)color-scheme\s*:/.test(csstree.generate(ast).replace(/--color-scheme\s*:/g, ''));
const rootHas = Object.entries(blocks).map(([sel, d]) => sel + ': ' + (d['color-scheme'] ? 'yes' : 'no (only the --color-scheme variable)'));
console.log('  ' + rootHas.join('\n  '));
let schemeFails = 0;
Object.entries(blocks).forEach(([sel, d]) => {
  const want = sel === '.dark' ? 'dark' : 'light';
  if (d['color-scheme'] !== want) { schemeFails++; console.log(`FAIL ${sel} must declare color-scheme: ${want}`); }
});
if (!schemeFails) console.log('  both :root and .dark declare color-scheme correctly.');
const total = problems.length + schemeFails + fgProblems.length;
console.log(total === 0 ? '\nALL CHECKS PASSED' : `\n${total} CHECK(S) FAILED`);
process.exit(total ? 1 : 0);
