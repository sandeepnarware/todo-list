/* Regression tests for the review fixes: confirm-dialog lifecycle, drag-handler
   binding, local-time session dates, and the timestamp-based timer. */
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

const mk = (id, title, extra = {}) => ({
  id, title, description: '', dueDate: null, priority: 'none', project: '', frequency: 'none',
  tags: [], done: false, completedAt: null, createdAt: 1, pomodoros: 0, estPomodoros: 0,
  wasGolden: false, subtasks: [], ...extra,
});

function boot({ todos, history, activeTaskId } = {}) {
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
  if (history) w.localStorage.setItem('pomodoroHistory', JSON.stringify(history));
  if (activeTaskId) w.localStorage.setItem('activeTaskId', activeTaskId);
  const s = w.document.createElement('script');
  s.textContent = appJs + `\nwindow.__t = { showConfirmModal, switchTab, pomState, startTimer, pauseTimer,
    resetTimer, tick, remainingSeconds, recordSession, loadHistory, migrateSession, localDateKey,
    updateDashDots, makeTodo, renderDashboardUpNext, toggleTodoDone, get todos(){return todos} };`;
  w.document.body.appendChild(s);
  return {
    w, doc: w.document,
    $: (id) => w.document.getElementById(id),
    click: (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })),
    key: (k, target) => (target || w.document).dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true })),
  };
}

const tick = () => new Promise(r => setTimeout(r, 20));

