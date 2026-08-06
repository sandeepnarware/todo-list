/* jsdom harness: the Tasks tab due-window filter (Today / Tomorrow / This Week /
   This Month). The windows are cumulative and carry overdue work along, so most
   of what is worth checking is which tasks each pill keeps and which it drops.
   Dates are built relative to the day the suite runs — the expectations are
   derived independently of app.js rather than hard-coded. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log('  PASS  ' + label);
  else { fails++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

function boot(seed) {
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
  w.crypto = Object.assign({}, w.crypto, { randomUUID: () => `uuid-${++n}` });
  w.alert = () => {};
  w.fetch = () => Promise.reject(new Error('offline'));
  if (seed) Object.entries(seed).forEach(([k, v]) =>
    w.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));

  const bridge = `
  window.__t = {
    get dueFilter() { return dueFilter; },
    get tagFilter() { return tagFilter; },
    setDueFilter, filterByTag, dueFilterEndKey,
  };`;
  const s = w.document.createElement('script');
  s.textContent = appJs + bridge;
  w.document.body.appendChild(s);
  return { w, doc: w.document, t: w.__t, errors, $: id => w.document.getElementById(id) };
}

const click = (a, el) => el.dispatchEvent(new a.w.MouseEvent('click', { bubbles: true }));
const pill = (a, kind) => a.doc.querySelector(`.due-filter-btn[data-due="${kind}"]`);
const titles = (a) => [...a.$('todoList').querySelectorAll('.task-text')].map(e => e.textContent);
const countOn = (a, kind) => pill(a, kind).querySelector('.due-filter-count').textContent;

/* ---- date fixtures, derived here so app.js is not grading its own homework ---- */
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
const TODAY = shift(0);
const KEYS = {
  overdue: key(shift(-3)),
  today: key(TODAY),
  tomorrow: key(shift(1)),
};
// Sunday-start week, matching the calendar and the stats heatmap.
const weekEnd = shift(6 - TODAY.getDay());
const monthEnd = new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 0);
KEYS.weekEnd = key(weekEnd);
KEYS.monthEnd = key(monthEnd);
KEYS.nextMonth = key(new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 15));

const mkTask = (over = {}) => Object.assign({
  id: 'T', title: 'Task', description: '', dueDate: null, priority: 'none',
  project: '', frequency: 'none', tags: [], done: false, completedAt: null,
  createdAt: 1, pomodoros: 0, estPomodoros: 0, wasGolden: false, subtasks: [], schedule: [],
}, over);

const SEED = [
  mkTask({ id: 'a', title: 'Overdue', dueDate: KEYS.overdue }),
  mkTask({ id: 'b', title: 'Today', dueDate: KEYS.today }),
  mkTask({ id: 'c', title: 'Tomorrow', dueDate: KEYS.tomorrow }),
  mkTask({ id: 'd', title: 'WeekEnd', dueDate: KEYS.weekEnd }),
  mkTask({ id: 'e', title: 'MonthEnd', dueDate: KEYS.monthEnd }),
  mkTask({ id: 'f', title: 'NextMonth', dueDate: KEYS.nextMonth }),
  mkTask({ id: 'g', title: 'Undated', dueDate: null }),
];
// Which of the seed titles each window should keep, worked out from the fixture
// dates alone. Later windows are supersets of earlier ones by construction.
const EXPECTED = {
  today: ['Overdue', 'Today'],
  tomorrow: ['Overdue', 'Today', 'Tomorrow'],
  week: ['Overdue', 'Today', 'Tomorrow', 'WeekEnd'],
  month: ['Overdue', 'Today', 'Tomorrow', 'WeekEnd', 'MonthEnd'],
};
// Fixtures can collide: on a Saturday the week ends today, and on the last day
// of a month "MonthEnd" is today. Dedupe against the actual due keys so the
// expectations stay honest whatever day the suite runs on.
const keyOf = { Overdue: KEYS.overdue, Today: KEYS.today, Tomorrow: KEYS.tomorrow, WeekEnd: KEYS.weekEnd, MonthEnd: KEYS.monthEnd, NextMonth: KEYS.nextMonth };
const ends = { today: KEYS.today, tomorrow: KEYS.tomorrow, week: KEYS.weekEnd, month: KEYS.monthEnd };
Object.keys(EXPECTED).forEach(k => {
  EXPECTED[k] = ['Overdue', 'Today', 'Tomorrow', 'WeekEnd', 'MonthEnd', 'NextMonth']
    .filter(t => keyOf[t] <= ends[k]);
});

const sorted = (a) => [...a].sort();
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

console.log('\n1. The pills exist, and the list starts unfiltered');
{
  const a = boot({ todos: SEED, activeTab: 'tasks' });
  check('boots without errors', a.errors.length === 0, a.errors);
  const kinds = [...a.doc.querySelectorAll('.due-filter-btn')].map(b => b.dataset.due);
  check('all five windows are offered', same(kinds, ['all', 'today', 'tomorrow', 'week', 'month']), kinds);
  check('"All" starts selected', pill(a, 'all').classList.contains('active'));
  check('"All" is marked pressed for screen readers', pill(a, 'all').getAttribute('aria-pressed') === 'true');
  check('every task is listed', titles(a).length === 7, titles(a));
}

