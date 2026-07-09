/* ===== Pomodoro State ===== */
const FOCUS_TIME = 25 * 60;
const BREAK_TIME = 5 * 60;

let pomState = {
  timeLeft: FOCUS_TIME,
  phase: 'focus',
  running: false,
  sessionCount: 0,
  timerId: null,
};

/* ===== Pomodoro DOM ===== */
const timerEl = document.getElementById('timer');
const phaseEl = document.getElementById('phase');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const sessionCountEl = document.getElementById('sessionCount');
const progressFg = document.querySelector('.progress-ring .fg');
const circumference = 553;

const pomSection = document.getElementById('pomodoroSection');
const compactTimer = document.getElementById('compactTimer');
const compactPhase = document.getElementById('compactPhase');
const compactSessions = document.getElementById('compactSessions');
const compactStartBtn = document.getElementById('compactStartBtn');

/* ===== Audio ===== */
let audioCtx = null;

function playBeep() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 800;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.8);
  } catch {}
}

function playTripleBeep() {
  playBeep();
  setTimeout(() => playBeep(), 250);
  setTimeout(() => playBeep(), 500);
}

/* ===== Notifications ===== */
if (Notification.permission === 'default') Notification.requestPermission();

function notifyPhaseEnd(phase) {
  if (Notification.permission !== 'granted') return;
  const labels = { focus: 'Focus session complete — time for a break!', break: 'Break over — back to focus!' };
  new Notification('Pomodoro', { body: labels[phase] || 'Timer done!', icon: '/favicon.ico' });
}

/* ===== Pomodoro Timer ===== */
function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const BASE_TITLE = document.title;

function updateCompactDisplay() {
  compactTimer.textContent = formatTime(pomState.timeLeft);
  compactPhase.textContent = pomState.phase === 'focus' ? 'Focus' : 'Break';
  compactSessions.textContent = `${pomState.sessionCount} sessions`;
}

function setCompact(compact) {
  pomSection.classList.toggle('pomodoro--compact', compact);
}

function updateDisplay() {
  timerEl.textContent = formatTime(pomState.timeLeft);
  updateCompactDisplay();
  if (pomState.running) {
    const label = pomState.phase === 'focus' ? 'F' : 'B';
    document.title = `${formatTime(pomState.timeLeft)} [${label}] - PomoDone`;
  } else {
    document.title = BASE_TITLE;
  }
  const total = pomState.phase === 'focus' ? FOCUS_TIME : BREAK_TIME;
  const offset = circumference * (1 - pomState.timeLeft / total);
  progressFg.style.strokeDashoffset = offset;
}

function updatePhaseLabel() {
  const labels = { focus: 'Focus', break: 'Break' };
  phaseEl.textContent = labels[pomState.phase];
  progressFg.style.stroke = pomState.phase === 'focus' ? '#ff6b6b' : '#4ecdc4';
}

function startTimer() {
  if (pomState.running) return;
  pomState.running = true;
  startBtn.disabled = true;
  pauseBtn.disabled = false;
  resetBtn.disabled = false;
  pomState.timerId = setInterval(tick, 1000);
  setCompact(false);
  updatePipControls();
}

function pauseTimer() {
  pomState.running = false;
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  resetBtn.disabled = false;
  clearInterval(pomState.timerId);
  updateDisplay();
  setCompact(true);
  updatePipControls();
}

function resetTimer() {
  pomState.running = false;
  clearInterval(pomState.timerId);
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  resetBtn.disabled = false;
  pomState.phase = 'focus';
  pomState.timeLeft = FOCUS_TIME;
  updatePhaseLabel();
  updateDisplay();
  setCompact(true);
  updatePipControls();
}

function recordSession() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 5);
  const history = loadHistory();
  history.push({ date, time, timestamp: Date.now() });
  saveHistory(history);
  renderStats();
}

function switchPhase() {
  if (pomState.phase === 'focus') {
    pomState.sessionCount++;
    sessionCountEl.textContent = pomState.sessionCount;
    recordSession();
    const task = getActiveTask();
    if (task) {
      task.pomodoros = (task.pomodoros || 0) + 1;
      saveTodos();
      renderTodos();
    }
    pomState.phase = 'break';
    pomState.timeLeft = BREAK_TIME;
  } else {
    pomState.phase = 'focus';
    pomState.timeLeft = FOCUS_TIME;
  }
  updatePhaseLabel();
  updateDisplay();
}

function tick() {
  pomState.timeLeft--;
  updateDisplay();
  if (pomState.timeLeft <= 0) {
    pomState.running = false;
    clearInterval(pomState.timerId);
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    resetBtn.disabled = false;
    playTripleBeep();
    notifyPhaseEnd(pomState.phase);
    switchPhase();
    updatePipControls();
  }
}

startBtn.addEventListener('click', startTimer);
compactStartBtn.addEventListener('click', startTimer);
pauseBtn.addEventListener('click', pauseTimer);
resetBtn.addEventListener('click', resetTimer);

/* ===== Picture-in-Picture ===== */
const pipBtn = document.getElementById('pipBtn');
let pipWindow = null;
let pipUpdateId = null;

function updatePipWindow() {
  if (!pipWindow || pipWindow.closed) return;
  try {
    pipWindow.document.getElementById('pipTime').textContent = formatTime(pomState.timeLeft);
    pipWindow.document.getElementById('pipPhase').textContent = pomState.phase === 'focus' ? 'Focus' : 'Break';
    const task = getActiveTask();
    const pipTask = pipWindow.document.getElementById('pipCurrentTask');
    if (pipTask) pipTask.textContent = task ? '▶ ' + task.title : '';
    updatePipControls();
  } catch { closePip(); }
}

function updatePipControls() {
  if (!pipWindow || pipWindow.closed) return;
  try {
    const pipStart = pipWindow.document.getElementById('pipStartBtn');
    const pipPause = pipWindow.document.getElementById('pipPauseBtn');
    const pipReset = pipWindow.document.getElementById('pipResetBtn');
    if (pipStart) pipStart.disabled = pomState.running;
    if (pipPause) pipPause.disabled = !pomState.running;
    if (pipReset) pipReset.disabled = false;
  } catch {}
}

function closePip() {
  if (pipUpdateId) { clearInterval(pipUpdateId); pipUpdateId = null; }
  if (pipWindow && !pipWindow.closed) pipWindow.close();
  pipWindow = null;
  pipBtn.classList.remove('active');
}

