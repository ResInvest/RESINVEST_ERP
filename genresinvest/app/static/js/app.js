// GenResInvest 1.0 — powłoka aplikacji: logowanie, układ, nawigacja, router (#/ścieżka).

import { api, setUnauthorizedHandler } from './api.js';
import { h, icon, clear, button, toast, showErrors, clearErrors, field, input, withBusy, confirmDialog } from './ui.js';

export const state = { user: null, settings: null, dirty: false };

const ROUTES = [
  { pattern: /^\/?$/, view: () => import('./views/dashboard.js'), nav: 'pulpit' },
  { pattern: /^\/pulpit$/, view: () => import('./views/dashboard.js'), nav: 'pulpit' },
  { pattern: /^\/zlecenia$/, view: () => import('./views/orders.js'), nav: 'zlecenia' },
  { pattern: /^\/zlecenia\/nowe$/, view: () => import('./views/order-form.js'), nav: 'nowe', role: 'editor' },
  { pattern: /^\/zlecenia\/(\d+)\/edycja$/, view: () => import('./views/order-form.js'), nav: 'zlecenia', role: 'editor' },
  { pattern: /^\/zlecenia\/(\d+)$/, view: () => import('./views/order-detail.js'), nav: 'zlecenia' },
  { pattern: /^\/kontrahenci$/, view: () => import('./views/contractors.js'), nav: 'kontrahenci' },
  { pattern: /^\/slowniki$/, view: () => import('./views/dictionaries.js'), nav: 'slowniki' },
  { pattern: /^\/raporty$/, view: () => import('./views/reports.js'), nav: 'raporty' },
  { pattern: /^\/historia$/, view: () => import('./views/history.js'), nav: 'historia' },
  { pattern: /^\/administracja$/, view: () => import('./views/admin.js'), nav: 'administracja', role: 'admin' },
  { pattern: /^\/konto$/, view: () => import('./views/account.js'), nav: 'konto' },
];

const NAV = [
  { key: 'pulpit', href: '#/pulpit', label: 'Pulpit', icon: 'dashboard' },
  { key: 'nowe', href: '#/zlecenia/nowe', label: 'Nowe zlecenie', icon: 'plus', role: 'editor' },
  { key: 'zlecenia', href: '#/zlecenia', label: 'Rejestr zleceń', icon: 'orders' },
  { section: 'Kartoteki' },
  { key: 'kontrahenci', href: '#/kontrahenci', label: 'Kontrahenci', icon: 'contractors' },
  { key: 'slowniki', href: '#/slowniki', label: 'Usługi, ceny, osoby', icon: 'dict' },
  { section: 'Analiza' },
  { key: 'raporty', href: '#/raporty', label: 'Raporty', icon: 'reports' },
  { key: 'historia', href: '#/historia', label: 'Historia operacji', icon: 'history' },
  { key: 'administracja', href: '#/administracja', label: 'Administracja', icon: 'admin', role: 'admin' },
];

export const can = {
  edit: () => ['admin', 'user'].includes(state.user?.role),
  admin: () => state.user?.role === 'admin',
};

const ROLE_LABEL = { admin: 'Administrator', user: 'Użytkownik', viewer: 'Podgląd' };
const root = document.getElementById('app');
let layout = null;
let currentCleanup = null;

export function navigate(path) { window.location.hash = `#${path}`; }

/** Oznacza formularz jako zmieniony — ostrzeżenie przed opuszczeniem bez zapisu. */
export function setDirty(value) { state.dirty = value; }

window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

export async function loadSettings(force = false) {
  if (!state.settings || force) state.settings = await api.get('/settings');
  return state.settings;
}

// --- Logowanie i zmiana hasła ---------------------------------------------------------------------
function renderLogin(message) {
  layout = null;
  clear(root);
  const user = input({ autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', autofocus: true });
  const pass = input({ type: 'password', autocomplete: 'current-password' });
  const submit = h('button', { type: 'submit', class: 'btn primary' }, 'Zaloguj się');
  const form = h('form', { novalidate: true },
    message ? h('div', { class: 'alert info', role: 'status' }, message) : null,
    field({ label: 'Login', name: 'username', control: user, required: true }),
    field({ label: 'Hasło', name: 'password', control: pass, required: true }),
    submit);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const errs = [];
    if (!user.value.trim()) errs.push({ field: 'username', message: 'Wpisz login' });
    if (!pass.value) errs.push({ field: 'password', message: 'Wpisz hasło' });
    if (errs.length) { showErrors(form, errs); return; }
    withBusy(submit, async () => {
      try {
        state.user = await api.post('/auth/login', { username: user.value.trim(), password: pass.value });
        start();
      } catch (err) {
        pass.value = '';
        showErrors(form, [{ field: 'password', message: err.message }]);
      }
    });
  });
  root.append(h('main', { class: 'auth', id: 'main' },
    h('div', { class: 'card' },
      h('img', { class: 'logo', src: '/static/img/logo.png', alt: 'ResInvest Commodities', width: 200, height: 68 }),
      h('div', { class: 'app-name' }, 'GenResInvest 1.0 · generator zleceń'),
      form)));
  user.focus();
}

