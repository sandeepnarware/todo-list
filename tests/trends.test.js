/* jsdom harness: verify the trends view renders a stacked bar chart. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!/tailwind|Could not load|Not implemented/.test(e.message)) console.log('JSDOM ERR:', e.message); });

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/', virtualConsole: vc, pretendToBeVisual: true });
const w = dom.window;
w.Notification = { permission: 'denied', requestPermission() {} };
w.AudioContext = function () { throw new Error('no audio'); };
w.documentPictureInPicture = null;
w.fetch = () => Promise.reject(new Error('offline'));
let n = 0;
w.crypto = Object.assign({}, w.crypto, { randomUUID: () => `uuid-${++n}` });
w.alert = () => {};

const dayKey = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const at = (offset, h) => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  d.setHours(h, 0, 0, 0);
  return d.getTime();
};

// Today: 3 pomodoros, 2 tasks completed (1 of them had pomodoros) -> stack 3+2+1 = 6
// 2 days ago: 1 pomodoro only -> stack 1
w.localStorage.setItem('pomodoroHistory', JSON.stringify([
  { date: dayKey(0), time: '09:00', timestamp: at(0, 9) },
  { date: dayKey(0), time: '10:00', timestamp: at(0, 10) },
  { date: dayKey(0), time: '11:00', timestamp: at(0, 11) },
  { date: dayKey(2), time: '14:00', timestamp: at(2, 14) },
]));
w.localStorage.setItem('todos', JSON.stringify([
  { id: 'p1', title: 'With pomos', description: '', dueDate: null, priority: 'none', project: '', frequency: 'none',
    tags: [], done: true, completedAt: at(0, 12), createdAt: 1, pomodoros: 3, estPomodoros: 0, wasGolden: false, subtasks: [] },
  { id: 'p2', title: 'No pomos', description: '', dueDate: null, priority: 'none', project: '', frequency: 'none',
    tags: [], done: true, completedAt: at(0, 13), createdAt: 1, pomodoros: 0, estPomodoros: 0, wasGolden: false, subtasks: [] },
]));

const bridge = `window.__t = { renderStats, setCurrentView(v){ currentView = v; }, get trendsRange(){ return trendsRange; }, switchTab };`;
const script = w.document.createElement('script');
script.textContent = appJs + bridge;
w.document.body.appendChild(script);

const $ = (id) => w.document.getElementById(id);
const views = $('statsViews');
let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log('  PASS  ' + label);
  else { fails++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

w.__t.switchTab('stats');
w.__t.setCurrentView('trends');
w.__t.renderStats();

console.log('\n1. Chart is bars, not lines');
check('no polyline elements', views.querySelectorAll('polyline').length === 0);
check('no .trend-line', views.querySelectorAll('.trend-line').length === 0);
check('no crosshair / hover dots', views.querySelectorAll('.trends-crosshair, .trends-hover-dot').length === 0);
check('bar elements present', views.querySelectorAll('.trend-bar').length > 0, views.querySelectorAll('.trend-bar').length);
check('hover band present and hidden', (() => {
  const b = views.querySelector('.trends-hover-band');
  return b && b.style.display === 'none';
})());

console.log('\n2. Three distinct series colors used');
const fills = [...views.querySelectorAll('.trend-bar')].map(el => el.style.fill);
const uniq = [...new Set(fills)];
check('three colors on screen', uniq.length === 3, uniq);
check('uses --trend-1/2/3 vars', uniq.every(f => /var\(--trend-[123]\)/.test(f)), uniq);

console.log("\n3. Today's stack: 3 segments, contiguous, correct heights");
// Default range 30D. plotH = 270, yTop = 8 (max stack 6 -> nice step 2 x 4).
const segs = [...views.querySelectorAll('.trend-bar')];
const today = segs.filter(el => el.style.fill === 'var(--trend-1)' || el.style.fill === 'var(--trend-2)' || el.style.fill === 'var(--trend-3)');
check('4 segments total (3 today + 1 two days ago)', segs.length === 4, segs.length);

const rects = segs.filter(el => el.tagName.toLowerCase() === 'rect');
const paths = segs.filter(el => el.tagName.toLowerCase() === 'path');
check('2 plain rects (non-top segments)', rects.length === 2, rects.map(r => r.style.fill));
check('2 rounded paths (top of each stack)', paths.length === 2, paths.map(p => p.style.fill));

const pomoRect = rects.find(r => r.style.fill === 'var(--trend-1)');
const taskRect = rects.find(r => r.style.fill === 'var(--trend-2)');
const startedPath = paths.find(p => p.style.fill === 'var(--trend-3)');
check('pomodoros is the bottom segment (rect)', !!pomoRect);
check('tasks is the middle segment (rect)', !!taskRect);
check('started is the top segment (rounded path)', !!startedPath);

const num = (el, a) => parseFloat(el.getAttribute(a));
const baseline = 16 + 270; // padT + plotH
const unit = 270 / 8;      // px per unit at yTop = 8
check('pomodoros height == 3 units', Math.abs(num(pomoRect, 'height') - 3 * unit) < 0.5, num(pomoRect, 'height'));
check('pomodoros sits on the baseline', Math.abs(num(pomoRect, 'y') + num(pomoRect, 'height') - baseline) < 0.5,
  { y: num(pomoRect, 'y'), h: num(pomoRect, 'height'), baseline });
check('tasks height == 2 units', Math.abs(num(taskRect, 'height') - 2 * unit) < 0.5, num(taskRect, 'height'));
check('tasks stacks flush on pomodoros', Math.abs(num(taskRect, 'y') + num(taskRect, 'height') - num(pomoRect, 'y')) < 0.5,
  { taskBottom: num(taskRect, 'y') + num(taskRect, 'height'), pomoTop: num(pomoRect, 'y') });
check('same x/width across the stack', num(pomoRect, 'x') === num(taskRect, 'x') && num(pomoRect, 'width') === num(taskRect, 'width'));
// Top path: starts at the stack's y = yAt(6) = baseline - 6*unit
const topY = baseline - 6 * unit;
const pathD = startedPath.getAttribute('d');
check('top segment ends at yAt(6)', pathD.includes(String(Math.round(topY * 100) / 100)), { pathD, expected: topY });

console.log('\n4. Zero-activity days draw nothing');
check('exactly 4 segments for 2 active days', segs.length === 4);

console.log('\n5. Y axis scales to the stack total, not the largest series');
const yLabels = [...views.querySelectorAll('.trend-axis-label')]
  .map(t => t.textContent).filter(t => /^\d+$/.test(t)).map(Number);
check('axis tops out at 8 (stack of 6), not 3', Math.max(...yLabels) === 8, yLabels);

console.log('\n6. Legend + range controls intact');
check('3 legend items', views.querySelectorAll('.trend-legend-item').length === 3);
check('3 range buttons', views.querySelectorAll('.trend-range-btn').length === 3);
check('30D active by default', views.querySelector('.trend-range-btn.active').textContent === '30D');

console.log('\n7. Data table gains a Stack column');
const heads = [...views.querySelectorAll('.trends-table th')].map(th => th.textContent);
check('headers include Stack', heads.join(',') === 'Date,Pomodoros,Tasks,Started,Stack', heads);
const todayRow = [...views.querySelectorAll('.trends-table tbody tr')].pop();
check("today's row reads 3,2,1,6", [...todayRow.children].slice(1).map(td => td.textContent).join(',') === '3,2,1,6',
  [...todayRow.children].map(td => td.textContent));

console.log('\n8. Hover shows a band + tooltip with the stack breakdown');
const svg = views.querySelector('.trends-svg');
svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 760, height: 320, right: 760, bottom: 320 });
views.querySelector('.trends-chart-area').getBoundingClientRect = () => ({ left: 0, top: 0, width: 760, height: 320, right: 760, bottom: 320 });
// x for the last slot (today): padL + slotW * (days - 0.5)
const slotW = (760 - 34 - 16) / 30;
const xToday = 34 + slotW * 29.5;
svg.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: xToday, clientY: 150 }));
const tip = views.querySelector('.trends-tooltip');
check('tooltip visible', !tip.classList.contains('hidden'));
const tipRows = [...tip.querySelectorAll('.trend-tip-row')].map(r => r.textContent);
check('rows read top-down: Started, Tasks, Pomodoros, Bar height',
  tipRows.join('|') === 'Started1|Tasks2|Pomodoros3|Bar height6', tipRows);
const band = views.querySelector('.trends-hover-band');
check('band moved to the hovered slot', band.style.display === '' && Math.abs(parseFloat(band.getAttribute('x')) - (34 + slotW * 29)) < 0.5,
  band.getAttribute('x'));
svg.dispatchEvent(new w.MouseEvent('mouseleave', { bubbles: true }));
check('leave hides tooltip + band', tip.classList.contains('hidden') && band.style.display === 'none');

console.log('\n9. Range switch re-renders (7D)');
views.querySelector('[data-trend-range="7"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
check('7D now active', views.querySelector('.trend-range-btn.active').textContent === '7D');
check('7 rows in table', views.querySelectorAll('.trends-table tbody tr').length === 7);
check('still 4 bar segments', views.querySelectorAll('.trend-bar').length === 4, views.querySelectorAll('.trend-bar').length);
check('7D labels every day', views.querySelectorAll('.trend-axis-label').length === 5 + 7, views.querySelectorAll('.trend-axis-label').length);

console.log('\n10. Empty state when there is no activity');
w.localStorage.setItem('pomodoroHistory', JSON.stringify([]));
w.localStorage.setItem('todos', JSON.stringify([]));
const dom2Script = w.document.createElement('script');
dom2Script.textContent = 'todos = loadTodos(); renderStats();';
w.document.body.appendChild(dom2Script);
check('no-data message shown', !!views.querySelector('.no-data'), views.innerHTML.slice(0, 200));
check('no bars drawn', views.querySelectorAll('.trend-bar').length === 0);
check('controls still rendered', views.querySelectorAll('.trend-range-btn').length === 3);
// hover handler must not throw with no chart
try { w.eval('setupTrendsInteraction()'); check('setupTrendsInteraction bails safely', true); }
catch (e) { check('setupTrendsInteraction bails safely', false, e.message); }

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
