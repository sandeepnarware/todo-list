/* jsdom harness: the Goals tab. The roadmap is a rolling three months from today
   and everything before it goes to the archive, so most of this is about the
   window boundary (including the year rollover) and the archive's expansion. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');

let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log('  PASS  ' + label);
  else { fails++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

/* Pins "now" so the November case — where the rolling window crosses into the
   next year — can be exercised whatever today happens to be. */
function freezeClock(w, iso) {
  const RealDate = w.Date;
  const fixed = new RealDate(iso).getTime();
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() { return fixed; }
  }
  w.Date = FakeDate;
}

function boot(seed, frozenNow) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    if (!/tailwind|Could not load|Not implemented|razorpay|navigation/i.test(e.message)) errors.push(e.message);
  });
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/', virtualConsole: vc, pretendToBeVisual: true });
  const w = dom.window;
  w.Notification = { permission: 'denied', requestPermission() {} };
  w.AudioContext = function () { throw new Error('no audio'); };
  w.documentPictureInPicture = null;
  let n = 0;
  w.crypto = Object.assign({}, w.crypto, { randomUUID: () => `u-${++n}` });
  w.alert = () => {};
  w.fetch = () => Promise.reject(new Error('offline'));
  if (seed) Object.entries(seed).forEach(([k, v]) =>
    w.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));
  if (frozenNow) freezeClock(w, frozenNow);

  const bridge = `window.__t = { renderQuarterlyGoals, getMonthKey, loadQuarterlyGoals, switchTab };`;
  const s = w.document.createElement('script');
  s.textContent = appJs + bridge;
  w.document.body.appendChild(s);
  return { w, doc: w.document, t: w.__t, errors, $: id => w.document.getElementById(id) };
}

const click = (a, el) => el.dispatchEvent(new a.w.MouseEvent('click', { bubbles: true }));
const goal = (text, done = false) => ({ id: 'g-' + text, text, done });
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const shift = (n) => { const d = new Date(); return monthKey(new Date(d.getFullYear(), d.getMonth() + n, 1)); };

const NOW = new Date();
const THIS_MONTH = monthKey(NOW);

