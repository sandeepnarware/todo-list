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
  startBtn.textContent = 'Pause';
  startBtn.classList.add('running');
  pomState.timerId = setInterval(tick, 1000);
}

function pauseTimer() {
  pomState.running = false;
  startBtn.textContent = 'Resume';
  clearInterval(pomState.timerId);
  updateDisplay();
}

function resetTimer() {
  pauseTimer();
  startBtn.classList.remove('running');
  startBtn.textContent = 'Start';
  pomState.phase = 'focus';
  pomState.timeLeft = FOCUS_TIME;
  updatePhaseLabel();
  updateDisplay();
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
    pauseTimer();
    playTripleBeep();
    notifyPhaseEnd(pomState.phase);
    switchPhase();
    startTimer();
  }
}

startBtn.addEventListener('click', () => {
  pomState.running ? pauseTimer() : startTimer();
});

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
  } catch { closePip(); }
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
    pipWindow = await documentPictureInPicture.requestWindow({ width: 300, height: 160 });
    pipBtn.classList.add('active');
    pipWindow.document.body.innerHTML = `
      <div class="pip-timer">
        <div class="pip-time" id="pipTime">25:00</div>
        <div class="pip-phase" id="pipPhase">Focus</div>
      </div>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        html,body{height:100%}
        body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f0f23;color:#e0e0e0;display:flex;align-items:center;justify-content:center}
        .pip-timer{text-align:center}
        .pip-time{font-size:4rem;font-weight:700;font-variant-numeric:tabular-nums}
        .pip-phase{font-size:1rem;text-transform:uppercase;letter-spacing:3px;color:#888;margin-top:0.5rem}
      </style>
    `;
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
const todoForm = document.getElementById('todoForm');
const todoInput = document.getElementById('todoInput');
const todoList = document.getElementById('todoList');
const taskCount = document.getElementById('taskCount');

let todos = loadTodos();
let tagFilter = null;

/* ===== Todo localStorage ===== */
function loadTodos() {
  try {
    return JSON.parse(localStorage.getItem('todos')) || [];
  } catch {
    return [];
  }
}

function saveTodos() {
  localStorage.setItem('todos', JSON.stringify(todos));
}

function highlightTags(text) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/#([\w-]+)/g, '<span class="tag">#$1</span>')
    .replace(/#(\w+)\[([^\]]+)\]/g, '<span class="tag">#$1[$2]</span>');
}

function extractTags() {
  const set = new Set();
  todos.forEach(t => {
    const simple = t.text.match(/#([\w-]+)/g);
    if (simple) simple.forEach(m => set.add(m.toLowerCase()));
    const bracketed = t.text.match(/#(\w+)\[/g);
    if (bracketed) bracketed.forEach(m => set.add(m.slice(0, -1).toLowerCase()));
  });
  return [...set].sort();
}

function renderTagCloud() {
  const tags = extractTags();
  const html = tags.map(t => {
    const count = todos.filter(td => td.text.toLowerCase().includes(t)).length;
    const active = tagFilter === t ? 'active' : '';
    return `<span class="tag-pill ${active}" data-tag="${t}">${t} <span class="count">${count}</span></span>`;
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

function renderTodos() {
  const filtered = tagFilter
    ? todos.filter(t => t.text.toLowerCase().includes(tagFilter))
    : todos;

  todoList.innerHTML = '';
  const remaining = filtered.filter(t => !t.done).length;
  taskCount.textContent = remaining;

  filtered.forEach((todo, i) => {
    const origIndex = todos.indexOf(todo);
    const li = document.createElement('li');
    if (todo.done) li.classList.add('completed');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = todo.done;
    cb.addEventListener('change', () => {
      const todo = todos[origIndex];
      todo.done = cb.checked;
      if (todo.done && !/#CompleteOn\[\d{2}\/\d{2}\/\d{2}\]/.test(todo.text)) {
        const d = new Date();
        const dd = String(d.getDate()).padStart(2,'0');
        const mm = String(d.getMonth()+1).padStart(2,'0');
        const yy = String(d.getFullYear()).slice(-2);
        todo.text += ` #CompleteOn[${dd}/${mm}/${yy}]`;
      }
      saveTodos();
      renderTagCloud();
      renderTodos();
    });

    const span = document.createElement('span');
    span.className = 'task-text';
    span.innerHTML = highlightTags(todo.text);

    const del = document.createElement('button');
    del.textContent = '✕';
    del.setAttribute('aria-label', 'Delete task');
    del.addEventListener('click', () => {
      todos.splice(origIndex, 1);
      saveTodos();
      renderTagCloud();
      renderTodos();
    });

    li.appendChild(cb);
    li.appendChild(span);
    li.appendChild(del);
    todoList.appendChild(li);
  });
}

todoForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = todoInput.value.trim();
  if (!text) return;
  todos.push({ text, done: false });
  todoInput.value = '';
  saveTodos();
  renderTagCloud();
  renderTodos();
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

/* ===== Init ===== */
updateDisplay();
updatePhaseLabel();
renderTagCloud();
renderTodos();
renderStats();
