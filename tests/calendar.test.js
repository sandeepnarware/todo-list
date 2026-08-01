/* jsdom harness: the Calendar tab — month/week/day rendering, scheduling from the
   grid, the task modal's multi-block editor, and the dashboard's Today's Schedule
   panel. Tasks own their time blocks (`schedule: [{id,date,start,end}]`), so most
   of what's checked here is that a block survives a round trip through storage and
   lands on the right day at the right offset. */
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

/* Boots a fresh app instance with the given localStorage seed. Top-level let/const
   in app.js aren't window properties, so a bridge exposes what the test drives. */
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
    get calView() { return calView; },
    get scheduleDraft() { return scheduleDraft; },
    switchTab, setCalView, openEditModal, layoutDayBlocks, blocksForDate, calMinutes,
  };`;
  const s = w.document.createElement('script');
  s.textContent = appJs + bridge;
  w.document.body.appendChild(s);
  return { w, doc: w.document, t: w.__t, errors, $: id => w.document.getElementById(id) };
}

const click = (a, el) => el.dispatchEvent(new a.w.MouseEvent('click', { bubbles: true }));

const mkTask = (over = {}) => Object.assign({
  id: 'T1', title: 'Ship feature', description: '', dueDate: null, priority: 'none',
  project: 'Work', frequency: 'none', tags: ['api'], done: false, completedAt: null,
  createdAt: 1, pomodoros: 3, estPomodoros: 4, wasGolden: false, subtasks: [], schedule: [],
}, over);

const todayKey = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const HOUR_PX = 44; // must track CAL_HOUR_PX in app.js

console.log('\n1. A task with no schedule field is migrated, not dropped');
{
  const a = boot({ todos: [{ id: 'X', title: 'old task', done: false }] });
  check('legacy task survives', a.t.todos.length === 1, a.t.todos);
  check('schedule array added', Array.isArray(a.t.todos[0].schedule), a.t.todos[0]);
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n2. Month view');
{
  const a = boot({
    todos: [mkTask({ schedule: [{ id: 'B1', date: todayKey, start: '09:00', end: '10:30' }] })],
    activeTab: 'calendar',
  });
  check('month is the default view', a.t.calView === 'month', a.t.calView);
  check('six weeks of cells', a.$('calendarContent').querySelectorAll('.cal-month-cell').length === 42);
  check('exactly one cell marked today', a.$('calendarContent').querySelectorAll('.cal-month-cell.is-today').length === 1);
  const chips = a.$('calendarContent').querySelectorAll('.cal-chip');
  check('the block renders as one chip', chips.length === 1, chips.length);
  check('chip carries task and block ids', chips[0].dataset.taskId === 'T1' && chips[0].dataset.blockId === 'B1');
  check('chip is on today\'s cell', chips[0].closest('.cal-month-cell').dataset.date === todayKey);
  check('label names month and year', /^[A-Z][a-z]+ \d{4}$/.test(a.$('calLabel').textContent), a.$('calLabel').textContent);
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n3. Week and day views place blocks by time');
{
  const a = boot({
    todos: [mkTask({ schedule: [{ id: 'B1', date: todayKey, start: '09:00', end: '10:30' }] })],
    activeTab: 'calendar',
  });
  a.t.setCalView('week');
  check('seven day columns', a.$('calendarContent').querySelectorAll('.cal-day-col').length === 7);
  check('a full 24-hour axis', a.$('calendarContent').querySelectorAll('.cal-hour-label').length === 24);
  check('24 clickable slots per column',
    a.$('calendarContent').querySelector('.cal-day-col').querySelectorAll('.cal-slot').length === 24);
  const block = a.$('calendarContent').querySelector('.cal-block');
  check('block offset matches 09:00', Math.round(parseFloat(block.style.top)) === 9 * HOUR_PX, block.style.top);
  check('block height matches 90 minutes',
    Math.round(parseFloat(block.style.height)) === Math.round(1.5 * HOUR_PX), block.style.height);
  check('now-line only on today', a.$('calendarContent').querySelectorAll('.cal-now').length === 1);
  check('day headers sit inside the scroller, so they stay aligned when it scrolls sideways',
    !!a.$('calendarContent').querySelector('.cal-grid-scroll .cal-grid-head'));
  check('view choice persisted', a.w.localStorage.getItem('calView') === 'week');

  a.t.setCalView('day');
  check('one column in day view', a.$('calendarContent').querySelectorAll('.cal-day-col').length === 1);
  check('the block is still there', a.$('calendarContent').querySelectorAll('.cal-block').length === 1);
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n4. Overlapping blocks share a column instead of hiding each other');
{
  const a = boot({ todos: [mkTask()], activeTab: 'calendar' });
  const laid = a.t.layoutDayBlocks([
    { task: { id: 'a' }, block: { id: '1', start: '09:00', end: '10:00' } },
    { task: { id: 'b' }, block: { id: '2', start: '09:30', end: '10:30' } },
    { task: { id: 'c' }, block: { id: '3', start: '12:00', end: '13:00' } },
  ]);
  check('the overlapping pair splits into 2 lanes', laid[0].lanes === 2 && laid[1].lanes === 2, laid.map(x => x.lanes));
  check('and takes different lanes', laid[0].lane !== laid[1].lane, laid.map(x => x.lane));
  check('a block that overlaps nothing stays full width', laid[2].lanes === 1, laid[2]);
  const zero = a.t.layoutDayBlocks([{ task: { id: 'a' }, block: { id: '1', start: '09:00', end: '09:00' } }]);
  check('a zero-length block still gets a clickable height', zero[0].end > zero[0].start, zero[0]);
}

console.log('\n5. Navigation');
{
  const a = boot({ todos: [], activeTab: 'calendar' });
  a.t.setCalView('day');
  const start = a.$('calLabel').textContent;
  click(a, a.$('calNext'));
  check('next advances', a.$('calLabel').textContent !== start);
  click(a, a.$('calPrev'));
  check('prev returns', a.$('calLabel').textContent === start, a.$('calLabel').textContent);
  a.t.setCalView('month');
  click(a, a.$('calNext'));
  click(a, a.$('calNext'));
  click(a, a.$('calToday'));
  check('Today jumps back to the current month',
    a.$('calLabel').textContent.includes(String(new Date().getFullYear())), a.$('calLabel').textContent);
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n6. Scheduling an existing task from an empty slot');
{
  const a = boot({ todos: [mkTask()], activeTab: 'calendar' });
  a.t.setCalView('week');
  const slot = a.$('calendarContent').querySelector('.cal-slot[data-hour="14"]');
  click(a, slot);
  check('slot click opens the schedule modal', !a.$('scheduleModal').classList.contains('hidden'));
  check('start prefilled from the slot', a.$('schedStart').value === '14:00', a.$('schedStart').value);
  check('end defaults to one hour later', a.$('schedEnd').value === '15:00', a.$('schedEnd').value);
  check('date prefilled from the column', a.$('schedDate').value === slot.dataset.date);
  check('the existing task is offered', [...a.$('schedTask').options].some(o => o.value === 'T1'));

  a.$('schedTask').value = 'T1';
  click(a, a.$('scheduleSave'));
  check('block saved on the task', a.t.todos[0].schedule.length === 1, a.t.todos[0].schedule);
  check('with the chosen times', (() => {
    const b = a.t.todos[0].schedule[0];
    return b.date === slot.dataset.date && b.start === '14:00' && b.end === '15:00';
  })(), a.t.todos[0].schedule[0]);
  check('written to localStorage', JSON.parse(a.w.localStorage.getItem('todos'))[0].schedule.length === 1);
  check('modal closed', a.$('scheduleModal').classList.contains('hidden'));
  check('and it shows on the grid', a.$('calendarContent').querySelectorAll('.cal-block').length === 1);

  click(a, a.$('calendarContent').querySelector('.cal-slot[data-hour="16"]'));
  a.$('schedTask').value = 'T1';
  click(a, a.$('scheduleSave'));
  check('one task can hold several blocks', a.t.todos[0].schedule.length === 2, a.t.todos[0].schedule);
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n7. Scheduling can create the task, and refuses bad input');
{
  const a = boot({ todos: [], activeTab: 'calendar' });
  click(a, a.$('calAddBtn'));
  check('new-task is the default when there is nothing to pick', a.$('schedTask').value === '__new__', a.$('schedTask').value);
  check('the title field is revealed', !a.$('schedNewTitleGroup').classList.contains('hidden'));

  click(a, a.$('scheduleSave'));
  check('a blank title is rejected', a.t.todos.length === 0, a.t.todos);
  check('and says so', /title/i.test(a.$('schedError').textContent), a.$('schedError').textContent);

  a.$('schedNewTitle').value = 'Write the deck';
  a.$('schedEnd').value = '08:00'; // earlier than the 09:00 start
  click(a, a.$('scheduleSave'));
  check('an end before the start is rejected', a.t.todos.length === 0, a.t.todos);
  check('and says why', /after the start/.test(a.$('schedError').textContent), a.$('schedError').textContent);

  a.$('schedEnd').value = '10:00';
  click(a, a.$('scheduleSave'));
  check('task created', a.t.todos.length === 1 && a.t.todos[0].title === 'Write the deck', a.t.todos);
  check('and scheduled', a.t.todos[0].schedule.length === 1, a.t.todos[0].schedule);
  check('it reaches the task list too', /Write the deck/.test(a.$('todoList').textContent));
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n8. Editing and unscheduling a block');
{
  const a = boot({
    todos: [mkTask({ schedule: [{ id: 'B1', date: todayKey, start: '09:00', end: '10:00' }] })],
    activeTab: 'calendar',
  });
  a.t.setCalView('day');
  click(a, a.$('calendarContent').querySelector('.cal-block'));
  check('clicking a block opens it', !a.$('scheduleModal').classList.contains('hidden'));
  check('the task picker is locked — editing a time must not move the block to another task',
    a.$('schedTask').disabled === true);
  check('unschedule is offered', !a.$('scheduleDelete').classList.contains('hidden'));

  a.$('schedStart').value = '11:00';
  a.$('schedEnd').value = '12:00';
  click(a, a.$('scheduleSave'));
  check('edited in place, not duplicated', a.t.todos[0].schedule.length === 1, a.t.todos[0].schedule);
  check('new times stored', a.t.todos[0].schedule[0].start === '11:00', a.t.todos[0].schedule[0]);

  click(a, a.$('calendarContent').querySelector('.cal-block-del'));
  check('block removed', a.t.todos[0].schedule.length === 0, a.t.todos[0].schedule);
  check('the task itself is untouched', a.t.todos.length === 1 && a.t.todos[0].title === 'Ship feature');
  check('undo is offered', !a.$('toast').classList.contains('hidden'));
  click(a, a.$('toastUndo'));
  check('undo restores the block', a.t.todos[0].schedule.length === 1, a.t.todos[0].schedule);
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n9. A crowded day collapses to "+N more", which opens the day view');
{
  const sched = ['08:00', '09:00', '10:00', '11:00'].map((s, i) => ({
    id: 'B' + i, date: todayKey, start: s, end: s.replace(':00', ':30'),
  }));
  const a = boot({ todos: [mkTask({ schedule: sched })], activeTab: 'calendar' });
  check('month cell caps at 3 chips', a.$('calendarContent').querySelectorAll('.cal-chip').length === 3);
  const more = a.$('calendarContent').querySelector('.cal-more');
  check('the rest are counted', !!more && /\+1 more/.test(more.textContent), more && more.textContent);
  click(a, more);
  check('switches to the day view', a.t.calView === 'day', a.t.calView);
  check('where all four are visible', a.$('calendarContent').querySelectorAll('.cal-block').length === 4);
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n10. The task modal edits every block of a task at once');
{
  const a = boot({ todos: [mkTask()], activeTab: 'tasks' });
  a.t.openEditModal(0);
  check('empty state when unscheduled', /Not scheduled yet/.test(a.$('modalScheduleList').textContent));
  click(a, a.$('taskScheduleAdd'));
  click(a, a.$('taskScheduleAdd'));
  const rows = a.$('modalScheduleList').querySelectorAll('.modal-schedule-row');
  check('two rows added', rows.length === 2, rows.length);
  check('each row is date + start + end', rows[0].querySelectorAll('input').length === 3);
  check('a new row starts where the previous one ended',
    a.t.scheduleDraft[1].start === a.t.scheduleDraft[0].end, a.t.scheduleDraft);

  click(a, a.$('modalSave'));
  check('both blocks saved', a.t.todos[0].schedule.length === 2, a.t.todos[0].schedule);
  check('persisted', JSON.parse(a.w.localStorage.getItem('todos'))[0].schedule.length === 2);

  a.t.openEditModal(0);
  check('reopening shows them', a.$('modalScheduleList').querySelectorAll('.modal-schedule-row').length === 2);
  const dateInput = a.$('modalScheduleList').querySelector('input[type="date"]');
  dateInput.value = '';
  dateInput.dispatchEvent(new a.w.Event('input', { bubbles: true }));
  click(a, a.$('modalSave'));
  check('a half-filled row is dropped rather than saved broken', a.t.todos[0].schedule.length === 1, a.t.todos[0].schedule);

  a.t.openEditModal(0);
  click(a, a.$('modalScheduleList').querySelector('.subtask-del'));
  click(a, a.$('modalSave'));
  check('a removed row is gone', a.t.todos[0].schedule.length === 0, a.t.todos[0].schedule);
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n11. Dashboard: Today\'s Schedule');
{
  const a = boot({
    todos: [
      mkTask({ schedule: [{ id: 'B1', date: todayKey, start: '09:00', end: '10:00' }] }),
      mkTask({ id: 'T2', title: 'Some other day', schedule: [{ id: 'B2', date: '2099-01-01', start: '09:00', end: '10:00' }] }),
    ],
    activeTab: 'dashboard',
  });
  const rows = a.$('todayScheduleBody').querySelectorAll('.today-row');
  check('only today\'s block is listed', rows.length === 1, a.$('todayScheduleBody').textContent);
  check('it names the task', /Ship feature/.test(rows[0].textContent));
  check('the count is shown', /1 BLOCK/.test(a.$('todayScheduleCount').textContent), a.$('todayScheduleCount').textContent);
  check('the panel sits above the timer widget', (() => {
    const timerCard = a.$('dashTimer').closest('.organic-card');
    return !!(a.$('todaySchedule').compareDocumentPosition(timerCard) & a.w.Node.DOCUMENT_POSITION_FOLLOWING);
  })());

  click(a, rows[0].querySelector('.dash-task-check'));
  check('a row can complete its task', a.t.todos[0].done === true);
  check('and shows as done', a.$('todayScheduleBody').querySelector('.today-row').classList.contains('done'));

  check('starts expanded', !a.$('todaySchedule').classList.contains('collapsed'));
  click(a, a.$('todayScheduleToggle'));
  check('collapses', a.$('todaySchedule').classList.contains('collapsed'));
  check('the choice is remembered', a.w.localStorage.getItem('todayScheduleCollapsed') === '1');
  check('the header survives collapse, so it can be reopened', !!a.$('todayScheduleToggle'));
  click(a, a.$('todayScheduleToggle'));
  check('expands again', !a.$('todaySchedule').classList.contains('collapsed'));
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n12. Today\'s Schedule: empty state and restored collapse');
{
  const a = boot({ todos: [], activeTab: 'dashboard', todayScheduleCollapsed: '1' });
  check('collapsed state restored on boot', a.$('todaySchedule').classList.contains('collapsed'));
  check('empty state explains itself', /Nothing scheduled today/.test(a.$('todayScheduleBody').textContent));
  click(a, a.doc.querySelector('.today-schedule-add'));
  check('and offers a way to schedule something', !a.$('scheduleModal').classList.contains('hidden'));
  a.doc.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Escape closes the schedule modal', a.$('scheduleModal').classList.contains('hidden'));
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n13. Navigation wiring');
{
  const a = boot({ todos: [], activeTab: 'calendar' });
  check('sidebar has a calendar tab', !!a.doc.querySelector('aside .tab[data-tab="calendar"]'));
  check('it is the last sidebar entry, below Goals',
    [...a.doc.querySelectorAll('aside .tab')].pop().dataset.tab === 'calendar');
  check('mobile nav has it too', !!a.doc.querySelector('#mobileNav .tab[data-tab="calendar"]'));
  check('page title updates', a.$('pageTitle').textContent === 'Calendar', a.$('pageTitle').textContent);
  check('the tab is remembered', a.w.localStorage.getItem('activeTab') === 'calendar');
  check('the dashboard link reaches it', (() => {
    a.t.switchTab('dashboard');
    click(a, a.$('todayScheduleOpen'));
    return a.$('pageTitle').textContent === 'Calendar';
  })());
  check('no errors', a.errors.length === 0, a.errors);
}

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
