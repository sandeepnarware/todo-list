/* ===== Pomodoro State ===== */
const FOCUS_TIME = 25 * 60;
const BREAK_TIME = 5 * 60;
const LONG_BREAK_TIME = 15 * 60;
const POMODOROS_BEFORE_LONG_BREAK = 4; // long break after every 4 completed focus sessions

let pomState = {
  timeLeft: FOCUS_TIME,
  phase: "focus",
  running: false,
  sessionCount: 0,
  timerId: null,
  // Wall-clock instant the current run ends. The countdown is derived from this
  // rather than accumulated from interval ticks, which browsers throttle hard in
  // background tabs (a 25 min session could take far longer).
  endsAt: null,
};

/* ===== Pomodoro DOM ===== */
const timerEl = document.getElementById("timer");
const phaseEl = document.getElementById("phase");
const pauseBtn = document.getElementById("pauseBtn");
const resetBtn = document.getElementById("resetBtn");
const sessionCountEl = document.getElementById("sessionCount");
const progressFg = document.querySelector(".timer-ring .fg");
const circumference = 314;

const pomSection = document.getElementById("pomodoroSection");

/* ===== Audio ===== */
let audioCtx = null;

function playBeep() {
  try {
    if (!audioCtx)
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 800;
    osc.type = "sine";
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
if (Notification.permission === "default") Notification.requestPermission();

function notifyPhaseEnd(phase) {
  if (Notification.permission !== "granted") return;
  const labels = {
    focus: "Focus session complete — time for a break!",
    break: "Break over — back to focus!",
  };
  new Notification("Pomodoro", {
    body: labels[phase] || "Timer done!",
    icon: "/favicon.ico",
  });
}

/* ===== Pomodoro Timer ===== */
function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

const BASE_TITLE = document.title;

function phaseDisplayName(phase) {
  if (phase === "focus") return "Focus";
  if (phase === "longbreak") return "Long Break";
  return "Break";
}

function getPhaseTime(phase) {
  if (phase === "focus") return FOCUS_TIME;
  if (phase === "longbreak") return LONG_BREAK_TIME;
  return BREAK_TIME;
}

function updateDashDots() {
  // Explicit hook rather than a structural sibling/utility-class selector,
  // which broke on any markup reshuffle.
  const dots = document.querySelectorAll("#dashCycleDots .dash-cycle-dot");
  if (!dots.length) return;
  // Completed focus sessions within the current cycle (0..POMODOROS_BEFORE_LONG_BREAK-1).
  const completed = pomState.sessionCount % POMODOROS_BEFORE_LONG_BREAK;
  dots.forEach((dot, i) => {
    let filled;
    if (pomState.phase === "longbreak") {
      filled = true; // all pomodoros of the cycle are done
    } else if (pomState.phase === "focus") {
      filled = i <= completed; // prior sessions + the one in progress
    } else {
      filled = i < completed; // short break: only completed sessions
    }
    dot.style.background = filled ? "var(--primary)" : "var(--outline-variant)";
  });
}

function updateDisplay() {
  timerEl.textContent = formatTime(pomState.timeLeft);
  const dashTimer = document.getElementById("dashTimer");
  if (dashTimer) dashTimer.textContent = formatTime(pomState.timeLeft);
  updateDashDots();
  if (pomState.running) {
    const labels = { focus: "F", break: "B", longbreak: "LB" };
    const label = labels[pomState.phase] || "B";
    document.title = `${formatTime(pomState.timeLeft)} [${label}] - PomoDone`;
  } else {
    document.title = BASE_TITLE;
  }
  const total = getPhaseTime(pomState.phase);
  const offset = circumference * (1 - pomState.timeLeft / total);
  if (progressFg) progressFg.style.strokeDashoffset = offset;
}

function updatePhaseLabel() {
  const labels = {
    focus: "Focus",
    break: "Short Break",
    longbreak: "Long Break",
  };
  phaseEl.textContent = labels[pomState.phase] || "Focus";
  if (progressFg)
    progressFg.style.stroke =
      pomState.phase === "focus" ? "#ff6b6b" : "#4ecdc4";
}

function setTimerButton(phase) {
  if (phase === "running") {
    pauseBtn.classList.remove("hidden");
    pauseBtn.disabled = false;
    resetBtn.classList.remove("hidden");
    resetBtn.disabled = false;
  } else {
    pauseBtn.classList.add("hidden");
    pauseBtn.disabled = true;
    resetBtn.classList.add("hidden");
    resetBtn.disabled = true;
  }
  const dashPlayBtn = document.getElementById("dashPlayBtn");
  if (dashPlayBtn) {
    const dashIcon = dashPlayBtn.querySelector(".material-symbols-outlined");
    if (dashIcon)
      dashIcon.textContent = pomState.running ? "pause" : "play_arrow";
  }
  if (secStartBtn) {
    const icon = secStartBtn.querySelector(".material-symbols-outlined");
    if (icon) icon.textContent = pomState.running ? "pause" : "play_arrow";
  }
  updateDashPhaseTabs();
}

function startTimer() {
  if (pomState.running) return;
  pomState.running = true;
  pomState.endsAt = Date.now() + pomState.timeLeft * 1000;
  setTimerButton("running");
  clearInterval(pomState.timerId); // kill any orphaned interval before starting a new one
  pomState.timerId = setInterval(tick, 1000);
  updatePipControls();
}

function pauseTimer() {
  // Capture the true remaining time before dropping endsAt, so pausing between
  // ticks doesn't round away up to a second.
  if (pomState.endsAt) pomState.timeLeft = remainingSeconds();
  pomState.running = false;
  pomState.endsAt = null;
  setTimerButton("paused");
  clearInterval(pomState.timerId);
  updateDisplay();
  updatePipControls();
}

function resetTimer() {
  pomState.running = false;
  pomState.endsAt = null;
  clearInterval(pomState.timerId);
  setTimerButton("paused");
  pomState.phase = "focus";
  pomState.timeLeft = FOCUS_TIME;
  updatePhaseLabel();
  updateDisplay();
  updatePipControls();
  updateDashPhaseTabs();
}

function recordSession() {
  const now = new Date();
  const date = localDateKey(now);
  const time = now.toTimeString().slice(0, 5);
  const history = loadHistory();
  history.push({ date, time, timestamp: Date.now() });
  saveHistory(history);
  renderStats();
}

function switchPhase() {
  const finishedFocus = pomState.phase === "focus";
  pomState.endsAt = null; // the next phase starts paused

  // 1) Advance to the next phase and paint the new timer FIRST, so the
  //    break/focus countdown is shown immediately (never left stuck at 00:00).
  //    The timer is left paused — the next phase does not auto-start.
  if (finishedFocus) {
    pomState.sessionCount++;
    sessionCountEl.textContent = pomState.sessionCount;
    if (pomState.sessionCount % POMODOROS_BEFORE_LONG_BREAK === 0) {
      pomState.phase = "longbreak";
      pomState.timeLeft = LONG_BREAK_TIME;
    } else {
      pomState.phase = "break";
      pomState.timeLeft = BREAK_TIME;
    }
  } else {
    pomState.phase = "focus";
    pomState.timeLeft = FOCUS_TIME;
  }
  updatePhaseLabel();
  updateDisplay();
  setTimerButton("paused");
  updateDashPhaseTabs();

  // 2) Side effects afterwards — if any of these throw, the timer above is
  //    already showing the correct next-phase countdown.
  if (finishedFocus) {
    recordSession();
    const task = getActiveTask();
    if (task) {
      task.pomodoros = (task.pomodoros || 0) + 1;
      saveTodos();
      renderTodos();
      updateCurrentTaskDisplay();
    }
  }
}

function remainingSeconds() {
  if (!pomState.endsAt) return pomState.timeLeft;
  return Math.max(0, Math.round((pomState.endsAt - Date.now()) / 1000));
}

function tick() {
  // Bail out if this interval no longer owns the timer (orphaned/stale interval).
  if (!pomState.running) {
    clearInterval(pomState.timerId);
    return;
  }
  // Recomputed from the end instant, so a throttled tab self-corrects instead of
  // drifting by however many ticks the browser skipped.
  pomState.timeLeft = remainingSeconds();
  if (pomState.timeLeft <= 0) {
    pomState.timeLeft = 0; // clamp so the countdown never displays a negative value
    pomState.running = false;
    pomState.endsAt = null;
    clearInterval(pomState.timerId);
    pomState.timerId = null;
    updateDisplay();
    pauseBtn.disabled = true;
    resetBtn.disabled = false;
    playTripleBeep();
    notifyPhaseEnd(pomState.phase);
    switchPhase();
    updatePipControls();
    return;
  }
  updateDisplay();
}

pauseBtn.addEventListener("click", pauseTimer);
resetBtn.addEventListener("click", resetTimer);

const secStartBtn = document.getElementById("secStartBtn");
if (secStartBtn) {
  secStartBtn.addEventListener("click", () => {
    if (pomState.running) {
      pauseTimer();
    } else {
      startTimer();
    }
  });
}

/* Dashboard timer widget */
const dashPlayBtn = document.getElementById("dashPlayBtn");
if (dashPlayBtn) {
  dashPlayBtn.addEventListener("click", () => {
    if (pomState.running) {
      pauseTimer();
    } else {
      startTimer();
    }
  });
}

const dashResetBtn = document.getElementById("dashResetBtn");
if (dashResetBtn) {
  dashResetBtn.addEventListener("click", resetTimer);
}

function updateDashPhaseTabs() {
  document.querySelectorAll(".dash-phase-tab").forEach((tab) => {
    const isActive = tab.dataset.phase === pomState.phase;
    tab.classList.toggle("active", isActive);
    if (isActive) {
      tab.style.cssText =
        "color:var(--primary);border-bottom:2px solid var(--primary);padding-bottom:4px";
    } else {
      tab.style.cssText = "";
    }
  });
}

document.getElementById("dashPhaseTabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".dash-phase-tab");
  if (!tab) return;
  const phase = tab.dataset.phase;
  if (phase === pomState.phase) return;
  if (pomState.running) pauseTimer();
  pomState.phase = phase;
  pomState.endsAt = null;
  pomState.timeLeft = getPhaseTime(phase);
  updatePhaseLabel();
  updateDisplay();
  setTimerButton("paused");
  updateDashPhaseTabs();
});

/* ===== Picture-in-Picture ===== */
const pipBtns = [
  document.getElementById("pipBtn"),
  document.getElementById("dashPipBtn"),
].filter(Boolean);
let pipWindow = null;
let pipUpdateId = null;

function setPipBtnsActive(active) {
  pipBtns.forEach((b) => b.classList.toggle("active", active));
}

function updatePipWindow() {
  if (!pipWindow || pipWindow.closed) return;
  try {
    pipWindow.document.getElementById("pipTime").textContent = formatTime(
      pomState.timeLeft,
    );
    pipWindow.document.getElementById("pipPhase").textContent =
      phaseDisplayName(pomState.phase);
    const task = getActiveTask();
    const pipTask = pipWindow.document.getElementById("pipCurrentTask");
    if (pipTask) pipTask.textContent = task ? "▶ " + task.title : "";
    updatePipControls();
  } catch {
    closePip();
  }
}

function updatePipControls() {
  if (!pipWindow || pipWindow.closed) return;
  try {
    const pipStart = pipWindow.document.getElementById("pipStartBtn");
    const pipPause = pipWindow.document.getElementById("pipPauseBtn");
    const pipReset = pipWindow.document.getElementById("pipResetBtn");
    if (pipStart) pipStart.disabled = pomState.running;
    if (pipPause) pipPause.disabled = !pomState.running;
    if (pipReset) pipReset.disabled = false;
  } catch {}
}

function closePip() {
  if (pipUpdateId) {
    clearInterval(pipUpdateId);
    pipUpdateId = null;
  }
  if (pipWindow && !pipWindow.closed) pipWindow.close();
  pipWindow = null;
  setPipBtnsActive(false);
}

async function togglePip() {
  if (pipWindow) {
    closePip();
    return;
  }
  if (!documentPictureInPicture) {
    alert(
      "Picture-in-Picture is not supported in this browser. Try Chrome 116+ or Brave.",
    );
    return;
  }
  try {
    pipWindow = await documentPictureInPicture.requestWindow({
      width: 300,
      height: 240,
    });
    setPipBtnsActive(true);
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
    pipWindow.document
      .getElementById("pipStartBtn")
      .addEventListener("click", startTimer);
    pipWindow.document
      .getElementById("pipPauseBtn")
      .addEventListener("click", pauseTimer);
    pipWindow.document
      .getElementById("pipResetBtn")
      .addEventListener("click", resetTimer);
    updatePipWindow();
    pipUpdateId = setInterval(updatePipWindow, 500);
    pipWindow.addEventListener("pagehide", closePip);
    pipWindow.addEventListener("beforeunload", closePip);
  } catch (e) {
    console.error("PiP failed:", e);
    pipWindow = null;
  }
}

pipBtns.forEach((b) => b.addEventListener("click", togglePip));

/* ===== Footer Controls ===== */
/* ===== Todo State ===== */
const addTaskBtn = document.getElementById("addTaskBtn");
const todoList = document.getElementById("todoList");
const taskCount = document.getElementById("taskCount");
const taskModal = document.getElementById("taskModal");
const modalTitle = document.getElementById("modalTitle");
const editId = document.getElementById("editId");
const taskTitle = document.getElementById("taskTitle");
const taskDescription = document.getElementById("taskDescription");
const taskDue = document.getElementById("taskDue");
const taskPriority = document.getElementById("taskPriority");
const taskProject = document.getElementById("taskProject");
const taskFrequency = document.getElementById("taskFrequency");
const taskTags = document.getElementById("taskTags");
const tagsContainer = document.getElementById("tagsContainer");
const taskEstPomodoros = document.getElementById("taskEstPomodoros");
const taskSubtaskInput = document.getElementById("taskSubtaskInput");
const taskSubtaskAdd = document.getElementById("taskSubtaskAdd");
const modalSubtaskList = document.getElementById("modalSubtaskList");
const modalScheduleList = document.getElementById("modalScheduleList");
const taskScheduleAdd = document.getElementById("taskScheduleAdd");
const modalSave = document.getElementById("modalSave");
const modalCancel = document.getElementById("modalCancel");
const modalClose = document.getElementById("modalClose");

const taskSearch = document.getElementById("headerSearch");
const taskStatBar = document.getElementById("taskStatBar");
const toast = document.getElementById("toast");
const toastMsg = document.getElementById("toastMsg");
const toastUndo = document.getElementById("toastUndo");

let todos = loadTodos();
let goldenTaskId = loadGoldenTask();
// validateGoldenTask() deliberately runs from the init block, not here: it can
// clear the id, and clearing renders — which would read tagFilter / sortBy /
// searchQuery below before they exist and throw on their temporal dead zone.
let tagFilter = null;
let draggedIndex = null;
let tagsList = [];
let subtasksDraft = [];
let scheduleDraft = [];
let showCompleted = false;
let completedPage = 0;
let sortBy = "custom";
let searchQuery = "";
let toastTimer = null;
let undoData = null;

/* ===== Active Task ===== */
const currentTaskDisplay = document.getElementById("currentTaskDisplay");
let activeTaskId = loadActiveTask();

function loadActiveTask() {
  return localStorage.getItem("activeTaskId") || null;
}

function saveActiveTask(id) {
  activeTaskId = id;
  if (id) {
    localStorage.setItem("activeTaskId", id);
  } else {
    localStorage.removeItem("activeTaskId");
  }
  updateCurrentTaskDisplay();
  renderTodos();
}

function getActiveTask() {
  if (!activeTaskId) return null;
  const task = todos.find((t) => t.id === activeTaskId);
  // A deleted OR completed task is no longer something to focus on. Checking
  // `done` here also self-heals a stored id that points at a task completed
  // before this rule existed.
  if (!task || task.done) {
    saveActiveTask(null);
    return null;
  }
  return task;
}

function setActiveTask(id) {
  if (activeTaskId === id) {
    saveActiveTask(null);
    return;
  }
  const target = id ? todos.find((t) => t.id === id) : null;
  if (target && target.done) return; // a finished task can't be the focus
  saveActiveTask(id);
}

function updateCurrentTaskDisplay() {
  const task = getActiveTask();
  const fallback = !task ? todos.find((t) => !t.done) : null;
  const displayTask = task || fallback;
  // Pomodoro tab title area
  const pomTaskName = document.getElementById("pomodoroTaskName");
  if (pomTaskName) {
    pomTaskName.textContent = displayTask
      ? displayTask.title
      : "No active task";
    pomTaskName.className =
      "font-mono text-xs font-semibold tracking-wider mt-2 " +
      (displayTask ? "text-primary" : "text-outline");
  }
  // Pomodoro tab card
  const titleEl = document.querySelector(
    "#currentTaskDisplay .current-task-text",
  );
  const pomoEl = document.getElementById("currentTaskPomo");
  const projectTag = document.getElementById("activeProjectTag");
  if (titleEl) {
    if (displayTask) {
      titleEl.textContent = displayTask.title;
      titleEl.style.opacity = "1";
      if (projectTag) {
        if (displayTask.project) {
          projectTag.classList.remove("hidden");
          projectTag.textContent = "#" + displayTask.project;
        } else {
          projectTag.classList.add("hidden");
        }
      }
      if (pomoEl) {
        const done = displayTask.pomodoros || 0;
        const est = displayTask.estPomodoros || 0;
        pomoEl.textContent = est > 0 ? done + "/" + est : String(done);
      }
    } else {
      titleEl.textContent = "No tasks yet — add one to get started";
      titleEl.style.opacity = "0.6";
      if (projectTag) projectTag.classList.add("hidden");
      if (pomoEl) pomoEl.textContent = "0";
    }
  }
  // Dashboard timer widget card
  const dashTitle = document.getElementById("dashActiveTitle");
  const dashPomo = document.getElementById("dashActivePomo");
  if (dashTitle) {
    if (displayTask) {
      dashTitle.textContent = displayTask.title;
      dashTitle.style.opacity = "1";
      if (dashPomo) {
        const done = displayTask.pomodoros || 0;
        const est = displayTask.estPomodoros || 0;
        dashPomo.textContent =
          est > 0 ? done + "/" + est + " pomos" : done + " pomos";
      }
    } else {
      dashTitle.textContent = "No tasks yet";
      dashTitle.style.opacity = "0.6";
      if (dashPomo) dashPomo.textContent = "";
    }
  }
  if (pipWindow && !pipWindow.closed) {
    const el = pipWindow.document.getElementById("pipCurrentTask");
    if (el) el.textContent = displayTask ? "▶ " + displayTask.title : "";
  }
}

/* ===== Dashboard Stats ===== */
function updateDashboardStats() {
  const dashPomos = document.getElementById("dashPomos");
  const dashTasks = document.getElementById("dashTasks");
  const dashGolden = document.getElementById("dashGolden");
  const dashGoldenTitle = document.getElementById("dashGoldenTitle");
  const dashFocusBtn = document.getElementById("dashFocusBtn");
  const dashGoldenPomos = document.getElementById("dashGoldenPomos");

  if (dashPomos) {
    const history = loadHistory();
    dashPomos.textContent = history.length;
  }
  if (dashTasks) {
    const done = todos.filter((t) => t.done).length;
    dashTasks.textContent = done;
  }
  if (dashGolden) {
    const golden = todos.find((t) => t.id === goldenTaskId && !t.done);
    const dashGoldenSub = dashGolden.querySelector(".golden-sub");
    if (golden) {
      if (dashGoldenTitle) dashGoldenTitle.textContent = golden.title;
      if (dashGoldenSub)
        dashGoldenSub.textContent =
          golden.description || "Focus on your golden task!";
      if (dashFocusBtn) dashFocusBtn.classList.remove("hidden");
      if (dashGoldenPomos) {
        const est = golden.estPomodoros || 0;
        dashGoldenPomos.textContent = `EST. ${est} POMOS`;
        dashGoldenPomos.classList.toggle("hidden", est === 0);
      }
    } else {
      if (dashGoldenTitle) dashGoldenTitle.textContent = "No golden task set";
      if (dashGoldenSub)
        dashGoldenSub.textContent = "Mark a task as golden ⭐ to see it here.";
      if (dashFocusBtn) dashFocusBtn.classList.add("hidden");
      if (dashGoldenPomos) dashGoldenPomos.classList.add("hidden");
    }
  }
}

/* ===== Golden Task ===== */
function loadGoldenTask() {
  return localStorage.getItem("goldenTaskId") || null;
}

function saveGoldenTask(id) {
  goldenTaskId = id;
  if (id) {
    localStorage.setItem("goldenTaskId", id);
  } else {
    localStorage.removeItem("goldenTaskId");
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
  const task = todos.find((t) => t.id === goldenTaskId && !t.done);
  if (!task) saveGoldenTask(null);
}

const TAG_COLORS = [
  "#ff6b6b",
  "#feca57",
  "#48dbfb",
  "#ff9ff3",
  "#54a0ff",
  "#5f27cd",
  "#01a3a4",
  "#f368e0",
  "#ff9f43",
  "#10ac84",
  "#ee5a24",
  "#0abde3",
  "#a29bfe",
  "#fd79a8",
  "#6c5ce7",
  "#00b894",
  "#e17055",
  "#00cec9",
  "#e056fd",
  "#badc58",
];

function calcNextDue(dueDate, frequency) {
  if (!dueDate || frequency === "none") return null;
  const d = new Date(dueDate + "T00:00:00");
  if (frequency === "daily") d.setDate(d.getDate() + 1);
  else if (frequency === "weekly") d.setDate(d.getDate() + 7);
  else if (frequency === "monthly") d.setMonth(d.getMonth() + 1);
  else if (frequency === "yearly") d.setFullYear(d.getFullYear() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getTagColorMap() {
  const tags = extractTags();
  const map = {};
  let ci = 0;
  tags.forEach((tag) => {
    map[tag] = TAG_COLORS[ci % TAG_COLORS.length];
    ci++;
  });
  return map;
}

function parseDueInfo(todo) {
  if (!todo.dueDate) return null;
  const p = todo.dueDate.split("-");
  const due = new Date(+p[0], +p[1] - 1, +p[2]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
  let label;
  if (diff === 0) label = "Today";
  else if (diff === 1) label = "Tomorrow";
  else if (diff < 0) label = todo.dueDate;
  else label = todo.dueDate;
  return { date: due, label, overdue: due < today };
}

/* ===== Todo localStorage ===== */
function loadTodos() {
  try {
    const data = JSON.parse(localStorage.getItem("todos"));
    if (!Array.isArray(data)) return [];
    // Drop anything that can't be repaired rather than letting one bad entry
    // throw and wipe the whole list.
    return data
      .map((entry) => {
        try {
          return migrateTodo(entry);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function saveTodos() {
  localStorage.setItem("todos", JSON.stringify(todos));
}

/* Single definition of a task's shape. Previously this literal was repeated in
   four places, which is how `subtasks` came to be missing from some of them. */
function makeTodo(fields = {}) {
  return {
    id: crypto.randomUUID(),
    title: "Untitled",
    description: "",
    dueDate: null,
    priority: "none",
    project: "",
    frequency: "none",
    tags: [],
    done: false,
    completedAt: null,
    createdAt: Date.now(),
    pomodoros: 0,
    estPomodoros: 0,
    wasGolden: false,
    subtasks: [],
    // Calendar time blocks: { id, date: 'YYYY-MM-DD', start: 'HH:MM', end: 'HH:MM' }.
    // A task can carry any number of them; `dueDate` stays the deadline.
    schedule: [],
    ...fields,
  };
}

function migrateTodo(old) {
  if (!old || typeof old !== "object") return null;
  if (old.id) {
    if (old.pomodoros === undefined) old.pomodoros = 0;
    if (old.wasGolden === undefined) old.wasGolden = false;
    if (!Array.isArray(old.subtasks)) old.subtasks = [];
    if (!Array.isArray(old.schedule)) old.schedule = [];
    if (!Array.isArray(old.tags)) old.tags = [];
    if (typeof old.title !== "string") old.title = String(old.title ?? "Untitled");
    old.done = !!old.done;
    return old;
  }
  // Pre-id format: the title lived in `text`.
  if (typeof old.text !== "string") return null;
  const tags = [];
  let text = old.text;
  const tagMatches = text.match(/#([\w-]+)/g);
  if (tagMatches) {
    tagMatches.forEach((m) => {
      tags.push(m.slice(1));
      text = text.replace(m, "").trim();
    });
  }
  let dueDate = null;
  const dueMatch = text.match(
    /@Due\[(today|tomorrow|\d{1,2}\/\d{1,2}\/\d{2,4})\]/i,
  );
  if (dueMatch) {
    const raw = dueMatch[1].toLowerCase();
    if (raw === "today") {
      const d = new Date();
      dueDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    } else if (raw === "tomorrow") {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      dueDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    } else {
      const p = raw.split("/");
      const d = new Date(
        p[2].length === 2 ? 2000 + +p[2] : +p[2],
        +p[1] - 1,
        +p[0],
      );
      dueDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    text = text.replace(dueMatch[0], "").trim();
  }
  text = text.replace(/@(Today|Tomorrow)\b/gi, "").trim();
  text = text.replace(/@(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g, "").trim();
  text = text.replace(/#CompleteOn\[\d{2}\/\d{2}\/\d{2}\]/g, "").trim();
  return makeTodo({
    title: text || "Untitled",
    dueDate,
    tags,
    done: !!old.done,
  });
}

/* ===== Subtasks =====
   Checklist items owned by a task. Pomodoros stay on the parent — subtasks
   only carry a done flag. */
const expandedSubtasks = new Set(); // task-list panels
const dashExpandedSubtasks = new Set(); // dashboard "Up Next" panels, tracked separately
// so the dashboard can stay compact
let pendingSubtaskFocus = null;

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

function getSubtasks(todo) {
  if (!Array.isArray(todo.subtasks)) todo.subtasks = [];
  return todo.subtasks;
}

function subtaskProgress(todo) {
  const subs = getSubtasks(todo);
  return { done: subs.filter((s) => s.done).length, total: subs.length };
}

function makeSubtask(title) {
  return { id: crypto.randomUUID(), title, done: false, createdAt: Date.now() };
}

function afterSubtaskChange() {
  saveTodos();
  renderTodos();
  renderDashboardUpNext();
}

function toggleSubtaskPanel(id) {
  if (expandedSubtasks.has(id)) expandedSubtasks.delete(id);
  else expandedSubtasks.add(id);
  renderTodos();
}

function addSubtask(todo, title) {
  const t = title.trim();
  if (!t) return;
  getSubtasks(todo).push(makeSubtask(t));
  expandedSubtasks.add(todo.id);
  pendingSubtaskFocus = todo.id;
  afterSubtaskChange();
}

function toggleSubtaskDone(todo, subId, done) {
  const sub = getSubtasks(todo).find((s) => s.id === subId);
  if (!sub) return;
  sub.done = done;
  sub.completedAt = done ? Date.now() : null;
  delete sub.autoDone; // an explicit tick is no longer a cascade from the parent
  afterSubtaskChange();
}

function deleteSubtask(todo, subId) {
  const subs = getSubtasks(todo);
  const idx = subs.findIndex((s) => s.id === subId);
  if (idx === -1) return;
  const [removed] = subs.splice(idx, 1);
  afterSubtaskChange();
  showToast(`Deleted "${removed.title}"`, () => {
    getSubtasks(todo).splice(idx, 0, removed);
    afterSubtaskChange();
  });
}

function renameSubtask(todo, subId, title) {
  const sub = getSubtasks(todo).find((s) => s.id === subId);
  if (!sub) return;
  const next = title.trim().slice(0, 200);
  if (!next || next === sub.title) return;
  sub.title = next;
  afterSubtaskChange();
}

/* Swaps a subtask's label for a text field in place: Enter or blur commits,
   Escape restores. Written against a label element rather than a specific list
   so the task-list checklist and the dashboard's Up Next checklist share it —
   both re-render wholesale afterwards, which is what removes the input. */
function beginInlineSubtaskEdit(todo, sub, labelEl) {
  if (!labelEl || !labelEl.parentNode) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "subtask-edit-input";
  input.value = sub.title;
  input.maxLength = 200;
  input.setAttribute("aria-label", "Rename subtask");
  labelEl.replaceWith(input);
  input.focus();
  input.select();

  // Enter commits then re-renders, which blurs the input — without this guard
  // the blur handler would run a second commit against a detached field.
  let settled = false;
  const finish = (save) => {
    if (settled) return;
    settled = true;
    const next = input.value.trim().slice(0, 200);
    // Repaint on every exit, including a no-op edit — otherwise the field is
    // left sitting there with no label to fall back to.
    if (save && next && next !== sub.title) renameSubtask(todo, sub.id, next);
    else afterSubtaskChange();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // don't also close the surrounding dialog/panel
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("click", (e) => e.stopPropagation());
}

function renderTagsList(tags, tagColors) {
  return tags
    .map((t) => {
      const c = tagColors[t.toLowerCase()] || TAG_COLORS[0];
      return `<span class="tag" style="background:${c}33;color:${c}">${escapeHtml(t)}</span>`;
    })
    .join("");
}

function extractTags() {
  const set = new Set();
  todos.forEach((t) =>
    (t.tags || []).forEach((tag) => set.add(tag.toLowerCase())),
  );
  todos.forEach((t) => {
    if (t.project) set.add("project:" + t.project.toLowerCase());
  });
  return [...set].sort();
}

/* A tag key is either a plain tag or the internal `project:NAME` form. */
function isProjectKey(key) {
  return key.startsWith("project:");
}

/* What the user sees on a pill. The `project:` prefix is an implementation
   detail of the filter key, so it never reaches the label. */
function tagDisplayLabel(key) {
  return isProjectKey(key) ? key.slice(8) : key;
}

function tagTaskCount(key, pendingOnly) {
  return todos.filter((td) => {
    if (pendingOnly && td.done) return false;
    return isProjectKey(key)
      ? !!td.project && td.project.toLowerCase() === key.slice(8)
      : (td.tags || []).some((tag) => tag.toLowerCase() === key);
  }).length;
}

function tagHasPending(key) {
  return tagTaskCount(key, true) > 0;
}

/* Pills carry their colour inline (one hue per tag), so the selected state has to
   be painted inline too — an inline border-color would otherwise outrank any
   stylesheet rule. `.active` still drives the ✓ and the weight. */
function tagPillHtml(key, colorMap, showCount) {
  const c = colorMap[key];
  const active = tagFilter === key;
  const label = tagDisplayLabel(key);
  const style = c
    ? `style="background:${c}${active ? "38" : "22"};color:${c};border-color:${active ? c : c + "44"}${active ? `;box-shadow:0 0 0 2px ${c}55` : ""}"`
    : "";
  const count = showCount
    ? ` <span class="count">${tagTaskCount(key, false)}</span>`
    : "";
  return `<span class="tag-pill${active ? " active" : ""}" data-tag="${escapeHtml(key)}" role="button" tabindex="0" aria-pressed="${active}" title="${active ? "Selected — click to clear" : "Filter by " + escapeHtml(label)}" ${style}>${escapeHtml(label)}${count}</span>`;
}

function renderTagCloud() {
  const tags = extractTags();
  const colorMap = getTagColorMap();
  // Anything with no open work left drops out; the active filter is kept so it
  // never becomes impossible to see (or clear) what is being filtered on.
  const live = tags.filter((t) => tagHasPending(t) || t === tagFilter);

  const tagCloudEl = document.getElementById("tagCloud");
  if (tagCloudEl)
    tagCloudEl.innerHTML = live
      .map((t) => tagPillHtml(t, colorMap, true))
      .join("");

  // Sidebar tag clouds
  const sidebarCloud = document.getElementById("tagCloudSidebar");
  const sidebarTags = document.getElementById("tagCloudTags");
  const projectTags = live.filter(isProjectKey);
  const regularTags = live.filter((t) => !isProjectKey(t));
  if (sidebarCloud)
    sidebarCloud.innerHTML = projectTags
      .map((t) => tagPillHtml(t, colorMap, false))
      .join("");
  if (sidebarTags)
    sidebarTags.innerHTML =
      regularTags.map((t) => tagPillHtml(t, colorMap, false)).join("") ||
      '<span class="tag-cloud-empty">No tags on open tasks</span>';
  // Projects disappear once none of them has open work left — there's nothing to
  // focus on. Tags keep their section either way: it is the other half of the
  // filter, and hiding it made the feature look like it had been removed. The
  // empty state says why the list is short instead.
  const projectBlock = document.getElementById("projectFocusBlock");
  if (projectBlock)
    projectBlock.classList.toggle("hidden", projectTags.length === 0);

  // Filter read-out — names what's selected and offers the way back out.
  const clearBtn = document.getElementById("tagFilterClear");
  if (clearBtn) {
    clearBtn.classList.toggle("hidden", !tagFilter);
    const label = document.getElementById("tagFilterClearLabel");
    if (label && tagFilter)
      label.textContent = `Clear: ${tagDisplayLabel(tagFilter)}`;
  }

  // Focus Score
  const total = todos.filter((t) => !t.done).length;
  const done = todos.filter((t) => t.done).length;
  const all = total + done;
  const score = all > 0 ? Math.round((done / all) * 100) : 0;
  const focusPct = document.getElementById("focusScorePct");
  const focusBar = document.getElementById("focusScoreBar");
  const focusText = document.getElementById("focusScoreText");
  if (focusPct) focusPct.textContent = score + "%";
  if (focusBar) focusBar.style.width = score + "%";
  // Spelling out the two numbers behind the percentage is most of the
  // explanation; the info button next to the label covers the rest.
  if (focusText)
    focusText.textContent =
      all === 0
        ? "Add a task to start scoring"
        : `${done} of ${all} tasks complete` +
          (score >= 80 ? " — crushing it!" : "");
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
  if (tagFilter.startsWith("project:")) {
    const proj = tagFilter.slice(8);
    return todo.project && todo.project.toLowerCase() === proj;
  }
  return (todo.tags || []).some((t) => t.toLowerCase() === tagFilter);
}

/* Toggle a task's done state, handling golden-task clearing and recurrence.
   Shared by the task list checkbox and the dashboard quick-complete button. */
function toggleTodoDone(todo, done) {
  if (!todo) return;
  todo.done = done;
  todo.completedAt = done ? Date.now() : null;
  // Completing a task closes out its checklist. Un-completing reopens only the
  // subtasks that were auto-closed — never ones the user ticked themselves.
  const subs = getSubtasks(todo);
  if (done) {
    subs.forEach((s) => {
      if (!s.done) {
        s.done = true;
        s.autoDone = true;
      }
    });
  } else {
    subs.forEach((s) => {
      if (s.autoDone) {
        s.done = false;
        s.completedAt = null;
        delete s.autoDone;
      }
    });
  }
  // Completing the focused task drops it out of the Pomodoro view.
  if (done && todo.id === activeTaskId) saveActiveTask(null);
  if (done && todo.id === goldenTaskId) {
    todo.wasGolden = true;
    saveGoldenTask(null);
  }
  if (done && todo.frequency && todo.frequency !== "none") {
    const nextDue = calcNextDue(todo.dueDate, todo.frequency);
    if (nextDue) {
      todos.push(
        makeTodo({
          title: todo.title,
          description: todo.description,
          dueDate: nextDue,
          priority: todo.priority,
          project: todo.project,
          frequency: todo.frequency,
          tags: [...(todo.tags || [])],
          estPomodoros: todo.estPomodoros || 0,
          subtasks: getSubtasks(todo).map((s) => makeSubtask(s.title)),
        }),
      );
    }
  }
  saveTodos();
  renderTagCloud();
  renderTodos();
  renderDashboardUpNext();
  updateDashboardStats();
  renderStats();
  // Last, so it sees the final task list: any recurrence clone now exists, and
  // the Pomodoro's fallback task is re-picked if the completed one was showing.
  updateCurrentTaskDisplay();
}

function renderTodoItem(todo, tagColors, showCompleted) {
  const origIndex = todos.indexOf(todo);
  const li = document.createElement("li");
  if (todo.done) li.classList.add("completed");
  if (!todo.done && todo.id === goldenTaskId) li.classList.add("golden");

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = todo.done;
  cb.addEventListener("change", () => {
    toggleTodoDone(todos[origIndex], cb.checked);
  });

  const content = document.createElement("div");
  content.className = "task-content";

  const titleRow = document.createElement("div");
  titleRow.className = "task-title-row";

  const titleSpan = document.createElement("span");
  titleSpan.className = "task-text";
  titleSpan.textContent = todo.title;
  titleRow.appendChild(titleSpan);

  const badges = document.createElement("div");
  badges.className = "task-badges";

  if (todo.priority && todo.priority !== "none") {
    const pBadge = document.createElement("span");
    pBadge.className = `priority-badge ${todo.priority}`;
    pBadge.textContent = todo.priority;
    badges.appendChild(pBadge);
  }

  if (todo.project) {
    const projBadge = document.createElement("span");
    projBadge.className = "project-badge";
    projBadge.textContent = todo.project;
    badges.appendChild(projBadge);
  }

  if (todo.frequency && todo.frequency !== "none") {
    const freqBadge = document.createElement("span");
    freqBadge.className = "freq-badge";
    freqBadge.textContent = "🔄 " + todo.frequency;
    badges.appendChild(freqBadge);
  }

  const subProgress = subtaskProgress(todo);
  if (subProgress.total > 0) {
    const stBadge = document.createElement("button");
    const allDone = subProgress.done === subProgress.total;
    stBadge.className = "subtask-badge" + (allDone ? " complete" : "");
    stBadge.textContent = `☑ ${subProgress.done}/${subProgress.total}`;
    stBadge.setAttribute("aria-label", "Show subtasks");
    stBadge.setAttribute(
      "aria-expanded",
      expandedSubtasks.has(todo.id) ? "true" : "false",
    );
    stBadge.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSubtaskPanel(todo.id);
    });
    badges.appendChild(stBadge);
  }

  const dueInfo = parseDueInfo(todo);
  if (dueInfo) {
    const badge = document.createElement("span");
    badge.className =
      "due-badge" + (dueInfo.overdue && !todo.done ? " overdue" : "");
    badge.textContent = "📅 " + dueInfo.label;
    badges.appendChild(badge);
  }

  if (showCompleted && todo.completedAt) {
    const completedBadge = document.createElement("span");
    completedBadge.className = "completed-badge";
    const d = new Date(todo.completedAt);
    completedBadge.textContent = "✓ " + d.toLocaleDateString();
    badges.appendChild(completedBadge);
  }

  if (badges.children.length > 0) {
    titleRow.appendChild(badges);
  }

  content.appendChild(titleRow);

  if (todo.tags && todo.tags.length > 0) {
    const tagsRow = document.createElement("div");
    tagsRow.className = "task-tags-row";
    tagsRow.innerHTML = renderTagsList(todo.tags, tagColors);
    content.appendChild(tagsRow);
  }

  if (todo.description) {
    const desc = document.createElement("div");
    desc.className = "task-desc";
    desc.textContent = todo.description;
    content.appendChild(desc);
  }

  if (expandedSubtasks.has(todo.id)) {
    content.appendChild(buildSubtaskPanel(todo));
  }

  const actionsRow = document.createElement("div");
  actionsRow.className = "task-actions-row";

  const goldenBtn = document.createElement("button");
  goldenBtn.className =
    "golden-btn" + (todo.id === goldenTaskId ? " active" : "");
  goldenBtn.textContent = "⭐";
  goldenBtn.setAttribute("aria-label", "Mark as golden task");
  goldenBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (goldenTaskId && goldenTaskId !== todo.id) {
      const current = todos.find((t) => t.id === goldenTaskId && !t.done);
      if (
        current &&
        !(await showConfirmModal(
          `"${current.title}" is your golden task. Make "${todo.title}" the golden task instead?`,
        ))
      )
        return;
    }
    toggleGoldenTask(todo.id);
  });
  actionsRow.appendChild(goldenBtn);

  // No focus button on a finished task — there's nothing left to work on.
  if (!todo.done) {
    const playBtn = document.createElement("button");
    playBtn.className = "play-btn";
    playBtn.innerHTML = todo.id === activeTaskId ? "⏹" : "▶";
    playBtn.setAttribute("aria-label", "Focus on this task");
    playBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (activeTaskId && activeTaskId !== todo.id) {
        const current = getActiveTask();
        if (
          !(await showConfirmModal(
            `You're focusing on "${current ? current.title : "a task"}". Switch to "${todo.title}"?`,
          ))
        )
          return;
      }
      setActiveTask(todo.id);
    });
    actionsRow.appendChild(playBtn);
  }

  const subBtn = document.createElement("button");
  subBtn.className =
    "subtask-toggle-btn" + (expandedSubtasks.has(todo.id) ? " active" : "");
  subBtn.textContent = "☑";
  subBtn.setAttribute("aria-label", "Subtasks");
  subBtn.title = subProgress.total > 0 ? "Subtasks" : "Add subtasks";
  subBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSubtaskPanel(todo.id);
  });
  actionsRow.appendChild(subBtn);

  const pomoBadge = document.createElement("span");
  pomoBadge.className = "task-pomo-count";
  const est = todo.estPomodoros || 0;
  if (est > 0) {
    const done = todo.pomodoros || 0;
    pomoBadge.innerHTML = `🍅 <span class="est-pomo-done">${done}</span><span class="est-pomo-sep">/</span>${est}`;
  } else {
    pomoBadge.textContent = "🍅 " + (todo.pomodoros || 0);
  }
  actionsRow.appendChild(pomoBadge);

  const editBtn = document.createElement("button");
  editBtn.textContent = "✏";
  editBtn.setAttribute("aria-label", "Edit task");
  editBtn.addEventListener("click", () => openEditModal(origIndex));
  actionsRow.appendChild(editBtn);

  const del = document.createElement("button");
  del.textContent = "✕";
  del.setAttribute("aria-label", "Delete task");
  del.addEventListener("click", () => {
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

  const grip = document.createElement("span");
  grip.className = "drag-handle";
  grip.textContent = "⠿";
  li.appendChild(grip);
  li.appendChild(cb);
  li.appendChild(content);

  // Drag is disabled while the subtask panel is open so its inputs stay usable.
  li.draggable =
    !tagFilter &&
    !searchQuery.trim() &&
    sortBy === "custom" &&
    !todo.done &&
    !expandedSubtasks.has(todo.id);
  li.dataset.index = origIndex;

  todoList.appendChild(li);

  if (pendingSubtaskFocus === todo.id) {
    pendingSubtaskFocus = null;
    const input = li.querySelector(".subtask-input");
    if (input) input.focus();
  }
}

function buildSubtaskPanel(todo) {
  const subs = getSubtasks(todo);
  const panel = document.createElement("div");
  panel.className = "subtask-panel";

  if (subs.length > 0) {
    const { done, total } = subtaskProgress(todo);
    const track = document.createElement("div");
    track.className = "subtask-progress";
    const fill = document.createElement("div");
    fill.className = "subtask-progress-fill";
    fill.style.width = Math.round((done / total) * 100) + "%";
    track.appendChild(fill);
    panel.appendChild(track);
  }

  const ul = document.createElement("ul");
  ul.className = "subtask-list";
  subs.forEach((sub) => {
    const li = document.createElement("li");
    li.className = "subtask-item" + (sub.done ? " done" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!sub.done;
    cb.setAttribute("aria-label", `Mark subtask "${sub.title}" done`);
    cb.addEventListener("change", () =>
      toggleSubtaskDone(todo, sub.id, cb.checked),
    );

    const text = document.createElement("span");
    text.className = "subtask-text";
    text.textContent = sub.title;
    text.title = "Click to rename";
    text.setAttribute("role", "button");
    text.tabIndex = 0;
    const edit = (e) => {
      e.stopPropagation();
      beginInlineSubtaskEdit(todo, sub, text);
    };
    text.addEventListener("click", edit);
    text.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        edit(e);
      }
    });

    const del = document.createElement("button");
    del.className = "subtask-del";
    del.textContent = "✕";
    del.setAttribute("aria-label", `Delete subtask "${sub.title}"`);
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSubtask(todo, sub.id);
    });

    li.append(cb, text, del);
    ul.appendChild(li);
  });
  if (subs.length === 0) {
    const empty = document.createElement("li");
    empty.className = "subtask-empty";
    empty.textContent = "No subtasks yet — break this task down below.";
    ul.appendChild(empty);
  }
  panel.appendChild(ul);

  const addRow = document.createElement("div");
  addRow.className = "subtask-add";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "subtask-input";
  input.placeholder = "Add a subtask…";
  input.maxLength = 200;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addSubtask(todo, input.value);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      input.value = "";
      input.blur();
    }
  });
  const addBtn = document.createElement("button");
  addBtn.className = "subtask-add-btn";
  addBtn.textContent = "Add";
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    addSubtask(todo, input.value);
  });
  addRow.append(input, addBtn);
  panel.appendChild(addRow);

  return panel;
}