export function changePasswordForm({ forced = false, onDone }) {
  const cur = input({ type: 'password', autocomplete: 'current-password', autofocus: true });
  const pw1 = input({ type: 'password', autocomplete: 'new-password' });
  const pw2 = input({ type: 'password', autocomplete: 'new-password' });
  const submit = h('button', { type: 'submit', class: 'btn primary' }, 'Zmień hasło');
  const form = h('form', { novalidate: true, class: 'stack' },
    forced ? h('div', { class: 'alert warn' }, h('strong', {}, 'Ustaw własne hasło'), 'To pierwsze logowanie lub hasło zostało zresetowane przez administratora.') : null,
    field({ label: 'Obecne hasło', name: 'current_password', control: cur, required: true }),
    field({ label: 'Nowe hasło', name: 'new_password', control: pw1, required: true, help: 'Min. 10 znaków, litery i cyfry.' }),
    field({ label: 'Powtórz nowe hasło', name: 'new_password2', control: pw2, required: true }),
    submit);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const errs = [];
    if (!cur.value) errs.push({ field: 'current_password', message: 'Wpisz obecne hasło' });
    if (pw1.value.length < 10 || !/\d/.test(pw1.value) || !/[a-zA-Z]/.test(pw1.value)) errs.push({ field: 'new_password', message: 'Min. 10 znaków, litery i cyfry' });
    if (pw1.value !== pw2.value) errs.push({ field: 'new_password2', message: 'Hasła nie są takie same' });
    if (errs.length) { showErrors(form, errs); return; }
    withBusy(submit, async () => {
      try {
        await api.post('/auth/change-password', { current_password: cur.value, new_password: pw1.value });
        toast('Hasło zostało zmienione', 'success');
        onDone?.();
      } catch (err) { showErrors(form, [], err.message); }
    });
  });
  return form;
}

function renderForcedPasswordChange() {
  clear(root);
  const form = changePasswordForm({ forced: true, onDone: async () => { state.user = await api.get('/auth/me'); start(); } });
  root.append(h('main', { class: 'auth', id: 'main' },
    h('div', { class: 'card' },
      h('img', { class: 'logo', src: '/static/img/logo.png', alt: 'ResInvest Commodities', width: 200, height: 68 }),
      h('div', { class: 'app-name' }, `Zalogowano: ${state.user.full_name}`),
      form)));
  form.querySelector('input').focus();
}

// --- Układ ------------------------------------------------------------------------------------------
function allowed(item) {
  if (item.role === 'admin') return can.admin();
  if (item.role === 'editor') return can.edit();
  return true;
}