async function togglePip() {
  if (pipWindow) { closePip(); return; }
  if (!documentPictureInPicture) {
    alert('Picture-in-Picture is not supported in this browser. Try Chrome 116+ or Brave.');
    return;
  }
  try {
    pipWindow = await documentPictureInPicture.requestWindow({ width: 300, height: 240 });
    pipBtn.classList.add('active');
    pipWindow.document.body.innerHTML = `
      <div class="pip-timer">
        <div class="pip-time" id="pipTime">25:00</div>
        <div class="pip-phase" id="pipPhase">Focus</div>
        <div class="pip-current-task" id="pipCurrentTask"></div>
        <div class="pip-controls">
          <button id="pipStartBtn" class="pip-btn pip-start">Start</button>
          <button id="pipPauseBtn" class="pip-btn pip-pause" disabled>Pause</button>
          <button id="pipResetBtn" class="pip-btn pip-reset">Reset</button>
        </div>
      </div>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        html,body{height:100%}
        body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f0f23;color:#e0e0e0;display:flex;align-items:center;justify-content:center}
        .pip-timer{text-align:center}
        .pip-time{font-size:3rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1}
        .pip-phase{font-size:0.8rem;text-transform:uppercase;letter-spacing:3px;color:#888;margin-top:0.25rem}
        .pip-current-task{font-size:0.75rem;color:#ff6b6b;margin-top:0.3rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px;display:inline-block}
        .pip-controls{display:flex;gap:0.4rem;justify-content:center;margin-top:0.6rem}
        .pip-btn{padding:0.3rem 0.6rem;border:none;border-radius:5px;font-size:0.7rem;font-weight:600;cursor:pointer;transition:background 0.2s;text-transform:uppercase;letter-spacing:0.5px}
        .pip-start{background:#ff6b6b;color:#fff}
        .pip-start:hover:not(:disabled){background:#e55a5a}
        .pip-pause{background:#4ecdc4;color:#fff}
        .pip-pause:hover:not(:disabled){background:#3dbdb5}
        .pip-reset{background:#2d2d44;color:#e0e0e0}
        .pip-reset:hover:not(:disabled){background:#3d3d55}
        .pip-btn:disabled{opacity:0.35;cursor:default}
      </style>
    `;
    pipWindow.document.getElementById('pipStartBtn').addEventListener('click', startTimer);
    pipWindow.document.getElementById('pipPauseBtn').addEventListener('click', pauseTimer);
    pipWindow.document.getElementById('pipResetBtn').addEventListener('click', resetTimer);
    updatePipWindow();
    pipUpdateId = setInterval(updatePipWindow, 500);
    pipWindow.addEventListener('pagehide', closePip);
    pipWindow.addEventListener('beforeunload', closePip);
  } catch (e) {
    console.error('PiP failed:', e);
    pipWindow = null;
  }
}

pipBtn.addEventListener('click', togglePip);

/* ===== Todo State ===== */
const addTaskBtn = document.getElementById('addTaskBtn');
const todoList = document.getElementById('todoList');
const taskCount = document.getElementById('taskCount');
const taskModal = document.getElementById('taskModal');
const modalTitle = document.getElementById('modalTitle');
const editId = document.getElementById('editId');
const taskTitle = document.getElementById('taskTitle');
const taskDescription = document.getElementById('taskDescription');
const taskDue = document.getElementById('taskDue');
const taskPriority = document.getElementById('taskPriority');
const taskProject = document.getElementById('taskProject');
const taskFrequency = document.getElementById('taskFrequency');
const taskTags = document.getElementById('taskTags');
const tagsContainer = document.getElementById('tagsContainer');
const taskEstPomodoros = document.getElementById('taskEstPomodoros');
const modalSave = document.getElementById('modalSave');
const modalCancel = document.getElementById('modalCancel');
const modalClose = document.getElementById('modalClose');

const taskSearch = document.getElementById('taskSearch');
const taskStatBar = document.getElementById('taskStatBar');
const toast = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');
const toastUndo = document.getElementById('toastUndo');

let todos = loadTodos();
let goldenTaskId = loadGoldenTask();
validateGoldenTask();
let tagFilter = null;
let draggedIndex = null;
let tagsList = [];
let showCompleted = false;
let completedPage = 0;
let sortBy = 'custom';
let searchQuery = '';
let toastTimer = null;
let undoData = null;

/* ===== Active Task ===== */
const currentTaskDisplay = document.getElementById('currentTaskDisplay');
let activeTaskId = loadActiveTask();

function loadActiveTask() {
  return localStorage.getItem('activeTaskId') || null;
}

function saveActiveTask(id) {
  activeTaskId = id;
  if (id) {
    localStorage.setItem('activeTaskId', id);
  } else {
    localStorage.removeItem('activeTaskId');
  }
  updateCurrentTaskDisplay();
  renderTodos();
}

function getActiveTask() {
  if (!activeTaskId) return null;
  const task = todos.find(t => t.id === activeTaskId);
  if (!task) {
    saveActiveTask(null);
    return null;
  }
  return task;
}

function setActiveTask(id) {
  if (activeTaskId === id) {
    saveActiveTask(null);
  } else {
    saveActiveTask(id);
  }
}

function updateCurrentTaskDisplay() {
  const task = getActiveTask();
  currentTaskDisplay.textContent = task ? '▶ ' + task.title : '';
  if (pipWindow && !pipWindow.closed) {
    const el = pipWindow.document.getElementById('pipCurrentTask');
    if (el) el.textContent = task ? '▶ ' + task.title : '';
  }
}

/* ===== Golden Task ===== */
function loadGoldenTask() {
  return localStorage.getItem('goldenTaskId') || null;
}

function saveGoldenTask(id) {
  goldenTaskId = id;
  if (id) {
    localStorage.setItem('goldenTaskId', id);
  } else {
    localStorage.removeItem('goldenTaskId');
  }
  renderTodos();
}

function toggleGoldenTask(id) {
  if (goldenTaskId === id) {
    saveGoldenTask(null);
  } else {
    saveGoldenTask(id);
  }
}

function validateGoldenTask() {
  if (!goldenTaskId) return;
  const task = todos.find(t => t.id === goldenTaskId && !t.done);
  if (!task) saveGoldenTask(null);
}

const TAG_COLORS = [
  '#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3', '#54a0ff',
  '#5f27cd', '#01a3a4', '#f368e0', '#ff9f43', '#10ac84',
  '#ee5a24', '#0abde3', '#a29bfe', '#fd79a8', '#6c5ce7',
  '#00b894', '#e17055', '#00cec9', '#e056fd', '#badc58',
];

