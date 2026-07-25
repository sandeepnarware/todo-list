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
const total = problems.length + schemeFails;
console.log(total === 0 ? '\nALL CHECKS PASSED' : `\n${total} CHECK(S) FAILED`);
process.exit(total ? 1 : 0);