function getDueGroup(todo) {
  if (!todo.dueDate) return "none";
  const p = todo.dueDate.split("-");
  const due = new Date(+p[0], +p[1] - 1, +p[2]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff <= 7) return "week";
  return "later";
}

function renderTodos() {
  const q = searchQuery.trim().toLowerCase();
  let filtered = tagFilter
    ? todos.filter((t) => matchesTagFilter(t, tagFilter))
    : todos;
  if (q)
    filtered = filtered.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        getSubtasks(t).some((s) => s.title.toLowerCase().includes(q)),
    );

  const pending = filtered.filter((t) => !t.done);
  const completed = filtered.filter((t) => t.done);

  const tagColors = getTagColorMap();

  const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

  if (sortBy === "custom") {
    pending.sort((a, b) => {
      if (a.id === goldenTaskId) return -1;
      if (b.id === goldenTaskId) return 1;
      return 0;
    });
  } else if (sortBy === "date") {
    pending.sort((a, b) => {
      if (a.id === goldenTaskId) return -1;
      if (b.id === goldenTaskId) return 1;
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    });
  } else if (sortBy === "priority") {
    pending.sort((a, b) => {
      if (a.id === goldenTaskId) return -1;
      if (b.id === goldenTaskId) return 1;
      const pa = priorityOrder[a.priority] ?? 4;
      const pb = priorityOrder[b.priority] ?? 4;
      return pa - pb;
    });
  } else if (sortBy === "title") {
    pending.sort((a, b) => {
      if (a.id === goldenTaskId) return -1;
      if (b.id === goldenTaskId) return 1;
      return a.title.localeCompare(b.title);
    });
  }

  const canDrag = !tagFilter && !q && sortBy === "custom";

  todoList.innerHTML = "";

  // stat bar
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  let overdueCount = 0,
    todayCount = 0;
  pending.forEach((t) => {
    if (!t.dueDate) return;
    const p = t.dueDate.split("-");
    const due = new Date(+p[0], +p[1] - 1, +p[2]);
    due.setHours(0, 0, 0, 0);
    const diff = Math.ceil((due - now) / 86400000);
    if (diff < 0) overdueCount++;
    if (diff === 0) todayCount++;
  });
  const statHtml = [];
  if (overdueCount > 0)
    statHtml.push(
      `<span class="task-stat overdue" data-filter="overdue">⚠ ${overdueCount} overdue</span>`,
    );
  if (todayCount > 0)
    statHtml.push(
      `<span class="task-stat" data-filter="today">📅 ${todayCount} today</span>`,
    );
  statHtml.push(
    `<span class="task-stat" data-filter="all">${pending.length} total</span>`,
  );
  if (taskStatBar) {
    taskStatBar.innerHTML = statHtml.join("");
    taskStatBar.querySelectorAll(".task-stat").forEach((el) => {
      el.addEventListener("click", () => {
        const f = el.dataset.filter;
        if (f === "overdue") {
          const now2 = new Date();
          now2.setHours(0, 0, 0, 0);
          const ov = pending.filter((t) => {
            if (!t.dueDate) return false;
            const p2 = t.dueDate.split("-");
            const d2 = new Date(+p2[0], +p2[1] - 1, +p2[2]);
            d2.setHours(0, 0, 0, 0);
            return d2 < now2;
          });
          todoList.innerHTML = "";
          ov.forEach((t) => renderTodoItem(t, tagColors, false));
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
    const hdr = document.createElement("li");
    hdr.className = "due-section-header" + (cls ? " " + cls : "");
    hdr.innerHTML = `${label} <span class="due-count">${items.length}</span>`;
    todoList.appendChild(hdr);
    items.forEach((t) => renderTodoItem(t, tagColors, false));
  }

  if (sortBy === "date") {
    const groups = {
      overdue: [],
      today: [],
      tomorrow: [],
      week: [],
      later: [],
      none: [],
    };
    pending.forEach((t) => {
      groups[getDueGroup(t)].push(t);
    });
    addSection("Overdue", groups.overdue, "overdue");
    addSection("Today", groups.today);
    addSection("Tomorrow", groups.tomorrow);
    addSection("This Week", groups.week);
    addSection("Later", groups.later);
    addSection("No Date", groups.none);
  } else {
    pending.forEach((todo) => renderTodoItem(todo, tagColors, false));
  }

  // Completed tasks
  if (showCompleted && completed.length > 0) {
    const groups = {};
    completed.forEach((todo) => {
      const completedAt = todo.completedAt || todo.createdAt || 0;
      const key = localDateKey(new Date(completedAt));
      if (!groups[key]) groups[key] = [];
      groups[key].push(todo);
    });

    const dateKeys = Object.keys(groups).sort().reverse();
    const totalPages = Math.ceil(dateKeys.length / 2);
    if (completedPage >= totalPages) completedPage = totalPages - 1;
    if (completedPage < 0) completedPage = 0;

    const today = localDateKey(new Date());
    const yesterday = localDateKey(new Date(Date.now() - 86400000));
    const startIdx = completedPage * 2;

    dateKeys.slice(startIdx, startIdx + 2).forEach((dateKey) => {
      const date = new Date(dateKey + "T00:00:00");
      let label;
      if (dateKey === today) label = "Today";
      else if (dateKey === yesterday) label = "Yesterday";
      else label = date.toLocaleDateString();

      const separator = document.createElement("li");
      separator.className = "completed-section-header";
      const sepSpan = document.createElement("span");
      sepSpan.textContent = label;
      separator.appendChild(sepSpan);
      todoList.appendChild(separator);

      groups[dateKey].forEach((todo) => renderTodoItem(todo, tagColors, true));
    });

    if (totalPages > 1) {
      const nav = document.createElement("li");
      nav.className = "completed-pagination";

      const prevBtn = document.createElement("button");
      prevBtn.textContent = "← Newer";
      prevBtn.disabled = completedPage === 0;
      prevBtn.addEventListener("click", () => {
        completedPage--;
        renderTodos();
      });

      const pageInfo = document.createElement("span");
      pageInfo.textContent = `${completedPage + 1} / ${totalPages}`;

      const nextBtn = document.createElement("button");
      nextBtn.textContent = "Older →";
      nextBtn.disabled = completedPage >= totalPages - 1;
      nextBtn.addEventListener("click", () => {
        completedPage++;
        renderTodos();
      });

      nav.appendChild(prevBtn);
      nav.appendChild(pageInfo);
      nav.appendChild(nextBtn);
      todoList.appendChild(nav);
    }
  }

  const toggleBtn = document.getElementById("completedToggle");
  if (completed.length > 0) {
    toggleBtn.textContent = showCompleted
      ? "Hide completed"
      : `Show completed (${completed.length})`;
    toggleBtn.classList.remove("hidden");
  } else {
    toggleBtn.classList.add("hidden");
  }
  updateDashboardStats();
  renderDashboardUpNext();
  renderScheduleSurfaces();
}

/* ===== Modal ===== */
function openAddModal() {
  modalTitle.textContent = "Add Task";
  editId.value = "";
  taskTitle.value = "";
  taskDescription.value = "";
  taskDue.value = "";
  taskPriority.value = "none";
  taskProject.value = "";
  taskFrequency.value = "none";
  taskEstPomodoros.value = "0";
  tagsList = [];
  renderTagChips();
  subtasksDraft = [];
  renderModalSubtasks();
  scheduleDraft = [];
  renderModalSchedule();
  taskModal.classList.remove("hidden");
  taskTitle.focus();
}

function openEditModal(index) {
  const todo = todos[index];
  if (!todo) return;
  modalTitle.textContent = "Edit Task";
  editId.value = index;
  taskTitle.value = todo.title;
  taskDescription.value = todo.description || "";
  taskDue.value = todo.dueDate || "";
  taskPriority.value = todo.priority || "none";
  taskProject.value = todo.project || "";
  taskFrequency.value = todo.frequency || "none";
  taskEstPomodoros.value = todo.estPomodoros || 0;
  tagsList = [...(todo.tags || [])];
  renderTagChips();
  subtasksDraft = getSubtasks(todo).map((s) => ({ ...s }));
  renderModalSubtasks();
  scheduleDraft = taskSchedule(todo).map((b) => ({ ...b }));
  renderModalSchedule();
  taskModal.classList.remove("hidden");
  taskTitle.focus();
}

function closeModal() {
  taskModal.classList.add("hidden");
}

function saveModal() {
  const title = taskTitle.value.trim();
  if (!title) {
    taskTitle.focus();
    return;
  }

  // A tag typed into the field but never committed with Enter used to be thrown
  // away without a word. Nobody reliably presses Enter before hitting Save, and
  // this was the main reason tags "didn't work".
  commitPendingTag();

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
    subtasks: subtasksDraft
      .map((s) => ({ ...s, title: s.title.trim() }))
      .filter((s) => s.title),
    // Half-filled rows are dropped rather than saved as broken blocks. An end
    // date left behind the start date would silently yield no occurrences at all,
    // so it's cleared rather than kept.
    schedule: scheduleDraft
      .filter(isValidBlock)
      .map((b) => (b.until && b.until < b.date ? { ...b, until: null } : b))
      .sort(
        (a, b) =>
          (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
          (calMinutes(a.start) ?? 0) - (calMinutes(b.start) ?? 0),
      ),
  };

  const editIdx = editId.value;
  if (editIdx !== "") {
    Object.assign(todos[parseInt(editIdx)], data);
  } else {
    todos.push(makeTodo(data));
  }

  saveTodos();
  closeModal();
  renderTagCloud();
  renderTodos();
}

function addTag(tag) {
  const t = tag.trim().replace(/^#/, "");
  if (t && !tagsList.includes(t)) {
    tagsList.push(t);
    renderTagChips();
  }
}

/* Turns whatever is sitting in the tag field into a chip. Called on blur and
   again on save, so a tag can't be lost by not pressing Enter. */
function commitPendingTag() {
  if (!taskTags || !taskTags.value.trim()) return;
  addTag(taskTags.value);
  taskTags.value = "";
}

function removeTag(tag) {
  tagsList = tagsList.filter((t) => t !== tag);
  renderTagChips();
}

function renderTagChips() {
  tagsContainer.innerHTML = tagsList
    .map(
      (t) =>
        `<span class="tag-chip">${escapeHtml(t)} <span class="tag-chip-remove" data-tag="${escapeHtml(t)}">&times;</span></span>`,
    )
    .join("");
  tagsContainer.querySelectorAll(".tag-chip-remove").forEach((el) => {
    el.addEventListener("click", () => removeTag(el.dataset.tag));
  });
}

/* ===== Modal Subtask Editor ===== */
function renderModalSubtasks() {
  if (!modalSubtaskList) return;
  modalSubtaskList.innerHTML = "";
  if (subtasksDraft.length === 0) {
    const empty = document.createElement("p");
    empty.className = "subtask-empty";
    empty.textContent = "No subtasks yet.";
    modalSubtaskList.appendChild(empty);
    return;
  }
  subtasksDraft.forEach((sub, i) => {
    const row = document.createElement("div");
    row.className = "modal-subtask-row" + (sub.done ? " done" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!sub.done;
    cb.setAttribute("aria-label", "Mark subtask done");
    cb.addEventListener("change", () => {
      subtasksDraft[i].done = cb.checked;
      delete subtasksDraft[i].autoDone;
      row.classList.toggle("done", cb.checked);
    });

    const input = document.createElement("input");
    input.type = "text";
    input.value = sub.title;
    input.className = "modal-subtask-title";
    input.setAttribute("aria-label", "Subtask title");
    input.addEventListener("input", () => {
      subtasksDraft[i].title = input.value;
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "subtask-del";
    del.textContent = "✕";
    del.setAttribute("aria-label", "Remove subtask");
    del.addEventListener("click", () => {
      subtasksDraft.splice(i, 1);
      renderModalSubtasks();
    });

    row.append(cb, input, del);
    modalSubtaskList.appendChild(row);
  });
}

/* ===== Modal Schedule Editor =====
   The repeatable rows are how a task gets more than one time block; the calendar
   grid's own modal only ever edits a single block. */
function renderModalSchedule() {
  if (!modalScheduleList) return;
  modalScheduleList.innerHTML = "";
  if (scheduleDraft.length === 0) {
    const empty = document.createElement("p");
    empty.className = "subtask-empty";
    empty.textContent = "Not scheduled yet.";
    modalScheduleList.appendChild(empty);
    return;
  }
  scheduleDraft.forEach((block, i) => {
    const row = document.createElement("div");
    row.className = "modal-schedule-row";

    const date = document.createElement("input");
    date.type = "date";
    date.value = block.date || "";
    date.setAttribute("aria-label", "Scheduled date");
    date.addEventListener("input", () => {
      scheduleDraft[i].date = date.value;
    });

    const start = document.createElement("input");
    start.type = "time";
    start.value = block.start || CAL_DEFAULT_START;
    start.setAttribute("aria-label", "Start time");
    start.addEventListener("input", () => {
      scheduleDraft[i].start = start.value;
    });

    const end = document.createElement("input");
    end.type = "time";
    end.value = block.end || "";
    end.setAttribute("aria-label", "End time");
    end.addEventListener("input", () => {
      scheduleDraft[i].end = end.value;
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "subtask-del";
    del.textContent = "✕";
    del.setAttribute("aria-label", "Remove this time block");
    del.addEventListener("click", () => {
      scheduleDraft.splice(i, 1);
      renderModalSchedule();
    });

    const sep = document.createElement("span");
    sep.className = "modal-schedule-sep";
    sep.textContent = "→";

    // Recurrence is editable here as well as on the calendar. Interval and end
    // date stay where they were set — this select never silently discards them.
    const repeat = document.createElement("select");
    repeat.className = "modal-schedule-repeat";
    repeat.setAttribute("aria-label", "Repeat");
    CAL_REPEATS.forEach((value) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = CAL_REPEAT_LABELS[value];
      repeat.appendChild(opt);
    });
    repeat.value = blockRepeat(block);
    repeat.addEventListener("change", () => {
      scheduleDraft[i].repeat = repeat.value;
      if (repeat.value === "none") {
        scheduleDraft[i].until = null;
        scheduleDraft[i].exdates = [];
      }
      renderModalSchedule();
    });

    row.append(date, start, sep, end, del, repeat);

    const rule = describeRepeat(block);
    if (rule) {
      const caption = document.createElement("p");
      caption.className = "modal-schedule-rule";
      caption.textContent = rule;
      row.appendChild(caption);
    }

    modalScheduleList.appendChild(row);
  });
}

function addModalScheduleRow() {
  // Seeded from the task's due date when it has one, so a deadline and its work
  // block don't have to be typed twice.
  const date = taskDue.value || localDateKey(new Date());
  const last = scheduleDraft[scheduleDraft.length - 1];
  const start = last && last.end ? last.end : CAL_DEFAULT_START;
  const startMins = calMinutes(start) ?? calMinutes(CAL_DEFAULT_START);
  scheduleDraft.push(
    makeScheduleBlock(
      date,
      calHHMM(startMins),
      calHHMM(Math.min(startMins + CAL_DEFAULT_MINUTES, 24 * 60 - 1)),
    ),
  );
  renderModalSchedule();
}

if (taskScheduleAdd)
  taskScheduleAdd.addEventListener("click", addModalScheduleRow);

function addModalSubtask() {
  if (!taskSubtaskInput) return;
  const val = taskSubtaskInput.value.trim();
  if (!val) return;
  subtasksDraft.push(makeSubtask(val));
  taskSubtaskInput.value = "";
  renderModalSubtasks();
  taskSubtaskInput.focus();
}

if (taskSubtaskAdd) taskSubtaskAdd.addEventListener("click", addModalSubtask);
if (taskSubtaskInput) {
  taskSubtaskInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addModalSubtask();
    }
  });
}

/* ===== Modal focus handling =====
   Keeps Tab inside an open dialog instead of letting it walk the page behind. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(container) {
  return [...container.querySelectorAll(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

function trapFocus(container, e) {
  const items = focusableIn(container);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/* ===== Confirm Modal ===== */
function showConfirmModal(message) {
  const overlay = document.getElementById("confirmModal");
  const msgEl = document.getElementById("confirmMessage");
  const okBtn = document.getElementById("confirmOk");
  const cancelBtn = document.getElementById("confirmCancel");

  msgEl.textContent = message;
  overlay.classList.remove("hidden");
  const returnFocusTo = document.activeElement;
  okBtn.focus();

  return new Promise((resolve) => {
    function cleanup(result) {
      overlay.classList.add("hidden");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);
      if (returnFocusTo && returnFocusTo.focus) returnFocusTo.focus();
      resolve(result);
    }
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    // Dismissing via the backdrop or Escape has to settle the promise as well —
    // otherwise the awaiting caller hangs forever and these listeners pile up.
    const onBackdrop = (e) => {
      if (e.target === overlay) cleanup(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") cleanup(false);
      else if (e.key === "Tab") trapFocus(overlay, e);
    };

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
  });
}

addTaskBtn.addEventListener("click", openAddModal);
const headerAddBtn = document.getElementById("headerAddBtn");
if (headerAddBtn) headerAddBtn.addEventListener("click", openAddModal);

/* Pulls #hashtags out of quick-add text. The old pre-id storage format encoded
   tags this way and migrateTodo still parses it, so "#tag" was a habit the app
   taught and then quietly stopped honouring — typing it just left the hash in
   the title.
   A tag has to start at a word boundary and contain a letter, so "C#" keeps its
   suffix and "Fix issue #42" keeps its number. */
function parseQuickAddTags(raw) {
  const tags = [];
  const title = raw
    .replace(/(^|\s)#([\w-]*[a-zA-Z][\w-]*)/g, (_m, pre, tag) => {
      tags.push(tag);
      return pre;
    })
    .replace(/\s{2,}/g, " ")
    .trim();
  // All hashtags and nothing else isn't a task — keep the text as typed.
  if (!title) return { title: raw, tags: [] };
  return { title, tags };
}

function quickAddTask() {
  const input = document.getElementById("quickAddInput");
  const raw = input.value.trim();
  if (!raw) return;
  const { title, tags } = parseQuickAddTags(raw);
  todos.push(makeTodo({ title, tags }));
  saveTodos();
  renderTagCloud();
  renderTodos();
  input.value = "";
  input.focus();
}

document.getElementById("quickAddBtn").addEventListener("click", quickAddTask);
document.getElementById("quickAddInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    quickAddTask();
  }
});

modalClose.addEventListener("click", closeModal);
modalCancel.addEventListener("click", closeModal);
taskModal.addEventListener("click", (e) => {
  if (e.target === taskModal) closeModal();
});
modalSave.addEventListener("click", saveModal);

taskTags.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    commitPendingTag();
  }
});
// Clicking straight from the field to Save should still keep the tag, and turning
// it into a chip on blur makes that visible rather than magical.
taskTags.addEventListener("blur", commitPendingTag);

