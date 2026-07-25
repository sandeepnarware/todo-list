#!/usr/bin/env node
/* Runs every *.test.js plus the two stylesheet audits, and exits non-zero if any
   of them fail. No framework: each file prints PASS/FAIL lines and sets its own
   exit code, so this just sequences them and summarises. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const files = [
  ...fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort(),
  'control-audit.js',
  'token-audit.js',
];

const verbose = process.argv.includes('--verbose');
const results = [];

for (const file of files) {
  const res = spawnSync(process.execPath, [path.join(dir, file)], { encoding: 'utf8' });
  const out = (res.stdout || '') + (res.stderr || '');
  const passed = res.status === 0;
  results.push({ file, passed, out });
  process.stdout.write(`${passed ? 'PASS' : 'FAIL'}  ${file}\n`);
  if (verbose || !passed) {
    process.stdout.write(out.split('\n').map(l => '      ' + l).join('\n') + '\n');
  }
}

const failed = results.filter(r => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} suites passed`);
if (failed.length) {
  console.log('Failed: ' + failed.map(r => r.file).join(', '));
  process.exit(1);
}