function calcNextDue(dueDate, frequency) {
  if (!dueDate || frequency === 'none') return null;
  const d = new Date(dueDate + 'T00:00:00');
  if (frequency === 'daily') d.setDate(d.getDate() + 1);
  else if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (frequency === 'yearly') d.setFullYear(d.getFullYear() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getTagColorMap() {
  const tags = extractTags();
  const map = {};
  let ci = 0;
  tags.forEach(tag => {
    map[tag] = TAG_COLORS[ci % TAG_COLORS.length]; ci++;
  });
  return map;
}

function parseDueInfo(todo) {
  if (!todo.dueDate) return null;
  const p = todo.dueDate.split('-');
  const due = new Date(+p[0], +p[1] - 1, +p[2]);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
  let label;
  if (diff === 0) label = 'Today';
  else if (diff === 1) label = 'Tomorrow';
  else if (diff < 0) label = todo.dueDate;
  else label = todo.dueDate;
  return { date: due, label, overdue: due < today };
}

/* ===== Todo localStorage ===== */
function loadTodos() {
  try {
    const data = JSON.parse(localStorage.getItem('todos')) || [];
    return data.map(migrateTodo);
  } catch {
    return [];
  }
}

function saveTodos() {
  localStorage.setItem('todos', JSON.stringify(todos));
}

function migrateTodo(old) {
  if (old.id) {
    if (old.pomodoros === undefined) old.pomodoros = 0;
    if (old.wasGolden === undefined) old.wasGolden = false;
    return old;
  }
  const tags = [];
  let text = old.text;
  const tagMatches = text.match(/#([\w-]+)/g);
  if (tagMatches) {
    tagMatches.forEach(m => {
      tags.push(m.slice(1));
      text = text.replace(m, '').trim();
    });
  }
  let dueDate = null;
  const dueMatch = text.match(/@Due\[(today|tomorrow|\d{1,2}\/\d{1,2}\/\d{2,4})\]/i);
  if (dueMatch) {
    const raw = dueMatch[1].toLowerCase();
    if (raw === 'today') { const d = new Date(); dueDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
    else if (raw === 'tomorrow') { const d = new Date(); d.setDate(d.getDate() + 1); dueDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
    else { const p = raw.split('/'); const d = new Date(p[2].length === 2 ? 2000 + +p[2] : +p[2], +p[1] - 1, +p[0]); dueDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
    text = text.replace(dueMatch[0], '').trim();
  }
  text = text.replace(/@(Today|Tomorrow)\b/gi, '').trim();
  text = text.replace(/@(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g, '').trim();
  text = text.replace(/#CompleteOn\[\d{2}\/\d{2}\/\d{2}\]/g, '').trim();
  return {
    id: crypto.randomUUID(),
    title: text || 'Untitled',
    description: '',
    dueDate,
    priority: 'none',
    project: '',
    frequency: 'none',
    tags,
    done: old.done,
    completedAt: null,
    createdAt: Date.now(),
    pomodoros: 0,
    estPomodoros: 0,
    wasGolden: false
  };
}

function renderTagsList(tags, tagColors) {
  return tags.map(t => {
    const c = tagColors[t.toLowerCase()] || TAG_COLORS[0];
    return `<span class="tag" style="background:${c}33;color:${c}">${t}</span>`;
  }).join('');
}

function extractTags() {
  const set = new Set();
  todos.forEach(t => (t.tags || []).forEach(tag => set.add(tag.toLowerCase())));
  todos.forEach(t => {
    if (t.project) set.add('project:' + t.project.toLowerCase());
  });
  return [...set].sort();
}

function renderTagCloud() {
  const tags = extractTags();
  const colorMap = getTagColorMap();
  const html = tags.map(t => {
    const isProject = t.startsWith('project:');
    const count = isProject
      ? todos.filter(td => td.project && td.project.toLowerCase() === t.slice(8)).length
      : todos.filter(td => (td.tags || []).some(tag => tag.toLowerCase() === t)).length;
    const active = tagFilter === t ? 'active' : '';
    const c = colorMap[t];
    const style = c ? `style="background:${c}22;color:${c};border-color:${c}44"` : '';
    return `<span class="tag-pill ${active}" data-tag="${t}" ${style}>${t} <span class="count">${count}</span></span>`;
  }).join('');
  document.getElementById('tagCloud').innerHTML = html;
}

function clearFilter() {
  tagFilter = null;
  renderTagCloud();
  renderTodos();
}

function filterByTag(tag) {
  tagFilter = tagFilter === tag ? null : tag;
  renderTagCloud();
  renderTodos();
}

function matchesTagFilter(todo, tagFilter) {
  if (!tagFilter) return true;
  if (tagFilter.startsWith('project:')) {
    const proj = tagFilter.slice(8);
    return todo.project && todo.project.toLowerCase() === proj;
  }
  return (todo.tags || []).some(t => t.toLowerCase() === tagFilter);
}

function renderTodoItem(todo, tagColors, showCompleted) {
  const origIndex = todos.indexOf(todo);
  const li = document.createElement('li');
  if (todo.done) li.classList.add('completed');
  if (!todo.done && todo.id === goldenTaskId) li.classList.add('golden');

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = todo.done;
  cb.addEventListener('change', () => {
    const t = todos[origIndex];
    t.done = cb.checked;
    t.completedAt = cb.checked ? Date.now() : null;
    if (t.done && t.id === goldenTaskId) {
      t.wasGolden = true;
      saveGoldenTask(null);
    }
    if (t.done && t.frequency && t.frequency !== 'none') {
      const nextDue = calcNextDue(t.dueDate, t.frequency);
      if (nextDue) {
        todos.push({
          id: crypto.randomUUID(),
          title: t.title,
          description: t.description,
          dueDate: nextDue,
          priority: t.priority,
          project: t.project,
          frequency: t.frequency,
          tags: [...t.tags],
          done: false,
          completedAt: null,
          createdAt: Date.now(),
          pomodoros: 0,
          estPomodoros: t.estPomodoros || 0,
          wasGolden: false
        });
      }
    }
    saveTodos();
    renderTagCloud();
    renderTodos();
  });

  const content = document.createElement('div');
  content.className = 'task-content';

  const titleRow = document.createElement('div');
  titleRow.className = 'task-title-row';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'task-text';
  titleSpan.textContent = todo.title;
  titleRow.appendChild(titleSpan);

  const badges = document.createElement('div');
  badges.className = 'task-badges';

  if (todo.priority && todo.priority !== 'none') {
    const pBadge = document.createElement('span');
    pBadge.className = `priority-badge ${todo.priority}`;
    pBadge.textContent = todo.priority;
    badges.appendChild(pBadge);
  }

  if (todo.project) {
    const projBadge = document.createElement('span');
    projBadge.className = 'project-badge';
    projBadge.textContent = todo.project;
    badges.appendChild(projBadge);
  }

  if (todo.frequency && todo.frequency !== 'none') {
    const freqBadge = document.createElement('span');
    freqBadge.className = 'freq-badge';
    freqBadge.textContent = '🔄 ' + todo.frequency;
    badges.appendChild(freqBadge);
  }

  const dueInfo = parseDueInfo(todo);
  if (dueInfo) {
    const badge = document.createElement('span');
    badge.className = 'due-badge' + (dueInfo.overdue && !todo.done ? ' overdue' : '');
    badge.textContent = '📅 ' + dueInfo.label;
    badges.appendChild(badge);
  }

  if (showCompleted && todo.completedAt) {
    const completedBadge = document.createElement('span');
    completedBadge.className = 'completed-badge';
    const d = new Date(todo.completedAt);
    completedBadge.textContent = '✓ ' + d.toLocaleDateString();
    badges.appendChild(completedBadge);
  }

  if (badges.children.length > 0) {
    titleRow.appendChild(badges);
  }

  content.appendChild(titleRow);

  if (todo.tags && todo.tags.length > 0) {
    const tagsRow = document.createElement('div');
    tagsRow.className = 'task-tags-row';
    tagsRow.innerHTML = renderTagsList(todo.tags, tagColors);
    content.appendChild(tagsRow);
  }

  if (todo.description) {
    const desc = document.createElement('div');
    desc.className = 'task-desc';
    desc.textContent = todo.description;
    content.appendChild(desc);
  }

  const actionsRow = document.createElement('div');
  actionsRow.className = 'task-actions-row';

  const goldenBtn = document.createElement('button');
  goldenBtn.className = 'golden-btn' + (todo.id === goldenTaskId ? ' active' : '');
  goldenBtn.textContent = '⭐';
  goldenBtn.setAttribute('aria-label', 'Mark as golden task');
  goldenBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (goldenTaskId && goldenTaskId !== todo.id) {
      const current = todos.find(t => t.id === goldenTaskId && !t.done);
      if (current && !await showConfirmModal(`"${current.title}" is your golden task. Make "${todo.title}" the golden task instead?`)) return;
    }
    toggleGoldenTask(todo.id);
  });
  actionsRow.appendChild(goldenBtn);

  const playBtn = document.createElement('button');
  playBtn.className = 'play-btn';
  playBtn.innerHTML = todo.id === activeTaskId ? '⏹' : '▶';
  playBtn.setAttribute('aria-label', 'Focus on this task');
  playBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (activeTaskId && activeTaskId !== todo.id) {
      const current = getActiveTask();
      if (!await showConfirmModal(`You're focusing on "${current ? current.title : 'a task'}". Switch to "${todo.title}"?`)) return;
    }
    setActiveTask(todo.id);
  });
  actionsRow.appendChild(playBtn);

  const pomoBadge = document.createElement('span');
  pomoBadge.className = 'task-pomo-count';
  const est = todo.estPomodoros || 0;
  if (est > 0) {
    const done = todo.pomodoros || 0;
    pomoBadge.innerHTML = `🍅 <span class="est-pomo-done">${done}</span><span class="est-pomo-sep">/</span>${est}`;
  } else {
    pomoBadge.textContent = '🍅 ' + (todo.pomodoros || 0);
  }
  actionsRow.appendChild(pomoBadge);

  const editBtn = document.createElement('button');
  editBtn.textContent = '✏';
  editBtn.setAttribute('aria-label', 'Edit task');
  editBtn.addEventListener('click', () => openEditModal(origIndex));
  actionsRow.appendChild(editBtn);

  const del = document.createElement('button');
  del.textContent = '✕';
  del.setAttribute('aria-label', 'Delete task');
  del.addEventListener('click', () => {
    const removed = todos[origIndex];
    const wasActive = removed && removed.id === activeTaskId;
    const wasGolden = removed && removed.id === goldenTaskId;
    todos.splice(origIndex, 1);
    if (wasActive) saveActiveTask(null);
    if (wasGolden) saveGoldenTask(null);
    const restoredIndex = origIndex;
    showToast(`Deleted "${removed.title}"`, () => {
      todos.splice(restoredIndex, 0, removed);
      if (wasActive) activeTaskId = removed.id;
      if (wasGolden) goldenTaskId = removed.id;
      saveTodos();
      if (wasActive) saveActiveTask(removed.id);
      if (wasGolden) saveGoldenTask(removed.id);
      renderTagCloud();
      renderTodos();
    });
    saveTodos();
    renderTagCloud();
    renderTodos();
  });
  actionsRow.appendChild(del);

  content.appendChild(actionsRow);

  const grip = document.createElement('span');
  grip.className = 'drag-handle';
  grip.textContent = '⠿';
  li.appendChild(grip);
  li.appendChild(cb);
  li.appendChild(content);

  li.draggable = !tagFilter && !searchQuery.trim() && sortBy === 'custom' && !todo.done;
  li.dataset.index = origIndex;

  todoList.appendChild(li);
}

function getDueGroup(todo) {
  if (!todo.dueDate) return 'none';
  const p = todo.dueDate.split('-');
  const due = new Date(+p[0], +p[1] - 1, +p[2]);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff <= 7) return 'week';
  return 'later';
}

function renderTodos() {
  const q = searchQuery.trim().toLowerCase();
  let filtered = tagFilter ? todos.filter(t => matchesTagFilter(t, tagFilter)) : todos;
  if (q) filtered = filtered.filter(t => t.title.toLowerCase().includes(q));

  const pending = filtered.filter(t => !t.done);
  const completed = filtered.filter(t => t.done);

  const tagColors = getTagColorMap();

  const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

  if (sortBy === 'custom') {
    pending.sort((a, b) => {
      if (a.id === goldenTaskId) return -1;
      if (b.id === goldenTaskId) return 1;
      return 0;
    });
  } else if (sortBy === 'date') {
    pending.sort((a, b) => {
      if (a.id === goldenTaskId) return -1;
      if (b.id === goldenTaskId) return 1;
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    });
  } else if (sortBy === 'priority') {
    pending.sort((a, b) => {
      if (a.id === goldenTaskId) return -1;
      if (b.id === goldenTaskId) return 1;
      const pa = priorityOrder[a.priority] ?? 4;
      const pb = priorityOrder[b.priority] ?? 4;
      return pa - pb;
    });
  } else if (sortBy === 'title') {
    pending.sort((a, b) => {
      if (a.id === goldenTaskId) return -1;
      if (b.id === goldenTaskId) return 1;
      return a.title.localeCompare(b.title);
    });
  }

  const canDrag = !tagFilter && !q && sortBy === 'custom';

  todoList.innerHTML = '';

  // stat bar
  const now = new Date(); now.setHours(0,0,0,0);
  let overdueCount = 0, todayCount = 0;
  pending.forEach(t => {
    if (!t.dueDate) return;
    const p = t.dueDate.split('-');
    const due = new Date(+p[0], +p[1]-1, +p[2]);
    due.setHours(0,0,0,0);
    const diff = Math.ceil((due - now) / 86400000);
    if (diff < 0) overdueCount++;
    if (diff === 0) todayCount++;
  });
  const statHtml = [];
  if (overdueCount > 0) statHtml.push(`<span class="task-stat overdue" data-filter="overdue">⚠ ${overdueCount} overdue</span>`);
  if (todayCount > 0) statHtml.push(`<span class="task-stat" data-filter="today">📅 ${todayCount} today</span>`);
  statHtml.push(`<span class="task-stat" data-filter="all">${pending.length} total</span>`);
  taskStatBar.innerHTML = statHtml.join('');
  taskStatBar.querySelectorAll('.task-stat').forEach(el => {
    el.addEventListener('click', () => {
      const f = el.dataset.filter;
      if (f === 'overdue') {
        const now2 = new Date(); now2.setHours(0,0,0,0);
        const ov = pending.filter(t => {
          if (!t.dueDate) return false;
          const p2 = t.dueDate.split('-');
          const d2 = new Date(+p2[0], +p2[1]-1, +p2[2]);
          d2.setHours(0,0,0,0);
          return d2 < now2;
        });
        todoList.innerHTML = '';
        ov.forEach(t => renderTodoItem(t, tagColors, false));
        return;
      }
      renderTodos();
    });
  });

  const remaining = pending.length;
  taskCount.textContent = remaining;

  let needsSeparator = false;

  function addSection(label, items, cls) {
    if (items.length === 0) return;
    const hdr = document.createElement('li');
    hdr.className = 'due-section-header' + (cls ? ' ' + cls : '');
    hdr.innerHTML = `${label} <span class="due-count">${items.length}</span>`;
    todoList.appendChild(hdr);
    items.forEach(t => renderTodoItem(t, tagColors, false));
  }

  if (sortBy === 'date') {
    const groups = { overdue: [], today: [], tomorrow: [], week: [], later: [], none: [] };
    pending.forEach(t => { groups[getDueGroup(t)].push(t); });
    addSection('Overdue', groups.overdue, 'overdue');
    addSection('Today', groups.today);
    addSection('Tomorrow', groups.tomorrow);
    addSection('This Week', groups.week);
    addSection('Later', groups.later);
    addSection('No Date', groups.none);
  } else {
    pending.forEach(todo => renderTodoItem(todo, tagColors, false));
  }

  // Completed tasks
  if (showCompleted && completed.length > 0) {
    const groups = {};
    completed.forEach(todo => {
      const completedAt = todo.completedAt || todo.createdAt || 0;
      const key = new Date(completedAt).toISOString().slice(0, 10);
      if (!groups[key]) groups[key] = [];
      groups[key].push(todo);
    });

    const dateKeys = Object.keys(groups).sort().reverse();
    const totalPages = Math.ceil(dateKeys.length / 2);
    if (completedPage >= totalPages) completedPage = totalPages - 1;
    if (completedPage < 0) completedPage = 0;

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const startIdx = completedPage * 2;

    dateKeys.slice(startIdx, startIdx + 2).forEach(dateKey => {
      const date = new Date(dateKey + 'T00:00:00');
      let label;
      if (dateKey === today) label = 'Today';
      else if (dateKey === yesterday) label = 'Yesterday';
      else label = date.toLocaleDateString();

      const separator = document.createElement('li');
      separator.className = 'completed-section-header';
      const sepSpan = document.createElement('span');
      sepSpan.textContent = label;
      separator.appendChild(sepSpan);
      todoList.appendChild(separator);

      groups[dateKey].forEach(todo => renderTodoItem(todo, tagColors, true));
    });

    if (totalPages > 1) {
      const nav = document.createElement('li');
      nav.className = 'completed-pagination';

      const prevBtn = document.createElement('button');
      prevBtn.textContent = '← Newer';
      prevBtn.disabled = completedPage === 0;
      prevBtn.addEventListener('click', () => { completedPage--; renderTodos(); });

      const pageInfo = document.createElement('span');
      pageInfo.textContent = `${completedPage + 1} / ${totalPages}`;

      const nextBtn = document.createElement('button');
      nextBtn.textContent = 'Older →';
      nextBtn.disabled = completedPage >= totalPages - 1;
      nextBtn.addEventListener('click', () => { completedPage++; renderTodos(); });

      nav.appendChild(prevBtn);
      nav.appendChild(pageInfo);
      nav.appendChild(nextBtn);
      todoList.appendChild(nav);
    }
  }

  const toggleBtn = document.getElementById('completedToggle');
  if (completed.length > 0) {
    toggleBtn.textContent = showCompleted ? 'Hide completed' : `Show completed (${completed.length})`;
    toggleBtn.classList.remove('hidden');
  } else {
    toggleBtn.classList.add('hidden');
  }
}

/* ===== Modal ===== */
function openAddModal() {
  modalTitle.textContent = 'Add Task';
  editId.value = '';
  taskTitle.value = '';
  taskDescription.value = '';
  taskDue.value = '';
  taskPriority.value = 'none';
  taskProject.value = '';
  taskFrequency.value = 'none';
  taskEstPomodoros.value = '0';
  tagsList = [];
  renderTagChips();
  taskModal.classList.remove('hidden');
  taskTitle.focus();
}

function openEditModal(index) {
  const todo = todos[index];
  if (!todo) return;
  modalTitle.textContent = 'Edit Task';
  editId.value = index;
  taskTitle.value = todo.title;
  taskDescription.value = todo.description || '';
  taskDue.value = todo.dueDate || '';
  taskPriority.value = todo.priority || 'none';
  taskProject.value = todo.project || '';
  taskFrequency.value = todo.frequency || 'none';
  taskEstPomodoros.value = todo.estPomodoros || 0;
  tagsList = [...(todo.tags || [])];
  renderTagChips();
  taskModal.classList.remove('hidden');
  taskTitle.focus();
}

function closeModal() {
  taskModal.classList.add('hidden');
}

function saveModal() {
  const title = taskTitle.value.trim();
  if (!title) { taskTitle.focus(); return; }

  const dueDate = taskDue.value || null;
  const data = {
    title,
    description: taskDescription.value.trim(),
    dueDate,
    priority: taskPriority.value,
    project: taskProject.value.trim(),
    frequency: taskFrequency.value,
    estPomodoros: parseInt(taskEstPomodoros.value) || 0,
    tags: [...tagsList],
  };

  const editIdx = editId.value;
  if (editIdx !== '') {
    Object.assign(todos[parseInt(editIdx)], data);
  } else {
    data.id = crypto.randomUUID();
    data.done = false;
    data.completedAt = null;
    data.createdAt = Date.now();
    data.pomodoros = 0;
    data.wasGolden = false;
    todos.push(data);
  }

  saveTodos();
  closeModal();
  renderTagCloud();
  renderTodos();
}

function addTag(tag) {
  const t = tag.trim().replace(/^#/, '');
  if (t && !tagsList.includes(t)) {
    tagsList.push(t);
    renderTagChips();
  }
}

function removeTag(tag) {
  tagsList = tagsList.filter(t => t !== tag);
  renderTagChips();
}

function renderTagChips() {
  tagsContainer.innerHTML = tagsList.map(t =>
    `<span class="tag-chip">${t} <span class="tag-chip-remove" data-tag="${t}">&times;</span></span>`
  ).join('');
  tagsContainer.querySelectorAll('.tag-chip-remove').forEach(el => {
    el.addEventListener('click', () => removeTag(el.dataset.tag));
  });
}

/* ===== Confirm Modal ===== */
function showConfirmModal(message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirmModal');
    const msgEl = document.getElementById('confirmMessage');
    const okBtn = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');

    msgEl.textContent = message;
    overlay.classList.remove('hidden');

    function cleanup(result) {
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }

    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

document.getElementById('confirmModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    document.getElementById('confirmModal').classList.add('hidden');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const overlay = document.getElementById('confirmModal');
    if (!overlay.classList.contains('hidden')) overlay.classList.add('hidden');
  }
});

addTaskBtn.addEventListener('click', openAddModal);

function quickAddTask() {
  const input = document.getElementById('quickAddInput');
  const title = input.value.trim();
  if (!title) return;
  const todo = {
    id: crypto.randomUUID(),
    title,
    description: '',
    dueDate: null,
    priority: 'none',
    project: '',
    frequency: 'none',
    tags: [],
    done: false,
    completedAt: null,
    createdAt: Date.now(),
    pomodoros: 0,
    estPomodoros: 0,
    wasGolden: false
  };
  todos.push(todo);
  saveTodos();
  renderTagCloud();
  renderTodos();
  input.value = '';
  input.focus();
}

document.getElementById('quickAddBtn').addEventListener('click', quickAddTask);
document.getElementById('quickAddInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); quickAddTask(); }
});

modalClose.addEventListener('click', closeModal);
modalCancel.addEventListener('click', closeModal);
taskModal.addEventListener('click', (e) => { if (e.target === taskModal) closeModal(); });
modalSave.addEventListener('click', saveModal);

taskTags.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const val = taskTags.value.trim();
    if (val) {
      addTag(val);
      taskTags.value = '';
    }
  }
});