document.addEventListener("keydown", (e) => {
  if (
    e.key === "n" &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.target.closest("input,textarea,select,[contenteditable]")
  ) {
    e.preventDefault();
    document.getElementById("quickAddInput").focus();
  }
});

/* ===== Search & Sort ===== */
taskSearch.addEventListener("input", () => {
  searchQuery = taskSearch.value;
  renderTodos();
});

document.querySelectorAll(".sort-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".sort-btn")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    sortBy = btn.dataset.sort;
    renderTodos();
  });
});

/* ===== Tab Switching ===== */
function switchTab(tabId) {
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.toggle("active", t.dataset.tab === tabId));
  document
    .querySelectorAll("section[data-tab]")
    .forEach((s) => s.classList.toggle("tab-hidden", s.dataset.tab !== tabId));
  localStorage.setItem("activeTab", tabId);
  const titles = {
    dashboard: "Today's Overview",
    pomodoro: "Pomodoro",
    tasks: "Tasks",
    stats: "Statistics",
    goals: "Goals",
    calendar: "Calendar",
  };
  const pageTitle = document.getElementById("pageTitle");
  if (pageTitle) pageTitle.textContent = titles[tabId] || "Pomodoro";
  const ambient = document.getElementById("ambientBg");
  if (ambient) ambient.classList.toggle("hidden", tabId !== "pomodoro");
  if (tabId === "dashboard") {
    updateDashboardStats();
    renderDashboardUpNext();
    renderDashboardQuotes();
    updateCurrentTaskDisplay();
    renderTodaySchedule();
  }
  if (tabId === "pomodoro") updateCurrentTaskDisplay();
  if (tabId === "tasks") renderTodos();
  if (tabId === "stats") renderStats();
  if (tabId === "goals") renderQuarterlyGoals();
  if (tabId === "calendar") renderCalendar();
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

