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

/* ===== Pomodoro Timer ===== */
function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function updateDisplay() {
  timerEl.textContent = formatTime(pomState.timeLeft);
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
    switchPhase();
    startTimer();
  }
}

startBtn.addEventListener('click', () => {
  pomState.running ? pauseTimer() : startTimer();
});

resetBtn.addEventListener('click', resetTimer);

/* ===== Todo State ===== */
const todoForm = document.getElementById('todoForm');
const todoInput = document.getElementById('todoInput');
const todoList = document.getElementById('todoList');
const taskCount = document.getElementById('taskCount');

let todos = loadTodos();

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
  return escaped.replace(/#(\w+)/g, '<span class="tag">#$1</span>');
}

function renderTodos() {
  todoList.innerHTML = '';
  const remaining = todos.filter(t => !t.done).length;
  taskCount.textContent = remaining;

  todos.forEach((todo, i) => {
    const li = document.createElement('li');
    if (todo.done) li.classList.add('completed');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = todo.done;
    cb.addEventListener('change', () => {
      todos[i].done = cb.checked;
      saveTodos();
      renderTodos();
    });

    const span = document.createElement('span');
    span.className = 'task-text';
    span.innerHTML = highlightTags(todo.text);

    const del = document.createElement('button');
    del.textContent = '✕';
    del.setAttribute('aria-label', 'Delete task');
    del.addEventListener('click', () => {
      todos.splice(i, 1);
      saveTodos();
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

/* ===== Init ===== */
updateDisplay();
updatePhaseLabel();
renderTodos();
renderStats();
