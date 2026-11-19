// Powłoka: wybór profilu użytkownika, układ (menu boczne / szuflada na telefonie), router #/…,
// paleta poleceń Ctrl+K, motyw jasny/ciemny, ochrona niezapisanych zmian.

const App = { dirty: false, cleanup: null, main: null, lastHash: location.hash };
const VIEWS = {};
const NAV = [
  { key: 'pulpit', href: '#/', label: 'Pulpit', icon: 'home' },
  { group: 'Dokumenty' },
  { key: 'zlecenia', href: '#/zlecenia', label: 'Zlecenia', icon: 'truck', count: () => countDocs('zlecenie') },
  { key: 'zamowienia', href: '#/zamowienia', label: 'Zamówienia', icon: 'cart', count: () => countDocs('zamowienie') },
  { group: 'Kartoteki' },
  { key: 'kontrahenci', href: '#/kontrahenci', label: 'Kontrahenci', icon: 'users' },
  { key: 'slowniki', href: '#/slowniki', label: 'Słowniki', icon: 'book' },
  { group: 'Analiza' },
  { key: 'raporty', href: '#/raporty', label: 'Raporty', icon: 'chart' },
  { key: 'historia', href: '#/historia', label: 'Historia operacji', icon: 'clock' },
  { key: 'ustawienia', href: '#/ustawienia', label: 'Ustawienia i dane', icon: 'gear' },
];
const countDocs = (type) => Store.state.documents.filter((d) => d.type === type && d.status === 'draft').length || '';
const ROUTES = [
  [/^\/?$/, 'dashboard', 'pulpit'],
  [/^\/(zlecenia|zamowienia)$/, 'register', null],
  [/^\/(zlecenia|zamowienia)\/nowe$/, 'editor', null],
  [/^\/dok\/([\w-]+)\/edycja$/, 'editor', null],
  [/^\/dok\/([\w-]+)$/, 'detail', null],
  [/^\/kontrahenci$/, 'contractors', 'kontrahenci'],
  [/^\/slowniki$/, 'dicts', 'slowniki'],
  [/^\/raporty$/, 'reports', 'raporty'],
  [/^\/historia$/, 'history', 'historia'],
  [/^\/ustawienia$/, 'settings', 'ustawienia'],
];
const go = (path) => { location.hash = `#${path}`; };

// --- Motyw -------------------------------------------------------------------------------------
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('gri-theme', t || ''); } catch { /* tryb prywatny */ }
}
function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  applyTheme(dark ? 'light' : 'dark');
}