/* Dashboard view-all and focus button */
const dashViewAll = document.getElementById("dashViewAll");
if (dashViewAll)
  dashViewAll.addEventListener("click", () => switchTab("tasks"));
const dashFocusBtn = document.getElementById("dashFocusBtn");
if (dashFocusBtn) {
  dashFocusBtn.addEventListener("click", () => {
    if (goldenTaskId) setActiveTask(goldenTaskId);
    switchTab("pomodoro");
  });
}

/* ===== Toast/Undo ===== */
function showToast(msg, onUndo) {
  clearTimeout(toastTimer);
  undoData = onUndo ? { fn: onUndo } : null;
  toastMsg.textContent = msg;
  toast.classList.remove("hidden");
  toastUndo.style.display = onUndo ? "" : "none";
  toastTimer = setTimeout(hideToast, 5000);
}

function hideToast() {
  toast.classList.add("hidden");
  undoData = null;
}

toastUndo.addEventListener("click", () => {
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
  const weekStartStr = localDateKey(weekStart);
  const weekSessions = history.filter((s) => s.date >= weekStartStr).length;
  const weekCompleted = todos.filter(
    (t) => t.done && t.completedAt && new Date(t.completedAt) >= weekStart,
  ).length;
  const el = document.getElementById("weeklyStats");
  if (weekSessions === 0 && weekCompleted === 0) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `This week: <strong>${weekSessions}</strong> pomodoros · <strong>${weekCompleted}</strong> tasks completed`;
}

/* ===== Export ===== */
document.getElementById("exportBtn").addEventListener("click", () => {
  const data = {
    exportedAt: new Date().toISOString(),
    todos: loadTodos(),
    quarterlyGoals: loadQuarterlyGoals(),
    pomodoroHistory: loadHistory(),
    goldenTaskId: loadGoldenTask(),
    activeTaskId: loadActiveTask(),
    theme: localStorage.getItem("theme") || "dark",
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `todo-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Data exported");
});

/* ===== Drag and Drop Reorder ===== */
todoList.addEventListener("dragstart", (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  draggedIndex = parseInt(li.dataset.index);
  e.dataTransfer.effectAllowed = "move";
  li.classList.add("dragging");
});

todoList.addEventListener("dragover", (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  todoList
    .querySelectorAll(".drag-over")
    .forEach((el) => el.classList.remove("drag-over"));
  const li = e.target.closest("li");
  if (!li) return;
  const box = li.getBoundingClientRect();
  const offset = e.clientY - box.top;
  if (offset < box.height / 2) {
    li.classList.add("drag-over");
  } else if (li.nextElementSibling) {
    li.nextElementSibling.classList.add("drag-over");
  }
});

todoList.addEventListener("drop", (e) => {
  e.preventDefault();
  if (draggedIndex === null) return;
  const overLi = e.target.closest("li");
  if (!overLi) return;
  const box = overLi.getBoundingClientRect();
  const offset = e.clientY - box.top;
  const targetOrigIndex = parseInt(overLi.dataset.index);
  let insertAt =
    offset < box.height / 2 ? targetOrigIndex : targetOrigIndex + 1;
  if (draggedIndex === insertAt || draggedIndex === insertAt - 1) return;
  const [item] = todos.splice(draggedIndex, 1);
  if (draggedIndex < insertAt) insertAt--;
  todos.splice(insertAt, 0, item);
  draggedIndex = null;
  saveTodos();
  renderTagCloud();
  renderTodos();
});

todoList.addEventListener("dragend", () => {
  todoList
    .querySelectorAll(".dragging, .drag-over")
    .forEach((el) => el.classList.remove("dragging", "drag-over"));
  draggedIndex = null;
});

/* ===== History ===== */
function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem("pomodoroHistory")) || [];
    return raw.map(migrateSession);
  } catch {
    return [];
  }
}

/* Sessions used to store `date` as a UTC day while every chart buckets by local
   day, so anything logged after the UTC/local boundary landed on the wrong date.
   `timestamp` is authoritative, so re-derive date and time from it. Idempotent. */
function migrateSession(s) {
  if (!s || typeof s !== "object" || !s.timestamp) return s;
  const d = new Date(s.timestamp);
  if (Number.isNaN(d.getTime())) return s;
  s.date = localDateKey(d);
  s.time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return s;
}

function saveHistory(history) {
  localStorage.setItem("pomodoroHistory", JSON.stringify(history));
}

/* ===== Stats ===== */
const statsViews = document.getElementById("statsViews");
const viewTabs = document.getElementById("viewTabs");
let currentView = "calendar";
let calendarDate = new Date();
calendarDate.setDate(1);
let trendsRange = 30;
let _trendsMeta = null;

viewTabs.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  currentView = btn.dataset.view;
  viewTabs
    .querySelectorAll("button")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  renderStats();
});

function renderStats() {
  renderWeeklyStats();
  // Update bento summary cards
  const history = loadHistory();
  const focusTimeEl = document.getElementById("statsFocusTime");
  const focusSubEl = document.getElementById("statsFocusSub");
  const completedEl = document.getElementById("statsCompleted");
  const completedSubEl = document.getElementById("statsCompletedSub");
  const streakEl = document.getElementById("statsStreak");
  const streakSubEl = document.getElementById("statsStreakSub");
  if (focusTimeEl) {
    const totalMin = history.length * 25;
    if (totalMin >= 60)
      focusTimeEl.textContent = Math.round(totalMin / 60) + "h";
    else focusTimeEl.textContent = totalMin + "m";
  }
  if (focusSubEl)
    focusSubEl.textContent =
      history.length > 0
        ? `${history.length} sessions completed`
        : "No sessions yet";
  if (completedEl) completedEl.textContent = todos.filter((t) => t.done).length;
  if (completedSubEl) {
    const doneToday = todos.filter(
      (t) =>
        t.done &&
        t.completedAt &&
        new Date(t.completedAt).toDateString() === new Date().toDateString(),
    ).length;
    completedSubEl.textContent =
      doneToday > 0 ? `${doneToday} today` : "Tasks finished";
  }
  let streak = 0;
  if (streakEl) {
    const dates = [...new Set(history.map((s) => s.date))].sort().reverse();
    const today = localDateKey(new Date());
    let check = today;
    for (const d of dates) {
      if (d === check) {
        streak++;
        check = new Date(new Date(check).setDate(new Date(check).getDate() - 1))
          .toISOString()
          .slice(0, 10);
      } else break;
    }
    streakEl.textContent = streak;
  }
  if (streakSubEl)
    streakSubEl.textContent =
      streak === 0
        ? "No sessions yet"
        : streak === 1
          ? "Day of focus"
          : `${streak} day streak`;
  // Stats views
  if (currentView === "calendar") statsViews.innerHTML = renderCalendarHTML();
  else if (currentView === "hours") statsViews.innerHTML = renderHoursHTML();
  else if (currentView === "projects")
    statsViews.innerHTML = renderProjectsHTML();
  else if (currentView === "trends") statsViews.innerHTML = renderTrendsHTML();
  else if (currentView === "cloud") statsViews.innerHTML = renderWordCloudHTML();
  // A cloud word is a shortcut into the filtered task list.
  statsViews.querySelectorAll("[data-cloud-tag]").forEach((btn) => {
    btn.addEventListener("click", () => {
      tagFilter = btn.dataset.cloudTag;
      renderTagCloud();
      switchTab("tasks");
    });
  });
  statsViews.querySelectorAll("[data-cal-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      calendarDate.setMonth(
        calendarDate.getMonth() + (btn.dataset.calNav === "next" ? 1 : -1),
      );
      renderStats();
    });
  });
  statsViews.querySelectorAll("[data-trend-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      trendsRange = parseInt(btn.dataset.trendRange, 10);
      renderStats();
    });
  });
  if (currentView === "trends") setupTrendsInteraction();
}

/* ===== Calendar ===== */
function getGoldenDays(year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const golden = {};
  todos.forEach((t) => {
    if (t.wasGolden && t.completedAt) {
      const d = new Date(t.completedAt);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  history.forEach((s) => {
    if (s.date.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)) {
      counts[s.date] = (counts[s.date] || 0) + 1;
    }
  });

  const maxCount = Math.max(...Object.values(counts), 1);
  const goldenDays = getGoldenDays(year, month);
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

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
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const count = counts[dateStr] || 0;
    const level =
      count === 0 ? 0 : Math.min(5, Math.ceil((count / maxCount) * 5));
    const title =
      count > 0
        ? ` title="${count} pomodoro${count === 1 ? "" : "s"} completed"`
        : "";
    html += `<div class="day-cell level-${level}"${title}><div class="day-num">${d}</div>`;
    if (goldenDays[dateStr]) html += `<div class="day-star">⭐</div>`;
    if (count > 0) html += `<div class="day-count">🍅${count}</div>`;
    html += "</div>";
  }

  html += "</div>";
  html += `<p class="calendar-legend">🍅 = pomodoros completed that day</p>`;
  return html;
}

/* ===== Hours Chart ===== */
function renderHoursHTML() {
  const history = loadHistory();
  if (history.length === 0) {
    return '<div class="no-data">No sessions yet. Complete a pomodoro to see stats.</div>';
  }

  const hourCounts = Array(24).fill(0);
  history.forEach((s) => {
    const h = parseInt(s.time.slice(0, 10).split(":")[0], 10);
    if (h >= 0 && h < 24) hourCounts[h]++;
  });

  const maxH = Math.max(...hourCounts, 1);
  let html = '<div class="hours-chart">';

  for (let h = 0; h < 24; h++) {
    const pct = (hourCounts[h] / maxH) * 100;
    const label =
      h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;
    html += `
      <div class="hours-row">
        <div class="hour-label">${label}</div>
        <div class="hour-bar-bg"><div class="hour-bar" style="width:${pct}%"></div></div>
        <div class="hour-val">${hourCounts[h]}</div>
      </div>
    `;
  }

  html += "</div>";
  return html;
}

/* ===== Projects Breakdown ===== */
function renderProjectsHTML() {
  const history = loadHistory();
  const pending = todos.filter((t) => !t.done);
  const projects = {};
  todos.forEach((t) => {
    const p = t.project || "General";
    if (!projects[p]) projects[p] = { name: p, pomos: 0, total: 0, done: 0 };
    projects[p].total++;
    if (t.done) projects[p].done++;
    projects[p].pomos += t.pomodoros || 0;
  });
  const projectList = Object.values(projects).sort((a, b) => b.pomos - a.pomos);
  const totalPomos = projectList.reduce((s, p) => s + p.pomos, 0) || 1;
  const colors = [
    "bg-primary",
    "bg-secondary",
    "bg-tertiary",
    "bg-on-surface-variant",
  ];
  const projectColors = ["#ae2f34", "#006a65", "#705d00", "#584140"];

  let html = '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">';
  // Left: Project allocation
  html +=
    '<div class="bg-surface-container-low p-6 rounded-xl shadow-sm border border-outline-variant/10">';
  html +=
    '<h3 class="font-display font-semibold mb-5" style="font-size:18px;line-height:28px">Allocation</h3>';
  html += '<div class="space-y-5">';
  projectList.slice(0, 6).forEach((p, i) => {
    const pct = Math.round((p.pomos / totalPomos) * 100);
    const color = projectColors[i % projectColors.length];
    html += `
      <div>
        <div class="flex justify-between mb-2 text-sm font-bold font-body">
          <span>${escapeHtml(p.name)}</span>
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
    html +=
      '<p class="text-sm text-on-surface-variant opacity-60 text-center py-4">No projects yet. Add tasks with projects to see allocation.</p>';
  }
  html += "</div></div>";

  // Right: Insight section
  const bestHour = (() => {
    if (history.length === 0) return null;
    const hourCounts = Array(24).fill(0);
    history.forEach((s) => {
      const h = parseInt(s.time.split(":")[0], 10);
      if (h >= 0 && h < 24) hourCounts[h]++;
    });
    let maxH = 0,
      best = -1;
    hourCounts.forEach((c, h) => {
      if (c > maxH) {
        maxH = c;
        best = h;
      }
    });
    return best;
  })();
  const totalSessions = history.length;
  const todaySessions = history.filter(
    (s) => s.date === localDateKey(new Date()),
  ).length;
  let insightMsg = "Complete your first pomodoro session to unlock insights.";
  if (totalSessions > 0) {
    if (bestHour !== null) {
      const period =
        bestHour < 12 ? "morning" : bestHour < 17 ? "afternoon" : "evening";
      insightMsg = `You're most productive in the ${period} (around ${bestHour}:00). Your peak focus window is ${bestHour}:00–${Math.min(bestHour + 2, 24)}:00.`;
      if (todaySessions > 0) {
        insightMsg += ` Great start — you've logged ${todaySessions} session${todaySessions > 1 ? "s" : ""} today!`;
      }
    }
    const projectCount = projectList.filter((p) => p.pomos > 0).length;
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

  html += "</div>";
  return html;
}

/* ===== Word Cloud =====
   Which tags and projects actually absorbed the work. Weight leans on pomodoros
   logged against tasks carrying the tag, because that is real time spent; task
   counts only nudge it, so twenty untouched tasks never outrank one long grind. */
function buildTagWeights() {
  const map = new Map();
  const bump = (key, pomos, done) => {
    const e = map.get(key) || { key, pomos: 0, tasks: 0, done: 0 };
    e.pomos += pomos;
    e.tasks += 1;
    if (done) e.done += 1;
    map.set(key, e);
  };
  todos.forEach((t) => {
    const pomos = t.pomodoros || 0;
    if (t.project) bump("project:" + t.project.toLowerCase(), pomos, t.done);
    (t.tags || []).forEach((tag) => bump(tag.toLowerCase(), pomos, t.done));
  });
  const list = [...map.values()];
  list.forEach((e) => {
    e.weight = e.pomos * 4 + e.done * 2 + e.tasks;
  });
  return list.sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
}

function renderWordCloudHTML() {
  const list = buildTagWeights();
  if (list.length === 0) {
    return '<div class="no-data">Nothing to cloud yet. Give a task a project or a tag, then log a pomodoro against it.</div>';
  }
  const colorMap = getTagColorMap();
  const max = list[0].weight;
  const min = list[list.length - 1].weight;
  // Floor is 15px rather than smaller: below that, bold coloured text stops being
  // comfortably readable, and the podium below carries the exact figures anyway.
  const MIN_PX = 15;
  const MAX_PX = 44;
  // sqrt compresses the top end, so one dominant tag doesn't shrink the rest
  // into illegibility.
  const sizeFor = (w) => {
    if (max === min) return Math.round((MIN_PX + MAX_PX) / 2);
    const t = Math.sqrt((w - min) / (max - min));
    return Math.round(MIN_PX + t * (MAX_PX - MIN_PX));
  };

  // Heaviest words toward the middle. Deterministic on purpose: renderStats runs
  // on every task toggle, and a random layout would jump around each time.
  const arranged = [];
  list.forEach((e, i) => (i % 2 === 0 ? arranged.push(e) : arranged.unshift(e)));

  const words = arranged
    .map((e) => {
      const isProject = isProjectKey(e.key);
      const label = tagDisplayLabel(e.key);
      const c = colorMap[e.key] || TAG_COLORS[0];
      const px = sizeFor(e.weight);
      const title = `${e.pomos} pomodoro${e.pomos === 1 ? "" : "s"} · ${e.done}/${e.tasks} task${e.tasks === 1 ? "" : "s"} done — click to filter the task list`;
      return `<button class="cloud-word${isProject ? " is-project" : ""}${tagFilter === e.key ? " active" : ""}" data-cloud-tag="${escapeHtml(e.key)}" style="font-size:${px}px;color:${c}" title="${escapeHtml(title)}">${escapeHtml(label)}</button>`;
    })
    .join("");

  const top = list.slice(0, 3);
  const podium = top
    .map((e, i) => {
      const c = colorMap[e.key] || TAG_COLORS[0];
      return `<div class="cloud-rank">
        <span class="cloud-rank-pos">${i + 1}</span>
        <span class="cloud-rank-dot" style="background:${c}"></span>
        <span class="cloud-rank-name">${escapeHtml(tagDisplayLabel(e.key))}</span>
        <span class="cloud-rank-meta">${e.pomos} pomo${e.pomos === 1 ? "" : "s"} · ${e.done}/${e.tasks} done</span>
      </div>`;
    })
    .join("");

  const anyPomos = list.some((e) => e.pomos > 0);
  return `
    <div class="cloud-legend">
      <span><span class="cloud-legend-swatch is-project"></span>Projects</span>
      <span><span class="cloud-legend-swatch"></span>Tags</span>
      <span class="cloud-legend-note">Bigger = more invested${anyPomos ? " (pomodoros logged, then tasks finished)" : " — log a pomodoro to weight it by time"}</span>
    </div>
    <div class="wordcloud">${words}</div>
    <div class="cloud-podium">
      <h4 class="cloud-podium-title">Most worked on</h4>
      ${podium}
    </div>`;
}

/* ===== Trends (stacked bar chart) ===== */
function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function renderTrendsHTML() {
  const days = trendsRange;
  const history = loadHistory();

  // Build an ordered list of the last `days` day-buckets ending today.
  const today = new Date();
  const keys = [];
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - i,
    );
    keys.push(localDateKey(d));
    dates.push(d);
  }
  const idx = {};
  keys.forEach((k, i) => {
    idx[k] = i;
  });

  const pomos = Array(days).fill(0);
  const tasksDone = Array(days).fill(0);
  const startedDone = Array(days).fill(0);

  history.forEach((s) => {
    if (idx[s.date] !== undefined) pomos[idx[s.date]]++;
  });
  todos.forEach((t) => {
    if (t.done && t.completedAt) {
      const key = localDateKey(new Date(t.completedAt));
      if (idx[key] !== undefined) {
        tasksDone[idx[key]]++;
        if ((t.pomodoros || 0) > 0) startedDone[idx[key]]++;
      }
    }
  });

  const series = [
    {
      key: "pomos",
      name: "Pomodoros completed",
      short: "Pomodoros",
      data: pomos,
      color: "var(--trend-1)",
    },
    {
      key: "tasks",
      name: "Tasks completed",
      short: "Tasks",
      data: tasksDone,
      color: "var(--trend-2)",
    },
    {
      key: "started",
      name: "Started tasks completed",
      short: "Started",
      data: startedDone,
      color: "var(--trend-3)",
    },
  ];

  const ranges = [7, 30, 90];
  const rangeBtns = ranges
    .map(
      (r) =>
        `<button data-trend-range="${r}" class="trend-range-btn${r === days ? " active" : ""}">${r}D</button>`,
    )
    .join("");
  const legend = series
    .map(
      (s) =>
        `<span class="trend-legend-item"><span class="trend-legend-dot" style="background:${s.color}"></span>${s.name}</span>`,
    )
    .join("");

  const controls = `
    <div class="trends-controls">
      <div class="trend-ranges">${rangeBtns}</div>
      <div class="trends-legend">${legend}</div>
    </div>`;

  const grandTotal =
    pomos.reduce((a, b) => a + b, 0) +
    tasksDone.reduce((a, b) => a + b, 0) +
    startedDone.reduce((a, b) => a + b, 0);
  if (grandTotal === 0) {
    _trendsMeta = null;
    return (
      controls +
      '<div class="no-data">No activity in this period yet. Complete a pomodoro or a task to see trends.</div>'
    );
  }

  // Geometry (SVG user units; scales responsively via viewBox)
  const W = 760,
    H = 320;
  const padL = 34,
    padR = 16,
    padT = 16,
    padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  // Bars are stacked, so the y-axis must reach the tallest per-day stack.
  const stackTotals = dates.map((_, i) =>
    series.reduce((sum, s) => sum + s.data[i], 0),
  );
  const maxVal = Math.max(1, ...stackTotals);
  // Nice y ticks (~4 steps)
  const tickCount = 4;
  const rawStep = maxVal / tickCount;
  const niceStep = Math.max(1, Math.ceil(rawStep));
  const yTop =
    niceStep * tickCount >= maxVal
      ? niceStep * tickCount
      : Math.ceil(maxVal / niceStep) * niceStep;

  const slotW = plotW / days;
  const barW = Math.max(2, Math.min(slotW * 0.68, 26));
  const xAt = (i) => padL + slotW * (i + 0.5);
  const yAt = (v) => padT + plotH - (v / yTop) * plotH;
  const r2 = (n) => Math.round(n * 100) / 100;

  // Gridlines + y labels
  let grid = "";
  for (let t = 0; t <= tickCount; t++) {
    const val = (yTop / tickCount) * t;
    const y = yAt(val);
    grid += `<line class="trend-grid" x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}"></line>`;
    grid += `<text class="trend-axis-label" x="${padL - 8}" y="${y + 4}" text-anchor="end">${Math.round(val)}</text>`;
  }

  // X labels — every day when sparse, otherwise ~6 evenly spaced
  let xLabels = "";
  const xTicks = days <= 14 ? days : 6;
  for (let t = 0; t < xTicks; t++) {
    const i = xTicks === 1 ? 0 : Math.round((days - 1) * (t / (xTicks - 1)));
    const d = dates[i];
    xLabels += `<text class="trend-axis-label" x="${r2(xAt(i))}" y="${padT + plotH + 20}" text-anchor="middle">${d.getMonth() + 1}/${d.getDate()}</text>`;
  }

  // Stacked bars — series stack bottom-up in declaration order, and only the
  // topmost visible segment gets rounded corners so seams stay flush.
  const topRoundedPath = (x, y, w, h, radius) => {
    const rr = Math.max(0, Math.min(radius, w / 2, h));
    return (
      `M${r2(x)},${r2(y + h)}L${r2(x)},${r2(y + rr)}Q${r2(x)},${r2(y)} ${r2(x + rr)},${r2(y)}` +
      `L${r2(x + w - rr)},${r2(y)}Q${r2(x + w)},${r2(y)} ${r2(x + w)},${r2(y + rr)}` +
      `L${r2(x + w)},${r2(y + h)}Z`
    );
  };

  let bars = "";
  for (let i = 0; i < days; i++) {
    const visible = series.filter((s) => s.data[i] > 0);
    const x = xAt(i) - barW / 2;
    let acc = 0;
    visible.forEach((s, si) => {
      const v = s.data[i];
      const yTopSeg = yAt(acc + v);
      const h = yAt(acc) - yTopSeg;
      const isTop = si === visible.length - 1;
      bars += isTop
        ? `<path class="trend-bar" d="${topRoundedPath(x, yTopSeg, barW, h, 3)}" style="fill:${s.color}"></path>`
        : `<rect class="trend-bar" x="${r2(x)}" y="${r2(yTopSeg)}" width="${r2(barW)}" height="${r2(h)}" style="fill:${s.color}"></rect>`;
      acc += v;
    });
  }

  // Hover layer — a slot-wide band behind the bars, hidden until mousemove
  const hoverLayer = `<rect class="trends-hover-band" x="0" y="${padT}" width="${r2(slotW)}" height="${plotH}" style="display:none"></rect>`;

  const svg = `
    <svg class="trends-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Stacked daily totals for pomodoros completed, tasks completed and started tasks completed over the last ${days} days">
      ${grid}
      ${xLabels}
      ${hoverLayer}
      ${bars}
    </svg>`;

  // Accessible data table
  let table =
    '<details class="trends-table-details"><summary>View data table</summary><div class="trends-table-scroll"><table class="trends-table"><thead><tr><th>Date</th>';
  series.forEach((s) => {
    table += `<th>${s.short}</th>`;
  });
  table += "<th>Stack</th></tr></thead><tbody>";
  for (let i = 0; i < days; i++) {
    const d = dates[i];
    table += `<tr><td>${d.getMonth() + 1}/${d.getDate()}</td><td>${pomos[i]}</td><td>${tasksDone[i]}</td><td>${startedDone[i]}</td><td>${stackTotals[i]}</td></tr>`;
  }
  table += "</tbody></table></div></details>";

  _trendsMeta = {
    W,
    padL,
    plotW,
    days,
    slotW,
    xAt,
    yAt,
    dates,
    series,
    stackTotals,
  };

  return `${controls}
    <div class="trends-chart-area">
      ${svg}
      <div class="trends-tooltip hidden"></div>
    </div>
    ${table}`;
}

function setupTrendsInteraction() {
  const meta = _trendsMeta;
  if (!meta) return;
  const svg = statsViews.querySelector(".trends-svg");
  const area = statsViews.querySelector(".trends-chart-area");
  const tip = statsViews.querySelector(".trends-tooltip");
  const band = statsViews.querySelector(".trends-hover-band");
  if (!svg || !area || !tip || !band) return;

  const onMove = (e) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const vbX = ((e.clientX - rect.left) / rect.width) * meta.W;
    let i = Math.floor((vbX - meta.padL) / meta.slotW);
    i = Math.max(0, Math.min(meta.days - 1, i));
    const x = meta.xAt(i);

    band.setAttribute("x", meta.padL + i * meta.slotW);
    band.style.display = "";

    const d = meta.dates[i];
    const dateStr = d.toLocaleDateString("default", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    // Reverse so tooltip rows read top-down in the same order as the stack.
    let rows = "";
    [...meta.series].reverse().forEach((s) => {
      rows += `<div class="trend-tip-row"><span class="trend-legend-dot" style="background:${s.color}"></span><span class="trend-tip-name">${s.short}</span><span class="trend-tip-val">${s.data[i]}</span></div>`;
    });
    rows += `<div class="trend-tip-row trend-tip-total"><span class="trend-tip-name">Bar height</span><span class="trend-tip-val">${meta.stackTotals[i]}</span></div>`;
    tip.innerHTML = `<div class="trend-tip-date">${dateStr}</div>${rows}`;
    tip.classList.remove("hidden");

    // Position tooltip horizontally over the hovered point, clamped to the area.
    const areaRect = area.getBoundingClientRect();
    const pointClientX = rect.left + (x / meta.W) * rect.width;
    let left = pointClientX - areaRect.left;
    const tipW = tip.offsetWidth;
    left = Math.max(
      tipW / 2 + 4,
      Math.min(areaRect.width - tipW / 2 - 4, left),
    );
    tip.style.left = left + "px";
  };
  const onLeave = () => {
    tip.classList.add("hidden");
    band.style.display = "none";
  };

  svg.addEventListener("mousemove", onMove);
  svg.addEventListener("mouseleave", onLeave);
}

/* Pills are focusable (role=button), so Enter/Space has to work as well as a
   click — otherwise the selection indicator is unreachable by keyboard. */
["tagCloud", "tagCloudSidebar", "tagCloudTags"].forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("click", (e) => {
    const pill = e.target.closest(".tag-pill");
    if (pill) filterByTag(pill.dataset.tag);
  });
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const pill = e.target.closest(".tag-pill");
    if (!pill) return;
    e.preventDefault();
    filterByTag(pill.dataset.tag);
  });
});

