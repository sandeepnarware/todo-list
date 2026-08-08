/* jsdom harness: the inline due-date picker on the Tasks tab — the badge that
   doubles as a reschedule control, the month grid it opens, and the presets.
   Fixture dates are derived here rather than hard-coded, so the suite passes
   whatever day it runs on. */
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
    get dueFilter() { return dueFilter; },
    duePickerOpen, setDueFilter, setTodoDueDate,
  };`;
  const s = w.document.createElement('script');
  s.textContent = appJs + bridge;
  w.document.body.appendChild(s);
  return { w, doc: w.document, t: w.__t, errors, $: id => w.document.getElementById(id) };
}

const click = (a, el) => el.dispatchEvent(new a.w.MouseEvent('click', { bubbles: true }));
const key = (a, el, k) => el.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: k, bubbles: true }));
const picker = (a) => a.doc.querySelector('.due-picker:not(.hidden)');
const badges = (a) => [...a.$('todoList').querySelectorAll('.due-badge')];
const badgeFor = (a, title) => [...a.$('todoList').querySelectorAll('li[data-index]')]
  .find(li => (li.querySelector('.task-text') || {}).textContent === title)
  .querySelector('.due-badge');
const stored = (a) => JSON.parse(a.w.localStorage.getItem('todos'));

const dkey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
const TODAY = dkey(shift(0));
const TOMORROW = dkey(shift(1));
const NEXT_WEEK = dkey(shift(7));

const mkTask = (over = {}) => Object.assign({
  id: 'T', title: 'Task', description: '', dueDate: null, priority: 'none',
  project: '', frequency: 'none', tags: [], done: false, completedAt: null,
  createdAt: 1, pomodoros: 0, estPomodoros: 0, wasGolden: false, subtasks: [], schedule: [],
}, over);

const DATED = mkTask({ id: 'a', title: 'Dated', dueDate: TODAY });
const UNDATED = mkTask({ id: 'b', title: 'Undated', dueDate: null });

console.log('\n1. Every open task carries a clickable due badge');
{
  const a = boot({ todos: [DATED, UNDATED], activeTab: 'tasks' });
  check('boots without errors', a.errors.length === 0, a.errors);
  check('both tasks have one', badges(a).length === 2, badges(a).length);
  const dated = badgeFor(a, 'Dated');
  const undated = badgeFor(a, 'Undated');
  check('the dated badge is a button', dated.tagName === 'BUTTON');
  check('the dated badge still shows its date', /Today/.test(dated.textContent), dated.textContent);
  check('the undated badge is marked empty', undated.classList.contains('is-empty'));
  check('the undated badge is just the icon', undated.textContent.trim() === '📅', undated.textContent);
  check('each badge says what it does', /due date/i.test(dated.getAttribute('aria-label')) && /Set due date/i.test(undated.getAttribute('aria-label')));
  check('nothing is open yet', !picker(a) && !a.t.duePickerOpen());
}

console.log('\n2. A completed task keeps an inert label');
{
  const a = boot({
    todos: [mkTask({ id: 'c', title: 'Done dated', dueDate: TODAY, done: true, completedAt: Date.now() }),
      mkTask({ id: 'd', title: 'Done undated', done: true, completedAt: Date.now() })],
    activeTab: 'tasks',
  });
  // showCompleted lives in memory only — the footer toggle is the way in.
  click(a, a.$('completedToggle'));
  const btns = [...a.$('todoList').querySelectorAll('button.due-badge')];
  check('no due button on finished work', btns.length === 0, btns.length);
  const spans = [...a.$('todoList').querySelectorAll('span.due-badge')];
  check('the finished dated task keeps its label', spans.length === 1, spans.length);
}

console.log('\n3. Clicking a badge opens the month grid on the right month');
{
  const a = boot({ todos: [DATED], activeTab: 'tasks' });
  click(a, badgeFor(a, 'Dated'));
  const p = picker(a);
  check('a picker opens', !!p && a.t.duePickerOpen());
  check('exactly one picker exists', a.doc.querySelectorAll('.due-picker').length === 1);
  check('it is a labelled dialog', p.getAttribute('role') === 'dialog' && !!p.getAttribute('aria-label'));
  check('the grid has 42 days', p.querySelectorAll('.due-picker-day').length === 42);
  check('and seven day names', p.querySelectorAll('.due-picker-dayname').length === 7);
  check('today is marked', !!p.querySelector(`.due-picker-day.is-today[data-pick="${TODAY}"]`));
  check('the current due date is selected', !!p.querySelector(`.due-picker-day.is-selected[data-pick="${TODAY}"]`));
  const title = p.querySelector('.due-picker-title').textContent;
  const want = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  check('the title names the due date month', title === want, { title, want });
}

console.log('\n4. Picking a day writes it through and closes');
{
  const a = boot({ todos: [DATED], activeTab: 'tasks' });
  click(a, badgeFor(a, 'Dated'));
  const target = picker(a).querySelector(`.due-picker-day[data-pick="${TOMORROW}"]`);
  click(a, target);
  check('the task takes the new date', a.t.todos[0].dueDate === TOMORROW, a.t.todos[0].dueDate);
  check('it is persisted', stored(a)[0].dueDate === TOMORROW, stored(a)[0].dueDate);
  check('the picker closes', !picker(a) && !a.t.duePickerOpen());
  check('the badge re-renders with the new date', /Tomorrow/.test(badgeFor(a, 'Dated').textContent), badgeFor(a, 'Dated').textContent);
}

console.log('\n5. The presets write the dates they name');
{
  for (const [label, want] of [['Today', TODAY], ['Tomorrow', TOMORROW], ['Next week', NEXT_WEEK]]) {
    const a = boot({ todos: [UNDATED], activeTab: 'tasks' });
    click(a, badgeFor(a, 'Undated'));
    const btn = [...picker(a).querySelectorAll('.due-picker-preset')].find(b => b.textContent.trim() === label);
    click(a, btn);
    check(`"${label}" sets ${want}`, a.t.todos[0].dueDate === want, a.t.todos[0].dueDate);
  }
}

console.log('\n6. Clearing is offered only when there is a date to clear');
{
  const a = boot({ todos: [UNDATED], activeTab: 'tasks' });
  click(a, badgeFor(a, 'Undated'));
  check('no clear button on an undated task', !picker(a).querySelector('.is-clear'));

  const b = boot({ todos: [DATED], activeTab: 'tasks' });
  click(b, badgeFor(b, 'Dated'));
  const clear = picker(b).querySelector('.due-picker-preset.is-clear');
  check('a dated task offers one', !!clear);
  click(b, clear);
  check('the date is removed', b.t.todos[0].dueDate === null, b.t.todos[0].dueDate);
  check('null is persisted, not the empty string', stored(b)[0].dueDate === null, stored(b)[0].dueDate);
  check('the badge falls back to the bare icon', badgeFor(b, 'Dated').classList.contains('is-empty'));
}

console.log('\n7. Month navigation moves the grid, not the task');
{
  const a = boot({ todos: [DATED], activeTab: 'tasks' });
  click(a, badgeFor(a, 'Dated'));
  const before = picker(a).querySelector('.due-picker-title').textContent;
  click(a, picker(a).querySelector('[data-month-step="1"]'));
  const after = picker(a).querySelector('.due-picker-title').textContent;
  check('the month advances', before !== after, { before, after });
  check('still 42 days', picker(a).querySelectorAll('.due-picker-day').length === 42);
  check('the task is untouched', a.t.todos[0].dueDate === TODAY);
  click(a, picker(a).querySelector('[data-month-step="-1"]'));
  check('and steps back', picker(a).querySelector('.due-picker-title').textContent === before);
}

console.log('\n8. Escape and outside clicks dismiss without changing anything');
{
  const a = boot({ todos: [DATED], activeTab: 'tasks' });
  click(a, badgeFor(a, 'Dated'));
  key(a, a.doc.body, 'Escape');
  check('Escape closes', !a.t.duePickerOpen());
  check('the date is unchanged', a.t.todos[0].dueDate === TODAY);

  click(a, badgeFor(a, 'Dated'));
  check('it reopens', a.t.duePickerOpen());
  click(a, a.$('quickAddInput'));
  check('a click elsewhere closes', !a.t.duePickerOpen());
  check('still unchanged', a.t.todos[0].dueDate === TODAY);
}

console.log('\n9. The badge toggles, and re-points at another task');
{
  const a = boot({ todos: [DATED, UNDATED], activeTab: 'tasks' });
  click(a, badgeFor(a, 'Dated'));
  check('open', a.t.duePickerOpen());
  click(a, badgeFor(a, 'Dated'));
  check('a second click on the same badge closes it', !a.t.duePickerOpen());

  click(a, badgeFor(a, 'Dated'));
  click(a, badgeFor(a, 'Undated'));
  check('another task\'s badge keeps it open', a.t.duePickerOpen());
  check('still only one picker in the DOM', a.doc.querySelectorAll('.due-picker').length === 1);
  check('and it now targets the undated task', !picker(a).querySelector('.is-selected') && !picker(a).querySelector('.is-clear'));
}

console.log('\n10. Rescheduling out of the active due window leaves nothing behind');
{
  const a = boot({ todos: [mkTask({ id: 'e', title: 'Slips', dueDate: TODAY })], activeTab: 'tasks' });
  a.t.setDueFilter('today');
  check('the task is visible in the window', badges(a).length === 1);
  click(a, badgeFor(a, 'Slips'));
  click(a, picker(a).querySelector(`.due-picker-day[data-pick="${NEXT_WEEK}"]`));
  check('it leaves the filtered list', a.$('todoList').querySelectorAll('li[data-index]').length === 0);
  check('no picker is left orphaned', !a.t.duePickerOpen());
  check('but the task still has the new date', a.t.todos[0].dueDate === NEXT_WEEK, a.t.todos[0].dueDate);
}

console.log('\n11. The picker survives what would destroy an in-list popover');
{
  const a = boot({ todos: [DATED], activeTab: 'tasks' });
  click(a, badgeFor(a, 'Dated'));
  check('it is parented to <body>, not the task list',
    picker(a).parentElement === a.doc.body && !a.$('todoList').contains(picker(a)));
}

console.log('\n12. The "n" quick-add shortcut yields while the picker is open');
{
  const a = boot({ todos: [DATED], activeTab: 'tasks' });
  click(a, badgeFor(a, 'Dated'));
  key(a, picker(a).querySelector('.due-picker-day'), 'n');
  check('focus is not yanked into quick-add', a.doc.activeElement !== a.$('quickAddInput'));
  key(a, a.doc.body, 'Escape');
  key(a, a.doc.body, 'n');
  check('but the shortcut still works once closed', a.doc.activeElement === a.$('quickAddInput'));
}

console.log('\n13. The picker is themed, not left to the browser');
{
  // token-audit covers the palette; this just catches a rule going missing.
  ['.due-picker', '.due-picker-day', '.due-picker-preset', 'button.due-badge.is-empty']
    .forEach(sel => check(`${sel} is styled`, css.includes(sel)));
  // Every colour in these rules must be a theme token, or the picker breaks in
  // one of the two themes. (`white-space` is why this looks for hex, not "white".)
  const pickerRules = css.match(/\.due-picker[^{]*\{[^}]*\}/g) || [];
  const literal = pickerRules.filter(r => /#[0-9a-f]{3,8}\b|\brgba?\(/i.test(r));
  check('every colour is a theme token', literal.length === 0, literal);
}

console.log(fails === 0 ? '\nALL PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
