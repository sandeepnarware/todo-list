/* jsdom harness: version.json drives the displayed version; the deploy workflow
   stamps the patch number on every release. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const deploy = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
const versionRaw = fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8');
const quotesRaw = fs.readFileSync(path.join(ROOT, 'quotes.json'), 'utf8');

let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log('  PASS  ' + label);
  else { fails++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

console.log('\n1. version.json is the source of truth');
let vj;
try { vj = JSON.parse(versionRaw); check('valid JSON', true); }
catch (e) { check('valid JSON', false, e.message); process.exit(1); }
check('has numeric major/minor/patch',
  [vj.major, vj.minor, vj.patch].every(n => Number.isInteger(n)), { major: vj.major, minor: vj.minor, patch: vj.patch });
check('committed patch is 0 (CI owns it)', vj.patch === 0, vj.patch);
check('carries a note warning not to hand-bump patch', /do not bump them manually/i.test(vj._note || ''), vj._note);
check('no version string duplicated in index.html markup',
  !/v\d+\.\d+(\.\d+)?<\/p>\s*<p/.test(html) && (html.match(/v2\.0/g) || []).length === 1,
  (html.match(/v\d+\.\d+(\.\d+)?/g) || []));

console.log('\n2. Markup exposes a single hook with a sane fallback');
const idMatches = html.match(/id="appVersion"/g) || [];
check('exactly one #appVersion element', idMatches.length === 1, idMatches.length);
check('fallback text is a full 3-part version',
  /id="appVersion"[^>]*>v\d+\.\d+\.\d+</.test(html), (html.match(/id="appVersion"[^>]*>[^<]*/) || [])[0]);

console.log('\n3. Deploy workflow stamps the patch on every release');
check('checkout uses full history', /fetch-depth:\s*0/.test(deploy));
check('patch derived from commit count', /git rev-list --count HEAD/.test(deploy));
check('writes version.json', /writeFileSync\("version\.json"/.test(deploy));
check('stamps the commit sha', /GITHUB_SHA/.test(deploy));
check('stamps a release date', /released\s*=/.test(deploy));
check('stamp runs before the artifact upload',
  deploy.indexOf('Stamp release version') < deploy.indexOf('upload-pages-artifact'));
check('does NOT commit back (no push / git commit)', !/git (commit|push)/.test(deploy));
check('still triggers on push to main', /branches:\s*\n\s*- main/.test(deploy));
check('version.json precached by the service worker', /version\.json/.test(swJs));

console.log('\n4. The stamp script actually works (run it here)');
const tmp = path.join(require('os').tmpdir(), 'pomodone-stamp-sandbox');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, 'version.json'), versionRaw);
// Extract the node -e '...' program from the workflow and run it verbatim.
const progMatch = deploy.match(/node -e '\n([\s\S]*?)\n\s*'/);
check('stamp program extractable from the workflow', !!progMatch);
const realCommits = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: ROOT }).toString().trim();
const out = execFileSync(process.execPath, ['-e', progMatch[1]], {
  cwd: tmp,
  env: { ...process.env, PATCH: realCommits, GITHUB_SHA: 'abcdef1234567890' },
}).toString().trim();
const stamped = JSON.parse(fs.readFileSync(path.join(tmp, 'version.json'), 'utf8'));
check('patch set to the commit count', stamped.patch === Number(realCommits), { patch: stamped.patch, commits: realCommits });
check('patch is greater than the committed 0', stamped.patch > 0, stamped.patch);
check('commit truncated to 7 chars', stamped.commit === 'abcdef1', stamped.commit);
check('released is an ISO date', /^\d{4}-\d{2}-\d{2}$/.test(stamped.released), stamped.released);
check('major/minor untouched by the stamp',
  stamped.major === vj.major && stamped.minor === vj.minor, { major: stamped.major, minor: stamped.minor });
check('note preserved', stamped._note === vj._note);
check('logs the released version', /Releasing v\d+\.\d+\.\d+ \(abcdef1\)/.test(out), out);
check('output stays valid JSON with trailing newline',
  fs.readFileSync(path.join(tmp, 'version.json'), 'utf8').endsWith('}\n'));

