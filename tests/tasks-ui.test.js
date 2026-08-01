/* jsdom harness: the Tasks tab sidebar (project/tag pills, selection indicator,
   Focus Score explainer), inline subtask renaming, the Stats word cloud, and the
   task-card density / layout rules that decide how many tasks fit on screen. */
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
    get tagFilter() { return tagFilter; },
    set currentView(v) { currentView = v; },
    switchTab, renderStats, toggleTodoDone, toggleSubtaskPanel, filterByTag, buildTagWeights,
  };`;
  const s = w.document.createElement('script');
  s.textContent = appJs + bridge;
  w.document.body.appendChild(s);
  return { w, doc: w.document, t: w.__t, errors, $: id => w.document.getElementById(id) };
}

const click = (a, el) => el.dispatchEvent(new a.w.MouseEvent('click', { bubbles: true }));
const key = (a, el, k) => el.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: k, bubbles: true }));

const mkTask = (over = {}) => Object.assign({
  id: 'T1', title: 'Ship feature', description: '', dueDate: null, priority: 'none',
  project: 'Work', frequency: 'none', tags: ['api'], done: false, completedAt: null,
  createdAt: 1, pomodoros: 3, estPomodoros: 4, wasGolden: false, subtasks: [], schedule: [],
}, over);

console.log('\n1. A stale golden-task id at boot must not crash the app');
{
  // saveGoldenTask() renders, and a render reads state declared further down
  // app.js — so validating the stored id too early throws on the TDZ.
  const a = boot({
    todos: [mkTask({ done: true, completedAt: Date.now() })],
    goldenTaskId: 'T1',
    activeTab: 'tasks',
  });
  check('boots without errors', a.errors.length === 0, a.errors);
  check('the stale id is cleared', a.w.localStorage.getItem('goldenTaskId') === null,
    a.w.localStorage.getItem('goldenTaskId'));
  check('the task list still rendered', !!a.$('todoList'));
}

console.log('\n2. Project pills read as project names, not filter keys');
{
  const a = boot({ todos: [mkTask()], activeTab: 'tasks' });
  const pills = [...a.$('tagCloudSidebar').querySelectorAll('.tag-pill')];
  check('one project pill', pills.length === 1, pills.map(p => p.textContent));
  check('no "project:" prefix on screen', pills[0].textContent.trim() === 'work', pills[0].textContent);
  check('but the filter key is unchanged underneath', pills[0].dataset.tag === 'project:work', pills[0].dataset.tag);
}

console.log('\n3. Project Focus disappears once nothing is left to focus on');
{
  const a = boot({ todos: [mkTask()], activeTab: 'tasks' });
  check('shown while work is open', !a.$('projectFocusBlock').classList.contains('hidden'));
  check('Active Tags shown too', !a.$('activeTagsBlock').classList.contains('hidden'));
  a.t.toggleTodoDone(a.t.todos[0], true);
  check('hidden once every task is done', a.$('projectFocusBlock').classList.contains('hidden'));
  check('Active Tags hidden as well', a.$('activeTagsBlock').classList.contains('hidden'));
  a.t.toggleTodoDone(a.t.todos[0], false);
  check('and back when work reopens', !a.$('projectFocusBlock').classList.contains('hidden'));
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n4. A completed-only tag stays visible while it is the active filter');
{
  // Otherwise finishing the last task under a filter would strand the user in a
  // filtered list with no pill to clear.
  const a = boot({ todos: [mkTask()], activeTab: 'tasks' });
  a.t.filterByTag('project:work');
  a.t.toggleTodoDone(a.t.todos[0], true);
  check('Project Focus still shown', !a.$('projectFocusBlock').classList.contains('hidden'));
  check('the selected pill is still there', !!a.$('tagCloudSidebar').querySelector('.tag-pill.active'));
  check('and the clear button with it', !a.$('tagFilterClear').classList.contains('hidden'));
}

console.log('\n5. Selecting a tag or project is visibly indicated');
{
  const a = boot({ todos: [mkTask()], activeTab: 'tasks' });
  check('nothing selected to begin with', a.$('tagFilterClear').classList.contains('hidden'));
  a.t.filterByTag('project:work');
  const pill = a.$('tagCloudSidebar').querySelector('.tag-pill');
  check('the pill gets .active', pill.classList.contains('active'), pill.className);
  check('and aria-pressed for screen readers', pill.getAttribute('aria-pressed') === 'true');
  check('and a ring painted inline (an inline hue would outrank a stylesheet ring)',
    /box-shadow/.test(pill.getAttribute('style') || ''), pill.getAttribute('style'));
  check('the stylesheet supplies a check glyph', /\.tag-pill\.active::before/.test(css));
  check('its title says it can be cleared', /click to clear/i.test(pill.getAttribute('title')), pill.getAttribute('title'));
  check('the clear button names the selection', a.$('tagFilterClearLabel').textContent === 'Clear: work',
    a.$('tagFilterClearLabel').textContent);

  click(a, a.$('tagFilterClear'));
  check('clearing drops the filter', a.t.tagFilter === null, a.t.tagFilter);
  check('and hides the button again', a.$('tagFilterClear').classList.contains('hidden'));
  check('no pill left active', !a.$('tagCloudSidebar').querySelector('.tag-pill.active'));

  const tagPill = a.$('tagCloudTags').querySelector('.tag-pill');
  check('pills are keyboard reachable', tagPill.getAttribute('role') === 'button' && tagPill.tabIndex === 0);
  key(a, tagPill, 'Enter');
  check('Enter selects', a.t.tagFilter === 'api', a.t.tagFilter);
  key(a, a.$('tagCloudTags').querySelector('.tag-pill'), ' ');
  check('Space toggles it back off', a.t.tagFilter === null, a.t.tagFilter);
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n6. Focus Score is explained, not just displayed');
{
  const a = boot({
    todos: [mkTask(), mkTask({ id: 'T2', done: true, completedAt: 1 })],
    activeTab: 'tasks',
  });
  check('1 of 2 done reads as 50%', a.$('focusScorePct').textContent === '50%', a.$('focusScorePct').textContent);
  check('the caption spells out the two numbers behind it',
    /1 of 2 tasks complete/.test(a.$('focusScoreText').textContent), a.$('focusScoreText').textContent);
  check('help is collapsed by default', a.$('focusScoreHelp').classList.contains('hidden'));
  check('the info button is labelled for screen readers', !!a.$('focusScoreInfo').getAttribute('aria-label'));
  click(a, a.$('focusScoreInfo'));
  check('it expands', !a.$('focusScoreHelp').classList.contains('hidden'));
  check('aria-expanded tracks the panel', a.$('focusScoreInfo').getAttribute('aria-expanded') === 'true');
  check('the panel gives the formula', /completed ÷ \(completed \+ still open\)/.test(a.$('focusScoreHelp').textContent),
    a.$('focusScoreHelp').textContent);
  check('and says what does not count', /pomodoros and subtasks don't affect it/.test(a.$('focusScoreHelp').textContent));
  click(a, a.$('focusScoreInfo'));
  check('and collapses again', a.$('focusScoreHelp').classList.contains('hidden'));
  check('the help overlay documents it too', /Focus Score/.test(a.$('helpOverlay').textContent));

  const b = boot({ todos: [], activeTab: 'tasks' });
  check('no tasks reads as 0% with a nudge', b.$('focusScorePct').textContent === '0%'
    && /Add a task/.test(b.$('focusScoreText').textContent), b.$('focusScoreText').textContent);
}

console.log('\n7. Subtasks rename inline in the task list');
{
  const a = boot({
    todos: [mkTask({ subtasks: [{ id: 'S1', title: 'Draft it', done: false, createdAt: 1 }] })],
    activeTab: 'tasks',
  });
  a.t.toggleSubtaskPanel('T1');
  const label = () => a.doc.querySelector('#todoList .subtask-text');
  const input = () => a.doc.querySelector('#todoList .subtask-edit-input');
  check('the label advertises itself as editable',
    label().getAttribute('role') === 'button' && label().tabIndex === 0 && /rename/i.test(label().title));

  click(a, label());
  check('clicking swaps in a text field', !!input());
  check('prefilled with the current title', input().value === 'Draft it', input().value);
  input().value = 'Draft the RFC';
  key(a, input(), 'Enter');
  check('Enter commits', a.t.todos[0].subtasks[0].title === 'Draft the RFC', a.t.todos[0].subtasks[0]);
  check('and persists', JSON.parse(a.w.localStorage.getItem('todos'))[0].subtasks[0].title === 'Draft the RFC');
  check('the label is back', !!label());
  check('with no field left behind', !input());

  click(a, label());
  input().value = 'discarded';
  key(a, input(), 'Escape');
  check('Escape discards the edit', a.t.todos[0].subtasks[0].title === 'Draft the RFC', a.t.todos[0].subtasks[0].title);
  check('and still restores the label', !!label());

  click(a, label());
  input().value = '   ';
  key(a, input(), 'Enter');
  check('a blank title is ignored rather than wiping the subtask',
    a.t.todos[0].subtasks[0].title === 'Draft the RFC');
  check('and the label survives it', !!label());

  click(a, label());
  a.doc.querySelector('#todoList .subtask-edit-input').dispatchEvent(new a.w.Event('blur'));
  check('clicking away also restores the label', !!label());
  check('keyboard opens the editor too', (() => { key(a, label(), 'Enter'); return !!input(); })());
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n8. Subtasks rename inline on the dashboard too');
{
  const a = boot({
    todos: [mkTask({ subtasks: [{ id: 'S1', title: 'Draft it', done: false, createdAt: 1 }] })],
    activeTab: 'dashboard',
  });
  click(a, a.doc.querySelector('.dash-subtask-toggle'));
  const label = a.doc.querySelector('.dash-subtask-text');
  check('the dashboard label is editable too', label.getAttribute('role') === 'button');
  click(a, label);
  const input = a.doc.querySelector('#dashTaskList .subtask-edit-input');
  check('a field appears', !!input);
  input.value = 'Renamed from the dashboard';
  key(a, input, 'Enter');
  check('the rename lands on the task',
    a.t.todos[0].subtasks[0].title === 'Renamed from the dashboard', a.t.todos[0].subtasks[0].title);
  check('no errors', a.errors.length === 0, a.errors);
}

console.log('\n9. Stats word cloud');
{
  const a = boot({
    todos: [
      mkTask({ pomodoros: 6, done: true, completedAt: 1 }),
      mkTask({ id: 'T2', project: 'Side', tags: ['ui'], pomodoros: 1 }),
    ],
    activeTab: 'stats',
  });
  check('a Word Cloud tab exists', !!a.doc.querySelector('#viewTabs [data-view="cloud"]'));
  const weights = a.t.buildTagWeights();
  const wOf = k => weights.find(x => x.key === k).weight;
  check('projects and tags are both weighted', weights.length === 4, weights.map(x => x.key));
  check('time invested dominates the weighting',
    Math.min(wOf('project:work'), wOf('api')) > Math.max(wOf('project:side'), wOf('ui')), weights);

  a.t.currentView = 'cloud';
  a.t.renderStats();
  const words = [...a.$('statsViews').querySelectorAll('.cloud-word')];
  check('every key gets a word', words.length === 4, words.length);
  check('the heaviest word is the largest',
    Math.max(...words.map(x => parseInt(x.style.fontSize, 10))) === 44, words.map(x => x.style.fontSize));
  check('none drops below the 15px floor',
    Math.min(...words.map(x => parseInt(x.style.fontSize, 10))) >= 15, words.map(x => x.style.fontSize));
  check('projects are marked apart from tags',
    words.filter(x => x.classList.contains('is-project')).length === 2);
  check('project words drop the prefix', words.some(x => x.textContent === 'work'), words.map(x => x.textContent));
  check('each word explains its own numbers', /pomodoro/.test(words[0].getAttribute('title')), words[0].getAttribute('title'));
  check('a top-three list backs up the cloud', a.$('statsViews').querySelectorAll('.cloud-rank').length === 3);
  check('the palette is corrected per theme, since these hues were picked for tinted pills',
    /html:not\(\.dark\) \.cloud-word/.test(css) && /html\.dark \.cloud-word/.test(css));

  click(a, words.find(x => x.dataset.cloudTag === 'project:side'));
  check('clicking a word filters the task list', a.t.tagFilter === 'project:side', a.t.tagFilter);
  check('and lands you on the Tasks tab', a.$('pageTitle').textContent === 'Tasks', a.$('pageTitle').textContent);
  check('no errors', a.errors.length === 0, a.errors);

  const b = boot({ todos: [mkTask({ project: '', tags: [] })], activeTab: 'stats' });
  b.t.currentView = 'cloud';
  b.t.renderStats();
  check('an untagged list gets an explanation, not an empty box',
    /Nothing to cloud yet/.test(b.$('statsViews').textContent));
}

console.log('\n10. Layout: the task list takes the width, the cards take less height');
{
  const li = /#todoList > li \{([^}]*)\}/.exec(css)[1];
  check('card padding is tight', /padding:\s*8px 12px/.test(li), li.match(/padding[^;]*/));
  const actions = /\.task-actions-row \{([^}]*)\}/.exec(css)[1];
  check('the gap down to the icon row is tight',
    /margin-top:\s*4px/.test(actions) && /padding-top:\s*3px/.test(actions), actions);
  check('rows sit close together', /id="todoList" class="space-y-1"/.test(html));
  check('the sidebar still stacks below the list under lg', /flex flex-col lg:flex-row/.test(html));
  check('search and New Task share one height', /\.header-control \{[^}]*height:\s*36px/.test(css));
  const a = boot({});
  check('exactly the two header controls carry that class',
    a.doc.querySelectorAll('.header-control').length === 2,
    [...a.doc.querySelectorAll('.header-control')].map(el => el.id || el.tagName));
  check('the New Task button is one of them', a.$('headerAddBtn').classList.contains('header-control'));
  check('the search box is the other', a.$('headerSearch').closest('.header-control') !== null);
  check('the mobile nav is targetable now that it holds six tabs', /#mobileNav \.tab/.test(css));
}

console.log('\n10b. Every tab shares one page width and one set of gutters');
{
  const a = boot({});
  // Per-section caps had drifted to 1000 / 1200 / 1600, so switching tabs shifted
  // the content sideways. One class owns the width now.
  check('a single width rule exists', /\.app-wide \{[^}]*max-width:\s*1600px/.test(css));
  check('and nothing sets its own cap any more',
    !/max-w-\[\d+px\]/.test(html) && !/max-width:\s*1\d{3}px/.test(html),
    (html.match(/max-w-\[\d+px\]|max-width:\s*1\d{3}px/g) || []));

  const sections = [...a.doc.querySelectorAll('section[data-tab]')];
  check('all six tabs are present', sections.length === 6, sections.map(s => s.dataset.tab));
  check('every tab uses the shared gutters',
    sections.every(s => s.classList.contains('tab-pad')),
    sections.filter(s => !s.classList.contains('tab-pad')).map(s => s.dataset.tab));
  check('gutters widen with the viewport rather than staying at 16px',
    /@media \(min-width: 1280px\) \{ \.tab-pad \{ padding-left: 40px/.test(css));

  // Pomodoro centres its own content, so it is the one tab without a width box.
  const wide = ['dashboard', 'tasks', 'stats', 'goals', 'calendar'];
  check('every content tab is inside the shared width box',
    wide.every(t => !!a.doc.querySelector(`section[data-tab="${t}"] .app-wide`)),
    wide.filter(t => !a.doc.querySelector(`section[data-tab="${t}"] .app-wide`)));

  // The extra width goes into the existing widgets. Splitting a row into more
  // columns was explicitly not wanted, so the arrangement is pinned here.
  const lanes = [...a.doc.querySelector('#dashboardSection .grid').children];
  check('the dashboard keeps its two columns', lanes.length === 2,
    lanes.map(l => l.className));
  check('stats tiles, golden task, quotes and the schedule share the left column',
    lanes[0].contains(a.doc.getElementById('dashGolden')) &&
    lanes[0].contains(a.doc.getElementById('dashQuotes')) &&
    lanes[0].contains(a.doc.getElementById('todaySchedule')));
  check('the schedule sits below the quotes',
    !!(a.doc.getElementById('dashQuotes').compareDocumentPosition(a.doc.getElementById('todaySchedule'))
      & a.w.Node.DOCUMENT_POSITION_FOLLOWING));
  check('timer and Up Next share the right column',
    lanes[1].contains(a.doc.getElementById('dashTimer')) &&
    lanes[1].contains(a.doc.getElementById('dashUpNext')));
  check('no third lane sneaks back in at xl', !/xl:col-span-/.test(html),
    (html.match(/xl:col-span-\d+/g) || []));

  check('the stats tiles stay one full-width row above the charts', (() => {
    const bento = a.doc.getElementById('statsBento');
    const views = a.doc.getElementById('statsViews');
    return bento.parentElement === views.parentElement &&
      !!(bento.compareDocumentPosition(views) & a.w.Node.DOCUMENT_POSITION_FOLLOWING);
  })());
  check('and are not stacked into a rail', !/xl:grid-cols-1/.test(html));

  check('the heatmap is no longer pinned at 620px',
    /\.calendar-grid \{[^}]*max-width:\s*840px/.test(css) &&
    /\.calendar-grid \.day-cell \{[^}]*max-width:\s*112px/.test(css));
  check('the pomodoro ring scales up rather than being split into columns',
    /xl:w-\[500px\]/.test(html));
}

console.log('\n11. Donate button wears the app\'s styling');
{
  const a = boot({});
  const embed = a.$('donateEmbed');
  check('the official embed is untouched inside it',
    !!embed.querySelector('form script[src*="checkout.razorpay.com"]'));
  check('the app-styled pill is NOT inside the razorpay form (it would hijack submit)',
    a.$('donateToggle').closest('form') === null);
  check('the pill is themed from tokens, not razorpay branding',
    /\.donate-toggle \{[^}]*var\(--surface-container-high\)/.test(css));
  check('collapsed to start', !embed.classList.contains('open'));
  click(a, a.$('donateToggle'));
  check('opens on click', embed.classList.contains('open'));
  check('aria-expanded set', a.$('donateToggle').getAttribute('aria-expanded') === 'true');
  check('the label flips', /Maybe later/.test(a.$('donateToggle').textContent), a.$('donateToggle').textContent);
  click(a, a.$('donateToggle'));
  check('and closes again', !embed.classList.contains('open'));
  check('the embed is clipped rather than display:none, so razorpay can still size its iframe',
    /\.donate-embed \{[^}]*max-height:\s*0/.test(css) && !/\.donate-embed \{[^}]*display:\s*none/.test(css));
}

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