(async () => {
  console.log('\n1. Confirm dialog always settles its promise');
  {
    const t = boot({ todos: [mk('A', 'A')] });
    await tick();
    // Backdrop click
    let settled = null;
    t.w.__t.showConfirmModal('Sure?').then(v => { settled = v; });
    await tick();
    check('dialog opened', !t.$('confirmModal').classList.contains('hidden'));
    t.click(t.$('confirmModal'));
    await tick();
    check('backdrop click resolves false (used to hang)', settled === false, settled);
    check('dialog closed', t.$('confirmModal').classList.contains('hidden'));

    // Escape
    settled = null;
    t.w.__t.showConfirmModal('Again?').then(v => { settled = v; });
    await tick();
    t.key('Escape');
    await tick();
    check('Escape resolves false', settled === false, settled);

    // OK / Cancel still work
    settled = null;
    t.w.__t.showConfirmModal('Ok?').then(v => { settled = v; });
    await tick();
    t.click(t.$('confirmOk'));
    await tick();
    check('OK resolves true', settled === true, settled);
    settled = null;
    t.w.__t.showConfirmModal('Cancel?').then(v => { settled = v; });
    await tick();
    t.click(t.$('confirmCancel'));
    await tick();
    check('Cancel resolves false', settled === false, settled);
  }

  console.log('\n2. Confirm dialog does not leak listeners across dismissals');
  {
    const t = boot({ todos: [mk('A', 'A')] });
    await tick();
    // Dismiss by backdrop several times, then a single OK must resolve exactly one promise.
    for (let i = 0; i < 5; i++) {
      t.w.__t.showConfirmModal('x' + i).then(() => {});
      await tick();
      t.click(t.$('confirmModal'));
      await tick();
    }
    let resolvedCount = 0;
    t.w.__t.showConfirmModal('final').then(() => { resolvedCount++; });
    await tick();
    t.click(t.$('confirmOk'));
    await tick();
    check('one OK click resolves exactly one pending dialog', resolvedCount === 1, resolvedCount);
  }

  console.log('\n3. Dashboard drag handlers are bound once, not per render');
  {
    const t = boot({ todos: [mk('A', 'A'), mk('B', 'B'), mk('C', 'C')] });
    await tick();
    t.w.__t.switchTab('dashboard');
    const container = t.$('dashTaskList');
    let added = 0;
    const realAdd = container.addEventListener.bind(container);
    container.addEventListener = (type, fn, opts) => {
      if (['dragstart', 'dragend', 'dragover', 'drop'].includes(type)) added++;
      return realAdd(type, fn, opts);
    };
    for (let i = 0; i < 10; i++) t.w.__t.renderDashboardUpNext();
    check('no drag listeners re-added across 10 re-renders', added === 0, added);
    check('rows still rendered', container.querySelectorAll('.dash-task-item').length === 3);
    check('current row list is exposed for the handlers', Array.isArray(container._shownTasks));
    check('_shownTasks tracks the latest render', container._shownTasks.length === 3);
  }

  console.log('\n4. Sessions are stored on the local calendar day');
  {
    const t = boot({ todos: [mk('A', 'A')] });
    await tick();
    t.w.__t.recordSession();
    const h = t.w.__t.loadHistory();
    const expected = t.w.__t.localDateKey(new Date());
    check('recorded date is the local day', h[h.length - 1].date === expected,
      { got: h[h.length - 1].date, expected });
    check('a timestamp is stored', typeof h[h.length - 1].timestamp === 'number');
  }

  console.log('\n5. Legacy UTC-dated sessions are migrated from their timestamp');
  {
    // 2026-01-15T23:30:00Z — a different calendar day in any timezone east of UTC.
    const ts = Date.UTC(2026, 0, 15, 23, 30, 0);
    const t = boot({ todos: [mk('A', 'A')], history: [{ date: '2026-01-15', time: '23:30', timestamp: ts }] });
    await tick();
    const h = t.w.__t.loadHistory();
    const expected = t.w.__t.localDateKey(new Date(ts));
    check('date re-derived from the timestamp', h[0].date === expected, { got: h[0].date, expected });
    check('time re-derived as local time',
      h[0].time === `${String(new Date(ts).getHours()).padStart(2, '0')}:${String(new Date(ts).getMinutes()).padStart(2, '0')}`,
      h[0].time);
    check('migration is idempotent', t.w.__t.migrateSession(t.w.__t.migrateSession(h[0])).date === expected);
    check('entries without a timestamp are left alone',
      t.w.__t.migrateSession({ date: '2020-01-01', time: '00:00' }).date === '2020-01-01');
  }

  console.log('\n6. Timer derives remaining time from a deadline, not tick counting');
  {
    const t = boot({ todos: [mk('A', 'A')] });
    await tick();
    const p = t.w.__t.pomState;
    check('no deadline while idle', p.endsAt === null, p.endsAt);
    t.w.__t.startTimer();
    check('deadline set on start', typeof p.endsAt === 'number' && p.endsAt > Date.now(), p.endsAt);
    // Simulate a throttled tab: the browser skipped ~90s of ticks.
    p.endsAt = Date.now() + (25 * 60 - 90) * 1000;
    t.w.__t.tick();
    check('one tick recovers the full elapsed time (no drift)',
      Math.abs(p.timeLeft - (25 * 60 - 90)) <= 1, p.timeLeft);
    t.w.__t.pauseTimer();
    check('pause keeps the recovered remaining time', Math.abs(p.timeLeft - (25 * 60 - 90)) <= 1, p.timeLeft);
    check('pause clears the deadline', p.endsAt === null);
    check('remainingSeconds falls back to timeLeft when paused',
      t.w.__t.remainingSeconds() === p.timeLeft);
    t.w.__t.resetTimer();
    check('reset clears the deadline', p.endsAt === null);
    check('reset restores a full focus block', p.timeLeft === 25 * 60, p.timeLeft);
  }

  console.log('\n7. Timer ends exactly at the deadline');
  {
    const t = boot({ todos: [mk('A', 'A')] });
    await tick();
    const p = t.w.__t.pomState;
    t.w.__t.startTimer();
    p.endsAt = Date.now() - 5000; // deadline already passed
    t.w.__t.tick();
    // tick() clamps to 0, then switchPhase() loads the next phase's duration,
    // so by now timeLeft is the break length — never a negative overshoot.
    check('never shows a negative countdown', p.timeLeft >= 0, p.timeLeft);
    check('stopped running', p.running === false);
    check('deadline cleared', p.endsAt === null);
    check('advanced to the break phase', p.phase !== 'focus', p.phase);
    check('loaded the break duration', p.timeLeft === 5 * 60, p.timeLeft);
  }

  console.log('\n8. Cycle dots use an explicit hook');
  {
    const t = boot({ todos: [mk('A', 'A')] });
    await tick();
    const dots = t.doc.querySelectorAll('#dashCycleDots .dash-cycle-dot');
    check('4 dots found via the hook', dots.length === 4, dots.length);
    const p = t.w.__t.pomState;
    p.sessionCount = 2; p.phase = 'focus';
    t.w.__t.updateDashDots();
    const filled = [...dots].filter(d => /var\(--primary\)/.test(d.style.background)).length;
    check('dots reflect progress through the cycle', filled === 3, filled);
  }

  console.log('\n9. makeTodo is the single source of a task\'s shape');
  {
    const t = boot({ todos: [mk('A', 'A')] });
    await tick();
    const todo = t.w.__t.makeTodo({ title: 'X' });
    const required = ['id', 'title', 'description', 'dueDate', 'priority', 'project', 'frequency',
      'tags', 'done', 'completedAt', 'createdAt', 'pomodoros', 'estPomodoros', 'wasGolden', 'subtasks'];
    check('every field present', required.every(k => k in todo), required.filter(k => !(k in todo)));
    check('subtasks defaults to an array', Array.isArray(todo.subtasks) && todo.subtasks.length === 0);
    check('overrides applied', todo.title === 'X');
    check('ids are unique', t.w.__t.makeTodo().id !== t.w.__t.makeTodo().id);
  }

  console.log('\n10. Dialogs are announced as dialogs');
  {
    const t = boot({ todos: [mk('A', 'A')] });
    await tick();
    ['taskModal', 'supportModal', 'confirmModal', 'helpOverlay'].forEach(id => {
      const el = t.$(id);
      check(`${id} has role=dialog + aria-modal`,
        el.getAttribute('role') === 'dialog' && el.getAttribute('aria-modal') === 'true');
      const label = el.getAttribute('aria-labelledby');
      check(`${id} points at a real label element`, !!label && !!t.$(label), label);
    });
  }

  console.log('\n11. Text inputs have length caps');
  {
    const t = boot({ todos: [mk('A', 'A')] });
    await tick();
    ['taskTitle', 'taskDescription', 'taskProject', 'taskTags', 'quickAddInput',
      'supportSubject', 'supportReplyTo', 'supportMessage'].forEach(id => {
      const el = t.$(id);
      check(`${id} is capped`, el && el.getAttribute('maxlength'), el && el.getAttribute('maxlength'));
    });
  }

  console.log('\n12. Corrupt localStorage degrades instead of wiping everything');
  {
    const good = mk('A', 'Survivor');
    const t = boot({ todos: [null, 'nonsense', 42, { text: 'legacy task' }, { id: 'B' }, good] });
    await tick();
    const titles = t.w.__t.todos.map(x => x.title);
    check('valid task survives', titles.includes('Survivor'), titles);
    check('legacy text entry migrated', titles.includes('legacy task'), titles);
    check('junk entries dropped, not thrown on', t.w.__t.todos.length === 3, titles);
    check('every survivor has an array of tags', t.w.__t.todos.every(x => Array.isArray(x.tags)));
    check('every survivor has an array of subtasks', t.w.__t.todos.every(x => Array.isArray(x.subtasks)));
    check('every survivor has a string title', t.w.__t.todos.every(x => typeof x.title === 'string'));
    check('app still rendered the list', !!t.$('todoList'));
  }

  console.log('\n13. A Content-Security-Policy is declared');
  {
    const t = boot({ todos: [mk('A', 'A')] });
    await tick();
    const meta = t.doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
    check('CSP meta present', !!meta);
    const csp = meta.getAttribute('content');
    check("object-src is 'none'", /object-src 'none'/.test(csp));
    check("base-uri is 'self'", /base-uri 'self'/.test(csp));
    check("no 'unsafe-eval' granted", !/unsafe-eval/.test(csp), csp);
    // Every origin the code actually talks to must be allowed.
    ['https://cdn.tailwindcss.com', 'https://checkout.razorpay.com',
      'https://fonts.googleapis.com', 'https://fonts.gstatic.com',
      'https://api.web3forms.com'].forEach(origin => {
      check(`allows ${origin}`, csp.includes(origin) || csp.includes('*.razorpay.com'), origin);
    });
  }

  console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
