/* ===== Pomodoro State ===== */
const FOCUS_TIME = 25 * 60;
const BREAK_TIME = 5 * 60;
const LONG_BREAK_TIME = 15 * 60;

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
const circumference = 314;

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
  // compact mode disabled — full view always shown
}

function getPhaseTime(phase) {
  if (phase === 'focus') return FOCUS_TIME;
  if (phase === 'longbreak') return LONG_BREAK_TIME;
  return BREAK_TIME;
}

function updateDashDots() {
  const dots = document.querySelectorAll('#dashTimer ~ .flex.gap-2 .w-2');
  if (!dots.length) return;
  const phaseOrder = ['focus', 'break', 'focus', 'longbreak'];
  const cycleStep = pomState.sessionCount % 4;
  dots.forEach((dot, i) => {
    const isActive = pomState.phase === 'focus' && i <= cycleStep;
    const isBreak = pomState.phase !== 'focus' && i < cycleStep;
    if (isActive || isBreak) {
      dot.style.background = 'var(--primary)';
    } else {
      dot.style.background = 'var(--outline-variant)';
    }
  });
}

function updateDisplay() {
  timerEl.textContent = formatTime(pomState.timeLeft);
  const dashTimer = document.getElementById('dashTimer');
  if (dashTimer) dashTimer.textContent = formatTime(pomState.timeLeft);
  updateCompactDisplay();
  updateDashDots();
  if (pomState.running) {
    const labels = { focus: 'F', break: 'B', longbreak: 'LB' };
    const label = labels[pomState.phase] || 'B';
    document.title = `${formatTime(pomState.timeLeft)} [${label}] - PomoDone`;
  } else {
    document.title = BASE_TITLE;
  }
  const total = getPhaseTime(pomState.phase);
  const offset = circumference * (1 - pomState.timeLeft / total);
  progressFg.style.strokeDashoffset = offset;
}

function updatePhaseLabel() {
  const labels = { focus: 'Focus', break: 'Short Break', longbreak: 'Long Break' };
  phaseEl.textContent = labels[pomState.phase] || 'Focus';
  progressFg.style.stroke = pomState.phase === 'focus' ? '#ff6b6b' : '#4ecdc4';
}

function setTimerButton(phase) {
  const icon = startBtn.querySelector('.material-symbols-outlined');
  const label = startBtn.querySelector('span:last-child');
  if (phase === 'running') {
    if (icon) icon.textContent = 'pause';
    if (label) label.textContent = 'Pause';
    startBtn.classList.remove('bg-primary', 'hover:bg-primary/90');
    startBtn.classList.add('bg-secondary', 'hover:bg-secondary/90');
    pauseBtn.classList.remove('hidden');
    pauseBtn.disabled = false;
    resetBtn.classList.remove('hidden');
    resetBtn.disabled = false;
  } else {
    if (icon) icon.textContent = 'play_arrow';
    if (label) label.textContent = 'Start';
    startBtn.classList.remove('bg-secondary', 'hover:bg-secondary/90');
    startBtn.classList.add('bg-primary', 'hover:bg-primary/90');
    pauseBtn.classList.add('hidden');
    pauseBtn.disabled = true;
    resetBtn.classList.add('hidden');
    resetBtn.disabled = true;
  }
  const dashPlayBtn = document.getElementById('dashPlayBtn');
  if (dashPlayBtn) {
    const dashIcon = dashPlayBtn.querySelector('.material-symbols-outlined');
    if (dashIcon) dashIcon.textContent = pomState.running ? 'pause' : 'play_arrow';
  }
  updateDashPhaseTabs();
}

function startTimer() {
  if (pomState.running) return;
  pomState.running = true;
  setTimerButton('running');
  pomState.timerId = setInterval(tick, 1000);
  setCompact(false);
  updatePipControls();
}

function pauseTimer() {
  pomState.running = false;
  setTimerButton('paused');
  clearInterval(pomState.timerId);
  updateDisplay();
  setCompact(true);
  updatePipControls();
}

function resetTimer() {
  pomState.running = false;
  clearInterval(pomState.timerId);
  setTimerButton('paused');
  pomState.phase = 'focus';
  pomState.timeLeft = FOCUS_TIME;
  updatePhaseLabel();
  updateDisplay();
  setCompact(true);
  updatePipControls();
  updateDashPhaseTabs();
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
      updateCurrentTaskDisplay();
    }
    if (pomState.sessionCount % 4 === 0) {
      pomState.phase = 'longbreak';
      pomState.timeLeft = LONG_BREAK_TIME;
    } else {
      pomState.phase = 'break';
      pomState.timeLeft = BREAK_TIME;
    }
  } else {
    pomState.phase = 'focus';
    pomState.timeLeft = FOCUS_TIME;
  }
  updatePhaseLabel();
  updateDisplay();
  updateDashPhaseTabs();
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

/* Dashboard timer widget */
const dashPlayBtn = document.getElementById('dashPlayBtn');
if (dashPlayBtn) {
  dashPlayBtn.addEventListener('click', () => {
    if (pomState.running) { pauseTimer(); } else { startTimer(); }
  });
}

const dashResetBtn = document.getElementById('dashResetBtn');
if (dashResetBtn) {
  dashResetBtn.addEventListener('click', resetTimer);
}