// --- Profil użytkownika -------------------------------------------------------------------------
async function pickProfile() {
  const users = Store.state.users.filter((u) => u.active);
  let last = null;
  try { last = localStorage.getItem('gri-user'); } catch { /* */ }
  const lastUser = users.find((u) => u.id === last);
  if (lastUser && !lastUser.pin && users.length === 1) { Session.userId = lastUser.id; return; }
  const root = $('#app');
  await new Promise((resolve) => {
    const pinInput = inp({ type: 'password', inputmode: 'numeric', maxlength: 12, autocomplete: 'off', placeholder: 'PIN' });
    let chosen = lastUser || users[0];
    const pinWrap = field({ label: 'PIN', name: 'pin', control: pinInput });
    const list = h('div', { class: 'profiles', role: 'radiogroup', 'aria-label': 'Profil' });
    const draw = () => {
      list.replaceChildren(...users.map((u) => h('button', { type: 'button', role: 'radio', class: 'profile', 'aria-checked': String(u.id === chosen.id),
        onclick: () => { chosen = u; draw(); pinWrap.hidden = !u.pin; (u.pin ? pinInput : enter).focus(); } },
      h('span', { class: 'avatar' }, u.name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()), h('span', {}, h('strong', {}, u.name), h('small', {}, u.role === 'admin' ? 'Administrator' : u.role === 'user' ? 'Użytkownik' : 'Podgląd')))));
      pinWrap.hidden = !chosen.pin;
    };
    const enter = h('button', { type: 'submit', class: 'btn primary wide' }, 'Rozpocznij pracę');
    const form = h('form', { class: 'gate-form', novalidate: true }, h('p', { class: 'gate-q' }, 'Kto pracuje na tym komputerze?'), list, pinWrap, enter);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (chosen.pin && (await sha256Hex(`gri:${pinInput.value}`)) !== chosen.pin) { setErrors(form, [{ field: 'pin', message: 'Nieprawidłowy PIN' }]); pinInput.value = ''; return; }
      Session.userId = chosen.id;
      try { localStorage.setItem('gri-user', chosen.id); } catch { /* */ }
      resolve();
    });
    draw();
    root.replaceChildren(h('main', { class: 'gate', id: 'main' },
      h('section', { class: 'gate-card' },
        h('img', { src: `data:image/png;base64,${ASSETS.logo}`, alt: 'ResInvest Commodities', class: 'gate-logo' }),
        h('h1', {}, 'Generator zleceń i zamówień'),
        h('p', { class: 'muted' }, 'Dokumenty na papierze firmowym ResInvest — PDF i DOCX, bez internetu.'),
        form),
      h('p', { class: 'gate-foot' }, `GenResInvest ${BUILD.version} · Program stworzony przez Roesner Mateusz dla ResInvest Commodities`)));
    (chosen.pin ? pinInput : enter).focus();
  });
}

// --- Układ ---------------------------------------------------------------------------------------
function buildShell() {
  const nav = h('nav', { class: 'nav', 'aria-label': 'Menu główne' });
  const drawNav = () => nav.replaceChildren(...NAV.map((n) => (n.group ? h('div', { class: 'nav-group' }, n.group)
    : h('a', { href: n.href, dataset: { key: n.key } }, icon(n.icon), h('span', {}, n.label), n.count && n.count() ? h('span', { class: 'nav-count', title: 'Szkice' }, String(n.count())) : null))));
  drawNav();
  Store.onChange(drawNav);
  const newMenu = h('div', { class: 'new-actions' },
    canEdit() ? h('a', { class: 'btn primary block', href: '#/zlecenia/nowe' }, icon('plus'), h('span', {}, 'Nowe zlecenie')) : null,
    canEdit() ? h('a', { class: 'btn block on-dark', href: '#/zamowienia/nowe' }, icon('plus'), h('span', {}, 'Nowe zamówienie')) : null);
  const side = h('aside', { class: 'side', id: 'side' },
    h('a', { class: 'brand', href: '#/', 'aria-label': 'GenResInvest — pulpit' }, h('img', { src: `data:image/png;base64,${ASSETS.logoLight}`, alt: 'ResInvest Commodities' }), h('span', {}, 'GenResInvest')),
    newMenu, nav,
    h('div', { class: 'side-foot' },
      h('button', { type: 'button', class: 'me', onclick: () => switchUser(), title: 'Zmień użytkownika' },
        h('span', { class: 'avatar sm' }, Session.user.name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()),
        h('span', {}, h('strong', {}, Session.user.name), h('small', {}, 'Zmień użytkownika')))));
  const menuBtn = h('button', { type: 'button', class: 'btn ghost icon-only only-mobile', 'aria-label': 'Menu', 'aria-controls': 'side', 'aria-expanded': 'false' }, icon('menu'));
  const top = h('header', { class: 'top' }, menuBtn,
    h('button', { type: 'button', class: 'search-trigger', onclick: () => palette(), 'aria-label': 'Szukaj i polecenia (Ctrl+K)' }, icon('search', 16), h('span', {}, 'Szukaj dokumentu, kontrahenta lub polecenia'), h('kbd', {}, 'Ctrl K')),
    h('span', { class: 'spacer' }),
    h('span', { id: 'save-state', class: 'save-state', dataset: { state: 'idle' }, title: Store.memoryOnly ? 'Brak trwałego zapisu' : 'Dane zapisywane automatycznie w tej przeglądarce' }, Store.memoryOnly ? 'Brak zapisu!' : 'Dane zapisane'),
    btn('', { kind: 'ghost icon-only', icon: 'moon', title: 'Motyw jasny / ciemny', onClick: toggleTheme }));
  const main = h('main', { class: 'main', id: 'main', tabindex: '-1' });
  const scrim = h('div', { class: 'scrim' });
  const shell = h('div', { class: 'shell' }, side, scrim, h('div', { class: 'stage' }, top, main));
  const setOpen = (v) => { shell.classList.toggle('nav-open', v); menuBtn.setAttribute('aria-expanded', String(v)); };
  menuBtn.onclick = () => setOpen(!shell.classList.contains('nav-open'));
  scrim.onclick = () => setOpen(false);
  side.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  $('#app').replaceChildren(shell);
  App.main = main;
  App.nav = nav;
}

