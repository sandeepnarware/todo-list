/* jsdom harness: donate button placement + service worker origin guard. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const quotesRaw = fs.readFileSync(path.join(ROOT, 'quotes.json'), 'utf8');

let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log('  PASS  ' + label);
  else { fails++; console.log('  FAIL  ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!/tailwind|Could not load|Not implemented|razorpay/i.test(e.message)) console.log('JSDOM ERR:', e.message); });

// resources: 'usable' is NOT set, so no external script is actually fetched.
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/', virtualConsole: vc, pretendToBeVisual: true });
const w = dom.window;
w.Notification = { permission: 'denied', requestPermission() {} };
w.AudioContext = function () { throw new Error('no audio'); };
w.documentPictureInPicture = null;
let nn = 0;
w.crypto = Object.assign({}, w.crypto, { randomUUID: () => `uuid-${++nn}` });
w.alert = () => {};
const fetchLog = [];
w.fetch = (url) => {
  fetchLog.push(String(url));
  if (String(url) === 'quotes.json') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(quotesRaw)) });
  return Promise.reject(new Error('blocked'));
};

const script = w.document.createElement('script');
script.textContent = appJs;
w.document.body.appendChild(script);

const doc = w.document;

console.log('\n1. The Razorpay embed is present and unmodified');
const rzp = doc.querySelector('script[src*="checkout.razorpay.com"]');
check('razorpay script tag exists', !!rzp);
check('src is the official checkout URL',
  rzp.getAttribute('src') === 'https://checkout.razorpay.com/v1/payment-button.js', rzp && rzp.getAttribute('src'));
check('data-payment_button_id preserved exactly',
  rzp.getAttribute('data-payment_button_id') === 'pl_THdduXsaa77yQd', rzp && rzp.getAttribute('data-payment_button_id'));
check('async attribute kept', rzp.hasAttribute('async'));
check('exactly one razorpay script (not duplicated)',
  doc.querySelectorAll('script[src*="razorpay"]').length === 1);

console.log('\n2. It sits inside a <form>, which Razorpay requires');
check('parent element is a form', rzp.parentElement && rzp.parentElement.tagName === 'FORM', rzp.parentElement && rzp.parentElement.tagName);
check('the form has no other controls that could hijack submit',
  rzp.parentElement.querySelectorAll('input,button,select,textarea').length === 0);

console.log('\n3. Placement: in its own dialog, which is wide enough for the widget');
// Rendered in the sidebar profile card the iframe had ~200px to work with —
// narrower than Razorpay's own button, which is what looked broken. The dialog
// gives it room. The embed is never moved between containers, because
// relocating an iframe reloads it.
const wrap = doc.querySelector('.donate-wrap');
check('donate-wrap exists', !!wrap);
const donateModal = doc.getElementById('donateModal');
check('the embed lives in the donate dialog', donateModal.contains(rzp));
check('the dialog starts closed', donateModal.classList.contains('hidden'));
check('exactly one embed in the whole document',
  doc.querySelectorAll('script[src*="checkout.razorpay.com"]').length === 1);
check('nothing donate-related is left in the sidebar',
  !doc.querySelector('aside').contains(rzp));
check('the widget is not squeezed by a narrow rail',
  /\.donate-wrap iframe \{[^}]*max-width:\s*100%/.test(css));

console.log('\n4. An app-themed button fronts it');
const donateBtn = doc.getElementById('donateBtn');
check('sidebar has a themed button', !!donateBtn);
check('it is styled from theme tokens, not razorpay branding',
  /\.donate-btn \{[^}]*var\(--primary-fixed\)/.test(css));
check('it says what it does', /Support this app/.test(donateBtn.textContent));
check('it sits in the profile card below the version', (() => {
  const version = doc.getElementById('appVersion');
  const card = version.closest('.rounded-organic');
  return card.contains(donateBtn) &&
    !!(version.compareDocumentPosition(donateBtn) & w.Node.DOCUMENT_POSITION_FOLLOWING);
})());
check('it is NOT inside the razorpay form (it would hijack submit)',
  donateBtn.closest('form') === null);
check('clicking it reveals the razorpay button', (() => {
  donateBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  return !donateModal.classList.contains('hidden');
})());
check('and the embed is inside what just opened', donateModal.contains(rzp));
check('closing works', (() => {
  doc.getElementById('donateClose').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  return donateModal.classList.contains('hidden');
})());
check('Escape closes it too', (() => {
  donateBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return donateModal.classList.contains('hidden');
})());

console.log('\n5. Reachable on a phone, where the sidebar does not exist');
const aside = doc.querySelector('aside');
check('the sidebar is still desktop-only',
  /(^|\s)hidden(\s|$)/.test(aside.className) && /md:flex/.test(aside.className), aside.className);
const supportBtn = doc.getElementById('supportBtn');
check('the header support button is visible at every width',
  !/(^|\s)(hidden|sm:hidden|md:hidden|lg:hidden)(\s|$)/.test(supportBtn.className), supportBtn.className);
const supportDonateBtn = doc.getElementById('supportDonateBtn');
check('Help & Support offers the same themed button', !!supportDonateBtn);
check('which swaps dialogs rather than stacking two overlays', (() => {
  supportBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  supportDonateBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  return doc.getElementById('supportModal').classList.contains('hidden') &&
    !donateModal.classList.contains('hidden');
})());
doc.getElementById('donateClose').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

console.log('\n6. Existing sidebar content intact');
const version = doc.getElementById('appVersion');
check('version number still present', !!version && /^v\d+\.\d+\.\d+$/.test(version.textContent.trim()),
  version && version.textContent);
check('avatar still rendered', !!doc.getElementById('sidebarAvatar'));
check('app name still rendered', [...doc.querySelectorAll('p')].some(p => p.textContent.trim() === 'PomoDone'));
check('avatar + name still share a flex row',
  doc.getElementById('sidebarAvatar').parentElement.className.includes('flex items-center'),
  doc.getElementById('sidebarAvatar').parentElement.className);
check('all 6 nav tabs still present', doc.querySelectorAll('aside .tab').length === 6, doc.querySelectorAll('aside .tab').length);

console.log('\n7. CSS constrains the injected widget');
check('.donate-wrap styled', /\.donate-wrap\s*\{/.test(css));
check('iframe capped to container width', /\.donate-wrap iframe\s*\{[^}]*max-width:\s*100%/.test(css));
check('form capped to container width', /\.donate-wrap form\s*\{[^}]*max-width:\s*100%/.test(css));

console.log('\n8. Service worker leaves cross-origin traffic alone');
check('origin guard present', /origin !== self\.location\.origin/.test(swJs));
// Simulate the fetch handler's routing decision.
const listeners = {};
const swScope = {
  self: { addEventListener: (evt, fn) => { listeners[evt] = fn; }, location: { origin: 'https://example.com' }, skipWaiting() {} },
  caches: { open: () => Promise.resolve({ add: () => Promise.resolve(), put: () => Promise.resolve(), match: () => Promise.resolve() }), keys: () => Promise.resolve([]), match: () => Promise.resolve() },
  fetch: () => Promise.resolve({ clone: () => ({}) }),
  URL,
};
const swFn = new Function(...Object.keys(swScope), swJs);
swFn(...Object.values(swScope));
check('fetch handler registered', typeof listeners.fetch === 'function');

function routes(url, method = 'GET') {
  let handled = false;
  listeners.fetch({ request: { url, method }, respondWith: () => { handled = true; } });
  return handled;
}
check('same-origin app file IS handled by the SW', routes('https://example.com/app.js'));
check('same-origin quotes.json IS handled', routes('https://example.com/quotes.json'));
check('razorpay script is NOT intercepted', !routes('https://checkout.razorpay.com/v1/payment-button.js'));
check('razorpay api call is NOT intercepted', !routes('https://api.razorpay.com/v1/checkout'));
check('non-GET still ignored', !routes('https://example.com/app.js', 'POST'));

console.log('\n9. App still boots with the new markup');
setTimeout(() => {
  check('quotes.json still fetched at boot', fetchLog.includes('quotes.json'), fetchLog);
  check('no unexpected network calls',
    fetchLog.every(u => u === 'quotes.json' || u === 'version.json'), fetchLog);
  check('todo list rendered', !!doc.getElementById('todoList'));
  check('dashboard quotes container populated or empty-but-present', !!doc.getElementById('dashQuotes'));
  check('no razorpay script fetched by jsdom (external not loaded in test)', !fetchLog.some(u => /razorpay/.test(u)));

  console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}, 50);
