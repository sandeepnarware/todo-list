/* jsdom harness: view + complete subtasks directly from the dashboard Up Next list. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const quotesRaw = fs.readFileSync(path.join(ROOT, 'quotes.json'), 'utf8');
const versionRaw = fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8');

let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log('  PASS  ' + label);
  else { fails++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!/tailwind|Could not load|Not implemented/.test(e.message)) console.log('JSDOM ERR:', e.message); });
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/', virtualConsole: vc, pretendToBeVisual: true });
const w = dom.window;
w.Notification = { permission: 'denied', requestPermission() {} };
w.AudioContext = function () { throw new Error('no audio'); };
w.documentPictureInPicture = null;
let n = 0;
w.crypto = Object.assign({}, w.crypto, { randomUUID: () => `uuid-${++n}` });
w.alert = () => {};
w.fetch = (url) => {
  if (String(url) === 'quotes.json') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(quotesRaw)) });
  if (String(url) === 'version.json') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(versionRaw)) });
  return Promise.reject(new Error('blocked'));
};

const mk = (id, title, subs, extra = {}) => ({
  id, title, description: '', dueDate: null, priority: 'none', project: '', frequency: 'none',
  tags: [], done: false, completedAt: null, createdAt: 1, pomodoros: 0, estPomodoros: 0,
  wasGolden: false,
  subtasks: subs.map((s, i) => ({ id: `${id}-s${i}`, title: s.t, done: !!s.d, createdAt: 1 })),
  ...extra,
});

w.localStorage.setItem('todos', JSON.stringify([
  mk('A', 'Parent with subtasks', [{ t: 'Alpha' }, { t: 'Beta', d: true }, { t: 'Gamma <script>' }]),
  mk('B', 'Plain task, no subtasks', []),
  mk('C', 'Second parent', [{ t: 'Only one' }]),
]));

const bridge = `window.__t = { switchTab, renderDashboardUpNext, get todos(){return todos},
  get dashExpandedSubtasks(){return dashExpandedSubtasks}, get expandedSubtasks(){return expandedSubtasks},
  subtaskProgress, escapeHtml };`;
const script = w.document.createElement('script');
script.textContent = appJs + bridge;
w.document.body.appendChild(script);

const T = w.__t;
const doc = w.document;
const list = doc.getElementById('dashTaskList');
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const row = (id) => list.querySelector(`.dash-task-item[data-task-id="${id}"]`);
const taskA = () => T.todos.find(t => t.id === 'A');

T.switchTab('dashboard');

console.log('\n1. Collapsed by default; toggle only where there are subtasks');
check('3 task rows rendered', list.querySelectorAll('.dash-task-item').length === 3,
  list.querySelectorAll('.dash-task-item').length);
check('task A has a disclosure toggle', !!row('A').querySelector('.dash-subtask-toggle'));
check('task C has a disclosure toggle', !!row('C').querySelector('.dash-subtask-toggle'));
check('task B (no subtasks) has NO toggle', !row('B').querySelector('.dash-subtask-toggle'));
check('no checklist visible before expanding', list.querySelectorAll('.dash-subtask-list').length === 0);
check('toggle reports collapsed', row('A').querySelector('.dash-subtask-toggle').getAttribute('aria-expanded') === 'false');
check('toggle shows expand_more icon',
  row('A').querySelector('.dash-subtask-toggle .material-symbols-outlined').textContent === 'expand_more');
check('progress still summarised in the meta line', /☑ 1\/3/.test(row('A').textContent), row('A').textContent);

console.log('\n2. Expanding shows the subtasks');
click(row('A').querySelector('.dash-subtask-toggle'));
check('checklist appears', !!row('A').querySelector('.dash-subtask-list'));
check('all 3 subtasks listed', row('A').querySelectorAll('.dash-subtask-item').length === 3);
check('titles rendered in order',
  [...row('A').querySelectorAll('.dash-subtask-text')].map(e => e.textContent).join('|') === 'Alpha|Beta|Gamma <script>',
  [...row('A').querySelectorAll('.dash-subtask-text')].map(e => e.textContent));
check('done subtask marked done', row('A').querySelectorAll('.dash-subtask-item')[1].className.includes('done'));
check('undone subtasks not marked done',
  !row('A').querySelectorAll('.dash-subtask-item')[0].className.includes('done'));
check('done icon is check_circle',
  row('A').querySelectorAll('.dash-subtask-check')[1].textContent === 'check_circle');
check('undone icon is radio_button_unchecked',
  row('A').querySelectorAll('.dash-subtask-check')[0].textContent === 'radio_button_unchecked');
check('aria-expanded flipped to true', row('A').querySelector('.dash-subtask-toggle').getAttribute('aria-expanded') === 'true');
check('icon flipped to expand_less',
  row('A').querySelector('.dash-subtask-toggle .material-symbols-outlined').textContent === 'expand_less');
check('other rows stay collapsed', !row('C').querySelector('.dash-subtask-list'));

console.log('\n3. Subtask titles are escaped, not injected as HTML');
check('no live <script> element from a subtask title',
  row('A').querySelectorAll('script').length === 0);
check('escapeHtml escapes angle brackets and quotes',
  T.escapeHtml('<b>"x"&\'y\'</b>') === '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;',
  T.escapeHtml('<b>"x"&\'y\'</b>'));

console.log('\n4. Completing a subtask from the dashboard');
click(row('A').querySelectorAll('.dash-subtask-check')[0]);
check('model updated: Alpha done', taskA().subtasks[0].done === true);
check('other subtasks untouched',
  taskA().subtasks[1].done === true && taskA().subtasks[2].done === false,
  taskA().subtasks.map(s => s.done));
check('persisted to localStorage',
  JSON.parse(w.localStorage.getItem('todos')).find(t => t.id === 'A').subtasks[0].done === true);
check('meta counter refreshed to 2/3', /☑ 2\/3/.test(row('A').textContent), row('A').textContent);
check('panel stayed open after the tick', !!row('A').querySelector('.dash-subtask-list'));
check('row now shows 2 done items',
  [...row('A').querySelectorAll('.dash-subtask-item')].filter(li => li.className.includes('done')).length === 2);

console.log('\n5. Un-completing works too');
click(row('A').querySelectorAll('.dash-subtask-check')[1]);
check('Beta toggled back to not done', taskA().subtasks[1].done === false);
check('counter back to 1/3', /☑ 1\/3/.test(row('A').textContent), row('A').textContent);

console.log('\n6. Parent task is NOT completed by ticking a subtask');
check('parent still pending', taskA().done === false);
check('parent pomodoros untouched (tracked at parent level only)', taskA().pomodoros === 0);
check('subtask carries no pomodoro field', taskA().subtasks.every(s => s.pomodoros === undefined));

console.log('\n7. Dashboard and task-list panels are independent');
check('expanding on dashboard did not expand the task list',
  !T.expandedSubtasks.has('A'), [...T.expandedSubtasks]);
check('dashboard state tracked separately', T.dashExpandedSubtasks.has('A'), [...T.dashExpandedSubtasks]);

console.log('\n8. Changes made on the dashboard show up in the task list');
T.switchTab('tasks');
const tl = doc.getElementById('todoList');
const tlRow = [...tl.querySelectorAll('li')].find(li => li.textContent.includes('Parent with subtasks'));
check('task list badge reflects the dashboard edit', /☑ 1\/3/.test(tlRow.textContent), tlRow.textContent);

console.log('\n9. Task list left exactly as it was');
const badge = tlRow.querySelector('.subtask-badge');
check('progress badge still present', !!badge, badge && badge.textContent);
check('badge still toggles the inline panel', (() => {
  click(badge);
  const r = [...tl.querySelectorAll('li')].find(li => li.textContent.includes('Parent with subtasks'));
  return !!r.querySelector('.subtask-panel');
})());
const tlRow2 = [...tl.querySelectorAll('li')].find(li => li.textContent.includes('Parent with subtasks'));
check('inline panel still lists all 3 subtasks', tlRow2.querySelectorAll('.subtask-item').length === 3);
check('inline panel still has an add-subtask input', !!tlRow2.querySelector('.subtask-input'));
check('actions-row toggle button still present', !!tlRow2.querySelector('.subtask-toggle-btn'));

console.log('\n10. Collapsing again on the dashboard');
T.switchTab('dashboard');
check('panel still open (state remembered)', !!row('A').querySelector('.dash-subtask-list'));
click(row('A').querySelector('.dash-subtask-toggle'));
check('checklist hidden', !row('A').querySelector('.dash-subtask-list'));
check('aria-expanded back to false', row('A').querySelector('.dash-subtask-toggle').getAttribute('aria-expanded') === 'false');
check('summary counter still shown when collapsed', /☑ 1\/3/.test(row('A').textContent));

console.log('\n11. Existing dashboard row controls still work');
check('drag handle present', !!row('A').querySelector('.drag-handle-dash'));
check('play button present', !!row('A').querySelector('.dash-task-play'));
check('complete button present', !!row('A').querySelector('.dash-task-check'));
check('main row is still a flex line', !!row('A').querySelector('.dash-task-main'));
check('row draggable when collapsed', row('A').getAttribute('draggable') === 'true');
click(row('A').querySelector('.dash-subtask-toggle'));
check('row NOT draggable while expanded (so checkboxes stay usable)',
  row('A').getAttribute('draggable') === 'false', row('A').getAttribute('draggable'));

console.log('\n12. Completing the parent from the dashboard cascades');
click(row('A').querySelector('.dash-task-check'));
check('parent marked done', taskA().done === true);
check('all subtasks closed out', taskA().subtasks.every(s => s.done), taskA().subtasks.map(s => s.done));
check('done parent leaves the pending Up Next list', !row('A'));

console.log('\n13. Styles exist for the new dashboard elements');
['.dash-subtask-toggle', '.dash-subtask-list', '.dash-subtask-item', '.dash-subtask-check',
  '.dash-subtask-text'].forEach(sel => {
  check(`${sel} styled`, new RegExp(sel.replace('.', '\\.') + '[\\s,{:]').test(css));
});
check('done state struck through', /\.dash-subtask-item\.done \.dash-subtask-text\s*\{[^}]*line-through/.test(css));

console.log('\n14. Empty-state and no-subtask rows unaffected');
w.localStorage.setItem('todos', JSON.stringify([mk('Z', 'Lonely task', [])]));
const s2 = doc.createElement('script');
s2.textContent = 'todos = loadTodos(); renderDashboardUpNext();';
doc.body.appendChild(s2);
check('row renders without a toggle', !!list.querySelector('.dash-task-item') && !list.querySelector('.dash-subtask-toggle'));
check('no checklist markup', !list.querySelector('.dash-subtask-list'));
check('no ☑ counter in meta for a task with no subtasks', !/☑/.test(list.textContent), list.textContent.trim());

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
