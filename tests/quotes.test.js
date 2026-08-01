/* jsdom harness: quotes come from quotes.json, are strictly on-topic, randomized,
   and involve no external network call. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const quotesRaw = fs.readFileSync(path.join(ROOT, 'quotes.json'), 'utf8');

let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log('  PASS  ' + label);
  else { fails++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

// Topic vocabularies: every quote must contain a word from its own topic.
const TOPIC_WORDS = {
  time: ['time', 'hour', 'hours', 'clock', 'day', 'days', 'today', 'tomorrow', 'yesterday', 'someday',
    'minute', 'minutes', 'delay', 'patience', 'future', 'schedule', 'priorities', 'punctuality', 'morning'],
  success: ['success', 'successes', 'successful', 'succeed', 'failure', 'great', 'value',
    'extraordinary', 'extraordinarily', 'climbed', 'achieved', 'hardship'],
  hardwork: ['work', 'worked', 'working', 'hard', 'harder', 'labor', 'job', 'jobs', 'effort', 'efforts',
    'perspiration', 'diligence', 'perseverance', 'persistence', 'talent', 'stop'],
};

console.log('\n=== PART A: quotes.json as data ===');
let data;
try { data = JSON.parse(quotesRaw); check('quotes.json is valid JSON', true); }
catch (e) { check('quotes.json is valid JSON', false, e.message); process.exit(1); }

console.log('\n1. Shape and size');
check('exactly 100 quotes', data.quotes.length === 100, data.quotes.length);
check('declares the three topics',
  Object.keys(data.topics).join(',') === 'time,success,hardwork', Object.keys(data.topics));
const counts = {};
data.quotes.forEach(q => { counts[q.topic] = (counts[q.topic] || 0) + 1; });
check('every quote has a declared topic', Object.keys(counts).every(k => data.topics[k]), counts);
check('all three topics well represented (>=30 each)',
  Object.values(counts).every(c => c >= 30) && Object.keys(counts).length === 3, counts);
check('every entry has q + a strings',
  data.quotes.every(q => typeof q.q === 'string' && q.q.trim() && typeof q.a === 'string' && q.a.trim()));

console.log('\n2. Strictly on-topic, attributed, unique');
const offTopic = [];
data.quotes.forEach(item => {
  const words = item.q.toLowerCase().replace(/[^a-z\s']/g, ' ').split(/\s+/);
  if (!TOPIC_WORDS[item.topic].some(kw => words.includes(kw))) offTopic.push([item.topic, item.q]);
});
check('no off-topic quote', offTopic.length === 0, offTopic);
check('no "Unknown" / blank attributions',
  data.quotes.every(q => q.a && q.a.trim() && q.a !== 'Unknown'),
  data.quotes.filter(q => !q.a || q.a === 'Unknown').map(q => q.q));
const texts = data.quotes.map(q => q.q);
check('no duplicate quote text', texts.filter((q, i) => texts.indexOf(q) !== i).length === 0,
  texts.filter((q, i) => texts.indexOf(q) !== i));
check('no quote is absurdly long for a card', data.quotes.every(q => q.q.length <= 170),
  data.quotes.filter(q => q.q.length > 170).map(q => [q.q.length, q.q]));

console.log('\n=== PART B: app wiring ===');
console.log('\n3. No external API left in the source');
// Every fetch() argument in the file, literal or identifier.
const fetchArgs = [...appJs.matchAll(/fetch\(\s*([^)\s,]+)/g)].map(m => m[1]);
// WEB3FORMS_ENDPOINT is the support form's outbound POST — unrelated to quotes.
check('every fetch() targets a known constant (no ad-hoc URLs)',
  fetchArgs.length > 0 && fetchArgs.every(a => ['QUOTES_URL', 'VERSION_URL', 'WEB3FORMS_ENDPOINT'].includes(a)), fetchArgs);
check('quotes are fetched via QUOTES_URL', fetchArgs.includes('QUOTES_URL'), fetchArgs);
check("QUOTES_URL is the local 'quotes.json'", /const QUOTES_URL\s*=\s*["']quotes\.json["']/.test(appJs),
  (appJs.match(/const QUOTES_URL\s*=.*/) || [])[0]);