taskModal.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.target.closest('input,textarea,select,[contenteditable]')) {
    e.preventDefault();
    document.getElementById('quickAddInput').focus();
  }
});

/* ===== Search & Sort ===== */
taskSearch.addEventListener('input', () => {
  searchQuery = taskSearch.value;
  renderTodos();
});

document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    sortBy = btn.dataset.sort;
    renderTodos();
  });
});

/* ===== Tab Switching ===== */
function switchTab(tabId) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  document.querySelectorAll('section[data-tab]').forEach(s => s.classList.toggle('tab-hidden', s.dataset.tab !== tabId));
  localStorage.setItem('activeTab', tabId);
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

/* ===== Toast/Undo ===== */
function showToast(msg, onUndo) {
  clearTimeout(toastTimer);
  undoData = onUndo ? { fn: onUndo } : null;
  toastMsg.textContent = msg;
  toast.classList.remove('hidden');
  toastUndo.style.display = onUndo ? '' : 'none';
  toastTimer = setTimeout(hideToast, 5000);
}

function hideToast() {
  toast.classList.add('hidden');
  undoData = null;
}

toastUndo.addEventListener('click', () => {
  if (undoData && undoData.fn) undoData.fn();
  hideToast();
});

/* ===== Weekly Stats ===== */
function renderWeeklyStats() {
  const history = loadHistory();
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekStartStr = weekStart.toISOString().slice(0, 10);
  const weekSessions = history.filter(s => s.date >= weekStartStr).length;
  const weekCompleted = todos.filter(t => t.done && t.completedAt && new Date(t.completedAt) >= weekStart).length;
  const el = document.getElementById('weeklyStats');
  if (weekSessions === 0 && weekCompleted === 0) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `This week: <strong>${weekSessions}</strong> pomodoros · <strong>${weekCompleted}</strong> tasks completed`;
}