console.log('\n5. Patch increases with each release (simulated consecutive releases)');
const runStamp = (patch, sha) => {
  execFileSync(process.execPath, ['-e', progMatch[1]], {
    cwd: tmp, env: { ...process.env, PATCH: String(patch), GITHUB_SHA: sha },
  });
  return JSON.parse(fs.readFileSync(path.join(tmp, 'version.json'), 'utf8'));
};
const r1 = runStamp(10, '1111111aaa');
const r2 = runStamp(11, '2222222bbb');
const r3 = runStamp(14, '3333333ccc'); // a push containing 3 commits
check('release N+1 shows a higher patch', r2.patch > r1.patch, [r1.patch, r2.patch]);
check('multi-commit push still increases', r3.patch > r2.patch, [r2.patch, r3.patch]);
check('never repeats a version across releases',
  new Set([r1, r2, r3].map(r => `${r.major}.${r.minor}.${r.patch}`)).size === 3);
check('commit sha changes per release', new Set([r1.commit, r2.commit, r3.commit]).size === 3,
  [r1.commit, r2.commit, r3.commit]);

// --- Runtime rendering ---
function boot(versionResponse) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/tailwind|Could not load|Not implemented/.test(e.message)) console.log('JSDOM ERR:', e.message); });
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/', virtualConsole: vc, pretendToBeVisual: true });
  const w = dom.window;
  w.Notification = { permission: 'denied', requestPermission() {} };
  w.AudioContext = function () { throw new Error('no audio'); };
  w.documentPictureInPicture = null;
  let k = 0;
  w.crypto = Object.assign({}, w.crypto, { randomUUID: () => `u-${++k}` });
  w.alert = () => {};
  const log = [];
  w.fetch = (url) => {
    log.push(String(url));
    if (String(url) === 'quotes.json') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(quotesRaw)) });
    if (String(url) === 'version.json') return versionResponse();
    return Promise.reject(new Error('blocked ' + url));
  };
  const s = w.document.createElement('script');
  s.textContent = appJs + '\nwindow.__t = { loadVersion, formatVersion };';
  w.document.body.appendChild(s);
  return { w, log };
}

(async () => {
  console.log('\n6. Runtime renders the stamped version');
  const released = { _note: vj._note, major: 2, minor: 0, patch: 47, commit: 'deadbee', released: '2026-07-25' };
  const a = boot(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(released) }));
  await a.w.__t.loadVersion();
  const elA = a.w.document.getElementById('appVersion');
  check('shows v2.0.47 from version.json', elA.textContent === 'v2.0.47', elA.textContent);
  check('no longer shows the hardcoded fallback', elA.textContent !== 'v2.0.0');
  check('hover detail includes commit and date',
    elA.title === 'commit deadbee · released 2026-07-25', elA.title);
  check('version.json fetched once at boot',
    a.log.filter(u => u === 'version.json').length === 2, a.log); // init + explicit await

  console.log('\n7. formatVersion handles odd input without breaking the UI');
  check('missing patch falls back to 0', a.w.__t.formatVersion({ major: 3, minor: 1 }) === 'v3.1.0');
  check('all missing falls back to v0.0.0', a.w.__t.formatVersion({}) === 'v0.0.0');
  check('string patch is not concatenated',
    a.w.__t.formatVersion({ major: 2, minor: 0, patch: '9' }) === 'v2.0.0',
    a.w.__t.formatVersion({ major: 2, minor: 0, patch: '9' }));
  check('large patch renders fine', a.w.__t.formatVersion({ major: 2, minor: 0, patch: 1284 }) === 'v2.0.1284');

  console.log('\n8. Falls back gracefully when version.json is unavailable');
  const b = boot(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('nope')) }));
  await b.w.__t.loadVersion();
  const elB = b.w.document.getElementById('appVersion');
  check('keeps the markup fallback text', elB.textContent === 'v2.0.0', elB.textContent);
  check('no title set on failure', !elB.title, elB.title);
  check('rest of the app still boots', !!b.w.document.getElementById('todoList'));

  const c = boot(() => Promise.reject(new Error('offline')));
  await c.w.__t.loadVersion();
  check('network error also leaves the fallback intact',
    c.w.document.getElementById('appVersion').textContent === 'v2.0.0');

  console.log('\n9. Malformed version.json does not blank the version');
  const d = boot(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ nonsense: true }) }));
  await d.w.__t.loadVersion();
  const elD = d.w.document.getElementById('appVersion');
  check('renders v0.0.0 rather than "vundefined"', elD.textContent === 'v0.0.0', elD.textContent);
  check('no NaN/undefined leaks into the UI', !/NaN|undefined/.test(elD.textContent), elD.textContent);

  console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