const tagFilterClearBtn = document.getElementById("tagFilterClear");
if (tagFilterClearBtn) tagFilterClearBtn.addEventListener("click", clearFilter);

/* Focus Score explainer — a title attribute alone is useless on touch, so the
   copy lives in a panel the button expands. */
const focusScoreInfo = document.getElementById("focusScoreInfo");
if (focusScoreInfo) {
  focusScoreInfo.addEventListener("click", () => {
    const help = document.getElementById("focusScoreHelp");
    if (!help) return;
    const open = help.classList.toggle("hidden");
    focusScoreInfo.setAttribute("aria-expanded", open ? "false" : "true");
  });
}

/* ===== Theme Toggle ===== */
const themeToggle = document.getElementById("themeToggle");

function setTheme(theme) {
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
  localStorage.setItem("theme", theme);
  themeToggle.innerHTML =
    theme === "dark"
      ? '<span class="material-symbols-outlined">dark_mode</span>'
      : '<span class="material-symbols-outlined">light_mode</span>';
}

const savedTheme = localStorage.getItem("theme") || "dark";
setTheme(savedTheme);

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
  setTheme(current === "dark" ? "light" : "dark");
});

/* ===== Help Overlay ===== */
const helpOverlay = document.getElementById("helpOverlay");
document
  .getElementById("helpBtn")
  .addEventListener("click", () => helpOverlay.classList.remove("hidden"));
document
  .getElementById("helpClose")
  .addEventListener("click", () => helpOverlay.classList.add("hidden"));
helpOverlay.addEventListener("click", (e) => {
  if (e.target === helpOverlay) helpOverlay.classList.add("hidden");
});

/* ===== Completed Toggle ===== */
document.getElementById("completedToggle").addEventListener("click", () => {
  showCompleted = !showCompleted;
  completedPage = 0;
  renderTodos();
});

/* ===== Quarterly Goals ===== */
function loadQuarterlyGoals() {
  try {
    const data = JSON.parse(localStorage.getItem("quarterlyGoals")) || {};
    // migrate old string format to array format
    Object.keys(data).forEach((key) => {
      if (typeof data[key] === "string") {
        const text = data[key].trim();
        data[key] = text
          ? [{ id: crypto.randomUUID(), text, done: false }]
          : [];
      }
    });
    return data;
  } catch {
    return {};
  }
}

function saveQuarterlyGoals(goals) {
  localStorage.setItem("quarterlyGoals", JSON.stringify(goals));
}

function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(key) {
  const [y, m] = key.split("-");
  const date = new Date(+y, +m - 1);
  return date.toLocaleDateString("default", { month: "long", year: "numeric" });
}

/* Archive months the user has opened. Kept in memory rather than storage — which
   months you were browsing isn't worth persisting. */
const expandedArchive = new Set();

function renderQuarterlyGoals() {
  const now = new Date();
  const currentKey = getMonthKey(now);

  // A rolling three months from today, not the calendar quarter. Anchoring to the
  // quarter meant that in the back half of one (August, say) the roadmap led with
  // a month that had already finished — and that month then also showed up in the
  // archive, so the same goals appeared twice. Month + i handles the year
  // rollover for us, so Nov gives Nov/Dec/Jan.
  const upcoming = [];
  for (let i = 0; i < 3; i++) {
    upcoming.push(getMonthKey(new Date(now.getFullYear(), now.getMonth() + i, 1)));
  }

  const allGoals = loadQuarterlyGoals();
  const pastKeys = Object.keys(allGoals).filter(
    (k) => k < currentKey && allGoals[k].length > 0,
  );
  pastKeys.sort().reverse();

  const borderColors = [
    "border-primary",
    "border-secondary",
    "border-tertiary",
  ];
  const badgeColors = [
    "bg-primary-fixed text-primary",
    "bg-secondary-fixed text-secondary",
    "bg-tertiary-fixed text-tertiary",
  ];
  const progressColors = [
    "bg-secondary-container",
    "bg-primary-container",
    "bg-tertiary-container",
  ];
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  function monthCardHTML(key, idx) {
    const items = allGoals[key] || [];
    const doneCount = items.filter((i) => i.done).length;
    const totalCount = items.length;
    const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
    const barPct = pct > 0 ? pct : totalCount > 0 ? 2 : 2;
    const [y, m] = key.split("-");
    // The year is only worth showing when the window straddles one, which a
    // rolling three months does every November.
    const monthLabel =
      monthNames[parseInt(m) - 1] +
      (+y === now.getFullYear() ? "" : " " + y);
    const isCurrent = key === currentKey;

    const lastDay = new Date(+y, parseInt(m), 0).getDate();
    const todayNum = now.getDate();
    const daysLeft = lastDay - (isCurrent ? todayNum : 0);
    // Compared as YYYY-MM strings, not month numbers: January of next year is
    // ahead of August of this one, and a numeric compare said otherwise.
    const showDaysLeft = key >= currentKey;

    const itemsHtml =
      items.length === 0
        ? '<p class="text-xs text-on-surface-variant opacity-50 text-center py-3">No goals set for this month</p>'
        : items
            .map(
              (item, i) => `
        <li class="flex items-start gap-3">
          <input type="checkbox" class="stitch-checkbox mt-0.5" ${item.done ? "checked" : ""} data-key="${key}" data-idx="${i}">
          <span class="flex-1 text-sm font-body ${item.done ? "line-through opacity-60 text-on-surface-variant" : "text-on-surface"}">${escapeHtml(item.text)}</span>
          <button class="qg-item-del text-outline hover:text-primary transition-colors text-sm" data-key="${key}" data-idx="${i}">✕</button>
        </li>
      `,
            )
            .join("");

    return `
      <div class="organic-card bg-surface-container-lowest p-5 rounded-xl shadow-sm relative overflow-hidden border-l-4 ${borderColors[idx]}">
        <div class="flex justify-between items-start mb-3">
          <div>
            ${isCurrent ? `<span class="font-mono text-[10px] font-bold tracking-widest text-primary bg-primary-fixed px-3 py-1 rounded-full">CURRENT</span>` : ""}
            <h4 class="font-display font-semibold mt-1" style="font-size:18px;line-height:28px">${monthLabel}</h4>
          </div>
          ${
            showDaysLeft
              ? `
          <div class="text-right ${isCurrent ? "" : "opacity-50"}">
            <span class="block text-2xl font-bold text-on-surface">${daysLeft}</span>
            <span class="text-[10px] text-on-surface-variant uppercase tracking-wider font-mono">Days Left</span>
          </div>`
              : ""
          }
        </div>
        <div class="mb-4">
          <div class="flex justify-between text-xs font-mono mb-1.5">
            <span class="font-bold text-secondary">${pct}% Focus Achieved</span>
            <span class="text-on-surface-variant">${totalCount > 0 ? doneCount + "/" + totalCount : "No"} Goals</span>
          </div>
          <div class="h-2.5 w-full bg-surface-container-high rounded-full overflow-hidden">
            <div class="h-full rounded-full progress-glow ${progressColors[idx]}" style="width:${barPct}%"></div>
          </div>
        </div>
        <ul class="space-y-3">${itemsHtml}</ul>
        <div class="flex items-center gap-2 mt-4 pt-3 border-t border-outline-variant/20">
          <input type="text" data-key="${key}" class="flex-1 bg-surface-container-low rounded-lg px-3 py-2 text-xs font-body outline-none focus:ring-1 focus:ring-primary" maxlength="200" placeholder="Add goal...">
          <button class="qg-add-btn bg-primary text-on-primary px-4 py-2 rounded-lg text-xs font-bold hover:opacity-90 transition-all active:scale-95 squishy-button" data-key="${key}">+</button>
        </div>
      </div>
    `;
  }

  // === Build HTML ===
  let html = "";

  // Active Quarterly Roadmap
  html += '<section class="mb-10">';
  html += '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">';

  upcoming.forEach((k, idx) => {
    html += monthCardHTML(k, idx);
  });

  html += "</div>";
  html += "</section>";

  // Summary — the three months on screen only. It used to fold the archive in
  // while calling the total "this quarter", so it drifted upward forever.
  let totalDone = 0,
    totalItems = 0;
  upcoming.forEach((k) => {
    (allGoals[k] || []).forEach((i) => {
      totalItems++;
      if (i.done) totalDone++;
    });
  });
  if (totalItems > 0) {
    html +=
      '<div class="text-center text-sm font-mono text-on-surface-variant opacity-70 mb-5">' +
      `${totalDone}/${totalItems} goals completed across these three months</div>`;
  }

  // Archive — every month before this one, newest first, each expandable to what
  // was planned and what actually got done.
  const history = loadHistory();
  html += '<section class="mb-6">';
  html += '<div class="flex items-center gap-4 mb-5">';
  html +=
    '<h3 class="font-display font-semibold text-on-surface-variant" style="font-size:16px;line-height:24px">Archive</h3>';
  html += '<div class="h-px flex-1 bg-outline-variant opacity-30"></div>';
  html += "</div>";
  if (pastKeys.length > 0) {
    html += '<div class="qg-archive">';
    pastKeys.forEach((k) => {
      const items = allGoals[k] || [];
      const doneCount = items.filter((i) => i.done).length;
      const totalCount = items.length;
      const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
      const allDone = totalCount > 0 && doneCount === totalCount;
      const open = expandedArchive.has(k);
      // What else happened that month, from the task list and session history.
      const tasksDone = todos.filter(
        (t) =>
          t.done &&
          t.completedAt &&
          localDateKey(new Date(t.completedAt)).startsWith(k),
      ).length;
      const pomos = history.filter((s) => s.date && s.date.startsWith(k)).length;

      const itemsHtml =
        totalCount === 0
          ? '<li class="qg-archive-empty">No goals were set that month.</li>'
          : items
              .map(
                (item) => `
            <li class="qg-archive-item ${item.done ? "done" : "open"}">
              <span class="material-symbols-outlined">${item.done ? "check_circle" : "radio_button_unchecked"}</span>
              <span class="qg-archive-item-text">${escapeHtml(item.text)}</span>
            </li>`,
              )
              .join("");

      html += `
        <div class="qg-archive-card${open ? " open" : ""}">
          <button class="qg-archive-head" data-archive="${k}" aria-expanded="${open}" aria-controls="qg-archive-body-${k}">
            <span class="material-symbols-outlined qg-archive-icon ${allDone ? "all-done" : ""}">${allDone ? "verified" : "history"}</span>
            <span class="qg-archive-title">${escapeHtml(formatMonthLabel(k))}</span>
            <span class="qg-archive-meta">${totalCount > 0 ? `${doneCount}/${totalCount} goals · ${pct}%` : "no goals"}</span>
            <span class="material-symbols-outlined qg-archive-chevron">expand_more</span>
          </button>
          <div class="qg-archive-body" id="qg-archive-body-${k}">
            ${totalCount > 0 ? `<div class="qg-archive-bar"><div class="qg-archive-bar-fill" style="width:${pct}%"></div></div>` : ""}
            <ul class="qg-archive-list">${itemsHtml}</ul>
            <p class="qg-archive-stats">
              <span><strong>${tasksDone}</strong> task${tasksDone === 1 ? "" : "s"} completed</span>
              <span><strong>${pomos}</strong> pomodoro${pomos === 1 ? "" : "s"}</span>
            </p>
          </div>
        </div>`;
    });
    html += "</div>";
  } else {
    html +=
      '<p class="text-xs text-on-surface-variant opacity-50">Nothing archived yet. Once this month is behind you it will show up here.</p>';
  }
  html += "</section>";

  document.getElementById("quarterlyGoalsContent").innerHTML = html;

  // Event handlers
  document
    .querySelectorAll("#quarterlyGoalsContent .stitch-checkbox")
    .forEach((cb) => {
      cb.addEventListener("change", () => {
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

  document
    .querySelectorAll("#quarterlyGoalsContent .qg-item-del")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
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

  document
    .querySelectorAll("#quarterlyGoalsContent [data-archive]")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.archive;
        if (expandedArchive.has(key)) expandedArchive.delete(key);
        else expandedArchive.add(key);
        renderQuarterlyGoals();
      });
    });

  document
    .querySelectorAll("#quarterlyGoalsContent .qg-add-btn")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.key;
        const input = btn.parentElement.querySelector("input");
        const text = input.value.trim();
        if (!text) return;
        const goals = loadQuarterlyGoals();
        if (!goals[key]) goals[key] = [];
        goals[key].push({ id: crypto.randomUUID(), text, done: false });
        saveQuarterlyGoals(goals);
        renderQuarterlyGoals();
      });
    });

  document
    .querySelectorAll(
      "#quarterlyGoalsContent .qg-add-row input, #quarterlyGoalsContent input[data-key]",
    )
    .forEach((input) => {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
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

/* ===== App Version =====
   version.json is the single source of truth. major/minor are hand-edited;
   the patch number is stamped on every release by the deploy workflow, so the
   version the user sees changes with each release without anyone editing markup.
   If the file can't be loaded the fallback text baked into index.html stands. */
const VERSION_URL = "version.json";

function formatVersion(v) {
  const major = Number.isFinite(v.major) ? v.major : 0;
  const minor = Number.isFinite(v.minor) ? v.minor : 0;
  const patch = Number.isFinite(v.patch) ? v.patch : 0;
  return `v${major}.${minor}.${patch}`;
}

function loadVersion() {
  const el = document.getElementById("appVersion");
  if (!el) return Promise.resolve();
  return fetch(VERSION_URL)
    .then((res) => {
      if (!res.ok) throw new Error(VERSION_URL + " " + res.status);
      return res.json();
    })
    .then((v) => {
      el.textContent = formatVersion(v);
      const detail = [];
      if (v.commit) detail.push("commit " + v.commit);
      if (v.released) detail.push("released " + v.released);
      if (detail.length) el.title = detail.join(" · ");
    })
    .catch((err) => {
      console.error("Could not load " + VERSION_URL, err);
    });
}

/* ===== Help & Support =====
   No backend here, so the composer hands off to the user's mail client via a
   mailto: link. Nothing is sent from the page — the user reviews the draft and
   sends it themselves, and the address is shown for manual use as a fallback. */
const SUPPORT_EMAIL = "sandeep.kumar.narware@gmail.com";

/* ---------------------------------------------------------------------------
   IN-APP SENDING (optional)
   Paste your Web3Forms access key below to let the app send support messages
   directly, instead of handing off to the user's mail client. Get one free at
   https://web3forms.com/#start — enter SUPPORT_EMAIL, confirm the email they
   send you, and paste the UUID here.

   The key is meant to be public (Web3Forms documents this), so committing it
   is fine. While it's empty the app simply keeps using the mailto composer.
   Free tier is 250 messages/month; past that, sends fail and the UI falls
   back to the mail-client draft.
   --------------------------------------------------------------------------- */
const WEB3FORMS_ACCESS_KEY = "b5d2ba55-6e53-4ee9-a365-1db6ca94f9eb";
const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";

const SUPPORT_TYPES = {
  bug: { subject: "Bug report", diagnostics: true },
  feature: { subject: "Feature request", diagnostics: false },
  hello: { subject: "Hello", diagnostics: false },
};

const supportModal = document.getElementById("supportModal");
const supportType = document.getElementById("supportType");
const supportSubject = document.getElementById("supportSubject");
const supportReplyTo = document.getElementById("supportReplyTo");
const supportMessage = document.getElementById("supportMessage");
const supportDiagnostics = document.getElementById("supportDiagnostics");
const supportCount = document.getElementById("supportCount");
const supportStatus = document.getElementById("supportStatus");
const supportBotcheck = document.getElementById("supportBotcheck");

/* In-app sending is on only once an access key is configured. */
function supportServiceEnabled() {
  return (
    typeof WEB3FORMS_ACCESS_KEY === "string" &&
    WEB3FORMS_ACCESS_KEY.trim().length > 0
  );
}

function setSupportStatus(text, kind) {
  if (!supportStatus) return;
  if (!text) {
    supportStatus.classList.add("hidden");
    supportStatus.textContent = "";
    return;
  }
  supportStatus.textContent = text;
  supportStatus.className = "support-status " + (kind || "info");
}

function setSupportBusy(busy) {
  const btn = document.getElementById("supportSend");
  if (!btn) return;
  btn.disabled = busy;
  btn.textContent = busy
    ? "Sending…"
    : supportServiceEnabled()
      ? "Send message"
      : "Open in email app";
}

function appVersionString() {
  const el = document.getElementById("appVersion");
  return el && el.textContent.trim() ? el.textContent.trim() : "unknown";
}

/* Environment only — never task data. */
function supportDiagnosticsBlock() {
  const lines = [
    `App: PomoDone ${appVersionString()}`,
    `Browser: ${navigator.userAgent}`,
    `Language: ${navigator.language || "unknown"}`,
    `Screen: ${window.screen ? window.screen.width + "x" + window.screen.height : "unknown"}`,
    `Theme: ${document.documentElement.classList.contains("dark") ? "dark" : "light"}`,
  ];
  return "\n\n---\nTechnical details\n" + lines.join("\n");
}

function defaultSubjectFor(type) {
  const t = SUPPORT_TYPES[type] || SUPPORT_TYPES.hello;
  return `PomoDone ${appVersionString()} — ${t.subject}`;
}

function applySupportType() {
  const type = supportType.value;
  const t = SUPPORT_TYPES[type] || SUPPORT_TYPES.hello;
  // Only overwrite the subject while the user hasn't customised it.
  if (!supportSubject.dataset.touched)
    supportSubject.value = defaultSubjectFor(type);
  supportDiagnostics.checked = t.diagnostics;
}

function updateSupportCount() {
  const max = supportMessage.getAttribute("maxlength") || 1500;
  supportCount.textContent = `${supportMessage.value.length} / ${max}`;
}

function openSupportModal() {
  supportType.value = "bug";
  delete supportSubject.dataset.touched;
  supportMessage.value = "";
  if (supportReplyTo)
    supportReplyTo.value = localStorage.getItem("supportReplyTo") || "";
  if (supportBotcheck) supportBotcheck.checked = false;
  applySupportType();
  updateSupportCount();
  setSupportStatus("", null);
  setSupportBusy(false);

  const enabled = supportServiceEnabled();
  // The reply-to field only helps when we send it ourselves; a mail draft
  // already carries the user's address.
  const emailGroup = document.getElementById("supportEmailGroup");
  if (emailGroup) emailGroup.classList.toggle("hidden", !enabled);
  const fallbackBtn = document.getElementById("supportMailtoFallback");
  if (fallbackBtn) fallbackBtn.classList.toggle("hidden", !enabled);

  supportModal.classList.remove("hidden");
  // Don't grab the textarea on a phone: the keyboard springs up and covers the
  // dialog before the user has read what it's for. On a wide screen the composer
  // is what you came for, so focus it.
  const narrow =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 767px)").matches;
  if (!narrow) supportMessage.focus();
}

function closeSupportModal() {
  supportModal.classList.add("hidden");
}

/* Returns the mailto URL, or null when there's nothing to send. Kept separate
   from the navigation below so the composed message can be reasoned about. */
function buildSupportMailto() {
  const message = supportMessage.value.trim();
  if (!message) return null;
  const subject =
    supportSubject.value.trim() || defaultSubjectFor(supportType.value);
  const body =
    message + (supportDiagnostics.checked ? supportDiagnosticsBlock() : "");
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function sendSupportEmail() {
  const url = buildSupportMailto();
  if (!url) {
    supportMessage.focus();
    return;
  }
  window.location.href = url;
  closeSupportModal();
  showToast(
    "Opening your email app — nothing is sent until you hit send there.",
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Guards against a second submit while one is in flight. The disabled button
// covers mouse clicks, but Ctrl+Enter bypasses it.
let supportSending = false;

/* Posts straight to Web3Forms. Any failure — offline, over quota, network —
   leaves the modal open and points the user at the mail-client fallback, so a
   message is never silently lost. */
async function submitSupportViaService() {
  if (supportSending) return;
  const message = supportMessage.value.trim();
  if (!message) {
    supportMessage.focus();
    return;
  }

  const replyTo = supportReplyTo ? supportReplyTo.value.trim() : "";
  if (replyTo && !EMAIL_RE.test(replyTo)) {
    setSupportStatus(
      "That email address looks incomplete — fix it, or clear it to send anonymously.",
      "error",
    );
    supportReplyTo.focus();
    return;
  }
  if (supportBotcheck && supportBotcheck.checked) return; // honeypot tripped
  if (navigator.onLine === false) {
    setSupportStatus(
      "You're offline, so this can't be sent right now. Open a draft in your email app instead — it'll go out when you reconnect.",
      "error",
    );
    return;
  }

  const payload = {
    access_key: WEB3FORMS_ACCESS_KEY,
    subject:
      supportSubject.value.trim() || defaultSubjectFor(supportType.value),
    from_name: "PomoDone Support",
    message:
      message + (supportDiagnostics.checked ? supportDiagnosticsBlock() : ""),
    botcheck: false,
  };
  if (replyTo) {
    payload.email = replyTo;
    payload.name = replyTo;
  }

  supportSending = true;
  setSupportBusy(true);
  setSupportStatus("Sending…", "info");
  try {
    const res = await fetch(WEB3FORMS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok || data.success === false) {
      throw new Error(data.message || `the service returned ${res.status}`);
    }
    if (replyTo) localStorage.setItem("supportReplyTo", replyTo);
    setSupportStatus("", null);
    closeSupportModal();
    showToast(
      replyTo
        ? "Message sent — I'll reply to " + replyTo
        : "Message sent. Thank you!",
    );
  } catch (err) {
    console.error("Support send failed", err);
    setSupportStatus(
      `Couldn't send — ${err.message}. Your message is still here; open a draft in your email app instead.`,
      "error",
    );
  } finally {
    supportSending = false;
    setSupportBusy(false);
  }
}

if (supportModal) {
  const supportBtn = document.getElementById("supportBtn");
  if (supportBtn) supportBtn.addEventListener("click", openSupportModal);
  document
    .getElementById("supportClose")
    .addEventListener("click", closeSupportModal);
  document
    .getElementById("supportCancel")
    .addEventListener("click", closeSupportModal);
  document.getElementById("supportSend").addEventListener("click", () => {
    if (supportServiceEnabled()) submitSupportViaService();
    else sendSupportEmail();
  });
  const fallbackBtn = document.getElementById("supportMailtoFallback");
  if (fallbackBtn) fallbackBtn.addEventListener("click", sendSupportEmail);
  supportModal.addEventListener("click", (e) => {
    if (e.target === supportModal) closeSupportModal();
  });
  supportType.addEventListener("change", applySupportType);
  supportSubject.addEventListener("input", () => {
    supportSubject.dataset.touched = "1";
  });
  supportMessage.addEventListener("input", updateSupportCount);
  supportMessage.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (supportServiceEnabled()) submitSupportViaService();
      else sendSupportEmail();
    }
  });
  const supportMailLink = document.getElementById("supportMailLink");
  if (supportMailLink) {
    supportMailLink.textContent = SUPPORT_EMAIL;
    supportMailLink.href = "mailto:" + SUPPORT_EMAIL;
  }
  document.getElementById("supportCopy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      showToast("Email address copied");
    } catch {
      showToast("Copy failed — the address is shown above");
    }
  });
}

