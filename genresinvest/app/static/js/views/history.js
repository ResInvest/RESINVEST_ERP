// Historia operacji (dziennik zdarzeń) z filtrowaniem: okres, użytkownik, obiekt, akcja, tekst.

import { api } from '../api.js';
import { h, mount, field, input, fmtDateTime, pagination, emptyRow, debounce, showError } from '../ui.js';
import { navigate } from '../app.js';

const ACTIONS = {
  create: 'Utworzenie', update: 'Zmiana', delete: 'Usunięcie', issue: 'Wystawienie', correction: 'Korekta', cancel: 'Anulowanie',
  duplicate: 'Duplikat', login: 'Logowanie', login_failed: 'Nieudane logowanie', logout: 'Wylogowanie', change_password: 'Zmiana hasła',
  reset_password: 'Reset hasła', import: 'Import', backup: 'Kopia zapasowa', restore: 'Przywrócenie', deactivate: 'Dezaktywacja',
};
const ENTITIES = { order: 'Zlecenie', contractor: 'Kontrahent', service: 'Opis usługi', price: 'Cena', handler: 'Osoba prowadząca', user: 'Użytkownik', settings: 'Ustawienia', system: 'System', data: 'Dane' };

function short(v) {
  if (v === null || v === undefined || v === '') return '—';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
}

export function renderChanges(changes) {
  const entries = Object.entries(changes || {});
  if (!entries.length) return null;
  return h('table', { class: 'changes' }, h('tbody', {}, entries.map(([k, v]) => h('tr', {},
    h('td', {}, k), h('td', { class: 'old' }, short(v['było'])), h('td', { class: 'new' }, short(v['jest']))))));
}

export async function render(main) {
  const from = input({ type: 'date' });
  const to = input({ type: 'date' });
  const user = input({ placeholder: 'login' });
  const entity = h('select', {}, h('option', { value: '' }, 'Wszystkie'), Object.entries(ENTITIES).map(([k, v]) => h('option', { value: k }, v)));
  const action = h('select', {}, h('option', { value: '' }, 'Wszystkie'), Object.entries(ACTIONS).map(([k, v]) => h('option', { value: k }, v)));
  const q = input({ type: 'search', placeholder: 'Szukaj w opisie…' });
  const list = h('div', {});
  const pager = h('div', {});
  let page = 1;

  mount(main, 
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Historia operacji'), h('div', { class: 'sub' }, 'Kto, co i kiedy zmienił. Wpisów nie można edytować ani usuwać.'))),
    h('div', { class: 'card' }, h('div', { class: 'filters' },
      field({ label: 'Szukaj', name: 'q', control: q, cls: 'grow' }),
      field({ label: 'Od', name: 'from', control: from }),
      field({ label: 'Do', name: 'to', control: to }),
      field({ label: 'Obiekt', name: 'entity', control: entity }),
      field({ label: 'Akcja', name: 'action', control: action }),
      field({ label: 'Użytkownik', name: 'user', control: user }))),
    h('div', { class: 'table-wrap' }, list),
    pager);

  async function load(p = page) {
    page = p;
    try {
      const data = await api.get('/audit', { page, page_size: 50, q: q.value.trim(), date_from: from.value, date_to: to.value, username: user.value.trim(), entity: entity.value, action: action.value });
      list.replaceChildren(h('table', { class: 'data responsive' },
        h('thead', {}, h('tr', {}, ['Data i czas', 'Użytkownik', 'Akcja', 'Obiekt', 'Opis'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, data.items.length ? data.items.map((a) => h('tr', {},
          h('td', { 'data-label': 'Czas', class: 'nowrap' }, fmtDateTime(a.ts)),
          h('td', { 'data-label': 'Użytkownik' }, a.username, a.ip ? h('div', { class: 'small muted' }, a.ip) : null),
          h('td', { 'data-label': 'Akcja' }, h('span', { class: `badge ${a.action === 'cancel' || a.action === 'delete' || a.action === 'login_failed' ? 'cancelled' : a.action === 'issue' ? 'issued' : 'neutral'}` }, ACTIONS[a.action] || a.action)),
          h('td', { 'data-label': 'Obiekt' }, a.entity === 'order' && a.entity_id
            ? h('a', { href: `#/zlecenia/${a.entity_id}`, onclick: (e) => { e.preventDefault(); navigate(`/zlecenia/${a.entity_id}`); } }, `${ENTITIES[a.entity]} #${a.entity_id}`)
            : `${ENTITIES[a.entity] || a.entity}${a.entity_id ? ` #${a.entity_id}` : ''}`),
          h('td', { 'data-label': 'Opis', class: 'primary-cell' }, h('div', {}, a.summary),
            a.details?.zmiany && Object.keys(a.details.zmiany).length ? h('details', {}, h('summary', { class: 'small' }, `Zmiany (${Object.keys(a.details.zmiany).length})`), renderChanges(a.details.zmiany)) : null)))
          : emptyRow(5, 'Brak wpisów.'))));
      pager.replaceChildren(pagination(data.total, data.page, data.page_size, load));
    } catch (err) { showError(err); }
  }

  const deb = debounce(() => load(1), 300);
  for (const el of [q, user]) el.addEventListener('input', deb);
  for (const el of [from, to, entity, action]) el.addEventListener('change', () => load(1));
  await load(1);
  return null;
}