console.log('\n2. Each window keeps exactly the tasks due by its last day');
{
  for (const kind of ['today', 'tomorrow', 'week', 'month']) {
    const a = boot({ todos: SEED, activeTab: 'tasks' });
    click(a, pill(a, kind));
    check(`${kind}: ${EXPECTED[kind].join(', ')}`, same(titles(a), EXPECTED[kind]), { got: titles(a), want: EXPECTED[kind] });
    check(`${kind}: the undated task is not claimed to be due`, !titles(a).includes('Undated'));
    check(`${kind}: the pill takes the selection`, pill(a, kind).classList.contains('active') && !pill(a, 'all').classList.contains('active'));
  }
}

console.log('\n3. Overdue work is carried into every window, never hidden');
{
  const a = boot({ todos: SEED, activeTab: 'tasks' });
  ['today', 'tomorrow', 'week', 'month'].forEach(kind => {
    click(a, pill(a, kind));
    check(`${kind} still shows the overdue task`, titles(a).includes('Overdue'), titles(a));
  });
}

console.log('\n4. The task count reflects the window, not the whole list');
{
  const a = boot({ todos: SEED, activeTab: 'tasks' });
  click(a, pill(a, 'today'));
  check('the footer count matches the filtered list',
    a.$('taskCount').textContent === String(EXPECTED.today.length),
    { count: a.$('taskCount').textContent, want: EXPECTED.today.length });
}

console.log('\n5. Each pill carries the number of tasks it would show');
{
  const a = boot({ todos: SEED, activeTab: 'tasks' });
  ['today', 'tomorrow', 'week', 'month'].forEach(kind =>
    check(`${kind} pill reads ${EXPECTED[kind].length}`, countOn(a, kind) === String(EXPECTED[kind].length),
      { got: countOn(a, kind), want: EXPECTED[kind].length }));
  check('"All" carries no count', countOn(a, 'all') === '');
  // Counts must describe the whole open list, not the current selection.
  click(a, pill(a, 'today'));
  check('counts survive a selection', countOn(a, 'month') === String(EXPECTED.month.length), countOn(a, 'month'));
}

console.log('\n6. Counts respect an active tag/project filter');
{
  const a = boot({
    todos: [
      mkTask({ id: 'a', title: 'Work today', dueDate: KEYS.today, project: 'Work' }),
      mkTask({ id: 'b', title: 'Home today', dueDate: KEYS.today, project: 'Home' }),
    ],
    activeTab: 'tasks',
  });
  check('unfiltered, Today counts both', countOn(a, 'today') === '2', countOn(a, 'today'));
  a.t.filterByTag('project:work');
  check('inside a project, Today counts only its tasks', countOn(a, 'today') === '1', countOn(a, 'today'));
  click(a, pill(a, 'today'));
  check('both filters apply together', same(titles(a), ['Work today']), titles(a));
}

console.log('\n7. Clicking the selected pill again goes back to All');
{
  const a = boot({ todos: SEED, activeTab: 'tasks' });
  click(a, pill(a, 'week'));
  check('the week window is on', a.t.dueFilter === 'week');
  click(a, pill(a, 'week'));
  check('a second click clears it', a.t.dueFilter === 'all');
  check('"All" is selected again', pill(a, 'all').classList.contains('active'));
  check('the whole list is back', titles(a).length === 7, titles(a));
}

console.log('\n8. An empty window says so and offers the way out');
{
  const a = boot({ todos: [mkTask({ id: 'z', title: 'Far off', dueDate: KEYS.nextMonth })], activeTab: 'tasks' });
  click(a, pill(a, 'today'));
  const note = a.$('todoList').querySelector('.task-empty-note');
  check('an empty window explains itself', !!note && /nothing due today/i.test(note.textContent), note && note.textContent);
  check('no empty note without a window', (() => {
    const b = boot({ todos: [], activeTab: 'tasks' });
    return !b.$('todoList').querySelector('.task-empty-note');
  })());
  click(a, note.querySelector('button'));
  check('the reset button restores the list', a.t.dueFilter === 'all' && same(titles(a), ['Far off']), titles(a));
}

console.log('\n9. Manual reordering is off while a window hides tasks');
{
  const a = boot({ todos: SEED, activeTab: 'tasks' });
  const anyDraggable = () => [...a.$('todoList').querySelectorAll('li[data-index]')].some(li => li.draggable);
  check('drag works on the unfiltered custom order', anyDraggable());
  click(a, pill(a, 'today'));
  check('drag is disabled inside a window', !anyDraggable());
}

console.log('\n10. The window boundaries are the ones the calendar uses');
{
  const a = boot({ todos: [], activeTab: 'tasks' });
  check('"all" has no boundary', a.t.dueFilterEndKey('all') === null);
  check('today ends today', a.t.dueFilterEndKey('today') === KEYS.today);
  check('tomorrow ends tomorrow', a.t.dueFilterEndKey('tomorrow') === KEYS.tomorrow);
  check('the week ends on Saturday', a.t.dueFilterEndKey('week') === KEYS.weekEnd);
  check('the month ends on its last day', a.t.dueFilterEndKey('month') === KEYS.monthEnd);
  // A leap-year February is the case a naive "same day next month" gets wrong.
  check('February 2028 ends on the 29th',
    a.t.dueFilterEndKey('month', new Date(2028, 1, 10)) === '2028-02-29',
    a.t.dueFilterEndKey('month', new Date(2028, 1, 10)));
  check('a Sunday week runs to the following Saturday',
    a.t.dueFilterEndKey('week', new Date(2026, 7, 2)) === '2026-08-08',
    a.t.dueFilterEndKey('week', new Date(2026, 7, 2)));
}

console.log(fails === 0 ? '\nALL PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