/* ===== Dashboard Quotes =====
   The pool lives in quotes.json — 100 curated quotes, each tagged time /
   success / hardwork. No external quotes API is involved: api.quotable.io (the
   old primary) is offline and dummyjson / zenquotes serve untagged random
   quotes, which is how off-topic ones slipped in. quotes.json is precached by
   the service worker, so this keeps working offline.
   To add a quote, append an entry to quotes.json with a matching topic. */
const QUOTES_URL = "quotes.json";
// One quote, not three: the dashboard's left column also carries Today's
// Schedule now, and three cards crowded it out.
const QUOTES_SHOWN = 1;
const QUOTE_TOPIC_LABELS = {
  time: "Time",
  success: "Success",
  hardwork: "Hard Work",
};

let quotePool = [];
let quotesState = "loading"; // loading | ready | error
let lastQuoteKeys = []; // previous draw, so a re-render never repeats it

function loadQuotes() {
  return fetch(QUOTES_URL)
    .then((res) => {
      if (!res.ok) throw new Error(QUOTES_URL + " " + res.status);
      return res.json();
    })
    .then((data) => {
      const labels = (data && data.topics) || QUOTE_TOPIC_LABELS;
      quotePool = ((data && data.quotes) || []).filter(
        (q) => q && q.q && q.a && labels[q.topic],
      );
      Object.assign(QUOTE_TOPIC_LABELS, labels);
      quotesState = quotePool.length > 0 ? "ready" : "error";
    })
    .catch((err) => {
      console.error("Could not load " + QUOTES_URL, err);
      quotesState = "error";
    })
    .then(() => renderDashboardQuotes());
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/* Random draw across the whole pool — distinct within a render, and never a
   straight repeat of the previous draw. */
function pickQuotes(n) {
  if (quotePool.length === 0) return [];
  const fresh = quotePool.filter((q) => !lastQuoteKeys.includes(q.q));
  const source = fresh.length >= n ? fresh : quotePool;
  const picks = shuffle(source).slice(0, Math.min(n, source.length));
  lastQuoteKeys = picks.map((p) => p.q);
  return picks;
}

function renderDashboardQuotes() {
  const container = document.getElementById("dashQuotes");
  if (!container) return;
  if (quotesState === "error") {
    container.innerHTML =
      '<p class="text-xs text-on-surface-variant opacity-50">Quotes unavailable right now.</p>';
    return;
  }
  const picks = pickQuotes(QUOTES_SHOWN);
  if (picks.length === 0) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = picks
    .map((quote) => {
      const label = QUOTE_TOPIC_LABELS[quote.topic] || quote.topic;
      return `
      <div class="organic-card stitch-border p-4 bg-surface-container-low flex items-start gap-3">
        <span class="material-symbols-outlined text-outline-variant shrink-0" style="font-size:20px">format_quote</span>
        <div class="min-w-0">
          <span class="quote-topic quote-topic-${quote.topic}">${label}</span>
          <p class="font-body text-sm italic text-on-surface-variant leading-relaxed">"${escapeHtml(quote.q)}"<br><span class="not-italic font-semibold text-xs opacity-60">&mdash; ${escapeHtml(quote.a)}</span></p>
        </div>
      </div>`;
    })
    .join("");
}

/* ===== Dashboard Up Next ===== */
function renderDashboardUpNext() {
  const container = document.getElementById("dashTaskList");
  if (!container) return;
  const today = localDateKey(new Date());
  const pending = todos.filter((t) => !t.done);
  if (pending.length === 0) {
    container.innerHTML =
      '<div class="text-center py-8 text-sm text-on-surface-variant opacity-60">No pending tasks. Add a task to get started!</div>';
    return;
  }
  const todayTasks = pending.filter((t) => t.dueDate === today);
  const otherTasks = pending.filter((t) => t.dueDate !== today);
  let ordered = [];
  if (goldenTaskId) {
    const golden = pending.find((t) => t.id === goldenTaskId);
    if (golden) ordered.push(golden);
  }
  if (activeTaskId) {
    const active = pending.find((t) => t.id === activeTaskId);
    if (active && !ordered.some((t) => t.id === active.id))
      ordered.push(active);
  }
  todayTasks.forEach((t) => {
    if (!ordered.some((o) => o.id === t.id)) ordered.push(t);
  });
  otherTasks.forEach((t) => {
    if (!ordered.some((o) => o.id === t.id)) ordered.push(t);
  });
  const maxShow = 8;
  const shown = ordered.slice(0, maxShow);
  container.innerHTML = shown
    .map((t, idx) => {
      const isGolden = t.id === goldenTaskId;
      const isActive = t.id === activeTaskId;
      const starIcon = isGolden
        ? '<span class="material-symbols-outlined fill text-tertiary text-sm">stars</span>'
        : "";
      const goldenCls = isGolden ? "golden-item" : "";
      const isDueToday = t.dueDate === today;
      const sub = subtaskProgress(t);
      const subMeta = sub.total > 0 ? ` • ☑ ${sub.done}/${sub.total}` : "";
      const meta =
        (isDueToday
          ? "Today"
          : t.dueDate
            ? t.dueDate
            : `${t.pomodoros || 0} POMOS`) + subMeta;
      const playIcon = isActive ? "pause_circle" : "play_circle";

      // Collapsible checklist, shown only for tasks that have subtasks. Dragging is
      // disabled while a panel is open so its checkboxes stay clickable.
      const subOpen = dashExpandedSubtasks.has(t.id);
      const subToggle =
        sub.total > 0
          ? `<button class="dash-subtask-toggle" data-task-id="${t.id}" aria-expanded="${subOpen}" title="${subOpen ? "Hide" : "Show"} subtasks" aria-label="${subOpen ? "Hide" : "Show"} ${sub.total} subtasks">
           <span class="material-symbols-outlined">${subOpen ? "expand_less" : "expand_more"}</span>
         </button>`
          : "";
      const subPanel =
        sub.total > 0 && subOpen
          ? `<ul class="dash-subtask-list">
           ${getSubtasks(t)
             .map(
               (s) => `
             <li class="dash-subtask-item${s.done ? " done" : ""}">
               <button class="dash-subtask-check material-symbols-outlined" data-task-id="${t.id}" data-sub-id="${s.id}" aria-label="${s.done ? "Mark subtask not done" : "Mark subtask done"}">${s.done ? "check_circle" : "radio_button_unchecked"}</button>
               <span class="dash-subtask-text" role="button" tabindex="0" title="Click to rename">${escapeHtml(s.title)}</span>
             </li>`,
             )
             .join("")}
         </ul>`
          : "";

      return `<div class="dash-task-item p-3 rounded-xl border-l-4 bg-surface-container-low border-l-surface-container transition-all hover:translate-x-1 ${goldenCls}" draggable="${!subOpen}" data-idx="${idx}" data-task-id="${t.id}">
      <div class="dash-task-main flex items-center gap-2">
        <span class="material-symbols-outlined text-outline-variant text-lg drag-handle-dash" style="cursor:grab">drag_indicator</span>
        <button class="dash-task-play material-symbols-outlined text-lg ${isActive ? "text-secondary" : "text-primary"} hover:scale-110 transition-transform shrink-0" data-task-id="${t.id}" aria-label="${isActive ? "Pause" : "Focus on this task"}">${playIcon}</button>
        <button class="dash-task-check material-symbols-outlined text-sm ${t.done ? "text-secondary" : "text-outline-variant"} hover:text-secondary hover:scale-110 transition-all shrink-0" data-task-id="${t.id}" aria-label="Mark task complete">${t.done ? "check_circle" : "radio_button_unchecked"}</button>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold truncate">${escapeHtml(t.title)}</p>
          <p class="text-[10px] font-mono opacity-50">${t.project ? escapeHtml(t.project.toUpperCase()) + " • " : ""}${meta}</p>
        </div>
        ${subToggle}
        ${starIcon}
      </div>
      ${subPanel}
    </div>`;
    })
    .join("");
  container._shownTasks = shown;
  setupDashDragDrop(container);
}

document.addEventListener("click", async function _dashPlayHandler(e) {
  const btn = e.target.closest(".dash-task-play");
  if (!btn) return;
  const taskId = btn.dataset.taskId;
  if (!taskId) return;
  const todo = todos.find((t) => t.id === taskId);
  if (!todo) return;
  e.stopPropagation();
  if (activeTaskId && activeTaskId !== taskId) {
    const current = getActiveTask();
    if (
      !(await showConfirmModal(
        `You're focusing on "${current ? current.title : "a task"}". Switch to "${todo.title}"?`,
      ))
    )
      return;
  }
  setActiveTask(taskId);
  if (pomState.phase !== "focus") {
    pomState.phase = "focus";
    pomState.endsAt = null;
    pomState.timeLeft = FOCUS_TIME;
    updatePhaseLabel();
    updateDisplay();
    updateDashPhaseTabs();
    updateDashDots();
    updateCurrentTaskDisplay();
  }
  startTimer();
});

document.addEventListener("click", function _dashCheckHandler(e) {
  const btn = e.target.closest(".dash-task-check");
  if (!btn) return;
  e.stopPropagation();
  const taskId = btn.dataset.taskId;
  if (!taskId) return;
  const todo = todos.find((t) => t.id === taskId);
  if (!todo) return;
  toggleTodoDone(todo, !todo.done);
});

/* Dashboard: expand/collapse a task's checklist in place */
document.addEventListener("click", function _dashSubtaskToggleHandler(e) {
  const btn = e.target.closest(".dash-subtask-toggle");
  if (!btn) return;
  e.stopPropagation();
  const taskId = btn.dataset.taskId;
  if (!taskId) return;
  if (dashExpandedSubtasks.has(taskId)) dashExpandedSubtasks.delete(taskId);
  else dashExpandedSubtasks.add(taskId);
  renderDashboardUpNext();
});

/* Dashboard: tick a subtask off without leaving the dashboard */
document.addEventListener("click", function _dashSubtaskCheckHandler(e) {
  const btn = e.target.closest(".dash-subtask-check");
  if (!btn) return;
  e.stopPropagation();
  const todo = todos.find((t) => t.id === btn.dataset.taskId);
  if (!todo) return;
  const sub = getSubtasks(todo).find((s) => s.id === btn.dataset.subId);
  if (!sub) return;
  toggleSubtaskDone(todo, sub.id, !sub.done);
});

/* Dashboard: rename a subtask in place. The task/subtask ids live on the sibling
   check button, so they're read from there rather than duplicated onto the text. */
function dashSubtaskFromNode(node) {
  const item = node.closest(".dash-subtask-item");
  const check = item && item.querySelector(".dash-subtask-check");
  if (!check) return null;
  const todo = todos.find((t) => t.id === check.dataset.taskId);
  if (!todo) return null;
  const sub = getSubtasks(todo).find((s) => s.id === check.dataset.subId);
  return sub ? { todo, sub } : null;
}

document.addEventListener("click", function _dashSubtaskEditHandler(e) {
  const el = e.target.closest(".dash-subtask-text");
  if (!el) return;
  e.stopPropagation();
  const found = dashSubtaskFromNode(el);
  if (found) beginInlineSubtaskEdit(found.todo, found.sub, el);
});

document.addEventListener("keydown", function _dashSubtaskEditKeyHandler(e) {
  if (e.key !== "Enter" && e.key !== " ") return;
  const el = e.target.closest && e.target.closest(".dash-subtask-text");
  if (!el) return;
  e.preventDefault();
  const found = dashSubtaskFromNode(el);
  if (found) beginInlineSubtaskEdit(found.todo, found.sub, el);
});

/* Bound exactly once. The previous version called removeEventListener with
   freshly created closures — a no-op — so every re-render stacked another set of
   handlers, each holding a stale task list, and one drop spliced the array
   several times. The current row list is read from container._shownTasks. */
let dashDragBound = false;

function setupDashDragDrop(container) {
  if (dashDragBound) return;
  dashDragBound = true;
  const rows = () => container._shownTasks || [];
  let dragSrcIdx = null;
  const onDragStart = (e) => {
    const item = e.target.closest(".dash-task-item");
    if (!item) return;
    dragSrcIdx = parseInt(item.dataset.idx);
    item.classList.add("opacity-30");
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragEnd = () => {
    container
      .querySelectorAll(".dash-task-item")
      .forEach((el) =>
        el.classList.remove("opacity-30", "border-t-2", "border-primary"),
      );
    dragSrcIdx = null;
  };
  const onDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const item = e.target.closest(".dash-task-item");
    if (!item) return;
    container
      .querySelectorAll(".dash-task-item")
      .forEach((el) => el.classList.remove("border-t-2", "border-primary"));
    item.classList.add("border-t-2", "border-primary");
  };
  const onDrop = (e) => {
    e.preventDefault();
    if (dragSrcIdx === null) return;
    const target = e.target.closest(".dash-task-item");
    if (!target) return;
    const targetIdx = parseInt(target.dataset.idx);
    if (dragSrcIdx === targetIdx) return;
    const shown = rows();
    const srcTask = shown[dragSrcIdx];
    const targetTask = shown[targetIdx];
    if (!srcTask || !targetTask) return;
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
  container.addEventListener("dragstart", onDragStart);
  container.addEventListener("dragend", onDragEnd);
  container.addEventListener("dragover", onDragOver);
  container.addEventListener("drop", onDrop);
}

/* ===== Calendar =====
   A task owns its time blocks (`schedule: [{ id, date, start, end }]`), and the
   calendar is nothing but a view over the flattened set of them. Storing blocks
   on the task rather than per-day means deleting or completing a task can't leave
   an orphaned entry behind, and one task can hold as many blocks as it needs. */
const CAL_HOUR_PX = 44; // rendered height of one hour in the week/day grid
const CAL_DEFAULT_START = "09:00";
const CAL_DEFAULT_MINUTES = 60;
const CAL_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const CAL_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

let calView = localStorage.getItem("calView") || "month";
if (!["month", "week", "day"].includes(calView)) calView = "month";
let calCursor = calStartOfDay(new Date());

function calStartOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function calAddDays(d, n) {
  const x = calStartOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}

/* Weeks start Sunday, matching the stats heatmap already in the app. */
function calStartOfWeek(d) {
  const x = calStartOfDay(d);
  return calAddDays(x, -x.getDay());
}

function calParseKey(key) {
  const p = String(key).split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

/* 'HH:MM' -> minutes past midnight, or null when it isn't a valid time. */
function calMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return null;
  const h = +m[1];
  const mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function calHHMM(mins) {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(mins)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/* Locale-formatted, so 24h locales get 09:00 and 12h locales get 9:00 AM. */
function calFormatTime(hhmm) {
  const mins = calMinutes(hhmm);
  if (mins === null) return String(hhmm || "");
  const d = new Date(2000, 0, 1, Math.floor(mins / 60), mins % 60);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function calFormatHour(hour) {
  const d = new Date(2000, 0, 1, hour, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric" });
}

function taskSchedule(todo) {
  if (!Array.isArray(todo.schedule)) todo.schedule = [];
  return todo.schedule;
}

function makeScheduleBlock(date, start, end, extra) {
  return {
    id: crypto.randomUUID(),
    date, // for a repeating block this is the first occurrence
    start,
    end,
    repeat: "none",
    interval: 1,
    until: null, // inclusive last date, or null for "forever"
    exdates: [], // occurrences deleted or overridden individually
    ...extra,
  };
}

function isValidBlock(b) {
  if (!b || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ""))) return false;
  const s = calMinutes(b.start);
  const e = calMinutes(b.end);
  return s !== null && e !== null && e > s;
}

/* ===== Recurrence =====
   A repeating block stores a rule instead of one row per occurrence, so the
   series stays a single editable thing and can run forever without filling
   storage. Occurrences are computed per rendered day. Deleting or re-timing one
   occurrence records its date in `exdates` — the same trick a calendar server
   uses — which is what lets "just this one" coexist with "the whole series". */
const CAL_REPEATS = ["none", "daily", "weekdays", "weekly", "monthly", "yearly"];
const CAL_REPEAT_LABELS = {
  none: "Does not repeat",
  daily: "Daily",
  weekdays: "Every weekday",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Annually",
};

function blockExdates(block) {
  if (!Array.isArray(block.exdates)) block.exdates = [];
  return block.exdates;
}

/* Read defensively: blocks written before recurrence existed have no `repeat`. */
function blockRepeat(block) {
  return CAL_REPEATS.includes(block.repeat) ? block.repeat : "none";
}

function blockInterval(block) {
  const n = parseInt(block.interval, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 99) : 1;
}

/* Whole days between two date keys. Rounded, not floored: these are local
   midnights, so a span crossing a DST change is 167 or 169 hours rather than a
   clean multiple of 24, and flooring would drift the whole series by a day. */
function calDayDiff(fromKey, toKey) {
  return Math.round((calParseKey(toKey) - calParseKey(fromKey)) / 86400000);
}

function blockOccursOn(block, dateKey) {
  const repeat = blockRepeat(block);
  if (repeat === "none") return block.date === dateKey;
  if (dateKey < block.date) return false;
  if (block.until && dateKey > block.until) return false;
  if (Array.isArray(block.exdates) && block.exdates.includes(dateKey))
    return false;

  const start = calParseKey(block.date);
  const day = calParseKey(dateKey);
  const step = blockInterval(block);

  if (repeat === "daily") return calDayDiff(block.date, dateKey) % step === 0;
  // Mon–Fri, and the interval doesn't apply — matching Google's "every weekday".
  if (repeat === "weekdays") return day.getDay() >= 1 && day.getDay() <= 5;
  if (repeat === "weekly") {
    if (day.getDay() !== start.getDay()) return false;
    return (calDayDiff(block.date, dateKey) / 7) % step === 0;
  }
  if (repeat === "monthly") {
    // A series on the 31st simply skips shorter months rather than sliding to
    // the 1st of the next one, which is what Google does too.
    if (day.getDate() !== start.getDate()) return false;
    const months =
      (day.getFullYear() - start.getFullYear()) * 12 +
      (day.getMonth() - start.getMonth());
    return months % step === 0;
  }
  if (repeat === "yearly") {
    if (day.getDate() !== start.getDate() || day.getMonth() !== start.getMonth())
      return false;
    return (day.getFullYear() - start.getFullYear()) % step === 0;
  }
  return false;
}

/* Human-readable rule, for the chips and the modal caption. */
function describeRepeat(block) {
  const repeat = blockRepeat(block);
  if (repeat === "none") return "";
  const step = blockInterval(block);
  const start = calParseKey(block.date);
  const dayName = start.toLocaleDateString(undefined, { weekday: "long" });
  const every = step === 1 ? "" : `${step} `;
  let text;
  if (repeat === "daily") text = step === 1 ? "Daily" : `Every ${step} days`;
  else if (repeat === "weekdays") text = "Every weekday (Mon–Fri)";
  else if (repeat === "weekly")
    text = `Every ${every}week${step === 1 ? "" : "s"} on ${dayName}`;
  else if (repeat === "monthly")
    text = `Every ${every}month${step === 1 ? "" : "s"} on day ${start.getDate()}`;
  else
    text = `Every ${every}year${step === 1 ? "" : "s"} on ${start.toLocaleDateString(undefined, { month: "long", day: "numeric" })}`;
  if (block.until)
    text += `, until ${calParseKey(block.until).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  return text;
}

/* Every occurrence landing on one local day, earliest first. `date` is the
   occurrence's own date, which is not the block's date once it repeats — callers
   must use it when they need to act on the occurrence the user clicked. */
function blocksForDate(dateKey) {
  const out = [];
  todos.forEach((t) => {
    taskSchedule(t).forEach((b) => {
      if (b && blockOccursOn(b, dateKey))
        out.push({ task: t, block: b, date: dateKey });
    });
  });
  out.sort(
    (a, b) => (calMinutes(a.block.start) ?? 0) - (calMinutes(b.block.start) ?? 0),
  );
  return out;
}

/* Side-by-side placement for overlapping blocks, the way a day column in Google
   Calendar behaves: overlapping runs form a cluster, each block takes the first
   free lane, and the cluster's lane count decides how wide everything in it is. */
function layoutDayBlocks(entries) {
  const laid = entries.map((e) => {
    const s = calMinutes(e.block.start) ?? 0;
    let end = calMinutes(e.block.end);
    // A missing or inverted end still needs a box big enough to click.
    if (end === null || end <= s) end = s + 30;
    // `date` rides along: for a repeating block it is the occurrence's date, and
    // the click handler needs it to know which occurrence was hit.
    return {
      task: e.task,
      block: e.block,
      date: e.date,
      start: s,
      end: Math.min(end, 24 * 60),
    };
  });

  const clusters = [];
  let current = [];
  let clusterEnd = -1;
  laid.forEach((b) => {
    if (current.length && b.start >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -1;
    }
    current.push(b);
    clusterEnd = Math.max(clusterEnd, b.end);
  });
  if (current.length) clusters.push(current);

  const result = [];
  clusters.forEach((cluster) => {
    const laneEnds = [];
    cluster.forEach((b) => {
      let lane = laneEnds.findIndex((endAt) => endAt <= b.start);
      if (lane === -1) {
        laneEnds.push(b.end);
        lane = laneEnds.length - 1;
      } else {
        laneEnds[lane] = b.end;
      }
      b.lane = lane;
    });
    cluster.forEach((b) => {
      b.lanes = laneEnds.length;
      result.push(b);
    });
  });
  return result;
}

function calLabelText() {
  if (calView === "month")
    return `${CAL_MONTH_NAMES[calCursor.getMonth()]} ${calCursor.getFullYear()}`;
  if (calView === "day")
    return calCursor.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  const start = calStartOfWeek(calCursor);
  const end = calAddDays(start, 6);
  const opts = { month: "short", day: "numeric" };
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}, ${end.getFullYear()}`;
}

function calBlockHtml(entry) {
  const { task, block, date, start, end, lane, lanes } = entry;
  const top = (start / 60) * CAL_HOUR_PX;
  const height = Math.max(18, ((end - start) / 60) * CAL_HOUR_PX);
  const width = 100 / lanes;
  const range = `${calFormatTime(block.start)} – ${calFormatTime(block.end)}`;
  const rule = describeRepeat(block);
  const cls = [
    "cal-block",
    task.done ? "done" : "",
    task.id === goldenTaskId ? "golden" : "",
    task.id === activeTaskId ? "active" : "",
    rule ? "repeating" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const tip = `${range} — ${task.title}${rule ? ` (${rule})` : ""}`;
  return `<div class="${cls}" style="top:${top}px;height:${height}px;left:${lane * width}%;width:calc(${width}% - 3px)"
      data-task-id="${task.id}" data-block-id="${block.id}" data-date="${date}"
      title="${escapeHtml(tip)}" role="button" tabindex="0">
      <span class="cal-block-time">${escapeHtml(range)}${rule ? '<span class="cal-repeat-mark" aria-label="Repeating">↻</span>' : ""}</span>
      <span class="cal-block-title">${escapeHtml(task.title)}</span>
      ${task.project ? `<span class="cal-block-project">${escapeHtml(task.project)}</span>` : ""}
      <button class="cal-block-del" data-task-id="${task.id}" data-block-id="${block.id}" data-date="${date}" aria-label="Unschedule this block" title="Unschedule">&times;</button>
    </div>`;
}

/* Shared by the week (7 columns) and day (1 column) views. */
function renderCalTimeGridHTML(dayCount) {
  const first =
    dayCount === 7 ? calStartOfWeek(calCursor) : calStartOfDay(calCursor);
  const days = Array.from({ length: dayCount }, (_, i) => calAddDays(first, i));
  const todayKey = localDateKey(new Date());
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

  const heads = days
    .map((d) => {
      const key = localDateKey(d);
      return `<div class="cal-day-head${key === todayKey ? " is-today" : ""}" data-date="${key}">
        <span class="cal-day-name">${CAL_DAY_NAMES[d.getDay()]}</span>
        <span class="cal-day-num">${d.getDate()}</span>
      </div>`;
    })
    .join("");

  const hourLabels = Array.from(
    { length: 24 },
    (_, h) =>
      `<div class="cal-hour-label" style="height:${CAL_HOUR_PX}px">${h === 0 ? "" : escapeHtml(calFormatHour(h))}</div>`,
  ).join("");

  const columns = days
    .map((d) => {
      const key = localDateKey(d);
      const slots = Array.from(
        { length: 24 },
        (_, h) =>
          `<div class="cal-slot" data-date="${key}" data-hour="${h}" style="top:${h * CAL_HOUR_PX}px;height:${CAL_HOUR_PX}px"></div>`,
      ).join("");
      const blocks = layoutDayBlocks(blocksForDate(key))
        .map((entry) => calBlockHtml(entry))
        .join("");
      const now =
        key === todayKey
          ? `<div class="cal-now" style="top:${(nowMinutes / 60) * CAL_HOUR_PX}px"></div>`
          : "";
      return `<div class="cal-day-col${key === todayKey ? " is-today" : ""}" data-date="${key}" style="height:${24 * CAL_HOUR_PX}px">${slots}${now}${blocks}</div>`;
    })
    .join("");

  // The day headers live inside the scroller (sticky, so they stay on screen)
  // rather than above it — a week grid scrolls sideways on a narrow screen, and
  // headers outside the scroller would drift out of line with their columns.
  return `<div class="cal-grid ${dayCount === 7 ? "is-week" : "is-day"}">
      <div class="cal-grid-scroll">
        <div class="cal-grid-inner">
          <div class="cal-grid-head"><div class="cal-gutter-head"></div>${heads}</div>
          <div class="cal-grid-body">
            <div class="cal-gutter">${hourLabels}</div>
            ${columns}
          </div>
        </div>
      </div>
    </div>`;
}

function renderCalMonthHTML() {
  const month = calCursor.getMonth();
  const gridStart = calStartOfWeek(
    new Date(calCursor.getFullYear(), month, 1),
  );
  const todayKey = localDateKey(new Date());
  const MAX_CHIPS = 3;

  const heads = CAL_DAY_NAMES.map(
    (n) => `<div class="cal-month-dayname">${n}</div>`,
  ).join("");

  let cells = "";
  for (let i = 0; i < 42; i++) {
    const d = calAddDays(gridStart, i);
    const key = localDateKey(d);
    const entries = blocksForDate(key);
    const chips = entries
      .slice(0, MAX_CHIPS)
      .map(({ task, block }) => {
        const rule = describeRepeat(block);
        const tip = `${calFormatTime(block.start)} – ${calFormatTime(block.end)} — ${task.title}${rule ? ` (${rule})` : ""}`;
        return `<button class="cal-chip${task.done ? " done" : ""}${rule ? " repeating" : ""}" data-task-id="${task.id}" data-block-id="${block.id}" data-date="${key}" title="${escapeHtml(tip)}">
            <span class="cal-chip-time">${escapeHtml(calFormatTime(block.start))}</span>
            <span class="cal-chip-title">${escapeHtml(task.title)}</span>
            ${rule ? '<span class="cal-repeat-mark" aria-label="Repeating">↻</span>' : ""}
          </button>`;
      })
      .join("");
    const more =
      entries.length > MAX_CHIPS
        ? `<button class="cal-more" data-goto-day="${key}">+${entries.length - MAX_CHIPS} more</button>`
        : "";
    const cls = [
      "cal-month-cell",
      d.getMonth() === month ? "" : "other-month",
      key === todayKey ? "is-today" : "",
    ]
      .filter(Boolean)
      .join(" ");
    cells += `<div class="${cls}" data-date="${key}">
        <button class="cal-month-daynum" data-goto-day="${key}" title="Open this day">${d.getDate()}</button>
        <div class="cal-month-events">${chips}${more}</div>
      </div>`;
  }

  return `<div class="cal-month">
      <div class="cal-month-head">${heads}</div>
      <div class="cal-month-grid">${cells}</div>
    </div>`;
}

// What the grid was last built for. Re-rendering the same view of the same date
// (a task ticked off elsewhere, say) has to leave the scroll position alone —
// only a genuine view or date change earns a jump back to the interesting hour.
let calLastRenderKey = null;

function renderCalendar() {
  const content = document.getElementById("calendarContent");
  if (!content) return;
  const label = document.getElementById("calLabel");
  if (label) label.textContent = calLabelText();
  document
    .querySelectorAll("#calViewSwitch .cal-view-btn")
    .forEach((b) => b.classList.toggle("active", b.dataset.calView === calView));

  const oldScroller = content.querySelector(".cal-grid-scroll");
  const prevScroll = oldScroller
    ? { top: oldScroller.scrollTop, left: oldScroller.scrollLeft }
    : null;
  const renderKey = `${calView}|${localDateKey(calCursor)}`;

  content.innerHTML =
    calView === "month"
      ? renderCalMonthHTML()
      : renderCalTimeGridHTML(calView === "week" ? 7 : 1);

  if (calView !== "month") {
    const scroller = content.querySelector(".cal-grid-scroll");
    if (scroller && prevScroll && renderKey === calLastRenderKey) {
      scroller.scrollTop = prevScroll.top;
      scroller.scrollLeft = prevScroll.left;
    } else {
      calScrollToInterestingHour(content);
    }
  }
  calLastRenderKey = renderKey;
}

/* Open the time grid where the day actually is rather than at midnight: the
   earliest scheduled block, or the current hour when nothing is scheduled. */
function calScrollToInterestingHour(content) {
  const scroller = content.querySelector(".cal-grid-scroll");
  if (!scroller) return;
  const blocks = [...content.querySelectorAll(".cal-block")];
  let top;
  if (blocks.length) {
    top = Math.min(...blocks.map((b) => parseFloat(b.style.top) || 0));
  } else {
    top = new Date().getHours() * CAL_HOUR_PX;
  }
  scroller.scrollTop = Math.max(0, top - CAL_HOUR_PX);
}

function setCalView(view) {
  calView = view;
  localStorage.setItem("calView", view);
  renderCalendar();
}

function calShift(direction) {
  if (calView === "month") {
    calCursor = new Date(
      calCursor.getFullYear(),
      calCursor.getMonth() + direction,
      1,
    );
  } else {
    calCursor = calAddDays(calCursor, direction * (calView === "week" ? 7 : 1));
  }
  renderCalendar();
}

/* ===== Schedule modal ===== */
const scheduleModal = document.getElementById("scheduleModal");
const schedTaskSelect = document.getElementById("schedTask");
const schedNewTitle = document.getElementById("schedNewTitle");
const schedDate = document.getElementById("schedDate");
const schedStart = document.getElementById("schedStart");
const schedEnd = document.getElementById("schedEnd");
const schedTaskIdField = document.getElementById("schedTaskId");
const schedBlockIdField = document.getElementById("schedBlockId");
const schedError = document.getElementById("schedError");
const schedRepeat = document.getElementById("schedRepeat");
const schedInterval = document.getElementById("schedInterval");
const schedUntil = document.getElementById("schedUntil");
const NEW_TASK_OPTION = "__new__";
// Which occurrence the modal was opened for. schedDate.value starts out equal to
// it but the user can move it, and "just this occurrence" has to exclude the date
// that was clicked, not the one that was typed.
let schedOccurrenceDate = null;
const CAL_INTERVAL_UNITS = {
  daily: "day(s)",
  weekly: "week(s)",
  monthly: "month(s)",
  yearly: "year(s)",
};

function setSchedError(msg) {
  if (!schedError) return;
  schedError.textContent = msg || "";
  schedError.classList.toggle("hidden", !msg);
}

function populateSchedTaskOptions(selectedId) {
  if (!schedTaskSelect) return;
  const options = [`<option value="${NEW_TASK_OPTION}">+ New task…</option>`];
  // Pending tasks are what you normally schedule; a completed one only appears
  // when an existing block already points at it.
  todos
    .filter((t) => !t.done || t.id === selectedId)
    .forEach((t) => {
      options.push(
        `<option value="${t.id}">${escapeHtml(t.title)}${t.done ? " (done)" : ""}</option>`,
      );
    });
  schedTaskSelect.innerHTML = options.join("");
  schedTaskSelect.value =
    selectedId && todos.some((t) => t.id === selectedId)
      ? selectedId
      : NEW_TASK_OPTION;
  syncSchedNewTitle();
}

function syncSchedNewTitle() {
  const group = document.getElementById("schedNewTitleGroup");
  if (!group || !schedTaskSelect) return;
  group.classList.toggle(
    "hidden",
    schedTaskSelect.value !== NEW_TASK_OPTION,
  );
}

/* The rule as the form currently describes it — used for the live summary line
   and as the source of truth when saving. */
function schedRepeatDraft() {
  return {
    date: schedDate.value,
    repeat: schedRepeat ? schedRepeat.value : "none",
    interval: schedInterval ? parseInt(schedInterval.value, 10) || 1 : 1,
    until: schedUntil && schedUntil.value ? schedUntil.value : null,
  };
}

function syncSchedRepeatUI() {
  if (!schedRepeat) return;
  const repeat = schedRepeat.value;
  const detail = document.getElementById("schedRepeatDetail");
  if (detail) detail.classList.toggle("hidden", repeat === "none");
  // "Every weekday" is already a fixed pattern; an interval on top of it would
  // mean nothing.
  const intervalGroup = document.getElementById("schedIntervalGroup");
  if (intervalGroup)
    intervalGroup.classList.toggle("hidden", repeat === "weekdays");
  const unit = document.getElementById("schedIntervalUnit");
  if (unit) unit.textContent = CAL_INTERVAL_UNITS[repeat] || "";
  const summary = document.getElementById("schedRepeatSummary");
  if (summary) {
    const draft = schedRepeatDraft();
    summary.textContent =
      repeat === "none" || !draft.date ? "" : describeRepeat(draft);
  }
}

function schedScopeValue() {
  const checked = document.querySelector(
    '#schedScope input[name="schedScope"]:checked',
  );
  return checked ? checked.value : "all";
}

/* True when the form is editing one occurrence pulled out of a series. */
function schedEditingOneOccurrence() {
  const scope = document.getElementById("schedScope");
  return (
    !!scope && !scope.classList.contains("hidden") && schedScopeValue() === "one"
  );
}

/* The rule describes the series, so it can't be redefined from a single
   occurrence — the fields lock rather than silently applying to everything. */
function syncSchedScopeUI() {
  const one = schedEditingOneOccurrence();
  [schedRepeat, schedInterval, schedUntil].forEach((el) => {
    if (el) el.disabled = one;
  });
  const note = document.getElementById("schedRepeatLocked");
  if (note) note.classList.toggle("hidden", !one);
}

function setSchedScopeVisible(visible) {
  const scope = document.getElementById("schedScope");
  if (!scope) return;
  scope.classList.toggle("hidden", !visible);
  if (visible) {
    // Default to the narrow choice, the way a calendar app does — changing one
    // occurrence is far more common, and less destructive, than the series.
    const one = scope.querySelector('input[value="one"]');
    if (one) one.checked = true;
  }
}

function openScheduleModal(opts = {}) {
  if (!scheduleModal) return;
  const startMins = calMinutes(opts.start) ?? calMinutes(CAL_DEFAULT_START);
  const endMins = calMinutes(opts.end) ?? startMins + CAL_DEFAULT_MINUTES;
  schedTaskIdField.value = opts.taskId || "";
  schedBlockIdField.value = opts.blockId || "";
  schedOccurrenceDate = opts.date || null;
  schedDate.value = opts.date || localDateKey(new Date());
  schedStart.value = calHHMM(startMins);
  schedEnd.value = calHHMM(Math.min(endMins, 24 * 60 - 1));
  if (schedNewTitle) schedNewTitle.value = "";
  if (schedRepeat) schedRepeat.value = opts.repeat || "none";
  if (schedInterval) schedInterval.value = opts.interval || 1;
  if (schedUntil) schedUntil.value = opts.until || "";
  syncSchedRepeatUI();
  populateSchedTaskOptions(opts.taskId);
  // The task of an existing block is fixed — moving a block between tasks would
  // be an unexpected side effect of editing its time.
  schedTaskSelect.disabled = !!opts.blockId;
  // Editing one occurrence of a series needs the "which ones?" question asked
  // up front, so Save and Unschedule both have an answer already.
  setSchedScopeVisible(!!opts.blockId && (opts.repeat || "none") !== "none");
  syncSchedScopeUI();
  const title = document.getElementById("scheduleModalTitle");
  if (title)
    title.textContent = opts.blockId ? "Edit time block" : "Schedule a task";
  const del = document.getElementById("scheduleDelete");
  if (del) del.classList.toggle("hidden", !opts.blockId);
  setSchedError("");
  scheduleModal.classList.remove("hidden");
  (opts.blockId ? schedStart : schedTaskSelect).focus();
}

function closeScheduleModal() {
  if (scheduleModal) scheduleModal.classList.add("hidden");
}

function saveScheduleModal() {
  const date = schedDate.value;
  const start = schedStart.value;
  const end = schedEnd.value;
  if (!date) return setSchedError("Pick a date for this block.");
  const s = calMinutes(start);
  const e = calMinutes(end);
  if (s === null || e === null)
    return setSchedError("Give the block a start and an end time.");
  if (e <= s) return setSchedError("The end time has to be after the start.");

  // A single occurrence being pulled out of a series carries no rule of its own,
  // so the series' end date isn't its business — it may legitimately be moved
  // past it.
  const justThisOne = schedEditingOneOccurrence();
  const rule = schedRepeatDraft();
  if (!justThisOne && rule.repeat !== "none" && rule.until && rule.until < date)
    return setSchedError(
      "The repeat can't end before the first occurrence — clear the end date or move it later.",
    );

  let task;
  const blockId = schedBlockIdField.value;
  if (blockId) {
    task = todos.find((t) => t.id === schedTaskIdField.value);
    if (!task) return setSchedError("That task no longer exists.");
  } else if (schedTaskSelect.value === NEW_TASK_OPTION) {
    const title = (schedNewTitle && schedNewTitle.value.trim()) || "";
    if (!title) {
      setSchedError("Give the new task a title.");
      if (schedNewTitle) schedNewTitle.focus();
      return;
    }
    task = makeTodo({ title });
    todos.push(task);
  } else {
    task = todos.find((t) => t.id === schedTaskSelect.value);
    if (!task) return setSchedError("Pick a task to schedule.");
  }

  const blocks = taskSchedule(task);
  const existing = blockId ? blocks.find((b) => b.id === blockId) : null;
  const fields = {
    date,
    start,
    end,
    repeat: rule.repeat,
    interval: rule.interval,
    until: rule.until,
  };
  if (!existing) {
    blocks.push(makeScheduleBlock(date, start, end, fields));
  } else if (justThisOne) {
    // One occurrence pulled out of the series: exclude the original date and add
    // a standalone block in its place. This is how a calendar server records an
    // overridden occurrence, and it keeps the rest of the series untouched.
    const originalDate = schedOccurrenceDate || existing.date;
    blockExdates(existing).push(originalDate);
    blocks.push(makeScheduleBlock(date, start, end));
  } else {
    Object.assign(existing, fields);
    // A series that stops repeating has no exceptions left to honour.
    if (fields.repeat === "none") existing.exdates = [];
  }
  blocks.sort(
    (a, b) =>
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      (calMinutes(a.start) ?? 0) - (calMinutes(b.start) ?? 0),
  );

  saveTodos();
  closeScheduleModal();
  renderTagCloud();
  // renderTodos ends in renderScheduleSurfaces, which repaints the grid and the
  // dashboard panel — no separate calendar render needed here.
  renderTodos();
}

/* Drops the whole block — the single date for a one-off, every date for a series. */
function unscheduleBlock(taskId, blockId) {
  const task = todos.find((t) => t.id === taskId);
  if (!task) return;
  const blocks = taskSchedule(task);
  const idx = blocks.findIndex((b) => b.id === blockId);
  if (idx === -1) return;
  const [removed] = blocks.splice(idx, 1);
  const repeating = blockRepeat(removed) !== "none";
  saveTodos();
  renderTodos();
  showToast(
    repeating
      ? `Removed the whole series for "${task.title}"`
      : `Unscheduled "${task.title}"`,
    () => {
      taskSchedule(task).splice(idx, 0, removed);
      saveTodos();
      renderTodos();
    },
  );
}

/* Drops one date out of a series, leaving the rest of it alone. */
function unscheduleOccurrence(taskId, blockId, dateKey) {
  const task = todos.find((t) => t.id === taskId);
  if (!task) return;
  const block = taskSchedule(task).find((b) => b.id === blockId);
  if (!block || !dateKey) return;
  const exdates = blockExdates(block);
  if (exdates.includes(dateKey)) return;
  exdates.push(dateKey);
  saveTodos();
  renderTodos();
  const when = calParseKey(dateKey).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  showToast(`Skipped ${when} for "${task.title}"`, () => {
    const list = blockExdates(block);
    const i = list.indexOf(dateKey);
    if (i !== -1) list.splice(i, 1);
    saveTodos();
    renderTodos();
  });
}

if (scheduleModal) {
  document
    .getElementById("scheduleClose")
    .addEventListener("click", closeScheduleModal);
  document
    .getElementById("scheduleCancel")
    .addEventListener("click", closeScheduleModal);
  document
    .getElementById("scheduleSave")
    .addEventListener("click", saveScheduleModal);
  document.getElementById("scheduleDelete").addEventListener("click", () => {
    const taskId = schedTaskIdField.value;
    const blockId = schedBlockIdField.value;
    const occurrence = schedOccurrenceDate;
    const justThisOne = schedEditingOneOccurrence();
    closeScheduleModal();
    if (justThisOne) unscheduleOccurrence(taskId, blockId, occurrence);
    else unscheduleBlock(taskId, blockId);
  });
  scheduleModal.addEventListener("click", (e) => {
    if (e.target === scheduleModal) closeScheduleModal();
  });
  if (schedTaskSelect)
    schedTaskSelect.addEventListener("change", syncSchedNewTitle);
  // The summary line reads back the rule in words, so "every 2 weeks on Tuesday
  // until 1 Dec" is checkable before saving.
  [schedRepeat, schedInterval, schedUntil, schedDate].forEach((el) => {
    if (el) el.addEventListener("change", syncSchedRepeatUI);
    if (el) el.addEventListener("input", syncSchedRepeatUI);
  });
  document
    .querySelectorAll('#schedScope input[name="schedScope"]')
    .forEach((radio) => radio.addEventListener("change", syncSchedScopeUI));
  // Keep the block length steady when the start time moves, the way a calendar
  // app does, instead of leaving an inverted range behind.
  if (schedStart)
    schedStart.addEventListener("change", () => {
      const s = calMinutes(schedStart.value);
      const e = calMinutes(schedEnd.value);
      if (s === null) return;
      if (e === null || e <= s)
        schedEnd.value = calHHMM(Math.min(s + CAL_DEFAULT_MINUTES, 24 * 60 - 1));
    });
}

/* ===== Calendar toolbar + grid interaction ===== */
const calPrevBtn = document.getElementById("calPrev");
if (calPrevBtn) calPrevBtn.addEventListener("click", () => calShift(-1));
const calNextBtn = document.getElementById("calNext");
if (calNextBtn) calNextBtn.addEventListener("click", () => calShift(1));
const calTodayBtn = document.getElementById("calToday");
if (calTodayBtn)
  calTodayBtn.addEventListener("click", () => {
    calCursor = calStartOfDay(new Date());
    renderCalendar();
  });
const calViewSwitch = document.getElementById("calViewSwitch");
if (calViewSwitch)
  calViewSwitch.addEventListener("click", (e) => {
    const btn = e.target.closest(".cal-view-btn");
    if (btn) setCalView(btn.dataset.calView);
  });
/* Prefills the date you're looking at: the cursor day in week/day view, and in
   month view today if that month is on screen, otherwise the 1st of it — never a
   date from a month you aren't looking at. */
function calDefaultDate() {
  if (calView !== "month") return localDateKey(calCursor);
  const now = new Date();
  const sameMonth =
    now.getFullYear() === calCursor.getFullYear() &&
    now.getMonth() === calCursor.getMonth();
  return localDateKey(
    sameMonth ? now : new Date(calCursor.getFullYear(), calCursor.getMonth(), 1),
  );
}

const calAddBtn = document.getElementById("calAddBtn");
if (calAddBtn)
  calAddBtn.addEventListener("click", () =>
    openScheduleModal({ date: calDefaultDate() }),
  );

/* One delegated handler, bound once — the grid's innerHTML is replaced on every
   render, so per-element listeners would pile up. */
const calendarContentEl = document.getElementById("calendarContent");
if (calendarContentEl) {
  calendarContentEl.addEventListener("click", (e) => {
    const del = e.target.closest(".cal-block-del");
    if (del) {
      e.stopPropagation();
      // On the grid, ✕ means "not this one" — the least destructive reading.
      // Removing a whole series is deliberate, via the block's own dialog.
      const task = todos.find((t) => t.id === del.dataset.taskId);
      const block = task
        ? taskSchedule(task).find((b) => b.id === del.dataset.blockId)
        : null;
      if (block && blockRepeat(block) !== "none")
        unscheduleOccurrence(task.id, block.id, del.dataset.date);
      else unscheduleBlock(del.dataset.taskId, del.dataset.blockId);
      return;
    }
    const goto = e.target.closest("[data-goto-day]");
    if (goto) {
      calCursor = calParseKey(goto.dataset.gotoDay);
      setCalView("day");
      return;
    }
    const chip = e.target.closest(".cal-chip, .cal-block");
    if (chip) {
      const task = todos.find((t) => t.id === chip.dataset.taskId);
      const block = task
        ? taskSchedule(task).find((b) => b.id === chip.dataset.blockId)
        : null;
      if (task && block)
        openScheduleModal({
          taskId: task.id,
          blockId: block.id,
          // The occurrence that was clicked, which for a series is not block.date.
          date: chip.dataset.date || block.date,
          start: block.start,
          end: block.end,
          repeat: blockRepeat(block),
          interval: blockInterval(block),
          until: block.until,
        });
      return;
    }
    const slot = e.target.closest(".cal-slot");
    if (slot) {
      openScheduleModal({
        date: slot.dataset.date,
        start: calHHMM(parseInt(slot.dataset.hour, 10) * 60),
      });
      return;
    }
    // Empty space in a month cell schedules that day at the default hour.
    const cell = e.target.closest(".cal-month-cell");
    if (cell) openScheduleModal({ date: cell.dataset.date });
  });
  calendarContentEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const block = e.target.closest && e.target.closest(".cal-block");
    if (!block) return;
    e.preventDefault();
    block.click();
  });
}

/* ===== Dashboard: Today's Schedule ===== */
function renderTodaySchedule() {
  const body = document.getElementById("todayScheduleBody");
  if (!body) return;
  const countEl = document.getElementById("todayScheduleCount");
  const entries = blocksForDate(localDateKey(new Date()));
  if (countEl)
    countEl.textContent = entries.length
      ? `${entries.length} BLOCK${entries.length === 1 ? "" : "S"}`
      : "";

  if (entries.length === 0) {
    body.innerHTML = `<p class="today-schedule-empty">Nothing scheduled today.
      <button class="today-schedule-add">Add a time block</button></p>`;
    return;
  }

  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  body.innerHTML = entries
    .map(({ task, block }) => {
      const s = calMinutes(block.start) ?? 0;
      const e = calMinutes(block.end) ?? s + 30;
      let state = "";
      if (task.done) state = "done";
      else if (nowMins >= s && nowMins < e) state = "now";
      else if (e <= nowMins) state = "past";
      const isActive = task.id === activeTaskId;
      const rule = describeRepeat(block);
      return `<div class="today-row ${state}"${rule ? ` title="${escapeHtml(rule)}"` : ""}>
        <span class="today-time">${escapeHtml(calFormatTime(block.start))}<span class="today-time-end">${escapeHtml(calFormatTime(block.end))}</span></span>
        ${rule ? '<span class="cal-repeat-mark today-repeat" aria-label="Repeating">↻</span>' : ""}
        <button class="dash-task-check material-symbols-outlined today-check" data-task-id="${task.id}" aria-label="${task.done ? "Mark task not done" : "Mark task complete"}">${task.done ? "check_circle" : "radio_button_unchecked"}</button>
        <span class="today-title">${escapeHtml(task.title)}${task.project ? `<span class="today-project">${escapeHtml(task.project)}</span>` : ""}</span>
        ${state === "now" ? '<span class="today-now-badge">NOW</span>' : ""}
        ${task.done ? "" : `<button class="dash-task-play material-symbols-outlined today-play" data-task-id="${task.id}" aria-label="${isActive ? "Pause" : "Focus on this task"}">${isActive ? "pause_circle" : "play_circle"}</button>`}
      </div>`;
    })
    .join("");
}

/* Collapses to its header rather than disappearing, so there is always a way
   back to it. The choice is remembered. */
function applyTodayScheduleCollapsed(collapsed) {
  const section = document.getElementById("todaySchedule");
  const toggle = document.getElementById("todayScheduleToggle");
  if (!section || !toggle) return;
  section.classList.toggle("collapsed", collapsed);
  toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  toggle.title = collapsed ? "Show today's schedule" : "Hide today's schedule";
  const icon = toggle.querySelector(".material-symbols-outlined");
  if (icon) icon.textContent = collapsed ? "expand_more" : "expand_less";
}

const todayScheduleToggle = document.getElementById("todayScheduleToggle");
if (todayScheduleToggle) {
  applyTodayScheduleCollapsed(
    localStorage.getItem("todayScheduleCollapsed") === "1",
  );
  todayScheduleToggle.addEventListener("click", () => {
    const section = document.getElementById("todaySchedule");
    const collapsed = !section.classList.contains("collapsed");
    localStorage.setItem("todayScheduleCollapsed", collapsed ? "1" : "0");
    applyTodayScheduleCollapsed(collapsed);
  });
}

const todayScheduleOpen = document.getElementById("todayScheduleOpen");
if (todayScheduleOpen)
  todayScheduleOpen.addEventListener("click", () => switchTab("calendar"));

document.addEventListener("click", (e) => {
  if (e.target.closest(".today-schedule-add"))
    openScheduleModal({ date: localDateKey(new Date()) });
});

/* Task mutations reach the calendar surfaces from renderTodos, which every write
   path already calls. The grid is only rebuilt while its tab is on screen, so
   typing in the search box doesn't churn 42 month cells per keystroke. */
function renderScheduleSurfaces() {
  renderTodaySchedule();
  const section = document.querySelector('section[data-tab="calendar"]');
  if (section && !section.classList.contains("tab-hidden")) renderCalendar();
}

/* ===== Donate =====
   App-themed buttons front the Razorpay widget, which opens in its own dialog.
   The embed is left exactly as Razorpay ships it and is never moved — relocating
   an iframe reloads it — so both buttons open the same one. */
const donateModal = document.getElementById("donateModal");

function openDonateModal() {
  if (!donateModal) return;
  donateModal.classList.remove("hidden");
  const close = document.getElementById("donateClose");
  if (close) close.focus();
}

function closeDonateModal() {
  if (donateModal) donateModal.classList.add("hidden");
}

if (donateModal) {
  const donateBtn = document.getElementById("donateBtn");
  if (donateBtn) donateBtn.addEventListener("click", openDonateModal);
  // From Help & Support: swap dialogs rather than stacking two overlays.
  const supportDonateBtn = document.getElementById("supportDonateBtn");
  if (supportDonateBtn)
    supportDonateBtn.addEventListener("click", () => {
      closeSupportModal();
      openDonateModal();
    });
  document
    .getElementById("donateClose")
    .addEventListener("click", closeDonateModal);
  donateModal.addEventListener("click", (e) => {
    if (e.target === donateModal) closeDonateModal();
  });
}

/* ===== Init ===== */
// Runs here rather than beside `let goldenTaskId`, because dropping a stale id
// triggers a render and a render reads state declared further down the file.
validateGoldenTask();

const savedTab = localStorage.getItem("activeTab") || "dashboard";
switchTab(savedTab);

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
renderTodaySchedule();
renderCalendar();
loadQuotes();
loadVersion();

/* Background tabs throttle timers, so re-sync the countdown the moment the tab
   becomes visible again instead of waiting for the next interval tick. */
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !pomState.running) return;
  pomState.timeLeft = remainingSeconds();
  updateDisplay();
});