function updateDashPhaseTabs() {
  document.querySelectorAll('.dash-phase-tab').forEach(tab => {
    const isActive = tab.dataset.phase === pomState.phase;
    tab.classList.toggle('active', isActive);
    if (isActive) {
      tab.style.cssText = 'color:var(--primary);border-bottom:2px solid var(--primary);padding-bottom:4px';
    } else {
      tab.style.cssText = '';
    }
  });
}

document.getElementById('dashPhaseTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.dash-phase-tab');
  if (!tab) return;
  const phase = tab.dataset.phase;
  if (phase === pomState.phase) return;
  if (pomState.running) pauseTimer();
  pomState.phase = phase;
  pomState.timeLeft = getPhaseTime(phase);
  updatePhaseLabel();
  updateDisplay();
  setTimerButton('paused');
  updateDashPhaseTabs();
});

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
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;600&family=JetBrains+Mono:wght@600&display=swap" rel="stylesheet">
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        html,body{height:100%}
        body{font-family:'Inter',system-ui,sans-serif;background:#1a1716;color:#e7e1de;display:flex;align-items:center;justify-content:center}
        .pip-timer{text-align:center}
        .pip-time{font-size:3rem;font-weight:800;font-family:'Plus Jakarta Sans',sans-serif;font-variant-numeric:tabular-nums;line-height:1.1;color:#ae2f34}
        .pip-phase{font-size:0.7rem;text-transform:uppercase;letter-spacing:3px;color:#cbc1bf;margin-top:0.25rem;font-family:'JetBrains Mono',monospace;font-weight:600}
        .pip-current-task{font-size:0.7rem;color:#ff6b6b;margin-top:0.3rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px;display:inline-block;font-weight:600}
        .pip-controls{display:flex;gap:0.4rem;justify-content:center;margin-top:0.6rem}
        .pip-btn{padding:0.3rem 0.8rem;border:none;border-radius:999px;font-size:0.65rem;font-weight:700;cursor:pointer;transition:all 0.2s;text-transform:uppercase;letter-spacing:0.5px;font-family:'JetBrains Mono',monospace}
        .pip-start{background:#ae2f34;color:#fff;box-shadow:0 4px 12px rgba(174,47,52,0.3)}
        .pip-start:hover:not(:disabled){background:#8c1520}
        .pip-pause{background:#006a65;color:#fff}
        .pip-pause:hover:not(:disabled){background:#00504c}
        .pip-reset{background:#2b2927;color:#e7e1de;border:1px solid #524342}
        .pip-reset:hover:not(:disabled){background:#363432}
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

/* ===== Footer Controls ===== */
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

const taskSearch = document.getElementById('headerSearch');
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
  const fallback = !task ? todos.find(t => !t.done) : null;
  const displayTask = task || fallback;
  // Pomodoro tab title area
  const pomTaskName = document.getElementById('pomodoroTaskName');
  if (pomTaskName) {
    pomTaskName.textContent = displayTask ? displayTask.title : 'No active task';
    pomTaskName.className = 'font-mono text-xs font-semibold tracking-wider mt-2 ' + (displayTask ? 'text-primary' : 'text-outline');
  }
  // Pomodoro tab card
  const titleEl = document.querySelector('#currentTaskDisplay .current-task-text');
  const pomoEl = document.getElementById('currentTaskPomo');
  const projectTag = document.getElementById('activeProjectTag');
  if (titleEl) {
    if (displayTask) {
      titleEl.textContent = displayTask.title;
      titleEl.style.opacity = '1';
      if (projectTag) {
        if (displayTask.project) {
          projectTag.classList.remove('hidden');
          projectTag.textContent = '#' + displayTask.project;
        } else {
          projectTag.classList.add('hidden');
        }
      }
      if (pomoEl) {
        const done = displayTask.pomodoros || 0;
        const est = displayTask.estPomodoros || 0;
        pomoEl.textContent = est > 0 ? done + '/' + est : String(done);
      }
    } else {
      titleEl.textContent = 'No tasks yet — add one to get started';
      titleEl.style.opacity = '0.6';
      if (projectTag) projectTag.classList.add('hidden');
      if (pomoEl) pomoEl.textContent = '0';
    }
  }
  // Dashboard timer widget card
  const dashTitle = document.getElementById('dashActiveTitle');
  const dashPomo = document.getElementById('dashActivePomo');
  if (dashTitle) {
    if (displayTask) {
      dashTitle.textContent = displayTask.title;
      dashTitle.style.opacity = '1';
      if (dashPomo) {
        const done = displayTask.pomodoros || 0;
        const est = displayTask.estPomodoros || 0;
        dashPomo.textContent = est > 0 ? done + '/' + est + ' pomos' : done + ' pomos';
      }
    } else {
      dashTitle.textContent = 'No tasks yet';
      dashTitle.style.opacity = '0.6';
      if (dashPomo) dashPomo.textContent = '';
    }
  }
  if (pipWindow && !pipWindow.closed) {
    const el = pipWindow.document.getElementById('pipCurrentTask');
    if (el) el.textContent = displayTask ? '▶ ' + displayTask.title : '';
  }
}

/* ===== Dashboard Stats ===== */
function updateDashboardStats() {
  const dashPomos = document.getElementById('dashPomos');
  const dashTasks = document.getElementById('dashTasks');
  const dashGolden = document.getElementById('dashGolden');
  const dashGoldenTitle = document.getElementById('dashGoldenTitle');
  const dashFocusBtn = document.getElementById('dashFocusBtn');
  const dashGoldenPomos = document.getElementById('dashGoldenPomos');

  if (dashPomos) {
    const history = loadHistory();
    dashPomos.textContent = history.length;
  }
  if (dashTasks) {
    const done = todos.filter(t => t.done).length;
    dashTasks.textContent = done;
  }
  if (dashGolden) {
    const golden = todos.find(t => t.id === goldenTaskId && !t.done);
    const dashGoldenSub = dashGolden.querySelector('.golden-sub');
    if (golden) {
      if (dashGoldenTitle) dashGoldenTitle.textContent = golden.title;
      if (dashGoldenSub) dashGoldenSub.textContent = golden.description || 'Focus on your golden task!';
      if (dashFocusBtn) dashFocusBtn.classList.remove('hidden');
      if (dashGoldenPomos) {
        const est = golden.estPomodoros || 0;
        dashGoldenPomos.textContent = `EST. ${est} POMOS`;
        dashGoldenPomos.classList.toggle('hidden', est === 0);
      }
    } else {
      if (dashGoldenTitle) dashGoldenTitle.textContent = 'No golden task set';
      if (dashGoldenSub) dashGoldenSub.textContent = 'Mark a task as golden ⭐ to see it here.';
      if (dashFocusBtn) dashFocusBtn.classList.add('hidden');
      if (dashGoldenPomos) dashGoldenPomos.classList.add('hidden');
    }
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
  const pillHtml = tags.filter(t => {
    const isProject = t.startsWith('project:');
    const hasPending = isProject
      ? todos.some(td => !td.done && td.project && td.project.toLowerCase() === t.slice(8))
      : todos.some(td => !td.done && (td.tags || []).some(tag => tag.toLowerCase() === t));
    return hasPending || t === tagFilter;
  }).map(t => {
    const isProject = t.startsWith('project:');
    const count = isProject
      ? todos.filter(td => td.project && td.project.toLowerCase() === t.slice(8)).length
      : todos.filter(td => (td.tags || []).some(tag => tag.toLowerCase() === t)).length;
    const active = tagFilter === t ? 'active' : '';
    const c = colorMap[t];
    const style = c ? `style="background:${c}22;color:${c};border-color:${c}44"` : '';
    return `<span class="tag-pill ${active}" data-tag="${t}" ${style}>${t} <span class="count">${count}</span></span>`;
  }).join('');
  const tagCloudEl = document.getElementById('tagCloud');
  if (tagCloudEl) tagCloudEl.innerHTML = pillHtml;

  // Sidebar tag clouds
  const sidebarCloud = document.getElementById('tagCloudSidebar');
  const sidebarTags = document.getElementById('tagCloudTags');
  if (sidebarCloud || sidebarTags) {
    const projectTags = tags.filter(t => t.startsWith('project:'));
    const regularTags = tags.filter(t => !t.startsWith('project:'));
    const renderSidebarPills = (tagArray) => tagArray.map(t => {
      const c = colorMap[t];
      const count = t.startsWith('project:')
        ? todos.filter(td => td.project && td.project.toLowerCase() === t.slice(8)).length
        : todos.filter(td => (td.tags || []).some(tag => tag.toLowerCase() === t)).length;
      const active = tagFilter === t ? 'active' : '';
      const style = c ? `style="background:${c}22;color:${c};border-color:${c}44"` : '';
      return `<span class="tag-pill ${active}" data-tag="${t}" ${style}>${t}</span>`;
    }).join('');
    if (sidebarCloud) sidebarCloud.innerHTML = renderSidebarPills(projectTags) || '<span class="text-[11px] opacity-50">No projects yet</span>';
    if (sidebarTags) sidebarTags.innerHTML = renderSidebarPills(regularTags) || '<span class="text-[11px] opacity-50">No tags yet</span>';
  }

  // Focus Score
  const total = todos.filter(t => !t.done).length;
  const done = todos.filter(t => t.done).length;
  const score = total + done > 0 ? Math.round((done / (total + done)) * 100) : 0;
  const focusPct = document.getElementById('focusScorePct');
  const focusBar = document.getElementById('focusScoreBar');
  const focusText = document.getElementById('focusScoreText');
  if (focusPct) focusPct.textContent = score + '%';
  if (focusBar) focusBar.style.width = score + '%';
  if (focusText) focusText.textContent = score >= 80 ? 'Crushing it! Keep the momentum!' : 'Complete tasks to boost your score!';
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
  if (taskStatBar) {
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
  }

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
  updateDashboardStats();
  renderDashboardUpNext();
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
const headerAddBtn = document.getElementById('headerAddBtn');
if (headerAddBtn) headerAddBtn.addEventListener('click', openAddModal);

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
  const titles = { dashboard: "Today's Overview", pomodoro: 'Pomodoro', tasks: 'Tasks', stats: 'Statistics', goals: 'Goals' };
  const pageTitle = document.getElementById('pageTitle');
  if (pageTitle) pageTitle.textContent = titles[tabId] || 'Pomodoro';
  const ambient = document.getElementById('ambientBg');
  if (ambient) ambient.classList.toggle('hidden', tabId !== 'pomodoro');
  if (tabId === 'dashboard') { updateDashboardStats(); renderDashboardUpNext(); fetchQuotes(); updateCurrentTaskDisplay(); }
  if (tabId === 'pomodoro') updateCurrentTaskDisplay();
  if (tabId === 'tasks') renderTodos();
  if (tabId === 'stats') renderStats();
  if (tabId === 'goals') renderQuarterlyGoals();
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

/* Dashboard view-all and focus button */
const dashViewAll = document.getElementById('dashViewAll');
if (dashViewAll) dashViewAll.addEventListener('click', () => switchTab('tasks'));
const dashFocusBtn = document.getElementById('dashFocusBtn');
if (dashFocusBtn) {
  dashFocusBtn.addEventListener('click', () => {
    if (goldenTaskId) setActiveTask(goldenTaskId);
    switchTab('pomodoro');
  });
}

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
  // Update bento summary cards
  const history = loadHistory();
  const focusTimeEl = document.getElementById('statsFocusTime');
  const focusSubEl = document.getElementById('statsFocusSub');
  const completedEl = document.getElementById('statsCompleted');
  const completedSubEl = document.getElementById('statsCompletedSub');
  const streakEl = document.getElementById('statsStreak');
  const streakSubEl = document.getElementById('statsStreakSub');
  if (focusTimeEl) {
    const totalMin = history.length * 25;
    if (totalMin >= 60) focusTimeEl.textContent = Math.round(totalMin / 60) + 'h';
    else focusTimeEl.textContent = totalMin + 'm';
  }
  if (focusSubEl) focusSubEl.textContent = history.length > 0 ? `${history.length} sessions completed` : 'No sessions yet';
  if (completedEl) completedEl.textContent = todos.filter(t => t.done).length;
  if (completedSubEl) {
    const doneToday = todos.filter(t => t.done && t.completedAt && new Date(t.completedAt).toDateString() === new Date().toDateString()).length;
    completedSubEl.textContent = doneToday > 0 ? `${doneToday} today` : 'Tasks finished';
  }
  if (streakEl) {
    const dates = [...new Set(history.map(s => s.date))].sort().reverse();
    let streak = 0;
    const today = new Date().toISOString().slice(0, 10);
    let check = today;
    for (const d of dates) {
      if (d === check) { streak++; check = new Date(new Date(check).setDate(new Date(check).getDate() - 1)).toISOString().slice(0, 10); }
      else break;
    }
    streakEl.textContent = streak;
  }
  if (streakSubEl) streakSubEl.textContent = streak === 1 ? 'Day of focus' : `${streak} day streak`;
  // Stats views
  if (currentView === 'calendar') statsViews.innerHTML = renderCalendarHTML();
  else if (currentView === 'hours') statsViews.innerHTML = renderHoursHTML();
  else if (currentView === 'projects') statsViews.innerHTML = renderProjectsHTML();
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

/* ===== Projects Breakdown ===== */
function renderProjectsHTML() {
  const history = loadHistory();
  const pending = todos.filter(t => !t.done);
  const projects = {};
  todos.forEach(t => {
    const p = t.project || 'General';
    if (!projects[p]) projects[p] = { name: p, pomos: 0, total: 0, done: 0 };
    projects[p].total++;
    if (t.done) projects[p].done++;
    projects[p].pomos += t.pomodoros || 0;
  });
  const projectList = Object.values(projects).sort((a, b) => b.pomos - a.pomos);
  const totalPomos = projectList.reduce((s, p) => s + p.pomos, 0) || 1;
  const colors = ['bg-primary', 'bg-secondary', 'bg-tertiary', 'bg-on-surface-variant'];
  const projectColors = ['#ae2f34', '#006a65', '#705d00', '#584140'];

  let html = '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">';
  // Left: Project allocation
  html += '<div class="bg-surface-container-low p-6 rounded-xl shadow-sm border border-outline-variant/10">';
  html += '<h3 class="font-display font-semibold mb-5" style="font-size:18px;line-height:28px">Allocation</h3>';
  html += '<div class="space-y-5">';
  projectList.slice(0, 6).forEach((p, i) => {
    const pct = Math.round((p.pomos / totalPomos) * 100);
    const color = projectColors[i % projectColors.length];
    html += `
      <div>
        <div class="flex justify-between mb-2 text-sm font-bold font-body">
          <span>${p.name}</span>
          <span class="font-mono" style="color:${color}">${pct}%</span>
        </div>
        <div class="w-full h-3 bg-surface-container-high rounded-full overflow-hidden">
          <div class="h-full rounded-full transition-all duration-1000 ease-out" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="flex justify-between mt-1 text-[10px] font-mono text-on-surface-variant">
          <span>${p.done}/${p.total} tasks</span>
          <span>${p.pomos} pomos</span>
        </div>
      </div>`;
  });
  if (projectList.length === 0) {
    html += '<p class="text-sm text-on-surface-variant opacity-60 text-center py-4">No projects yet. Add tasks with projects to see allocation.</p>';
  }
  html += '</div></div>';

  // Right: Insight section
  const bestHour = (() => {
    if (history.length === 0) return null;
    const hourCounts = Array(24).fill(0);
    history.forEach(s => {
      const h = parseInt(s.time.split(':')[0], 10);
      if (h >= 0 && h < 24) hourCounts[h]++;
    });
    let maxH = 0, best = -1;
    hourCounts.forEach((c, h) => { if (c > maxH) { maxH = c; best = h; } });
    return best;
  })();
  const totalSessions = history.length;
  const todaySessions = history.filter(s => s.date === new Date().toISOString().slice(0, 10)).length;
  let insightMsg = 'Complete your first pomodoro session to unlock insights.';
  if (totalSessions > 0) {
    if (bestHour !== null) {
      const period = bestHour < 12 ? 'morning' : bestHour < 17 ? 'afternoon' : 'evening';
      insightMsg = `You're most productive in the ${period} (around ${bestHour}:00). Your peak focus window is ${bestHour}:00–${Math.min(bestHour + 2, 24)}:00.`;
      if (todaySessions > 0) {
        insightMsg += ` Great start — you've logged ${todaySessions} session${todaySessions > 1 ? 's' : ''} today!`;
      }
    }
    const projectCount = projectList.filter(p => p.pomos > 0).length;
    if (projectCount > 2 && totalSessions > 10) {
      insightMsg += ` You're juggling ${projectCount} projects — consider focusing on one per day.`;
    }
  }

  html += `
    <div class="bg-primary/5 p-8 rounded-xl border-2 border-dashed border-primary/20 flex flex-col items-center justify-center text-center">
      <div class="w-20 h-20 bg-primary-container rounded-full flex items-center justify-center mb-4">
        <span class="material-symbols-outlined text-[40px] text-on-primary-container">insights</span>
      </div>
      <h4 class="font-display font-semibold" style="font-size:18px;line-height:28px">Insight</h4>
      <p class="text-sm text-on-surface-variant mt-2 max-w-xs mx-auto leading-relaxed">${insightMsg}</p>
    </div>`;

  html += '</div>';
  return html;
}

const tagCloudEl = document.getElementById('tagCloud');
if (tagCloudEl) tagCloudEl.addEventListener('click', (e) => {
  const pill = e.target.closest('.tag-pill');
  if (pill) filterByTag(pill.dataset.tag);
});
['tagCloudSidebar', 'tagCloudTags'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', (e) => {
    const pill = e.target.closest('.tag-pill');
    if (pill) filterByTag(pill.dataset.tag);
  });
});

/* ===== Theme Toggle ===== */
const themeToggle = document.getElementById('themeToggle');

function setTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  localStorage.setItem('theme', theme);
  themeToggle.innerHTML = theme === 'dark'
    ? '<span class="material-symbols-outlined">dark_mode</span>'
    : '<span class="material-symbols-outlined">light_mode</span>';
}

const savedTheme = localStorage.getItem('theme') || 'dark';
setTheme(savedTheme);

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
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

function renderQuarterlyGoals() {
  const now = new Date();
  const currentKey = getMonthKey(now);

  const upcoming = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    upcoming.push(getMonthKey(d));
  }

  const allGoals = loadQuarterlyGoals();
  const pastKeys = Object.keys(allGoals).filter(k => k < currentKey && allGoals[k].length > 0);
  pastKeys.sort().reverse();

  const borderColors = ['border-primary', 'border-secondary', 'border-tertiary'];
  const badgeColors = ['bg-primary-fixed text-primary', 'bg-secondary-fixed text-secondary', 'bg-tertiary-fixed text-tertiary'];
  const progressColors = ['bg-secondary-container', 'bg-primary-container', 'bg-tertiary-container'];
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  function monthCardHTML(key, idx) {
    const items = allGoals[key] || [];
    const doneCount = items.filter(i => i.done).length;
    const totalCount = items.length;
    const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
    const barPct = pct > 0 ? pct : (totalCount > 0 ? 2 : 2);
    const [y, m] = key.split('-');
    const monthLabel = monthNames[parseInt(m) - 1];
    const isCurrent = key === currentKey;

    const lastDay = new Date(+y, parseInt(m), 0).getDate();
    const todayNum = now.getDate();
    const dayInMonth = parseInt(key.split('-')[1]) === now.getMonth() + 1 ? todayNum : 0;
    const daysLeft = lastDay - (isCurrent ? todayNum : 0);
    const showDaysLeft = parseInt(key.split('-')[1]) >= now.getMonth() + 1;

    const itemsHtml = items.length === 0
      ? '<p class="text-xs text-on-surface-variant opacity-50 text-center py-3">No goals set for this month</p>'
      : items.map((item, i) => `
        <li class="flex items-start gap-3">
          <input type="checkbox" class="stitch-checkbox mt-0.5" ${item.done ? 'checked' : ''} data-key="${key}" data-idx="${i}">
          <span class="flex-1 text-sm font-body ${item.done ? 'line-through opacity-60 text-on-surface-variant' : 'text-on-surface'}">${item.text}</span>
          <button class="qg-item-del text-outline hover:text-primary transition-colors text-sm" data-key="${key}" data-idx="${i}">✕</button>
        </li>
      `).join('');

    return `
      <div class="organic-card bg-surface-container-lowest p-5 rounded-xl shadow-sm relative overflow-hidden border-l-4 ${borderColors[idx]}">
        <div class="flex justify-between items-start mb-3">
          <div>
            ${isCurrent ? `<span class="font-mono text-[10px] font-bold tracking-widest text-primary bg-primary-fixed px-3 py-1 rounded-full">CURRENT</span>` : ''}
            <h4 class="font-display font-semibold mt-1" style="font-size:18px;line-height:28px">${monthLabel}</h4>
          </div>
          ${showDaysLeft ? `
          <div class="text-right ${isCurrent ? '' : 'opacity-50'}">
            <span class="block text-2xl font-bold text-on-surface">${daysLeft}</span>
            <span class="text-[10px] text-on-surface-variant uppercase tracking-wider font-mono">Days Left</span>
          </div>` : ''}
        </div>
        <div class="mb-4">
          <div class="flex justify-between text-xs font-mono mb-1.5">
            <span class="font-bold text-secondary">${pct}% Focus Achieved</span>
            <span class="text-on-surface-variant">${totalCount > 0 ? doneCount+'/'+totalCount : 'No'} Goals</span>
          </div>
          <div class="h-2.5 w-full bg-surface-container-high rounded-full overflow-hidden">
            <div class="h-full rounded-full progress-glow ${progressColors[idx]}" style="width:${barPct}%"></div>
          </div>
        </div>
        <ul class="space-y-3">${itemsHtml}</ul>
        <div class="flex items-center gap-2 mt-4 pt-3 border-t border-outline-variant/20">
          <input type="text" data-key="${key}" class="flex-1 bg-surface-container-low rounded-lg px-3 py-2 text-xs font-body outline-none focus:ring-1 focus:ring-primary" placeholder="Add goal...">
          <button class="qg-add-btn bg-primary text-on-primary px-4 py-2 rounded-lg text-xs font-bold hover:opacity-90 transition-all active:scale-95 squishy-button" data-key="${key}">+</button>
        </div>
      </div>
    `;
  }

  // === Build HTML ===
  let html = '';

  // Active Quarterly Roadmap
  html += '<section class="mb-10">';
  html += '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">';

  upcoming.forEach((k, idx) => {
    html += monthCardHTML(k, idx);
  });

  // Visual accent card (4th slot)
  const visualLabels = ['Prepare', 'Vision', 'Focus', 'Thrive'];
  const visualMsgs = ['Plan next quarter early for a smooth transition.', 'Set your intentions for the months ahead.', 'Stay consistent — small steps build big results.', 'Every goal starts with a single decision.'];
  const randomIdx = Math.floor(Math.random() * visualLabels.length);
  html += `
    <div class="relative rounded-xl overflow-hidden group min-h-[200px]">
      <div class="absolute inset-0 bg-gradient-to-br from-primary/20 via-secondary/10 to-tertiary/20 z-0"></div>
      <div class="absolute inset-0 bg-gradient-to-t from-on-surface/70 to-transparent z-10"></div>
      <div class="relative z-20 h-full p-5 flex flex-col justify-end text-white">
        <span class="material-symbols-outlined text-2xl mb-2">auto_awesome</span>
        <h4 class="font-display font-semibold text-lg">${visualLabels[randomIdx]}</h4>
        <p class="text-sm opacity-80">${visualMsgs[randomIdx]}</p>
      </div>
    </div>`;

  html += '</div>';
  html += '</section>';

  // Summary
  const allSummaryKeys = [...upcoming, ...pastKeys];
  let totalDone = 0, totalItems = 0;
  allSummaryKeys.forEach(k => {
    const items = allGoals[k] || [];
    items.forEach(i => { totalItems++; if (i.done) totalDone++; });
  });
  if (totalItems > 0) {
    html += '<div class="text-center text-sm font-mono text-on-surface-variant opacity-70 mb-5">' + totalDone + '/' + totalItems + ' goals completed this quarter</div>';
  }

  // Past Months
  html += '<section class="mb-6">';
  html += '<div class="flex items-center gap-4 mb-5">';
  html += '<h3 class="font-display font-semibold text-on-surface-variant" style="font-size:16px;line-height:24px">Past Months</h3>';
  html += '<div class="h-px flex-1 bg-outline-variant opacity-30"></div>';
  html += '</div>';
  html += '<div class="flex flex-wrap gap-3">';
  if (pastKeys.length > 0) {
    pastKeys.forEach(k => {
      const items = allGoals[k] || [];
      const doneCount = items.filter(i => i.done).length;
      const totalCount = items.length;
      const [y, m] = k.split('-');
      const monthLabel = monthNames[parseInt(m) - 1];
      const allDone = totalCount > 0 && doneCount === totalCount;
      html += `
        <div class="px-5 py-3 bg-surface-container-low rounded-xl border-2 border-dashed border-outline-variant flex items-center gap-3 opacity-70 hover:opacity-100 hover:grayscale-0 transition-all cursor-pointer">
          <span class="material-symbols-outlined ${allDone ? 'text-secondary' : 'text-outline'}">${allDone ? 'verified' : 'radio_button_unchecked'}</span>
          <div>
            <p class="font-bold text-sm">${monthLabel}</p>
            <p class="text-[11px] font-mono text-on-surface-variant">${doneCount}/${totalCount} Goals Completed</p>
          </div>
        </div>`;
    });
  } else {
    html += '<p class="text-xs text-on-surface-variant opacity-50">No past months recorded yet. Start adding goals to see your history.</p>';
  }
  html += '</div>';
  html += '</section>';

  document.getElementById('quarterlyGoalsContent').innerHTML = html;

  // Event handlers
  document.querySelectorAll('#quarterlyGoalsContent .stitch-checkbox').forEach(cb => {
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

  document.querySelectorAll('#quarterlyGoalsContent .qg-item-del').forEach(btn => {
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

  document.querySelectorAll('#quarterlyGoalsContent .qg-add-btn').forEach(btn => {
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

  document.querySelectorAll('#quarterlyGoalsContent .qg-add-row input, #quarterlyGoalsContent input[data-key]').forEach(input => {
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

/* ===== Dashboard Quotes ===== */
const fallbackQuotes = [
  { q: 'Slow progress is still progress. Every stitch counts towards the final masterpiece.', a: 'Unknown' },
  { q: 'Success is the sum of small efforts, repeated day in and day out.', a: 'Robert Collier' },
  { q: 'Hard work beats talent when talent doesn\'t work hard.', a: 'Tim Notke' },
  { q: 'Success is not final, failure is not fatal: it is the courage to continue that counts.', a: 'Winston Churchill' },
  { q: 'The only way to do great work is to love what you do.', a: 'Steve Jobs' },
  { q: 'Don\'t watch the clock; do what it does. Keep going.', a: 'Sam Levenson' },
  { q: 'Strive not to be a success, but rather to be of value.', a: 'Albert Einstein' },
  { q: 'The difference between ordinary and extraordinary is that little extra.', a: 'Jimmy Johnson' },
  { q: 'It does not matter how slowly you go as long as you do not stop.', a: 'Confucius' },
  { q: 'Success usually comes to those who are too busy to be looking for it.', a: 'Henry David Thoreau' },
  { q: 'The future depends on what you do today.', a: 'Mahatma Gandhi' },
  { q: 'There are no shortcuts to any place worth going.', a: 'Beverly Sills' },
  { q: 'The only limit to our realization of tomorrow is our doubts of today.', a: 'Franklin D. Roosevelt' },
  { q: 'Hard things are worth doing well.', a: 'Unknown' },
  { q: 'Dream big. Work hard. Stay focused.', a: 'Unknown' },
];

function pickShuffled(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function fetchQuotes() {
  const container = document.getElementById('dashQuotes');
  if (!container) return;

  function renderQuoteCards(quotes) {
    container.innerHTML = quotes.map(q => `
      <div class="organic-card stitch-border p-4 bg-surface-container-low flex items-start gap-3">
        <span class="material-symbols-outlined text-outline-variant shrink-0" style="font-size:20px">format_quote</span>
        <p class="font-body text-sm italic text-on-surface-variant leading-relaxed">"${q.q}"${q.a ? `<br><span class="not-italic font-semibold text-xs opacity-60">&mdash; ${q.a}</span>` : ''}</p>
      </div>
    `).join('');
  }

  function normalizeQuotes(data) {
    if (Array.isArray(data)) return data.map(q => ({ q: q.content || q.quote || q.q, a: q.author || q.a }));
    if (data.quotes) return data.quotes.map(q => ({ q: q.quote || q.q, a: q.author || q.a }));
    return null;
  }
  Promise.any([
    fetch('https://api.quotable.io/quotes/random?tags=work|success|perseverance|motivation&limit=3').then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    fetch('https://dummyjson.com/quotes/random/3').then(r => { if (!r.ok) throw new Error(); return r.json(); }),
  ]).then(data => {
    const quotes = normalizeQuotes(data);
    if (quotes && quotes.length >= 3) {
      renderQuoteCards(quotes);
      return;
    }
    throw new Error('not enough quotes');
  })
    .catch(() => {
      renderQuoteCards(pickShuffled(fallbackQuotes, 3));
    });
}

/* ===== Dashboard Up Next ===== */
function renderDashboardUpNext() {
  const container = document.getElementById('dashTaskList');
  if (!container) return;
  const today = new Date().toISOString().slice(0, 10);
  const pending = todos.filter(t => !t.done);
  if (pending.length === 0) {
    container.innerHTML = '<div class="text-center py-8 text-sm text-on-surface-variant opacity-60">No pending tasks. Add a task to get started!</div>';
    return;
  }
  const todayTasks = pending.filter(t => t.dueDate === today);
  const otherTasks = pending.filter(t => t.dueDate !== today);
  let ordered = [];
  if (goldenTaskId) {
    const golden = pending.find(t => t.id === goldenTaskId);
    if (golden) ordered.push(golden);
  }
  if (activeTaskId) {
    const active = pending.find(t => t.id === activeTaskId);
    if (active && !ordered.some(t => t.id === active.id)) ordered.push(active);
  }
  todayTasks.forEach(t => { if (!ordered.some(o => o.id === t.id)) ordered.push(t); });
  otherTasks.forEach(t => { if (!ordered.some(o => o.id === t.id)) ordered.push(t); });
  const maxShow = 8;
  const shown = ordered.slice(0, maxShow);
  container.innerHTML = shown.map((t, idx) => {
    const isGolden = t.id === goldenTaskId;
    const isActive = t.id === activeTaskId;
    const starIcon = isGolden ? '<span class="material-symbols-outlined fill text-tertiary text-sm">stars</span>' : '';
    const goldenCls = isGolden ? 'golden-item' : '';
    const isDueToday = t.dueDate === today;
    const meta = isDueToday ? 'Today' : t.dueDate ? t.dueDate : `${t.pomodoros || 0} POMOS`;
    const playIcon = isActive ? 'pause_circle' : 'play_circle';
    return `<div class="dash-task-item flex items-center gap-2 p-3 rounded-xl border-l-4 bg-surface-container-low border-l-surface-container transition-all hover:translate-x-1 ${goldenCls}" draggable="true" data-idx="${idx}" data-task-id="${t.id}">
      <span class="material-symbols-outlined text-outline-variant text-lg drag-handle-dash" style="cursor:grab">drag_indicator</span>
      <button class="dash-task-play material-symbols-outlined text-lg ${isActive ? 'text-secondary' : 'text-primary'} hover:scale-110 transition-transform shrink-0" data-task-id="${t.id}" aria-label="${isActive ? 'Pause' : 'Focus on this task'}">${playIcon}</button>
      <span class="material-symbols-outlined text-sm ${t.done ? 'text-secondary' : 'text-outline-variant'}">${t.done ? 'check_circle' : 'radio_button_unchecked'}</span>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-semibold truncate">${t.title}</p>
        <p class="text-[10px] font-mono opacity-50">${t.project ? t.project.toUpperCase() + ' • ' : ''}${meta}</p>
      </div>
      ${starIcon}
    </div>`;
  }).join('');
  container._shownTasks = shown;
  setupDashDragDrop(container, shown);
}

document.addEventListener('click', async function _dashPlayHandler(e) {
  const btn = e.target.closest('.dash-task-play');
  if (!btn) return;
  const taskId = btn.dataset.taskId;
  if (!taskId) return;
  const todo = todos.find(t => t.id === taskId);
  if (!todo) return;
  e.stopPropagation();
  if (activeTaskId && activeTaskId !== taskId) {
    const current = getActiveTask();
    if (!await showConfirmModal(`You're focusing on "${current ? current.title : 'a task'}". Switch to "${todo.title}"?`)) return;
  }
  setActiveTask(taskId);
  if (pomState.phase !== 'focus') {
    pomState.phase = 'focus';
    pomState.timeLeft = FOCUS_TIME;
    updatePhaseLabel();
    updateDisplay();
    updateDashPhaseTabs();
    updateDashDots();
    updateCurrentTaskDisplay();
  }
  startTimer();
});

function setupDashDragDrop(container, todayTasks) {
  let dragSrcIdx = null;
  const onDragStart = (e) => {
    const item = e.target.closest('.dash-task-item');
    if (!item) return;
    dragSrcIdx = parseInt(item.dataset.idx);
    item.classList.add('opacity-30');
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragEnd = () => {
    container.querySelectorAll('.dash-task-item').forEach(el => el.classList.remove('opacity-30', 'border-t-2', 'border-primary'));
    dragSrcIdx = null;
  };
  const onDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const item = e.target.closest('.dash-task-item');
    if (!item) return;
    container.querySelectorAll('.dash-task-item').forEach(el => el.classList.remove('border-t-2', 'border-primary'));
    item.classList.add('border-t-2', 'border-primary');
  };
  const onDrop = (e) => {
    e.preventDefault();
    if (dragSrcIdx === null) return;
    const target = e.target.closest('.dash-task-item');
    if (!target) return;
    const targetIdx = parseInt(target.dataset.idx);
    if (dragSrcIdx === targetIdx) return;
    const srcTask = todayTasks[dragSrcIdx];
    const targetTask = todayTasks[targetIdx];
    const srcTodosIdx = todos.indexOf(srcTask);
    const targetTodosIdx = todos.indexOf(targetTask);
    if (srcTodosIdx === -1 || targetTodosIdx === -1) return;
    todos.splice(srcTodosIdx, 1);
    const newTargetIdx = todos.indexOf(targetTask);
    todos.splice(newTargetIdx + (dragSrcIdx < targetIdx ? 0 : 1), 0, srcTask);
    saveTodos();
    renderDashboardUpNext();
    renderTodos();
  };
  container.removeEventListener('dragstart', onDragStart);
  container.removeEventListener('dragend', onDragEnd);
  container.removeEventListener('dragover', onDragOver);
  container.removeEventListener('drop', onDrop);
  container.addEventListener('dragstart', onDragStart);
  container.addEventListener('dragend', onDragEnd);
  container.addEventListener('dragover', onDragOver);
  container.addEventListener('drop', onDrop);
}

/* ===== Init ===== */
const savedTab = localStorage.getItem('activeTab') || 'dashboard';
switchTab(savedTab);

startBtn.disabled = false;
pauseBtn.disabled = true;
resetBtn.disabled = false;
updateDisplay();
updatePhaseLabel();
updateDashPhaseTabs();
updateDashDots();
updateCurrentTaskDisplay();
renderTagCloud();
renderTodos();
renderStats();
renderWeeklyStats();
renderQuarterlyGoals();
updateDashboardStats();
renderDashboardUpNext();
fetchQuotes();