/* ===== Export ===== */
document.getElementById('exportBtn').addEventListener('click', () => {
  const data = {
    exportedAt: new Date().toISOString(),
    todos: loadTodos(),
    quarterlyGoals: loadQuarterlyGoals(),
    pomodoroHistory: loadHistory(),
    goldenTaskId: loadGoldenTask(),
    activeTaskId: loadActiveTask(),
    theme: localStorage.getItem('theme') || 'dark'
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `todo-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Data exported');
});

/* ===== Drag and Drop Reorder ===== */
todoList.addEventListener('dragstart', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  draggedIndex = parseInt(li.dataset.index);
  e.dataTransfer.effectAllowed = 'move';
  li.classList.add('dragging');
});

todoList.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  todoList.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  const li = e.target.closest('li');
  if (!li) return;
  const box = li.getBoundingClientRect();
  const offset = e.clientY - box.top;
  if (offset < box.height / 2) {
    li.classList.add('drag-over');
  } else if (li.nextElementSibling) {
    li.nextElementSibling.classList.add('drag-over');
  }
});

todoList.addEventListener('drop', (e) => {
  e.preventDefault();
  if (draggedIndex === null) return;
  const overLi = e.target.closest('li');
  if (!overLi) return;
  const box = overLi.getBoundingClientRect();
  const offset = e.clientY - box.top;
  const targetOrigIndex = parseInt(overLi.dataset.index);
  let insertAt = offset < box.height / 2 ? targetOrigIndex : targetOrigIndex + 1;
  if (draggedIndex === insertAt || draggedIndex === insertAt - 1) return;
  const [item] = todos.splice(draggedIndex, 1);
  if (draggedIndex < insertAt) insertAt--;
  todos.splice(insertAt, 0, item);
  draggedIndex = null;
  saveTodos();
  renderTagCloud();
  renderTodos();
});

todoList.addEventListener('dragend', () => {
  todoList.querySelectorAll('.dragging, .drag-over').forEach(el => el.classList.remove('dragging', 'drag-over'));
  draggedIndex = null;
});

/* ===== History ===== */
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem('pomodoroHistory')) || [];
  } catch {
    return [];
  }
}

function saveHistory(history) {
  localStorage.setItem('pomodoroHistory', JSON.stringify(history));
}

/* ===== Stats ===== */
const statsViews = document.getElementById('statsViews');
const viewTabs = document.getElementById('viewTabs');
let currentView = 'calendar';
let calendarDate = new Date();
calendarDate.setDate(1);

viewTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  currentView = btn.dataset.view;
  viewTabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderStats();
});

function renderStats() {
  renderWeeklyStats();
  if (currentView === 'calendar') statsViews.innerHTML = renderCalendarHTML();
  else if (currentView === 'hours') statsViews.innerHTML = renderHoursHTML();
  else if (currentView === 'slots') statsViews.innerHTML = renderSlotsHTML();
  statsViews.querySelectorAll('[data-cal-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      calendarDate.setMonth(calendarDate.getMonth() + (btn.dataset.calNav === 'next' ? 1 : -1));
      renderStats();
    });
  });
}

/* ===== Calendar ===== */
function getGoldenDays(year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const golden = {};
  todos.forEach(t => {
    if (t.wasGolden && t.completedAt) {
      const d = new Date(t.completedAt);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (dateStr.startsWith(prefix)) golden[dateStr] = true;
    }
  });
  return golden;
}

function renderCalendarHTML() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const history = loadHistory();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const counts = {};
  history.forEach(s => {
    if (s.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)) {
      counts[s.date] = (counts[s.date] || 0) + 1;
    }
  });

  const maxCount = Math.max(...Object.values(counts), 1);
  const goldenDays = getGoldenDays(year, month);
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  let html = `
    <div class="calendar-nav">
      <button data-cal-nav="prev">←</button>
      <span>${monthNames[month]} ${year}</span>
      <button data-cal-nav="next">→</button>
    </div>
    <div class="calendar-grid">
      <div class="day-header">Sun</div><div class="day-header">Mon</div><div class="day-header">Tue</div>
      <div class="day-header">Wed</div><div class="day-header">Thu</div><div class="day-header">Fri</div>
      <div class="day-header">Sat</div>
  `;

  for (let i = 0; i < firstDay; i++) {
    html += '<div class="day-cell empty"></div>';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const count = counts[dateStr] || 0;
    const level = count === 0 ? 0 : Math.min(5, Math.ceil((count / maxCount) * 5));
    html += `<div class="day-cell level-${level}"><div class="day-num">${d}</div>`;
    if (goldenDays[dateStr]) html += `<div class="day-star">⭐</div>`;
    if (count > 0) html += `<div class="day-count">${count}</div>`;
    html += '</div>';
  }

  html += '</div>';
  return html;
}

/* ===== Hours Chart ===== */
function renderHoursHTML() {
  const history = loadHistory();
  if (history.length === 0) {
    return '<div class="no-data">No sessions yet. Complete a pomodoro to see stats.</div>';
  }

  const hourCounts = Array(24).fill(0);
  history.forEach(s => {
    const h = parseInt(s.time.slice(0, 10).split(':')[0], 10);
    if (h >= 0 && h < 24) hourCounts[h]++;
  });

  const maxH = Math.max(...hourCounts, 1);
  let html = '<div class="hours-chart">';

  for (let h = 0; h < 24; h++) {
    const pct = (hourCounts[h] / maxH) * 100;
    const label = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
    html += `
      <div class="hours-row">
        <div class="hour-label">${label}</div>
        <div class="hour-bar-bg"><div class="hour-bar" style="width:${pct}%"></div></div>
        <div class="hour-val">${hourCounts[h]}</div>
      </div>
    `;
  }

  html += '</div>';
  return html;
}

/* ===== Time Slots ===== */
function renderSlotsHTML() {
  const history = loadHistory();
  if (history.length === 0) {
    return '<div class="no-data">No sessions yet. Complete a pomodoro to see stats.</div>';
  }

  const slots = [
    { id: 'morning', label: 'Morning (6-12)', hours: [6,7,8,9,10,11], count: 0 },
    { id: 'afternoon', label: 'Afternoon (12-18)', hours: [12,13,14,15,16,17], count: 0 },
    { id: 'evening', label: 'Evening (18-24)', hours: [18,19,20,21,22,23], count: 0 },
    { id: 'night', label: 'Night (0-6)', hours: [0,1,2,3,4,5], count: 0 },
  ];

  history.forEach(s => {
    const h = parseInt(s.time.split(':')[0], 10);
    const slot = slots.find(sl => sl.hours.includes(h));
    if (slot) slot.count++;
  });

  const maxSlot = Math.max(...slots.map(s => s.count), 1);
  let html = '<div class="slots-container">';

  slots.forEach(slot => {
    const pct = (slot.count / maxSlot) * 100;
    html += `
      <div class="slot-card ${slot.id}">
        <div class="slot-name">${slot.label}</div>
        <div class="slot-count">${slot.count}</div>
        <div class="slot-bar-bg"><div class="slot-bar" style="width:${pct}%"></div></div>
        <div class="slot-pct">${slot.count > 0 ? Math.round((slot.count / history.length) * 100) : 0}%</div>
      </div>
    `;
  });

  html += '</div>';
  return html;
}

document.getElementById('tagCloud').addEventListener('click', (e) => {
  const pill = e.target.closest('.tag-pill');
  if (pill) filterByTag(pill.dataset.tag);
});

/* ===== Theme Toggle ===== */
const themeToggle = document.getElementById('themeToggle');

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  themeToggle.textContent = theme === 'dark' ? '🌙' : '☀️';
}

const savedTheme = localStorage.getItem('theme') || 'dark';
setTheme(savedTheme);

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  setTheme(current === 'dark' ? 'light' : 'dark');
});

/* ===== Help Overlay ===== */
const helpOverlay = document.getElementById('helpOverlay');
document.getElementById('helpBtn').addEventListener('click', () => helpOverlay.classList.remove('hidden'));
document.getElementById('helpClose').addEventListener('click', () => helpOverlay.classList.add('hidden'));
helpOverlay.addEventListener('click', (e) => { if (e.target === helpOverlay) helpOverlay.classList.add('hidden'); });

/* ===== Completed Toggle ===== */
document.getElementById('completedToggle').addEventListener('click', () => {
  showCompleted = !showCompleted;
  completedPage = 0;
  renderTodos();
});

/* ===== Quarterly Goals ===== */
function loadQuarterlyGoals() {
  try {
    const data = JSON.parse(localStorage.getItem('quarterlyGoals')) || {};
    // migrate old string format to array format
    Object.keys(data).forEach(key => {
      if (typeof data[key] === 'string') {
        const text = data[key].trim();
        data[key] = text ? [{ id: crypto.randomUUID(), text, done: false }] : [];
      }
    });
    return data;
  } catch {
    return {};
  }
}

function saveQuarterlyGoals(goals) {
  localStorage.setItem('quarterlyGoals', JSON.stringify(goals));
}

function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(key) {
  const [y, m] = key.split('-');
  const date = new Date(+y, +m - 1);
  return date.toLocaleDateString('default', { month: 'long', year: 'numeric' });
}

function renderQGCard(key, isPast) {
  const goals = loadQuarterlyGoals();
  const items = goals[key] || [];
  let label = formatMonthLabel(key);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const currentKey = getMonthKey(now);
  if (key === currentKey) {
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const remaining = lastDay - today.getDate();
    label += ` (${remaining}d left)`;
  }

  const doneCount = items.filter(i => i.done).length;
  const totalCount = items.length;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  let progressHtml = '';
  if (totalCount > 0) {
    progressHtml = `
      <div class="qg-progress">
        <div class="qg-progress-text">${doneCount}/${totalCount} completed</div>
        <div class="qg-progress-bar"><div class="qg-progress-fill" style="width:${pct}%"></div></div>
      </div>
    `;
  }

  let itemsHtml = items.length === 0
    ? '<div class="qg-empty">No goals set</div>'
    : items.map((item, i) => `
      <div class="qg-item${item.done ? ' done' : ''}">
        <input type="checkbox" ${item.done ? 'checked' : ''} data-key="${key}" data-idx="${i}">
        <span class="qg-item-text">${item.text}</span>
        <button class="qg-item-del" data-key="${key}" data-idx="${i}">✕</button>
      </div>
    `).join('');

  return `
    <div class="qg-card${isPast ? ' past' : ''}" data-month="${key}">
      <div class="qg-month">${label}</div>
      ${progressHtml}
      <div class="qg-items">${itemsHtml}</div>
      <div class="qg-add-row">
        <input type="text" placeholder="Add goal..." data-key="${key}">
        <button class="qg-add-btn" data-key="${key}">+</button>
      </div>
    </div>
  `;
}

function renderQuarterlyGoals() {
  const now = new Date();
  const currentKey = getMonthKey(now);

  const upcoming = [];
  for (let i = 0; i < 4; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    upcoming.push(getMonthKey(d));
  }

  const allGoals = loadQuarterlyGoals();
  const pastKeys = Object.keys(allGoals).filter(k => k < currentKey && allGoals[k].length > 0);
  pastKeys.sort().reverse();

  let html = '<div class="qg-grid">';
  html += upcoming.map(k => renderQGCard(k, false)).join('');
  html += '</div>';

  if (pastKeys.length > 0) {
    html += '<div class="qg-past-header">Past Months</div>';
    html += '<div class="qg-grid">';
    html += pastKeys.map(k => renderQGCard(k, true)).join('');
    html += '</div>';
  }

  const allMonthKeys = [...upcoming, ...pastKeys];
  let totalDone = 0;
  let totalItems = 0;
  allMonthKeys.forEach(k => {
    const items = allGoals[k] || [];
    items.forEach(i => { totalItems++; if (i.done) totalDone++; });
  });
  if (totalItems > 0) {
    html += `<div class="qg-summary">${totalDone}/${totalItems} goals completed across all months</div>`;
  }

  document.getElementById('quarterlyGoalsContent').innerHTML = html;

  // checkbox toggle
  document.querySelectorAll('.qg-item input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const key = cb.dataset.key;
      const idx = parseInt(cb.dataset.idx);
      const goals = loadQuarterlyGoals();
      if (goals[key] && goals[key][idx]) {
        goals[key][idx].done = cb.checked;
        saveQuarterlyGoals(goals);
        renderQuarterlyGoals();
      }
    });
  });

  // delete item
  document.querySelectorAll('.qg-item-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      const idx = parseInt(btn.dataset.idx);
      const goals = loadQuarterlyGoals();
      if (goals[key]) {
        goals[key].splice(idx, 1);
        if (goals[key].length === 0) delete goals[key];
        saveQuarterlyGoals(goals);
        renderQuarterlyGoals();
      }
    });
  });

  // add item - button click
  document.querySelectorAll('.qg-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      const input = btn.parentElement.querySelector('input');
      const text = input.value.trim();
      if (!text) return;
      const goals = loadQuarterlyGoals();
      if (!goals[key]) goals[key] = [];
      goals[key].push({ id: crypto.randomUUID(), text, done: false });
      saveQuarterlyGoals(goals);
      renderQuarterlyGoals();
    });
  });

  // add item - enter key
  document.querySelectorAll('.qg-add-row input').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const key = input.dataset.key;
        const text = input.value.trim();
        if (!text) return;
        const goals = loadQuarterlyGoals();
        if (!goals[key]) goals[key] = [];
        goals[key].push({ id: crypto.randomUUID(), text, done: false });
        saveQuarterlyGoals(goals);
        renderQuarterlyGoals();
      }
    });
  });
}

/* ===== Init ===== */
const savedTab = localStorage.getItem('activeTab') || 'pomodoro';
switchTab(savedTab);

startBtn.disabled = false;
pauseBtn.disabled = true;
resetBtn.disabled = false;
updateDisplay();
updatePhaseLabel();
updateCurrentTaskDisplay();
renderTagCloud();
renderTodos();
renderStats();
renderWeeklyStats();
renderQuarterlyGoals();
