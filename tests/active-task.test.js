/* jsdom harness: completing a task must drop it out of the Pomodoro view. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const quotesRaw = fs.readFileSync(path.join(ROOT, 'quotes.json'), 'utf8');

let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log('  PASS  ' + label);
  else { fails++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

const mk = (id, title, done = false, extra = {}) => ({
  id, title, description: '', dueDate: null, priority: 'none', project: 'Work', frequency: 'none',
  tags: [], done, completedAt: done ? 1 : null, createdAt: 1, pomodoros: 2, estPomodoros: 4,
  wasGolden: false, subtasks: [], ...extra,
});

function boot({ todos, activeTaskId, goldenTaskId } = {}) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/tailwind|Could not load|Not implemented|navigation/i.test(e.message)) console.log('JSDOM ERR:', e.message); });
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/', virtualConsole: vc, pretendToBeVisual: true });
  const w = dom.window;
  w.Notification = { permission: 'denied', requestPermission() {} };
  w.AudioContext = function () { throw new Error('no audio'); };
  w.documentPictureInPicture = null;
  let n = 0;
  w.crypto = Object.assign({}, w.crypto, { randomUUID: () => `uuid-${++n}` });
  w.alert = () => {};
  w.fetch = (u) => {
    if (String(u) === 'quotes.json') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(quotesRaw)) });
    if (String(u) === 'version.json') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ major: 2, minor: 0, patch: 1 }) });
    return Promise.reject(new Error('blocked'));
  };
  if (todos) w.localStorage.setItem('todos', JSON.stringify(todos));
  if (activeTaskId) w.localStorage.setItem('activeTaskId', activeTaskId);
  if (goldenTaskId) w.localStorage.setItem('goldenTaskId', goldenTaskId);
  const s = w.document.createElement('script');
  s.textContent = appJs + `\nwindow.__t = { switchTab, toggleTodoDone, setActiveTask, getActiveTask,
    updateCurrentTaskDisplay, renderTodos, startTimer, switchPhase, pomState,
    get todos(){return todos}, get activeTaskId(){return activeTaskId} };`;
  w.document.body.appendChild(s);
  const doc = w.document;
  return {
    w, doc,
    $: (id) => doc.getElementById(id),
    click: (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })),
    pomName: () => doc.getElementById('pomodoroTaskName').textContent.trim(),
    pomCard: () => doc.querySelector('#currentTaskDisplay .current-task-text').textContent.trim(),
    dashTitle: () => doc.getElementById('dashActiveTitle').textContent.trim(),
    task: (id) => w.__t.todos.find(t => t.id === id),
  };
}

const tick = () => new Promise(r => setTimeout(r, 20));

(async () => {
  console.log('\n1. Completing the focused task clears it from the Pomodoro');
  {
    const t = boot({ todos: [mk('A', 'Focused task'), mk('B', 'Next task')], activeTaskId: 'A' });
    await tick();
    check('starts focused on A', t.w.__t.activeTaskId === 'A', t.w.__t.activeTaskId);
    check('Pomodoro shows A', t.pomName() === 'Focused task', t.pomName());
    t.w.__t.toggleTodoDone(t.task('A'), true);
    check('active task cleared', t.w.__t.activeTaskId === null, t.w.__t.activeTaskId);
    check('getActiveTask() returns null', t.w.__t.getActiveTask() === null);
    check('localStorage entry removed', t.w.localStorage.getItem('activeTaskId') === null,
      t.w.localStorage.getItem('activeTaskId'));
    check('completed task no longer named in the Pomodoro', t.pomName() !== 'Focused task', t.pomName());
    check('Pomodoro falls back to the next pending task', t.pomName() === 'Next task', t.pomName());
    check('Pomodoro card also updated', t.pomCard() === 'Next task', t.pomCard());
    check('dashboard timer widget updated', t.dashTitle() === 'Next task', t.dashTitle());
  }

  console.log('\n2. Completing a NON-focused task leaves the focus alone');
  {
    const t = boot({ todos: [mk('A', 'Focused task'), mk('B', 'Other task')], activeTaskId: 'A' });
    await tick();
    t.w.__t.toggleTodoDone(t.task('B'), true);
    check('still focused on A', t.w.__t.activeTaskId === 'A', t.w.__t.activeTaskId);
    check('Pomodoro still shows A', t.pomName() === 'Focused task', t.pomName());
  }

  console.log('\n3. A stored id pointing at an already-completed task self-heals on load');
  {
    // Reproduces existing localStorage from before this rule existed.
    const t = boot({ todos: [mk('A', 'Done already', true), mk('B', 'Pending')], activeTaskId: 'A' });
    await tick();
    check('stale active id dropped at startup', t.w.__t.activeTaskId === null, t.w.__t.activeTaskId);
    check('Pomodoro does not show the completed task', t.pomName() !== 'Done already', t.pomName());
    check('shows the pending task instead', t.pomName() === 'Pending', t.pomName());
  }

  console.log('\n4. A completed task cannot be made the focus');
  {
    const t = boot({ todos: [mk('A', 'Done task', true), mk('B', 'Pending')] });
    await tick();
    t.w.__t.setActiveTask('A');
    check('setActiveTask refuses a completed task', t.w.__t.activeTaskId === null, t.w.__t.activeTaskId);
    check('Pomodoro unaffected', t.pomName() === 'Pending', t.pomName());
    t.w.__t.setActiveTask('B');
    check('a pending task can still be focused', t.w.__t.activeTaskId === 'B');
  }

  console.log('\n5. No focus button rendered on completed rows');
  {
    const t = boot({ todos: [mk('A', 'Pending one'), mk('B', 'Done one', true)] });
    await tick();
    t.w.__t.switchTab('tasks');
    t.click(t.$('completedToggle')); // reveal completed tasks
    const rows = [...t.doc.querySelectorAll('#todoList > li')];
    const pending = rows.find(li => li.textContent.includes('Pending one'));
    const done = rows.find(li => li.textContent.includes('Done one'));
    check('completed row is rendered', !!done);
    check('pending row keeps its focus button', !!pending.querySelector('.play-btn'));
    check('completed row has no focus button', !done.querySelector('.play-btn'));
    check('completed row keeps edit/delete', done.querySelectorAll('.task-actions-row button').length > 0);
  }

  console.log('\n6. Un-completing does not silently re-focus');
  {
    const t = boot({ todos: [mk('A', 'Task A'), mk('B', 'Task B')], activeTaskId: 'A' });
    await tick();
    t.w.__t.toggleTodoDone(t.task('A'), true);
    check('cleared on completion', t.w.__t.activeTaskId === null);
    t.w.__t.toggleTodoDone(t.task('A'), false);
    check('still not focused after reopening', t.w.__t.activeTaskId === null, t.w.__t.activeTaskId);
    check('but it can be focused again explicitly', (() => {
      t.w.__t.setActiveTask('A');
      return t.w.__t.activeTaskId === 'A';
    })());
  }

  console.log('\n7. A finished pomodoro credits nothing once the task is done');
  {
    const t = boot({ todos: [mk('A', 'Focused task'), mk('B', 'Next')], activeTaskId: 'A' });
    await tick();
    const before = t.task('A').pomodoros;
    t.w.__t.toggleTodoDone(t.task('A'), true);
    t.w.__t.switchPhase(); // simulate a focus session ending
    check('completed task gains no extra pomodoro', t.task('A').pomodoros === before,
      { before, after: t.task('A').pomodoros });
    check('the fallback task is not credited either', t.task('B').pomodoros === 2, t.task('B').pomodoros);
  }

  console.log('\n8. Dashboard quick-complete also clears the focus');
  {
    const t = boot({ todos: [mk('A', 'Focused task'), mk('B', 'Next')], activeTaskId: 'A' });
    await tick();
    t.w.__t.switchTab('dashboard');
    const btn = t.doc.querySelector('.dash-task-check[data-task-id="A"]');
    check('dashboard complete button present', !!btn);
    t.click(btn);
    await tick();
    check('focus cleared from the dashboard path', t.w.__t.activeTaskId === null, t.w.__t.activeTaskId);
    check('task marked done', t.task('A').done === true);
    check('Pomodoro no longer shows it', t.pomName() !== 'Focused task', t.pomName());
  }

  console.log('\n9. Completing the only task leaves an empty-state, not a stale name');
  {
    const t = boot({ todos: [mk('A', 'Only task')], activeTaskId: 'A' });
    await tick();
    t.w.__t.toggleTodoDone(t.task('A'), true);
    check('active cleared', t.w.__t.activeTaskId === null);
    check('Pomodoro shows the no-task state', /no active task/i.test(t.pomName()), t.pomName());
    check('card shows a prompt, not the finished task', !/Only task/.test(t.pomCard()), t.pomCard());
    check('dashboard widget shows the empty state', /no tasks/i.test(t.dashTitle()), t.dashTitle());
  }

  console.log('\n10. Recurring task: focus moves off the completed instance');
  {
    const t = boot({
      todos: [mk('A', 'Daily standup', false, { frequency: 'daily', dueDate: '2026-07-25' })],
      activeTaskId: 'A',
    });
    await tick();
    t.w.__t.toggleTodoDone(t.task('A'), true);
    check('completed instance is not the focus', t.w.__t.activeTaskId !== 'A', t.w.__t.activeTaskId);
    const clone = t.w.__t.todos.find(x => x.title === 'Daily standup' && !x.done);
    check('a fresh instance was created', !!clone);
    check('Pomodoro shows the fresh instance via fallback', t.pomName() === 'Daily standup', t.pomName());
  }

  console.log('\n11. With nothing focused, completing the displayed fallback refreshes it');
  {
    // No activeTaskId at all: the Pomodoro shows the first pending task.
    const t = boot({ todos: [mk('A', 'First pending'), mk('B', 'Second pending')] });
    await tick();
    check('no task focused', t.w.__t.activeTaskId === null);
    check('shows the first pending task', t.pomName() === 'First pending', t.pomName());
    t.w.__t.toggleTodoDone(t.task('A'), true);
    check('completed fallback is replaced, not left showing',
      t.pomName() === 'Second pending', t.pomName());
    check('card updated too', t.pomCard() === 'Second pending', t.pomCard());
  }

  console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
