/* ===== State ===== */
const FOCUS_TIME = 25 * 60;
const BREAK_TIME = 5 * 60;

let state = {
  timeLeft: FOCUS_TIME,
  phase: 'focus',
  running: false,
  sessionCount: 0,
  timerId: null,
};

/* ===== DOM refs ===== */
const timerEl = document.getElementById('timer');
const phaseEl = document.getElementById('phase');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const sessionCountEl = document.getElementById('sessionCount');
const progressFg = document.querySelector('.progress-ring .fg');
const circumference = 553;

/* ===== Pomodoro logic ===== */
function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function updateDisplay() {
  timerEl.textContent = formatTime(state.timeLeft);
  const total = state.phase === 'focus' ? FOCUS_TIME : BREAK_TIME;
  const offset = circumference * (1 - state.timeLeft / total);
  progressFg.style.strokeDashoffset = offset;
}

function updatePhaseLabel() {
  const labels = { focus: 'Focus', break: 'Break' };
  phaseEl.textContent = labels[state.phase];
  progressFg.style.stroke = state.phase === 'focus' ? '#ff6b6b' : '#4ecdc4';
}

function startTimer() {
  if (state.running) return;
  state.running = true;
  startBtn.textContent = 'Pause';
  startBtn.classList.add('running');
  state.timerId = setInterval(tick, 1000);
}

function pauseTimer() {
  state.running = false;
  startBtn.textContent = 'Resume';
  clearInterval(state.timerId);
}

function resetTimer() {
  pauseTimer();
  startBtn.classList.remove('running');
  startBtn.textContent = 'Start';
  state.phase = 'focus';
  state.timeLeft = FOCUS_TIME;
  updatePhaseLabel();
  updateDisplay();
}

function switchPhase() {
  if (state.phase === 'focus') {
    state.sessionCount++;
    sessionCountEl.textContent = state.sessionCount;
    state.phase = 'break';
    state.timeLeft = BREAK_TIME;
  } else {
    state.phase = 'focus';
    state.timeLeft = FOCUS_TIME;
  }
  updatePhaseLabel();
  updateDisplay();
}

function tick() {
  state.timeLeft--;
  updateDisplay();
  if (state.timeLeft <= 0) {
    pauseTimer();
    switchPhase();
    startTimer();
  }
}

startBtn.addEventListener('click', () => {
  state.running ? pauseTimer() : startTimer();
});

resetBtn.addEventListener('click', resetTimer);

/* ===== Todo logic ===== */
const todoForm = document.getElementById('todoForm');
const todoInput = document.getElementById('todoInput');
const todoList = document.getElementById('todoList');
const taskCount = document.getElementById('taskCount');

let todos = loadTodos();

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
    span.textContent = todo.text;

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

/* ===== Init ===== */
updateDisplay();
updatePhaseLabel();
renderTodos();
