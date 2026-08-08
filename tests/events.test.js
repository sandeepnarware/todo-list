/* jsdom harness: calendar-only events — the "do I want a task out of this?" choice
   in the Schedule dialog. An event owns its time blocks exactly the way a task
   does, so what's checked here is that it renders and repeats like one while
   staying out of the task list, the timer and the checkbox column. */
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
    get events() { return events; },
    get calView() { return calView; },
    switchTab, setCalView, blocksForDate, openScheduleModal, renderCalendar,
  };`;
  const s = w.document.createElement('script');
  s.textContent = appJs + bridge;
  w.document.body.appendChild(s);
  return { w, doc: w.document, t: w.__t, errors, $: id => w.document.getElementById(id) };
}

const click = (a, el) => el.dispatchEvent(new a.w.MouseEvent('click', { bubbles: true }));
const pick = (a, value) => {
  a.$('schedTask').value = value;
  a.$('schedTask').dispatchEvent(new a.w.Event('change', { bubbles: true }));
};

const mkTask = (over = {}) => Object.assign({
  id: 'T1', title: 'Ship feature', description: '', dueDate: null, priority: 'none',
  project: 'Work', frequency: 'none', tags: [], done: false, completedAt: null,
  createdAt: 1, pomodoros: 0, estPomodoros: 0, wasGolden: false, subtasks: [], schedule: [],
}, over);

const mkEvent = (over = {}) => Object.assign({
  id: 'E1', title: 'Stand-up', isEvent: true, done: false, project: '', createdAt: 1,
  schedule: [{ id: 'EB1', date: todayKey, start: '09:00', end: '09:15' }],
}, over);

const todayKey = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

console.log('\n1. The dialog offers the choice: a task, or just an event');
{
  const a = boot({ todos: [mkTask()], activeTab: 'calendar' });
  click(a, a.$('calAddBtn'));
  const values = [...a.$('schedTask').options].map(o => o.value);
  check('both "+ New …" rows are offered', values[0] === '__new__' && values[1] === '__event__', values);
  check('existing tasks are still listed', values.includes('T1'), values);
  check('a task is still the default', a.$('schedTask').value === '__new__');
  check('the label admits it is not only about tasks',
    /event/i.test(a.doc.querySelector('label[for="schedTask"]').textContent),
    a.doc.querySelector('label[for="schedTask"]').textContent);
  check('the title field is labelled for a task', a.$('schedNewTitleLabel').textContent === 'New task title');

  pick(a, '__event__');
  check('choosing event relabels the title field', a.$('schedNewTitleLabel').textContent === 'Event title',
    a.$('schedNewTitleLabel').textContent);
  check('and the field stays visible', !a.$('schedNewTitleGroup').classList.contains('hidden'));
  check('the colour hint stops pointing at a project an event cannot have',
    /tell this event apart/i.test(a.$('schedColorHint').textContent), a.$('schedColorHint').textContent);

  pick(a, 'T1');
  check('picking an existing task hides the title field', a.$('schedNewTitleGroup').classList.contains('hidden'));
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n2. Creating an event makes no task');
{
  const a = boot({ todos: [], activeTab: 'calendar' });
  click(a, a.$('calAddBtn'));
  pick(a, '__event__');

  click(a, a.$('scheduleSave'));
  check('a blank title is rejected', a.t.events.length === 0, a.t.events);
  check('and says it is an event that needs one',
    /event/i.test(a.$('schedError').textContent), a.$('schedError').textContent);

  a.$('schedNewTitle').value = 'Dentist';
  a.$('schedStart').value = '14:00';
  a.$('schedEnd').value = '15:00';
  click(a, a.$('scheduleSave'));
  check('the event is created', a.t.events.length === 1 && a.t.events[0].title === 'Dentist', a.t.events);
  check('with its one time block',
    a.t.events[0].schedule.length === 1 && a.t.events[0].schedule[0].start === '14:00', a.t.events[0].schedule);
  check('and no task anywhere', a.t.todos.length === 0, a.t.todos);
  check('it is stored under its own key',
    JSON.parse(a.w.localStorage.getItem('calEvents'))[0].title === 'Dentist',
    a.w.localStorage.getItem('calEvents'));
  check('the todos store is left alone', a.w.localStorage.getItem('todos') === '[]',
    a.w.localStorage.getItem('todos'));
  check('it shows on the calendar', /Dentist/.test(a.$('calendarContent').textContent));
  check('the block is marked as an event',
    a.$('calendarContent').querySelector('.cal-chip').classList.contains('is-event'));

  a.t.switchTab('tasks');
  check('but never in the task list', !/Dentist/.test(a.$('todoList').textContent), a.$('todoList').textContent);
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n3. A stored event renders like any other block');
{
  const a = boot({ calEvents: [mkEvent()], activeTab: 'calendar' });
  a.t.setCalView('day');
  const block = a.$('calendarContent').querySelector('.cal-block');
  check('it survives the round trip through storage', !!block);
  check('placed at 09:00', Math.round(parseFloat(block.style.top)) === 9 * 44, block.style.top);
  check('titled', /Stand-up/.test(block.textContent));
  check('and flagged as an event', block.classList.contains('is-event'));
  check('the tooltip says so', /\(event\)/.test(block.getAttribute('title')), block.getAttribute('title'));
  check('an event is never golden or active — there is nothing to focus on',
    !block.classList.contains('golden') && !block.classList.contains('active'));
  const entry = a.t.blocksForDate(todayKey)[0];
  check('the calendar reads it through the same owner path', entry.owner.id === 'E1', entry && entry.owner);
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n4. Editing an event, including its title');
{
  const a = boot({ calEvents: [mkEvent()], activeTab: 'calendar' });
  a.t.setCalView('day');
  click(a, a.$('calendarContent').querySelector('.cal-block'));
  check('clicking opens the dialog', !a.$('scheduleModal').classList.contains('hidden'));
  check('which says it is editing an event', a.$('scheduleModalTitle').textContent === 'Edit event',
    a.$('scheduleModalTitle').textContent);
  check('the event is the selected entry', a.$('schedTask').value === 'E1', a.$('schedTask').value);
  check('and cannot be swapped for a task', a.$('schedTask').disabled === true);
  check('the title field doubles as the rename box', a.$('schedNewTitle').value === 'Stand-up',
    a.$('schedNewTitle').value);
  check('deleting says Remove, not Unschedule — there is nothing left behind',
    a.$('scheduleDelete').textContent === 'Remove', a.$('scheduleDelete').textContent);

  a.$('schedNewTitle').value = 'Daily stand-up';
  a.$('schedStart').value = '09:30';
  a.$('schedEnd').value = '09:45';
  click(a, a.$('scheduleSave'));
  check('renamed', a.t.events[0].title === 'Daily stand-up', a.t.events[0].title);
  check('retimed in place, not duplicated', a.t.events[0].schedule.length === 1, a.t.events[0].schedule);
  check('with the new times', a.t.events[0].schedule[0].start === '09:30', a.t.events[0].schedule[0]);
  check('persisted', JSON.parse(a.w.localStorage.getItem('calEvents'))[0].title === 'Daily stand-up');

  click(a, a.$('calendarContent').querySelector('.cal-block'));
  a.$('schedNewTitle').value = '   ';
  click(a, a.$('scheduleSave'));
  check('an event cannot be renamed to nothing', a.t.events[0].title === 'Daily stand-up', a.t.events[0].title);
  check('and the dialog stays open to say so', !a.$('scheduleModal').classList.contains('hidden'));
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n5. Removing an event removes the event');
{
  const a = boot({ calEvents: [mkEvent()], activeTab: 'calendar' });
  a.t.setCalView('day');
  click(a, a.$('calendarContent').querySelector('.cal-block-del'));
  check('the event is gone, not left as an empty husk', a.t.events.length === 0, a.t.events);
  check('storage agrees', a.w.localStorage.getItem('calEvents') === '[]', a.w.localStorage.getItem('calEvents'));
  check('the calendar is clear', !a.$('calendarContent').querySelector('.cal-block'));
  check('undo is offered', !a.$('toast').classList.contains('hidden'));
  check('and names it', /Stand-up/.test(a.$('toastMsg').textContent), a.$('toastMsg').textContent);
  click(a, a.$('toastUndo'));
  check('undo brings the whole event back',
    a.t.events.length === 1 && a.t.events[0].schedule.length === 1, a.t.events);
  check('including on the calendar', !!a.$('calendarContent').querySelector('.cal-block'));
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n6. Events repeat the way tasks do');
{
  const a = boot({
    calEvents: [mkEvent({ schedule: [{ id: 'EB1', date: '2026-03-02', start: '09:00', end: '09:15', repeat: 'weekly', interval: 1, until: null, exdates: [] }] })],
  });
  check('the first occurrence is there', a.t.blocksForDate('2026-03-02').length === 1);
  check('so is the next week', a.t.blocksForDate('2026-03-09').length === 1);
  check('but not the day between', a.t.blocksForDate('2026-03-05').length === 0);

  // The scope question governs a series whoever owns it.
  a.t.openScheduleModal({
    taskId: 'E1', blockId: 'EB1', date: '2026-03-09',
    start: '09:00', end: '09:15', repeat: 'weekly', interval: 1, until: null,
  });
  check('editing one occurrence asks which ones', !a.$('schedScope').classList.contains('hidden'));
  a.$('schedStart').value = '11:00';
  a.$('schedEnd').value = '11:15';
  click(a, a.$('scheduleSave'));
  const moved = a.t.blocksForDate('2026-03-09');
  check('that one occurrence moved', moved.length === 1 && moved[0].block.start === '11:00',
    moved.map(x => x.block));
  check('the series kept its time', a.t.blocksForDate('2026-03-16')[0].block.start === '09:00');
  check('and the override belongs to the same event',
    a.t.events.length === 1 && a.t.events[0].schedule.length === 2, a.t.events);
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n7. Today\'s Schedule lists events without offering task controls');
{
  const a = boot({
    todos: [mkTask({ schedule: [{ id: 'B1', date: todayKey, start: '11:00', end: '12:00' }] })],
    calEvents: [mkEvent()],
    activeTab: 'dashboard',
  });
  const rows = [...a.$('todayScheduleBody').querySelectorAll('.today-row')];
  check('both the event and the task are listed', rows.length === 2, a.$('todayScheduleBody').textContent);
  check('earliest first, so the event leads', /Stand-up/.test(rows[0].textContent), rows[0].textContent);
  check('the count includes it', /2 BLOCKS/.test(a.$('todayScheduleCount').textContent),
    a.$('todayScheduleCount').textContent);
  check('an event row has no checkbox — there is nothing to complete',
    !rows[0].querySelector('.dash-task-check'));
  check('and no play button — the timer tracks tasks',
    !rows[0].querySelector('.dash-task-play'));
  check('it carries the event glyph in that column instead',
    !!rows[0].querySelector('.today-event-mark'));
  check('the task row keeps both controls',
    !!rows[1].querySelector('.dash-task-check') && !!rows[1].querySelector('.dash-task-play'));
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n8. A damaged or absent event store cannot take the app down');
{
  const a = boot({ calEvents: 'not json at all', activeTab: 'calendar' });
  check('unparseable storage reads as no events', a.t.events.length === 0, a.t.events);
  check('the calendar still renders', !!a.$('calendarContent').querySelector('.cal-month-grid'));

  const b = boot({
    calEvents: [{ title: 'no id, so unrepairable' }, { id: 'E9', title: 'Fine' }],
    activeTab: 'calendar',
  });
  check('an entry with no id is dropped, the rest survive',
    b.t.events.length === 1 && b.t.events[0].id === 'E9', b.t.events);
  check('and a missing schedule is filled in', Array.isArray(b.t.events[0].schedule), b.t.events[0]);
  check('an event with no blocks simply draws nothing',
    !b.$('calendarContent').querySelector('.cal-chip'));
  check('no errors', a.errors.length === 0 && b.errors.length === 0, [a.errors, b.errors]);
}

console.log('\n9. The "Create a task for this" checkbox fronts that choice');
{
  const a = boot({ todos: [mkTask()], activeTab: 'calendar' });
  click(a, a.$('calAddBtn'));
  const box = a.$('schedMakeTask');
  const group = a.$('schedMakeTaskGroup');
  check('it is offered when creating something new', !!box && !group.classList.contains('hidden'));
  check('ticked by default, matching the default "+ New task…"', box.checked === true);
  check('it says what unticking costs',
    /task list|Focus Score|timer/i.test(group.textContent), group.textContent);

  // Unticking must drive the select, since saving reads only the select.
  box.checked = false;
  box.dispatchEvent(new a.w.Event('change', { bubbles: true }));
  check('unticking selects the event row', a.$('schedTask').value === '__event__', a.$('schedTask').value);
  check('and the title field relabels', a.$('schedNewTitleLabel').textContent === 'Event title',
    a.$('schedNewTitleLabel').textContent);

  box.checked = true;
  box.dispatchEvent(new a.w.Event('change', { bubbles: true }));
  check('re-ticking goes back to a task', a.$('schedTask').value === '__new__', a.$('schedTask').value);
  check('and relabels again', a.$('schedNewTitleLabel').textContent === 'New task title');

  // ...and the select drives it back, so the two can never disagree.
  pick(a, '__event__');
  check('choosing the event row unticks it', box.checked === false);
  pick(a, '__new__');
  check('choosing the task row re-ticks it', box.checked === true);

  pick(a, 'T1');
  check('an existing task hides it — it already is a task', group.classList.contains('hidden'));
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n10. Unticking the box is all it takes to get an event');
{
  const a = boot({ todos: [], activeTab: 'calendar' });
  click(a, a.$('calAddBtn'));
  const box = a.$('schedMakeTask');
  box.checked = false;
  box.dispatchEvent(new a.w.Event('change', { bubbles: true }));
  a.$('schedNewTitle').value = 'Flight to Delhi';
  a.$('schedStart').value = '06:00';
  a.$('schedEnd').value = '09:00';
  click(a, a.$('scheduleSave'));
  check('an event is created', a.t.events.length === 1 && a.t.events[0].title === 'Flight to Delhi', a.t.events);
  check('and no task with it', a.t.todos.length === 0, a.t.todos);
  check('it lands on the calendar', /Flight to Delhi/.test(a.$('calendarContent').textContent));

  // The default path must still make a task — the checkbox cannot have inverted it.
  const b = boot({ todos: [], activeTab: 'calendar' });
  click(b, b.$('calAddBtn'));
  b.$('schedNewTitle').value = 'Write the deck';
  click(b, b.$('scheduleSave'));
  check('leaving it ticked still makes a task', b.t.todos.length === 1 && b.t.todos[0].title === 'Write the deck', b.t.todos);
  check('and no stray event', b.t.events.length === 0, b.t.events);
  check('no errors', a.errors.length === 0 && b.errors.length === 0, [a.errors, b.errors]);
}

console.log('\n11. The checkbox stays out of the way when editing an existing block');
{
  const a = boot({ calEvents: [mkEvent()], activeTab: 'calendar' });
  a.t.setCalView('day');
  click(a, a.$('calendarContent').querySelector('.cal-block'));
  check('hidden while editing an event', a.$('schedMakeTaskGroup').classList.contains('hidden'));

  const b = boot({ todos: [mkTask({ schedule: [{ id: 'B1', date: todayKey, start: '10:00', end: '11:00' }] })], activeTab: 'calendar' });
  b.t.setCalView('day');
  click(b, b.$('calendarContent').querySelector('.cal-block'));
  check('and while editing a task block', b.$('schedMakeTaskGroup').classList.contains('hidden'));
  check('no errors', a.errors.length === 0 && b.errors.length === 0, [a.errors, b.errors]);
}

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