async function switchUser() {
  if (App.dirty && !(await confirmBox({ title: 'Niezapisane zmiany', message: 'Formularz ma niezapisane zmiany. Zmienić użytkownika mimo to?', ok: 'Zmień', danger: true }))) return;
  App.dirty = false;
  try { localStorage.removeItem('gri-user'); } catch { /* */ }
  Session.userId = null;
  await pickProfile();
  buildShell();
  route();
}

async function route() {
  if (!Session.user) return;
  if (App.dirty && location.hash !== App.lastHash) {
    const leave = await confirmBox({ title: 'Niezapisane zmiany', message: 'Formularz zawiera niezapisane zmiany. Opuścić go bez zapisu?', ok: 'Opuść bez zapisu', danger: true });
    if (!leave) { history.replaceState(null, '', App.lastHash); return; }
    App.dirty = false;
  }
  App.lastHash = location.hash;
  const path = location.hash.replace(/^#/, '') || '/';
  const hit = ROUTES.map(([re, view, nav]) => ({ m: path.match(re), view, nav })).find((x) => x.m);
  try { App.cleanup?.(); } catch { /* */ }
  App.cleanup = null;
  const main = App.main;
  main.replaceChildren();
  $$('a', App.nav).forEach((a) => a.removeAttribute('aria-current'));
  if (!hit) { main.append(emptyState('Nie ma takiej strony', null, h('a', { class: 'btn', href: '#/' }, 'Wróć do pulpitu'))); return; }
  let navKey = hit.nav;
  if (!navKey) {
    if (/^\/(zlecenia|zamowienia)/.test(path)) navKey = hit.m[1];
    else { const d = Docs.get(hit.m[1]); navKey = d ? DOC_TYPES[d.type].route : null; }
  }
  if (navKey) $(`a[data-key="${navKey}"]`, App.nav)?.setAttribute('aria-current', 'page');
  try {
    App.cleanup = (await VIEWS[hit.view](main, hit.m.slice(1), path)) || null;
  } catch (err) {
    console.error(err);
    main.append(h('div', { class: 'form-alert' }, h('strong', {}, 'Nie udało się otworzyć widoku'), err.message));
  }
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

// --- Paleta poleceń (Ctrl+K) -------------------------------------------------------------------
function palette() {
  if ($('dialog.palette')) return;
  const opener = document.activeElement;
  const q = inp({ placeholder: 'Szukaj: numer, kontrahent, przedmiot… albo polecenie', 'aria-label': 'Szukaj', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'pal-l' });
  const list = h('ul', { class: 'pal-list', id: 'pal-l', role: 'listbox' });
  const dlg = h('dialog', { class: 'palette', 'aria-label': 'Szukaj i polecenia' }, h('div', { class: 'pal-in' }, h('div', { class: 'pal-q' }, icon('search'), q), list,
    h('div', { class: 'pal-help' }, h('span', {}, h('kbd', {}, '↑↓'), ' wybór'), h('span', {}, h('kbd', {}, 'Enter'), ' otwórz'), h('span', {}, h('kbd', {}, 'Esc'), ' zamknij'))));
  let results = []; let active = 0;
  const close = () => { dlg.close(); dlg.remove(); opener?.focus?.(); };
  const commands = [
    canEdit() && ['Nowe zlecenie', 'Utwórz zlecenie przewozu / usługi', () => go('/zlecenia/nowe'), 'plus'],
    canEdit() && ['Nowe zamówienie', 'Utwórz zamówienie towaru', () => go('/zamowienia/nowe'), 'plus'],
    ['Rejestr zleceń', null, () => go('/zlecenia'), 'truck'], ['Rejestr zamówień', null, () => go('/zamowienia'), 'cart'],
    ['Kontrahenci', null, () => go('/kontrahenci'), 'users'], ['Słowniki', null, () => go('/slowniki'), 'book'],
    ['Raporty', null, () => go('/raporty'), 'chart'], ['Historia operacji', null, () => go('/historia'), 'clock'],
    ['Kopia zapasowa do pliku', 'Zapisz wszystkie dane jako plik .json', () => Store.exportBackup().then((n) => toast(`Zapisano kopię ${n}`, 'success')), 'shield'],
    ['Przełącz motyw jasny / ciemny', null, toggleTheme, 'moon'],
  ].filter(Boolean);
  const draw = () => {
    const t = q.value;
    const docs = Store.state.documents.filter((d) => matches(t, d.number, docParty(d).name, d.data.subject, d.data.service_short, docSummary(d))).slice(0, 8)
      .map((d) => [docLabel(d), `${DOC_TYPES[d.type].label} · ${docParty(d).name} · ${fmtDate(d.data.issue_date)}`, () => go(`/dok/${d.id}`), d.type === 'zlecenie' ? 'truck' : 'cart']);
    const cons = t.trim() ? Store.state.contractors.filter((c) => matches(t, c.name, c.nip, c.city)).slice(0, 5)
      .map((c) => [c.name, `Kontrahent · ${c.nip ? `NIP ${c.nip}` : 'bez NIP'} · ${c.city}`, () => { sessionStorage.setItem('gri-cq', c.name); go('/kontrahenci'); }, 'users']) : [];
    const cmds = commands.filter(([l, sub]) => matches(t, l, sub));
    results = [...cmds, ...docs, ...cons];
    active = Math.min(active, Math.max(0, results.length - 1));
    list.replaceChildren(...results.map(([l, sub, , ic], i) => h('li', { role: 'option', id: `pal-${i}`, 'aria-selected': String(i === active), onmousedown: (e) => { e.preventDefault(); run(i); } },
      icon(ic, 16), h('span', {}, h('strong', {}, l), sub ? h('small', {}, sub) : null))));
    if (!results.length) list.append(h('li', { class: 'cb-empty' }, 'Brak wyników'));
    q.setAttribute('aria-activedescendant', `pal-${active}`);
  };
  const run = (i) => { const r = results[i]; if (!r) return; close(); r[2](); };
  q.addEventListener('input', () => { active = 0; draw(); });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(results.length - 1, active + 1); draw(); $(`#pal-${active}`)?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw(); $(`#pal-${active}`)?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter') { e.preventDefault(); run(active); }
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  document.body.append(dlg);
  dlg.showModal();
  draw();
  q.focus();
}

document.addEventListener('keydown', (e) => {
  if (!Session.user) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette(); }
  if (e.altKey && !e.ctrlKey && canEdit()) {
    if (e.key.toLowerCase() === 'n') { e.preventDefault(); go('/zlecenia/nowe'); }
    if (e.key.toLowerCase() === 'm') { e.preventDefault(); go('/zamowienia/nowe'); }
  }
});
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => { if (App.dirty) { e.preventDefault(); e.returnValue = ''; } });