/* ===== Dialog keyboard handling =====
   One handler for every dialog instead of an Escape listener per modal (the old
   arrangement is how the confirm dialog ended up able to close without settling
   its promise). showConfirmModal owns its own keys while open, because it has to
   resolve a promise on dismiss. */
const DIALOGS = [
  { id: "taskModal", close: () => closeModal() },
  { id: "scheduleModal", close: () => closeScheduleModal() },
  { id: "supportModal", close: () => closeSupportModal() },
  { id: "donateModal", close: () => closeDonateModal() },
  { id: "helpOverlay", close: () => helpOverlay.classList.add("hidden") },
];

function topmostOpenDialog() {
  // Later entries sit above earlier ones; confirmModal is handled separately.
  for (let i = DIALOGS.length - 1; i >= 0; i--) {
    const el = document.getElementById(DIALOGS[i].id);
    if (el && !el.classList.contains("hidden")) return { el, ...DIALOGS[i] };
  }
  return null;
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" && e.key !== "Tab") return;
  const confirm = document.getElementById("confirmModal");
  if (confirm && !confirm.classList.contains("hidden")) return; // owns its keys
  const open = topmostOpenDialog();
  if (!open) return;
  if (e.key === "Escape") open.close();
  else trapFocus(open.el, e);
});
