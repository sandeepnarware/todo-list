/* jsdom harness: exercise the subtask feature end-to-end. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!/Could not load|Not implemented/.test(e.message)) console.log('JSDOM ERR:', e.message); });

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://example.com/',
  virtualConsole: vc,
  pretendToBeVisual: true,
});
const w = dom.window;

// Stubs for browser APIs app.js touches at load.
w.Notification = { permission: 'denied', requestPermission() {} };
w.AudioContext = function () { throw new Error('no audio'); };
w.documentPictureInPicture = null;
w.fetch = () => Promise.reject(new Error('offline'));
if (!w.crypto || !w.crypto.randomUUID) {
  let n = 0;
  w.crypto = Object.assign({}, w.crypto, { randomUUID: () => `uuid-${++n}` });
}
w.alert = () => {};

// Seed one legacy task (no id) + one modern task to check migration.
w.localStorage.setItem('todos', JSON.stringify([
  { text: 'legacy task #home', done: false },
  { id: 'task-A', title: 'Ship feature', description: '', dueDate: null, priority: 'none',
    project: 'Work', frequency: 'none', tags: [], done: false, completedAt: null,
    createdAt: 1, pomodoros: 2, estPomodoros: 4, wasGolden: false },
]));

// Top-level let/const aren't window properties, so expose what the test drives.
const bridge = `
window.__t = {
  get todos() { return todos; },
  toggleTodoDone, openEditModal, openAddModal, saveModal, switchTab, subtaskProgress
};`;
const script = w.document.createElement('script');
script.textContent = appJs + bridge;
w.document.body.appendChild(script);
Object.defineProperty(w, 'todos', { get: () => w.__t.todos });
['toggleTodoDone', 'openEditModal', 'openAddModal', 'saveModal', 'switchTab', 'subtaskProgress']
  .forEach(k => { w[k] = (...a) => w.__t[k](...a); });

const $ = (id) => w.document.getElementById(id);
let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log('  PASS  ' + label);
  else { fails++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

console.log('\n1. Migration adds subtasks: []');
const stored = () => JSON.parse(w.localStorage.getItem('todos'));
check('both tasks have subtasks array', w.todos.every(t => Array.isArray(t.subtasks)), w.todos.map(t => t.subtasks));

console.log('\n2. Switch to Tasks tab and open a task panel');
w.switchTab('tasks');
const taskA = w.todos.find(t => t.id === 'task-A');
const liFor = (id) => {
  const idx = w.todos.indexOf(w.todos.find(t => t.id === id));
  return [...$('todoList').querySelectorAll('li')].find(li => li.dataset.index === String(idx));
};
let li = liFor('task-A');
check('task rendered', !!li);
const toggleBtn = li.querySelector('.subtask-toggle-btn');
check('subtask toggle button present', !!toggleBtn);
check('no progress badge with 0 subtasks', !li.querySelector('.subtask-badge'));
toggleBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
li = liFor('task-A');
check('panel opens', !!li.querySelector('.subtask-panel'));
check('empty state shown', !!li.querySelector('.subtask-empty'));
check('drag disabled while open', li.draggable === false, li.draggable);

console.log('\n3. Add subtasks inline');
function addInline(id, title) {
  const el = liFor(id).querySelector('.subtask-input');
  el.value = title;
  liFor(id).querySelector('.subtask-add-btn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
}
addInline('task-A', 'Write code');
addInline('task-A', 'Write tests');
addInline('task-A', '   ');
check('two subtasks added, blank ignored', taskA.subtasks.length === 2, taskA.subtasks.map(s => s.title));
check('persisted to localStorage', stored().find(t => t.id === 'task-A').subtasks.length === 2);
li = liFor('task-A');
check('progress badge reads 0/2', li.querySelector('.subtask-badge').textContent === '☑ 0/2', li.querySelector('.subtask-badge').textContent);
check('panel lists 2 items', li.querySelectorAll('.subtask-item').length === 2);

console.log('\n4. Tick a subtask');
li.querySelectorAll('.subtask-item input[type=checkbox]')[0].click();
check('subtask 1 done', taskA.subtasks[0].done === true);
check('subtask 2 untouched', taskA.subtasks[1].done === false);
li = liFor('task-A');
check('badge reads 1/2', li.querySelector('.subtask-badge').textContent === '☑ 1/2', li.querySelector('.subtask-badge').textContent);
check('progress bar 50%', li.querySelector('.subtask-progress-fill').style.width === '50%', li.querySelector('.subtask-progress-fill').style.width);
check('parent pomodoros untouched', taskA.pomodoros === 2, taskA.pomodoros);
check('subtask has no pomodoro field', taskA.subtasks.every(s => s.pomodoros === undefined));

console.log('\n5. Complete parent -> cascade, then un-complete -> selective restore');
w.toggleTodoDone(taskA, true);
check('all subtasks done', taskA.subtasks.every(s => s.done));
check('only #2 flagged autoDone', taskA.subtasks[0].autoDone === undefined && taskA.subtasks[1].autoDone === true,
  taskA.subtasks.map(s => s.autoDone));
w.toggleTodoDone(taskA, false);
check('user-ticked #1 stays done', taskA.subtasks[0].done === true);
check('auto-closed #2 reopened', taskA.subtasks[1].done === false);
check('autoDone flag cleared', taskA.subtasks[1].autoDone === undefined);

console.log('\n6. Search matches subtask titles');
$('headerSearch').value = 'Write tests';
$('headerSearch').dispatchEvent(new w.Event('input', { bubbles: true }));
check('parent task surfaces via subtask text', !!liFor('task-A'));
$('headerSearch').value = 'zzz-nomatch';
$('headerSearch').dispatchEvent(new w.Event('input', { bubbles: true }));
check('non-matching query hides it', !liFor('task-A'));
$('headerSearch').value = '';
$('headerSearch').dispatchEvent(new w.Event('input', { bubbles: true }));

console.log('\n7. Delete a subtask, then undo');
li = liFor('task-A');
li.querySelectorAll('.subtask-item .subtask-del')[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
check('one subtask left', taskA.subtasks.length === 1, taskA.subtasks.map(s => s.title));
check('toast shown', !$('toast').classList.contains('hidden'));
$('toastUndo').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
check('undo restores at original index', taskA.subtasks.length === 2 && taskA.subtasks[0].title === 'Write code',
  taskA.subtasks.map(s => s.title));

console.log('\n8. Modal editor: edit existing task');
const aIdx = w.todos.indexOf(taskA);
w.openEditModal(aIdx);
check('modal prefilled with 2 rows', $('modalSubtaskList').querySelectorAll('.modal-subtask-row').length === 2);
$('taskSubtaskInput').value = 'Deploy';
$('taskSubtaskAdd').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
check('draft row added', $('modalSubtaskList').querySelectorAll('.modal-subtask-row').length === 3);
const rows = $('modalSubtaskList').querySelectorAll('.modal-subtask-row');
rows[0].querySelector('.modal-subtask-title').value = 'Write code v2';
rows[0].querySelector('.modal-subtask-title').dispatchEvent(new w.Event('input', { bubbles: true }));
rows[2].querySelector('input[type=checkbox]').click();
w.saveModal();
check('3 subtasks saved', taskA.subtasks.length === 3, taskA.subtasks.map(s => s.title));
check('rename applied', taskA.subtasks[0].title === 'Write code v2');
check('done state from modal kept', taskA.subtasks[2].done === true);
check('done state of #1 preserved through edit', taskA.subtasks[0].done === true);
check('estPomodoros untouched', taskA.estPomodoros === 4, taskA.estPomodoros);

console.log('\n9. Modal editor: brand-new task starts empty');
w.openAddModal();
check('draft cleared', $('modalSubtaskList').querySelectorAll('.modal-subtask-row').length === 0);
$('taskTitle').value = 'New parent';
$('taskSubtaskInput').value = 'Step one';
$('taskSubtaskAdd').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
w.saveModal();
const fresh = w.todos.find(t => t.title === 'New parent');
check('new task has 1 subtask', fresh && fresh.subtasks.length === 1, fresh && fresh.subtasks);

console.log('\n10. Quick-add gets an empty array');
$('quickAddInput').value = 'Quick one';
$('quickAddBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const quick = w.todos.find(t => t.title === 'Quick one');
check('quick-add subtasks == []', quick && Array.isArray(quick.subtasks) && quick.subtasks.length === 0);

console.log('\n11. Recurring task clones subtasks as fresh/undone');
const rec = w.todos.find(t => t.title === 'New parent');
rec.frequency = 'daily';
rec.dueDate = '2026-07-25';
rec.subtasks[0].done = true;
w.toggleTodoDone(rec, true);
const clones = w.todos.filter(t => t.title === 'New parent' && !t.done);
check('clone created', clones.length === 1);
check('clone subtasks reset to undone', clones[0].subtasks.length === 1 && clones[0].subtasks[0].done === false,
  clones[0] && clones[0].subtasks);
check('clone subtask has a new id', clones[0].subtasks[0].id !== rec.subtasks[0].id);

console.log('\n12. Dashboard Up Next shows checklist progress');
w.switchTab('dashboard');
const dashText = $('dashTaskList').textContent;
check('dash meta includes ☑ counter', /☑ \d+\/\d+/.test(dashText), dashText.slice(0, 300));

console.log('\n13. Export payload carries subtasks');
const savedRound = JSON.parse(w.localStorage.getItem('todos'));
check('round-trips through localStorage', savedRound.find(t => t.id === 'task-A').subtasks.length === 3);

console.log('\n14. Panel state survives re-render');
w.switchTab('tasks');
check('task-A panel still open', !!liFor('task-A').querySelector('.subtask-panel'));

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