function buildLayout() {
  const nav = h('nav', { class: 'nav', 'aria-label': 'Menu główne' },
    NAV.filter(allowed).map((item) => (item.section
      ? h('div', { class: 'nav-section' }, item.section)
      : h('a', { href: item.href, dataset: { key: item.key } }, icon(item.icon), item.label))));
  const logout = button('Wyloguj', {
    small: true, iconName: 'logout',
    onClick: async () => {
      if (state.dirty && !(await confirmDialog({ title: 'Niezapisane zmiany', message: 'Masz niezapisane zmiany. Wylogować mimo to?', confirmLabel: 'Wyloguj' }))) return;
      try { await api.post('/auth/logout'); } catch { /* sesja mogła już wygasnąć */ }
      state.user = null; state.dirty = false;
      renderLogin('Wylogowano.');
    },
  });
  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar' },
    h('div', { class: 'brand' }, h('img', { src: '/static/img/logo-light.png', alt: 'ResInvest Commodities', width: 150, height: 51 }), h('span', {}, 'GenResInvest 1.0')),
    nav,
    h('div', { class: 'user-box' },
      h('strong', {}, state.user.full_name),
      h('span', { class: 'small' }, `${state.user.username} · ${ROLE_LABEL[state.user.role] || state.user.role}`),
      h('a', { href: '#/konto', class: 'small', dataset: { key: 'konto' } }, 'Moje konto / hasło'),
      logout));
  const main = h('main', { class: 'main', id: 'main', tabindex: '-1' });
  const menuBtn = h('button', { type: 'button', class: 'btn icon', 'aria-label': 'Otwórz menu', 'aria-controls': 'sidebar', 'aria-expanded': 'false' }, icon('menu'));
  const topbar = h('header', { class: 'topbar' },
    menuBtn, h('img', { src: '/static/img/logo-light.png', alt: 'ResInvest Commodities', width: 88, height: 30 }), h('span', { class: 'spacer' }),
    can.edit() ? h('a', { class: 'btn icon', href: '#/zlecenia/nowe', 'aria-label': 'Nowe zlecenie' }, icon('plus')) : null);
  const backdrop = h('div', { class: 'backdrop' });
  const shell = h('div', { class: 'layout' }, topbar, sidebar, backdrop, main);
  const setOpen = (open) => { shell.classList.toggle('nav-open', open); menuBtn.setAttribute('aria-expanded', String(open)); if (open) nav.querySelector('a')?.focus(); };
  menuBtn.addEventListener('click', () => setOpen(!shell.classList.contains('nav-open')));
  backdrop.addEventListener('click', () => setOpen(false));
  nav.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && shell.classList.contains('nav-open')) setOpen(false); });
  clear(root).append(shell);
  layout = { shell, main, nav };
}

// --- Router -----------------------------------------------------------------------------------------
let lastHash = window.location.hash;
let navigating = false;

async function route() {
  if (!state.user) return;
  if (navigating) return;
  const path = window.location.hash.replace(/^#/, '') || '/pulpit';
  if (state.dirty && window.location.hash !== lastHash) {
    navigating = true;
    const leave = await confirmDialog({ title: 'Niezapisane zmiany', message: 'Formularz zawiera niezapisane zmiany. Opuścić stronę bez zapisu?', confirmLabel: 'Opuść bez zapisu', danger: true });
    navigating = false;
    if (!leave) { history.replaceState(null, '', lastHash); return; }
    state.dirty = false;
  }
  lastHash = window.location.hash;
  if (!layout) buildLayout();
  const match = ROUTES.map((r) => ({ r, m: path.match(r.pattern) })).find((x) => x.m);
  layout.nav.querySelectorAll('a').forEach((a) => a.removeAttribute('aria-current'));
  if (!match) { renderNotFound(); return; }
  const { r, m } = match;
  layout.nav.querySelector(`a[data-key="${r.nav}"]`)?.setAttribute('aria-current', 'page');
  if ((r.role === 'admin' && !can.admin()) || (r.role === 'editor' && !can.edit())) {
    clear(layout.main).append(h('div', { class: 'alert danger' }, 'Brak uprawnień do tej części programu.'));
    return;
  }
  try { currentCleanup?.(); } catch { /* ignoruj */ }
  currentCleanup = null;
  clear(layout.main);
  try {
    const mod = await r.view();
    currentCleanup = await mod.render(layout.main, { params: m.slice(1), path }) || null;
    layout.main.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  } catch (err) {
    console.error(err);
    clear(layout.main).append(h('div', { class: 'alert danger', role: 'alert' }, h('strong', {}, 'Nie udało się wczytać widoku'), err.message || String(err)));
  }
}

function renderNotFound() {
  clear(layout.main).append(h('div', { class: 'card' }, h('h1', {}, 'Nie znaleziono strony'), h('a', { href: '#/pulpit' }, 'Wróć do pulpitu')));
}

function start() {
  if (state.user.must_change_password) { renderForcedPasswordChange(); return; }
  layout = null;
  route();
}

setUnauthorizedHandler((message) => {
  if (!state.user) return;
  state.user = null; state.dirty = false;
  renderLogin(message || 'Sesja wygasła. Zaloguj się ponownie.');
});

window.addEventListener('hashchange', route);

// Skróty klawiaturowe (globalne)
document.addEventListener('keydown', (e) => {
  if (!state.user || !(e.altKey && !e.ctrlKey)) return;
  const map = { n: '/zlecenia/nowe', z: '/zlecenia', k: '/kontrahenci', r: '/raporty' };
  const target = map[e.key.toLowerCase()];
  if (target) { e.preventDefault(); navigate(target); }
});

(async function boot() {
  try {
    state.user = await api.get('/auth/me', null, { silent401: true });
    start();
  } catch {
    renderLogin();
  }
}());

export { clearErrors };