check('the URL is relative, not absolute/cross-origin', !/QUOTES_URL\s*=\s*['"]https?:/.test(appJs));
check('no fetch to any quotes host',
  !/fetch\([^)]*(quotable|dummyjson|zenquotes|quoteslate)/.test(appJs));
check('inline TOPIC_QUOTES pool removed', !/const TOPIC_QUOTES\s*=/.test(appJs));
check('old fetchQuotes() gone', !/function fetchQuotes/.test(appJs) && !/[^a-zA-Z]fetchQuotes\(/.test(appJs));

console.log('\n4. Service worker precaches quotes.json');
check('quotes.json in the precache list', /quotes\.json/.test(swJs));
check('cache version bumped past v3', /pomodone-v[4-9]/.test(swJs), (swJs.match(/pomodone-v\d/) || [])[0]);

// --- Boot the app with quotes.json served from disk, everything else blocked ---
const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!/tailwind|Could not load|Not implemented/.test(e.message)) console.log('JSDOM ERR:', e.message); });
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/', virtualConsole: vc, pretendToBeVisual: true });
const w = dom.window;
w.Notification = { permission: 'denied', requestPermission() {} };
w.AudioContext = function () { throw new Error('no audio'); };
w.documentPictureInPicture = null;
let nn = 0;
w.crypto = Object.assign({}, w.crypto, { randomUUID: () => `uuid-${++nn}` });
w.alert = () => {};

const fetchLog = [];
w.fetch = (url) => {
  fetchLog.push(String(url));
  if (String(url) === 'quotes.json') {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(quotesRaw)) });
  }
  return Promise.reject(new Error('blocked: ' + url));
};

const bridge = `window.__t = { loadQuotes, renderDashboardQuotes, pickQuotes, switchTab,
  get quotePool(){ return quotePool; }, get quotesState(){ return quotesState; },
  QUOTE_TOPIC_LABELS, QUOTES_SHOWN };`;
const script = w.document.createElement('script');
script.textContent = appJs + bridge;
w.document.body.appendChild(script);

const T = w.__t;
const container = w.document.getElementById('dashQuotes');
// Driven off the app's own constant rather than a hard-coded 3: how many quotes
// the dashboard shows is a layout decision and has changed once already.
const N = T.QUOTES_SHOWN;