console.log('\n1. The roadmap is a rolling three months from today');
{
  const a = boot({ activeTab: 'goals' });
  const cards = [...a.$('quarterlyGoalsContent').querySelectorAll('.organic-card')];
  check('three month cards', cards.length === 3, cards.length);

  // Anchoring to the calendar quarter meant that in the back half of one the
  // roadmap led with a month that had already finished.
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const expected = [0, 1, 2].map(i => {
    const d = new Date(NOW.getFullYear(), NOW.getMonth() + i, 1);
    return monthNames[d.getMonth()] + (d.getFullYear() === NOW.getFullYear() ? '' : ' ' + d.getFullYear());
  });
  const shown = cards.map(c => c.querySelector('h4').textContent.trim());
  check('it starts at the current month and runs forward', shown.join(' | ') === expected.join(' | '),
    { shown, expected });
  check('the first card is flagged CURRENT', /CURRENT/.test(cards[0].textContent));
  check('and the later two are not',
    !/CURRENT/.test(cards[1].textContent) && !/CURRENT/.test(cards[2].textContent));
  check('every card shows days left', cards.every(c => /Days Left/i.test(c.textContent)), shown);
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n1b. The window crosses the year boundary correctly (frozen at 20 Nov 2026)');
{
  const a = boot({
    activeTab: 'goals',
    quarterlyGoals: {
      '2027-01': [goal('january plan')],
      '2026-10': [goal('october, finished')],
    },
  }, '2026-11-20T10:00:00');
  const content = a.$('quarterlyGoalsContent');
  const shown = [...content.querySelectorAll('.organic-card h4')].map(h => h.textContent.trim());
  check('roadmap runs November -> December -> January',
    shown.join(' | ') === 'November | December | January 2027', shown);
  check('only the month in the other year is year-stamped',
    shown[0] === 'November' && shown[2] === 'January 2027', shown);
  check('next January\'s goal is on the roadmap, not the archive',
    /january plan/.test(content.querySelectorAll('.organic-card')[2].textContent));

  // A numeric month compare said January (1) was behind November (11) and hid
  // the countdown on the one card most likely to need it.
  const cards = [...content.querySelectorAll('.organic-card')];
  check('January still shows its days-left countdown', /Days Left/i.test(cards[2].textContent),
    cards[2].textContent.replace(/\s+/g, ' ').slice(0, 120));
  check('and the count is right for a 31-day month',
    /\b31\b/.test(cards[2].textContent), cards[2].textContent.replace(/\s+/g, ' ').slice(0, 120));
  check('November counts only the days it has left', /\b10\b/.test(cards[0].textContent),
    cards[0].textContent.replace(/\s+/g, ' ').slice(0, 120));

  check('October drops to the archive', content.querySelectorAll('.qg-archive-card').length === 1);
  check('archived under its own year',
    /October 2026/.test(content.querySelector('.qg-archive-title').textContent),
    content.querySelector('.qg-archive-title').textContent);
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n2. A finished month leaves the roadmap and appears once, in the archive');
{
  const a = boot({
    activeTab: 'goals',
    quarterlyGoals: {
      [shift(-1)]: [goal('last month goal', true)],
      [THIS_MONTH]: [goal('this month goal')],
    },
  });
  const content = a.$('quarterlyGoalsContent');
  check('last month is not a roadmap card',
    ![...content.querySelectorAll('.organic-card h4')].some(h => /last month/.test(h.textContent)));
  check('its goal text appears exactly once on the page',
    (content.textContent.match(/last month goal/g) || []).length === 1,
    (content.textContent.match(/last month goal/g) || []).length);
  check('one archive card', content.querySelectorAll('.qg-archive-card').length === 1);
  check('the archive heading is "Archive"', /Archive/.test(content.textContent));
  check('the old "Past Months" wording is gone', !/Past Months/.test(content.textContent));
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n3. The summary counts only the three months on screen');
{
  const a = boot({
    activeTab: 'goals',
    quarterlyGoals: {
      [shift(-2)]: [goal('old a', true), goal('old b', true)],
      [THIS_MONTH]: [goal('now a', true), goal('now b')],
      [shift(1)]: [goal('next a')],
    },
  });
  // It used to fold the archive in while calling the total "this quarter", so the
  // number climbed forever.
  check('reads 1/3, not 3/5',
    /1\/3 goals completed across these three months/.test(a.$('quarterlyGoalsContent').textContent),
    (a.$('quarterlyGoalsContent').textContent.match(/\d+\/\d+ goals completed[^<]*/) || [])[0]);
}

console.log('\n4. An archive month expands to what was planned and what got done');
{
  const last = shift(-1);
  const a = boot({
    activeTab: 'goals',
    quarterlyGoals: { [last]: [goal('shipped it', true), goal('did not get to this')] },
    todos: [
      { id: 'A', title: 'a task', done: true, completedAt: new Date(NOW.getFullYear(), NOW.getMonth() - 1, 15).getTime(),
        subtasks: [], schedule: [], tags: [] },
      { id: 'B', title: 'this month', done: true, completedAt: Date.now(), subtasks: [], schedule: [], tags: [] },
    ],
    pomodoroHistory: [
      { date: last + '-10', time: '09:00', timestamp: new Date(NOW.getFullYear(), NOW.getMonth() - 1, 10, 9).getTime() },
      { date: last + '-11', time: '09:00', timestamp: new Date(NOW.getFullYear(), NOW.getMonth() - 1, 11, 9).getTime() },
    ],
  });
  const card = a.$('quarterlyGoalsContent').querySelector('.qg-archive-card');
  const head = card.querySelector('.qg-archive-head');
  check('starts collapsed', !card.classList.contains('open'));
  check('aria-expanded says so', head.getAttribute('aria-expanded') === 'false');
  check('the header summarises without expanding',
    /1\/2 goals · 50%/.test(head.textContent), head.textContent.replace(/\s+/g, ' '));

  click(a, head);
  const open = a.$('quarterlyGoalsContent').querySelector('.qg-archive-card');
  check('clicking expands it', open.classList.contains('open'));
  check('aria-expanded follows', open.querySelector('.qg-archive-head').getAttribute('aria-expanded') === 'true');

  const items = [...open.querySelectorAll('.qg-archive-item')];
  check('both goals listed', items.length === 2, items.map(i => i.textContent.trim()));
  check('the completed one is marked done',
    items[0].classList.contains('done') && /check_circle/.test(items[0].innerHTML));
  check('the unfinished one is not',
    items[1].classList.contains('open') && /radio_button_unchecked/.test(items[1].innerHTML));
  check('a progress bar reflects 50%', /width:\s*50%/.test(open.querySelector('.qg-archive-bar-fill').outerHTML));

  const stats = open.querySelector('.qg-archive-stats').textContent.replace(/\s+/g, ' ');
  check('tasks completed that month are counted', /1 task completed/.test(stats), stats);
  check('and only that month — this month\'s task is excluded', !/2 tasks/.test(stats), stats);
  check('pomodoros for that month are counted', /2 pomodoros/.test(stats), stats);

  click(a, a.$('quarterlyGoalsContent').querySelector('.qg-archive-head'));
  check('clicking again collapses it',
    !a.$('quarterlyGoalsContent').querySelector('.qg-archive-card').classList.contains('open'));
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n5. The archive is read-only');
{
  const a = boot({
    activeTab: 'goals',
    quarterlyGoals: { [shift(-1)]: [goal('done thing', true)] },
  });
  click(a, a.$('quarterlyGoalsContent').querySelector('.qg-archive-head'));
  const body = a.$('quarterlyGoalsContent').querySelector('.qg-archive-body');
  // An archive you can change by mis-clicking is not a record of anything.
  check('no checkboxes in an archived month', body.querySelectorAll('input').length === 0);
  check('no delete buttons either', body.querySelectorAll('.qg-item-del').length === 0);
  check('and no add row', body.querySelectorAll('.qg-add-btn').length === 0);
  check('the stored goal is untouched',
    a.t.loadQuarterlyGoals()[shift(-1)][0].done === true);
}

console.log('\n6. Newest month first, and several can be open at once');
{
  const a = boot({
    activeTab: 'goals',
    quarterlyGoals: {
      [shift(-1)]: [goal('one month ago')],
      [shift(-2)]: [goal('two months ago')],
      [shift(-3)]: [goal('three months ago')],
    },
  });
  const titles = () => [...a.$('quarterlyGoalsContent').querySelectorAll('.qg-archive-title')]
    .map(t => t.textContent.trim());
  check('three archive cards', titles().length === 3, titles());
  const keys = [...a.$('quarterlyGoalsContent').querySelectorAll('[data-archive]')].map(b => b.dataset.archive);
  check('ordered newest first', keys.join(',') === [shift(-1), shift(-2), shift(-3)].join(','), keys);
  check('each title carries its year', titles().every(t => /\d{4}/.test(t)), titles());

  const heads = () => [...a.$('quarterlyGoalsContent').querySelectorAll('.qg-archive-head')];
  click(a, heads()[0]);
  click(a, heads()[2]);
  const openCards = [...a.$('quarterlyGoalsContent').querySelectorAll('.qg-archive-card.open')];
  check('two open independently', openCards.length === 2, openCards.length);
  check('the middle one stayed shut',
    !a.$('quarterlyGoalsContent').querySelectorAll('.qg-archive-card')[1].classList.contains('open'));
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n7. Empty archive explains itself');
{
  const a = boot({ activeTab: 'goals', quarterlyGoals: { [THIS_MONTH]: [goal('current')] } });
  const content = a.$('quarterlyGoalsContent');
  check('no archive cards', content.querySelectorAll('.qg-archive-card').length === 0);
  check('says nothing is archived yet', /Nothing archived yet/.test(content.textContent));
  check('the roadmap still renders', content.querySelectorAll('.organic-card').length === 3);
}

console.log('\n8. Styling is themed and collapses by default');
{
  check('archive card uses theme tokens',
    /\.qg-archive-card \{[^}]*var\(--surface-container-low\)/.test(css));
  check('body is hidden until the card is open',
    /\.qg-archive-body \{[^}]*display:\s*none/.test(css) &&
    /\.qg-archive-card\.open \.qg-archive-body \{[^}]*display:\s*block/.test(css));
  check('the chevron turns when open',
    /\.qg-archive-card\.open \.qg-archive-chevron \{[^}]*rotate\(180deg\)/.test(css));
}

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
