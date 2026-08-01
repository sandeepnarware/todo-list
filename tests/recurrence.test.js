/* jsdom harness: repeating calendar blocks. A series is stored as one block plus a
   rule (repeat/interval/until) and expanded per rendered day, with `exdates`
   holding the occurrences that were deleted or overridden — so most of what is
   checked here is the expansion math and the "this one vs the whole series" split.

   Dates are fixed, never derived from today, so the suite can't drift. */
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
    get todos() { return todos; },
    get calCursor() { return calCursor; },
    set calCursor(v) { calCursor = v; },
    blockOccursOn, describeRepeat, blockRepeat, blockInterval, blocksForDate,
    taskSchedule, openScheduleModal, setCalView, renderCalendar, openEditModal,
    switchTab,
  };`;
  const s = w.document.createElement('script');
  s.textContent = appJs + bridge;
  w.document.body.appendChild(s);
  return { w, doc: w.document, t: w.__t, errors, $: id => w.document.getElementById(id) };
}

const click = (a, el) => el.dispatchEvent(new a.w.MouseEvent('click', { bubbles: true }));

const mkTask = (over = {}) => Object.assign({
  id: 'T1', title: 'Standup', description: '', dueDate: null, priority: 'none',
  project: 'Work', frequency: 'none', tags: [], done: false, completedAt: null,
  createdAt: 1, pomodoros: 0, estPomodoros: 0, wasGolden: false, subtasks: [], schedule: [],
}, over);

const mkBlock = (over = {}) => Object.assign({
  id: 'B1', date: '2026-03-02', start: '09:00', end: '09:30',
  repeat: 'none', interval: 1, until: null, exdates: [],
}, over);

/* Walks real calendar days so no impossible key (Feb 31) is ever constructed. */
function occurrences(a, block, fromKey, toKey) {
  const out = [];
  const [fy, fm, fd] = fromKey.split('-').map(Number);
  const d = new Date(fy, fm - 1, fd);
  for (;;) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (key > toKey) break;
    if (a.t.blockOccursOn(block, key)) out.push(key);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

const a = boot({ todos: [mkTask()], activeTab: 'calendar' });

console.log('\n0. Date assumptions the rest of the suite leans on');
check('2026-03-02 is a Monday', new Date(2026, 2, 2).getDay() === 1, new Date(2026, 2, 2).getDay());
check('February 2026 has 28 days', new Date(2026, 2, 0).getDate() === 28);
check('2024 is a leap year, 2025 is not',
  new Date(2024, 1, 29).getDate() === 29 && new Date(2025, 1, 29).getDate() !== 29);

console.log('\n1. A block with no rule stays a single date');
{
  const b = mkBlock();
  check('occurs on its own date', a.t.blockOccursOn(b, '2026-03-02'));
  check('and nowhere else', occurrences(a, b, '2026-03-01', '2026-04-30').length === 1);
  const legacy = { id: 'L', date: '2026-03-02', start: '09:00', end: '09:30' }; // pre-recurrence shape
  check('a block saved before recurrence existed is treated as one-off',
    a.t.blockRepeat(legacy) === 'none' && a.t.blockOccursOn(legacy, '2026-03-02')
    && !a.t.blockOccursOn(legacy, '2026-03-03'));
  check('a corrupt repeat value falls back to one-off',
    a.t.blockRepeat({ repeat: 'fortnightly-ish' }) === 'none');
  check('a corrupt interval falls back to 1',
    a.t.blockInterval({ interval: 0 }) === 1 && a.t.blockInterval({ interval: 'x' }) === 1);
  check('interval is capped', a.t.blockInterval({ interval: 5000 }) === 99);
}

console.log('\n2. Daily');
{
  const b = mkBlock({ repeat: 'daily' });
  check('every day from the start', occurrences(a, b, '2026-03-02', '2026-03-08').length === 7);
  check('nothing before the start', !a.t.blockOccursOn(b, '2026-03-01'));
  const every3 = mkBlock({ repeat: 'daily', interval: 3 });
  check('every 3 days lands on 2, 5, 8, 11',
    occurrences(a, every3, '2026-03-01', '2026-03-12').join(',') ===
    '2026-03-02,2026-03-05,2026-03-08,2026-03-11',
    occurrences(a, every3, '2026-03-01', '2026-03-12'));
}

console.log('\n3. Every weekday');
{
  const b = mkBlock({ repeat: 'weekdays' });
  const got = occurrences(a, b, '2026-03-02', '2026-03-15');
  check('10 weekdays across two weeks', got.length === 10, got);
  check('Saturday skipped', !a.t.blockOccursOn(b, '2026-03-07'));
  check('Sunday skipped', !a.t.blockOccursOn(b, '2026-03-08'));
  check('Friday kept', a.t.blockOccursOn(b, '2026-03-06'));
}

console.log('\n4. Weekly');
{
  const b = mkBlock({ repeat: 'weekly' });
  const got = occurrences(a, b, '2026-03-01', '2026-03-31');
  check('only Mondays', got.join(',') === '2026-03-02,2026-03-09,2026-03-16,2026-03-23,2026-03-30', got);
  const fortnightly = mkBlock({ repeat: 'weekly', interval: 2 });
  check('every 2 weeks skips the in-between Monday',
    occurrences(a, fortnightly, '2026-03-01', '2026-03-31').join(',') ===
    '2026-03-02,2026-03-16,2026-03-30',
    occurrences(a, fortnightly, '2026-03-01', '2026-03-31'));
}

console.log('\n5. Monthly');
{
  const b = mkBlock({ date: '2026-03-15', repeat: 'monthly' });
  const got = occurrences(a, b, '2026-03-01', '2026-06-30');
  check('the 15th of each month', got.join(',') === '2026-03-15,2026-04-15,2026-05-15,2026-06-15', got);
  const quarterly = mkBlock({ date: '2026-03-15', repeat: 'monthly', interval: 3 });
  check('every 3 months', occurrences(a, quarterly, '2026-03-01', '2026-09-30').join(',') ===
    '2026-03-15,2026-06-15,2026-09-15', occurrences(a, quarterly, '2026-03-01', '2026-09-30'));

  // A series on the 31st skips short months rather than sliding to the 1st.
  const eom = mkBlock({ date: '2026-01-31', repeat: 'monthly' });
  const eomGot = occurrences(a, eom, '2026-01-01', '2026-04-30');
  check('day 31 skips February entirely', eomGot.join(',') === '2026-01-31,2026-03-31', eomGot);
  check('and does not slide into March 1st or 3rd',
    !a.t.blockOccursOn(eom, '2026-03-01') && !a.t.blockOccursOn(eom, '2026-03-03'));
}

console.log('\n6. Annually');
{
  const b = mkBlock({ date: '2026-03-02', repeat: 'yearly' });
  check('same day each year',
    occurrences(a, b, '2026-01-01', '2029-12-31').join(',') ===
    '2026-03-02,2027-03-02,2028-03-02,2029-03-02');
  const leap = mkBlock({ date: '2024-02-29', repeat: 'yearly' });
  const leapGot = occurrences(a, leap, '2024-01-01', '2029-12-31');
  check('Feb 29 only recurs on leap years', leapGot.join(',') === '2024-02-29,2028-02-29', leapGot);
  check('and never slips to Mar 1 in a common year', !a.t.blockOccursOn(leap, '2025-03-01'));
}

console.log('\n7. Ends-on date and skipped occurrences');
{
  const b = mkBlock({ repeat: 'weekly', until: '2026-03-16' });
  const got = occurrences(a, b, '2026-03-01', '2026-04-30');
  check('the end date is inclusive', got.join(',') === '2026-03-02,2026-03-09,2026-03-16', got);
  check('nothing after it', !a.t.blockOccursOn(b, '2026-03-23'));

  const withEx = mkBlock({ repeat: 'weekly', exdates: ['2026-03-09'] });
  check('an excluded date is skipped', !a.t.blockOccursOn(withEx, '2026-03-09'));
  check('while its neighbours survive',
    a.t.blockOccursOn(withEx, '2026-03-02') && a.t.blockOccursOn(withEx, '2026-03-16'));
}

console.log('\n8. describeRepeat reads back in plain words');
{
  const d = b => a.t.describeRepeat(b);
  check('one-off has nothing to say', d(mkBlock()) === '', d(mkBlock()));
  check('daily', d(mkBlock({ repeat: 'daily' })) === 'Daily', d(mkBlock({ repeat: 'daily' })));
  check('every n days', d(mkBlock({ repeat: 'daily', interval: 3 })) === 'Every 3 days');
  check('weekdays', /weekday/i.test(d(mkBlock({ repeat: 'weekdays' }))));
  check('weekly names the day', /Monday/.test(d(mkBlock({ repeat: 'weekly' }))),
    d(mkBlock({ repeat: 'weekly' })));
  check('every n weeks', /Every 2 weeks on Monday/.test(d(mkBlock({ repeat: 'weekly', interval: 2 }))),
    d(mkBlock({ repeat: 'weekly', interval: 2 })));
  check('monthly names the day of month', /day 2\b/.test(d(mkBlock({ repeat: 'monthly' }))),
    d(mkBlock({ repeat: 'monthly' })));
  check('the end date is mentioned', /until/i.test(d(mkBlock({ repeat: 'weekly', until: '2026-06-01' }))),
    d(mkBlock({ repeat: 'weekly', until: '2026-06-01' })));
}

console.log('\n9. A repeating block renders on every matching day');
{
  const b = boot({
    todos: [mkTask({ schedule: [mkBlock({ repeat: 'daily' })] })],
    activeTab: 'calendar',
    calView: 'week',
  });
  b.t.calCursor = new Date(2026, 2, 2);
  b.t.setCalView('week');
  // The week runs Sun 1st - Sat 7th and the series starts Mon 2nd, so 6 - a
  // series must not back-fill the days before it begins.
  const dates = () => [...b.$('calendarContent').querySelectorAll('.cal-block')].map(x => x.dataset.date);
  check('a daily series fills every column from its start', dates().length === 6, dates());
  check('and does not back-fill the day before it', !dates().includes('2026-03-01'), dates());
  check('each block knows which occurrence it is',
    new Set(dates()).size === 6 && dates().every(Boolean), dates());
  check('all seven point at the same stored block',
    new Set([...b.$('calendarContent').querySelectorAll('.cal-block')].map(x => x.dataset.blockId)).size === 1);
  check('one stored block, not seven', b.t.todos[0].schedule.length === 1);
  check('repeating blocks are marked', !!b.$('calendarContent').querySelector('.cal-block.repeating .cal-repeat-mark'));
  check('no errors', b.errors.length === 0, b.errors);
}

console.log('\n10. Creating a repeating block through the modal');
{
  const b = boot({ todos: [mkTask()], activeTab: 'calendar' });
  click(b, b.$('calAddBtn'));
  check('repeat defaults to "does not repeat"', b.$('schedRepeat').value === 'none');
  check('the detail fields stay out of the way', b.$('schedRepeatDetail').classList.contains('hidden'));
  check('so does the scope question, there being no series yet',
    b.$('schedScope').classList.contains('hidden'));

  b.$('schedRepeat').value = 'weekly';
  b.$('schedRepeat').dispatchEvent(new b.w.Event('change', { bubbles: true }));
  check('choosing a rule reveals interval and end date', !b.$('schedRepeatDetail').classList.contains('hidden'));
  check('the unit follows the rule', /week/.test(b.$('schedIntervalUnit').textContent),
    b.$('schedIntervalUnit').textContent);
  check('and the rule is summarised in words', /Every week|Weekly|week/i.test(b.$('schedRepeatSummary').textContent),
    b.$('schedRepeatSummary').textContent);

  b.$('schedRepeat').value = 'weekdays';
  b.$('schedRepeat').dispatchEvent(new b.w.Event('change', { bubbles: true }));
  check('"every weekday" hides the interval, which would be meaningless',
    b.$('schedIntervalGroup').classList.contains('hidden'));

  b.$('schedRepeat').value = 'weekly';
  b.$('schedInterval').value = '2';
  b.$('schedDate').value = '2026-03-02';
  b.$('schedStart').value = '09:00';
  b.$('schedEnd').value = '09:30';
  b.$('schedUntil').value = '2026-03-30';
  b.$('schedRepeat').dispatchEvent(new b.w.Event('change', { bubbles: true }));
  b.$('schedTask').value = 'T1';
  click(b, b.$('scheduleSave'));

  const saved = b.t.todos[0].schedule[0];
  check('one block saved', b.t.todos[0].schedule.length === 1, b.t.todos[0].schedule);
  check('with the rule attached',
    saved.repeat === 'weekly' && saved.interval === 2 && saved.until === '2026-03-30', saved);
  check('and it survives a reload', (() => {
    const stored = JSON.parse(b.w.localStorage.getItem('todos'))[0].schedule[0];
    return stored.repeat === 'weekly' && stored.interval === 2;
  })());
  check('expanding it gives the fortnightly Mondays',
    occurrences(b, saved, '2026-03-01', '2026-04-30').join(',') === '2026-03-02,2026-03-16,2026-03-30',
    occurrences(b, saved, '2026-03-01', '2026-04-30'));
  check('no errors', b.errors.length === 0, b.errors);
}

console.log('\n11. An end date before the first occurrence is refused');
{
  const b = boot({ todos: [mkTask()], activeTab: 'calendar' });
  click(b, b.$('calAddBtn'));
  b.$('schedTask').value = 'T1';
  b.$('schedDate').value = '2026-03-02';
  b.$('schedRepeat').value = 'weekly';
  b.$('schedUntil').value = '2026-02-01';
  click(b, b.$('scheduleSave'));
  check('nothing saved', b.t.todos[0].schedule.length === 0, b.t.todos[0].schedule);
  check('and it says why', /end before the first occurrence/i.test(b.$('schedError').textContent),
    b.$('schedError').textContent);
}

console.log('\n12. Editing just one occurrence leaves the series alone');
{
  const b = boot({
    todos: [mkTask({ schedule: [mkBlock({ repeat: 'weekly' })] })],
    activeTab: 'calendar',
  });
  // Open the second occurrence, not the series start.
  b.t.openScheduleModal({
    taskId: 'T1', blockId: 'B1', date: '2026-03-09',
    start: '09:00', end: '09:30', repeat: 'weekly', interval: 1, until: null,
  });
  check('the scope question is asked', !b.$('schedScope').classList.contains('hidden'));
  check('and defaults to the narrow, less destructive choice',
    b.doc.querySelector('#schedScope input[value="one"]').checked === true);

  // The rule describes the series, so one occurrence must not be able to redefine it.
  check('the repeat fields are locked while scope is one occurrence',
    b.$('schedRepeat').disabled && b.$('schedInterval').disabled && b.$('schedUntil').disabled);
  check('and the reason is stated', !b.$('schedRepeatLocked').classList.contains('hidden'));
  const allRadio = b.doc.querySelector('#schedScope input[value="all"]');
  allRadio.checked = true;
  allRadio.dispatchEvent(new b.w.Event('change', { bubbles: true }));
  check('switching to the series unlocks them', !b.$('schedRepeat').disabled);
  check('and drops the note', b.$('schedRepeatLocked').classList.contains('hidden'));
  const oneRadio = b.doc.querySelector('#schedScope input[value="one"]');
  oneRadio.checked = true;
  oneRadio.dispatchEvent(new b.w.Event('change', { bubbles: true }));
  check('and back again', b.$('schedRepeat').disabled);

  b.$('schedStart').value = '11:00';
  b.$('schedEnd').value = '11:30';
  click(b, b.$('scheduleSave'));

  const series = b.t.todos[0].schedule.find(x => x.id === 'B1');
  const override = b.t.todos[0].schedule.find(x => x.id !== 'B1');
  check('the series keeps its own time', series.start === '09:00', series);
  check('and its rule', series.repeat === 'weekly');
  check('the edited date is excluded from it', series.exdates.includes('2026-03-09'), series.exdates);
  check('a standalone block replaces that one date', !!override && override.date === '2026-03-09', override);
  check('at the new time', override.start === '11:00' && override.end === '11:30', override);
  check('and it does not itself repeat', b.t.blockRepeat(override) === 'none', override);

  const moved = b.t.blocksForDate('2026-03-09');
  check('that day shows exactly one entry', moved.length === 1, moved.map(x => x.block));
  check('at the moved time', moved[0].block.start === '11:00');
  const untouched = b.t.blocksForDate('2026-03-16');
  check('the following week is untouched',
    untouched.length === 1 && untouched[0].block.start === '09:00', untouched.map(x => x.block));
  const first = b.t.blocksForDate('2026-03-02');
  check('so is the series start', first.length === 1 && first[0].block.start === '09:00');
  check('no errors', b.errors.length === 0, b.errors);
}

console.log('\n12b. One occurrence can be moved past the series\' own end date');
{
  const b = boot({
    todos: [mkTask({ schedule: [mkBlock({ repeat: 'weekly', until: '2026-03-30' })] })],
    activeTab: 'calendar',
  });
  b.t.openScheduleModal({
    taskId: 'T1', blockId: 'B1', date: '2026-03-09',
    start: '09:00', end: '09:30', repeat: 'weekly', interval: 1, until: '2026-03-30',
  });
  // The detached block carries no rule, so the series' end date is not its business.
  b.$('schedDate').value = '2026-04-20';
  click(b, b.$('scheduleSave'));
  check('the move is allowed', b.$('schedError').classList.contains('hidden'),
    b.$('schedError').textContent);
  check('a standalone block sits on the new date',
    b.t.blocksForDate('2026-04-20').length === 1, b.t.todos[0].schedule);
  check('the series still ends where it did',
    b.t.todos[0].schedule.find(x => x.id === 'B1').until === '2026-03-30');
  check('and the vacated date is empty', b.t.blocksForDate('2026-03-09').length === 0);
}

console.log('\n13. Editing the entire series moves every occurrence');
{
  const b = boot({
    todos: [mkTask({ schedule: [mkBlock({ repeat: 'weekly' })] })],
    activeTab: 'calendar',
  });
  b.t.openScheduleModal({
    taskId: 'T1', blockId: 'B1', date: '2026-03-09',
    start: '09:00', end: '09:30', repeat: 'weekly', interval: 1, until: null,
  });
  b.doc.querySelector('#schedScope input[value="all"]').checked = true;
  b.$('schedStart').value = '11:00';
  b.$('schedEnd').value = '11:30';
  click(b, b.$('scheduleSave'));

  check('still a single stored block', b.t.todos[0].schedule.length === 1, b.t.todos[0].schedule);
  check('the series itself moved', b.t.todos[0].schedule[0].start === '11:00');
  check('nothing was excluded', b.t.todos[0].schedule[0].exdates.length === 0);
  check('a later occurrence shows the new time',
    b.t.blocksForDate('2026-03-16')[0].block.start === '11:00');
  check('no errors', b.errors.length === 0, b.errors);
}

console.log('\n14. Turning a series back into a one-off clears its exceptions');
{
  const b = boot({
    todos: [mkTask({ schedule: [mkBlock({ repeat: 'weekly', exdates: ['2026-03-09'] })] })],
    activeTab: 'calendar',
  });
  b.t.openScheduleModal({
    taskId: 'T1', blockId: 'B1', date: '2026-03-02',
    start: '09:00', end: '09:30', repeat: 'weekly', interval: 1, until: null,
  });
  b.doc.querySelector('#schedScope input[value="all"]').checked = true;
  b.$('schedRepeat').value = 'none';
  b.$('schedRepeat').dispatchEvent(new b.w.Event('change', { bubbles: true }));
  click(b, b.$('scheduleSave'));
  check('no longer repeats', b.t.blockRepeat(b.t.todos[0].schedule[0]) === 'none');
  check('stale exceptions dropped', b.t.todos[0].schedule[0].exdates.length === 0,
    b.t.todos[0].schedule[0].exdates);
  check('only the original date is left',
    b.t.blocksForDate('2026-03-02').length === 1 && b.t.blocksForDate('2026-03-09').length === 0);
}

console.log('\n15. The grid\'s x skips one day; it never wipes a series');
{
  const b = boot({
    todos: [mkTask({ schedule: [mkBlock({ repeat: 'daily' })] })],
    activeTab: 'calendar',
  });
  b.t.calCursor = new Date(2026, 2, 4);
  b.t.setCalView('day');
  const block = b.$('calendarContent').querySelector('.cal-block');
  check('the day shows its occurrence', !!block && block.dataset.date === '2026-03-04', block && block.dataset.date);
  click(b, block.querySelector('.cal-block-del'));
  check('the series is still stored', b.t.todos[0].schedule.length === 1, b.t.todos[0].schedule);
  check('only that date was excluded',
    b.t.todos[0].schedule[0].exdates.join(',') === '2026-03-04', b.t.todos[0].schedule[0].exdates);
  check('that day is now clear', b.t.blocksForDate('2026-03-04').length === 0);
  check('the next day is not', b.t.blocksForDate('2026-03-05').length === 1);
  check('the toast names the day it skipped', /Skipped/.test(b.$('toastMsg').textContent),
    b.$('toastMsg').textContent);
  click(b, b.$('toastUndo'));
  check('undo brings the occurrence back', b.t.blocksForDate('2026-03-04').length === 1);
  check('no errors', b.errors.length === 0, b.errors);
}

console.log('\n16. Unschedule with "entire series" removes the whole thing');
{
  const b = boot({
    todos: [mkTask({ schedule: [mkBlock({ repeat: 'daily' })] })],
    activeTab: 'calendar',
  });
  b.t.openScheduleModal({
    taskId: 'T1', blockId: 'B1', date: '2026-03-04',
    start: '09:00', end: '09:30', repeat: 'daily', interval: 1, until: null,
  });
  b.doc.querySelector('#schedScope input[value="all"]').checked = true;
  click(b, b.$('scheduleDelete'));
  check('the block is gone', b.t.todos[0].schedule.length === 0, b.t.todos[0].schedule);
  check('the task survives', b.t.todos.length === 1);
  check('every day is clear',
    b.t.blocksForDate('2026-03-04').length === 0 && b.t.blocksForDate('2026-03-05').length === 0);
  check('the toast says it was the series', /series/i.test(b.$('toastMsg').textContent), b.$('toastMsg').textContent);
  click(b, b.$('toastUndo'));
  check('undo restores the series', b.t.todos[0].schedule.length === 1);
  check('and its occurrences', b.t.blocksForDate('2026-03-05').length === 1);
}

console.log('\n17. Unschedule with "just this occurrence" only skips one');
{
  const b = boot({
    todos: [mkTask({ schedule: [mkBlock({ repeat: 'daily' })] })],
    activeTab: 'calendar',
  });
  b.t.openScheduleModal({
    taskId: 'T1', blockId: 'B1', date: '2026-03-04',
    start: '09:00', end: '09:30', repeat: 'daily', interval: 1, until: null,
  });
  // "one" is the default, so this is the path a hurried user takes.
  click(b, b.$('scheduleDelete'));
  check('the series is intact', b.t.todos[0].schedule.length === 1);
  check('one date excluded', b.t.todos[0].schedule[0].exdates.join(',') === '2026-03-04');
  check('neighbours unaffected', b.t.blocksForDate('2026-03-05').length === 1);
}

console.log('\n18. Recurrence is editable from the task form too');
{
  const b = boot({
    todos: [mkTask({ schedule: [mkBlock({ repeat: 'weekly', interval: 2, until: '2026-06-01' })] })],
    activeTab: 'tasks',
  });
  b.t.openEditModal(0);
  const sel = b.$('modalScheduleList').querySelector('.modal-schedule-repeat');
  check('the row carries a repeat select', !!sel);
  check('showing the current rule', sel.value === 'weekly', sel.value);
  check('and the rule spelled out beneath it',
    /Every 2 weeks/.test(b.$('modalScheduleList').querySelector('.modal-schedule-rule').textContent),
    b.$('modalScheduleList').querySelector('.modal-schedule-rule').textContent);

  sel.value = 'daily';
  sel.dispatchEvent(new b.w.Event('change', { bubbles: true }));
  click(b, b.$('modalSave'));
  check('the change is saved', b.t.todos[0].schedule[0].repeat === 'daily', b.t.todos[0].schedule[0]);
  check('interval is preserved rather than silently reset',
    b.t.todos[0].schedule[0].interval === 2, b.t.todos[0].schedule[0]);

  b.t.openEditModal(0);
  const sel2 = b.$('modalScheduleList').querySelector('.modal-schedule-repeat');
  sel2.value = 'none';
  sel2.dispatchEvent(new b.w.Event('change', { bubbles: true }));
  click(b, b.$('modalSave'));
  check('switching to one-off drops the end date', b.t.todos[0].schedule[0].until === null,
    b.t.todos[0].schedule[0]);
  check('no errors', b.errors.length === 0, b.errors);
}

console.log('\n19. A repeating block reaches Today\'s Schedule');
{
  const today = new Date();
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  // Starts a year back and repeats daily, so it must cover today whatever today is.
  const startKey = `${today.getFullYear() - 1}-01-01`;
  const b = boot({
    todos: [mkTask({ schedule: [mkBlock({ date: startKey, repeat: 'daily' })] })],
    activeTab: 'dashboard',
  });
  const rows = b.$('todayScheduleBody').querySelectorAll('.today-row');
  check('today shows the recurring block', rows.length === 1, b.$('todayScheduleBody').textContent);
  check('marked as repeating', !!rows[0].querySelector('.cal-repeat-mark'));
  check('and the rule is in its tooltip', /Daily/.test(rows[0].getAttribute('title') || ''),
    rows[0].getAttribute('title'));
  check('an excluded today would hide it', (() => {
    const c = boot({
      todos: [mkTask({ schedule: [mkBlock({ date: startKey, repeat: 'daily', exdates: [key] })] })],
      activeTab: 'dashboard',
    });
    return c.$('todayScheduleBody').querySelectorAll('.today-row').length === 0;
  })());
  check('no errors', b.errors.length === 0, b.errors);
}

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