(async () => {
  await T.loadQuotes();

  console.log('\n5. Load path');
  check('quotes.json requested at boot',
    fetchLog.filter(u => u === 'quotes.json').length === 2, fetchLog); // init + explicit await
  check('only local json files fetched',
    fetchLog.every(u => u === 'quotes.json' || u === 'version.json'), fetchLog);
  check('pool holds all 100', T.quotePool.length === 100, T.quotePool.length);
  check('state is ready', T.quotesState === 'ready', T.quotesState);
  check('labels came from the JSON', T.QUOTE_TOPIC_LABELS.hardwork === 'Hard Work', T.QUOTE_TOPIC_LABELS);

  console.log(`\n6. Render: ${N} random card(s)`);
  const cards = container.querySelectorAll('.organic-card');
  check(`${N} card(s) shown`, cards.length === N, cards.length);
  check('each card has a topic chip', container.querySelectorAll('.quote-topic').length === N);
  check('chips use a known label',
    [...container.querySelectorAll('.quote-topic')].every(c => ['Time', 'Success', 'Hard Work'].includes(c.textContent)),
    [...container.querySelectorAll('.quote-topic')].map(c => c.textContent));
  check('each card shows an attribution', [...cards].every(c => /&mdash;|—/.test(c.innerHTML)));

  console.log('\n7. Every rendered card traces back to quotes.json');
  const byText = new Map(data.quotes.map(q => [q.q, q]));
  let mismatch = [];
  let dupWithinRender = 0;
  for (let round = 0; round < 300; round++) {
    T.renderDashboardQuotes();
    const cs = [...container.querySelectorAll('.organic-card')];
    if (cs.length !== N) { mismatch.push(['card count', cs.length]); break; }
    const seenHere = new Set();
    cs.forEach(card => {
      const text = card.querySelector('p').textContent;
      const found = data.quotes.find(q => text.includes(q.q) && text.includes(q.a));
      if (!found) { mismatch.push(['unknown quote', text]); return; }
      if (seenHere.has(found.q)) dupWithinRender++;
      seenHere.add(found.q);
      // chip label must match the quote's own topic
      const chip = card.querySelector('.quote-topic');
      if (chip.textContent !== data.topics[found.topic]) mismatch.push(['chip mismatch', found.topic, chip.textContent]);
      if (!chip.className.includes('quote-topic-' + found.topic)) mismatch.push(['chip class mismatch', found.topic, chip.className]);
    });
  }
  check(`${300 * N} rendered cards all came from quotes.json with the right chip`, mismatch.length === 0, mismatch.slice(0, 3));
  check('never repeats a quote inside one render', dupWithinRender === 0, dupWithinRender);

  console.log('\n8. Randomization quality');
  const seen = new Set();
  const topicHits = {};
  for (let round = 0; round < 2000; round++) {
    T.renderDashboardQuotes();
    [...container.querySelectorAll('.organic-card p')].forEach(p => {
      const found = data.quotes.find(q => p.textContent.includes(q.q));
      if (found) { seen.add(found.q); topicHits[found.topic] = (topicHits[found.topic] || 0) + 1; }
    });
  }
  check('all 100 quotes reachable', seen.size === 100, seen.size);
  check('draws span all three topics', Object.keys(topicHits).length === 3, topicHits);
  // A pure random draw over 34/33/33 should land near-proportional; allow generous slack.
  const total = Object.values(topicHits).reduce((a, b) => a + b, 0);
  const shares = Object.fromEntries(Object.entries(topicHits).map(([k, v]) => [k, +(v / total).toFixed(3)]));
  check('no topic dominates (each 25-42% of draws)',
    Object.values(shares).every(s => s > 0.25 && s < 0.42), shares);

  console.log('\n9. Consecutive renders never repeat the previous trio');
  let repeats = 0;
  T.renderDashboardQuotes();
  let prev = [...container.querySelectorAll('.organic-card p')].map(p => p.textContent);
  for (let round = 0; round < 500; round++) {
    T.renderDashboardQuotes();
    const now = [...container.querySelectorAll('.organic-card p')].map(p => p.textContent);
    now.forEach(t => { if (prev.includes(t)) repeats++; });
    prev = now;
  }
  check('no quote carries over between consecutive renders', repeats === 0, repeats);

  console.log('\n10. Switching to the dashboard re-randomizes without refetching');
  const before = fetchLog.length;
  T.switchTab('tasks');
  T.switchTab('dashboard');
  check('no extra network call on tab switch', fetchLog.length === before, fetchLog.slice(before));
  check(`still ${N} card(s) after tab switch`, container.querySelectorAll('.organic-card').length === N);

  console.log('\n11. Graceful failure if quotes.json cannot be loaded');
  const dom2 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/', virtualConsole: vc, pretendToBeVisual: true });
  const w2 = dom2.window;
  w2.Notification = { permission: 'denied', requestPermission() {} };
  w2.AudioContext = function () { throw new Error('no audio'); };
  w2.documentPictureInPicture = null;
  let mm = 0;
  w2.crypto = Object.assign({}, w2.crypto, { randomUUID: () => `u-${++mm}` });
  w2.alert = () => {};
  w2.fetch = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('nope')) });
  const s2 = w2.document.createElement('script');
  s2.textContent = appJs + bridge;
  w2.document.body.appendChild(s2);
  await w2.__t.loadQuotes();
  const c2 = w2.document.getElementById('dashQuotes');
  check('app still boots with quotes.json missing', w2.__t.quotesState === 'error', w2.__t.quotesState);
  check('shows a muted fallback message, not a blank gap', /Quotes unavailable/.test(c2.textContent), c2.innerHTML);
  check('no cards rendered from a failed load', c2.querySelectorAll('.organic-card').length === 0);
  check('rest of the dashboard still renders', !!w2.document.getElementById('dashTaskList').innerHTML);

  console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
