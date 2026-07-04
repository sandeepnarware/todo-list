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

function updateDisplay() {
  timerEl.textContent = formatTime(pomState.timeLeft);
  if (pomState.running) {
    const label = pomState.phase === 'focus' ? 'F' : 'B';
    document.title = `${formatTime(pomState.timeLeft)} [${label}] - Todo & Pomodoro`;
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
  updatePipControls();
}

function pauseTimer() {
  pomState.running = false;
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  resetBtn.disabled = false;
  clearInterval(pomState.timerId);
  updateDisplay();
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
const modalSave = document.getElementById('modalSave');
const modalCancel = document.getElementById('modalCancel');
const modalClose = document.getElementById('modalClose');

let todos = loadTodos();
let tagFilter = null;
let draggedIndex = null;
let tagsList = [];
let showCompleted = false;

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
    pomodoros: 0
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

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = todo.done;
  cb.addEventListener('change', () => {
    const t = todos[origIndex];
    t.done = cb.checked;
    t.completedAt = cb.checked ? Date.now() : null;
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
          pomodoros: 0
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

  const playBtn = document.createElement('button');
  playBtn.className = 'play-btn';
  playBtn.innerHTML = todo.id === activeTaskId ? '⏹' : '▶';
  playBtn.setAttribute('aria-label', 'Focus on this task');
  playBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setActiveTask(todo.id);
  });

  const pomoBadge = document.createElement('span');
  pomoBadge.className = 'task-pomo-count';
  pomoBadge.textContent = '🍅 ' + (todo.pomodoros || 0);

  li.appendChild(cb);
  li.appendChild(content);
  li.appendChild(playBtn);
  li.appendChild(pomoBadge);

  li.draggable = !tagFilter && !todo.done;
  li.dataset.index = origIndex;

  const editBtn = document.createElement('button');
  editBtn.textContent = '✏';
  editBtn.setAttribute('aria-label', 'Edit task');
  editBtn.addEventListener('click', () => openEditModal(origIndex));

  const del = document.createElement('button');
  del.textContent = '✕';
  del.setAttribute('aria-label', 'Delete task');
  del.addEventListener('click', () => {
    const wasActive = todos[origIndex] && todos[origIndex].id === activeTaskId;
    todos.splice(origIndex, 1);
    if (wasActive) saveActiveTask(null);
    saveTodos();
    renderTagCloud();
    renderTodos();
  });

  li.appendChild(editBtn);
  li.appendChild(del);
  todoList.appendChild(li);
}

function renderTodos() {
  const filtered = tagFilter ? todos.filter(t => matchesTagFilter(t, tagFilter)) : todos;

  const pending = filtered.filter(t => !t.done);
  const completed = filtered.filter(t => t.done);

  todoList.innerHTML = '';

  const remaining = pending.length;
  taskCount.textContent = remaining;
  const tagColors = getTagColorMap();

  pending.forEach(todo => renderTodoItem(todo, tagColors, false));

  if (showCompleted && completed.length > 0) {
    const groups = {};
    completed.forEach(todo => {
      const completedAt = todo.completedAt || todo.createdAt || 0;
      const key = new Date(completedAt).toISOString().slice(0, 10);
      if (!groups[key]) groups[key] = [];
      groups[key].push(todo);
    });

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    Object.keys(groups).sort().reverse().forEach(dateKey => {
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

addTaskBtn.addEventListener('click', openAddModal);
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

/* ===== Stats View State ===== */
const statsContent = document.getElementById('statsContent');
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
  if (currentView === 'calendar') renderCalendar();
  else if (currentView === 'hours') renderHoursChart();
  else if (currentView === 'slots') renderSlots();
}

/* ===== Calendar ===== */
function renderCalendar() {
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
    if (count > 0) html += `<div class="day-count">${count}</div>`;
    html += '</div>';
  }

  html += '</div>';
  statsContent.innerHTML = html;

  statsContent.querySelectorAll('[data-cal-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      calendarDate.setMonth(calendarDate.getMonth() + (btn.dataset.calNav === 'next' ? 1 : -1));
      renderCalendar();
    });
  });
}

/* ===== Hours Chart ===== */
function renderHoursChart() {
  const history = loadHistory();
  if (history.length === 0) {
    statsContent.innerHTML = '<div class="no-data">No sessions yet. Complete a pomodoro to see stats.</div>';
    return;
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
  statsContent.innerHTML = html;
}

/* ===== Time Slots ===== */
function renderSlots() {
  const history = loadHistory();
  if (history.length === 0) {
    statsContent.innerHTML = '<div class="no-data">No sessions yet. Complete a pomodoro to see stats.</div>';
    return;
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
  statsContent.innerHTML = html;
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
  renderTodos();
});

/* ===== Init ===== */
startBtn.disabled = false;
pauseBtn.disabled = true;
resetBtn.disabled = false;
updateDisplay();
updatePhaseLabel();
updateCurrentTaskDisplay();
renderTagCloud();
renderTodos();
renderStats();
