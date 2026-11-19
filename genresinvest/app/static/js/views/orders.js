// Rejestr zleceń: wyszukiwanie, filtry (status, kontrahent, okres), sortowanie, stronicowanie, eksport.

import { api, download } from '../api.js';
import { combobox } from '../combobox.js';
import { h, mount, icon, button, field, input, fmtPLN, fmtDate, statusBadge, pagination, emptyRow, debounce, todayISO, withBusy, showError } from '../ui.js';
import { can, navigate } from '../app.js';

const KEY = 'gri-orders-filters';

function periodRange(kind) {
  const d = new Date();
  const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  if (kind === 'month') return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), todayISO()];
  if (kind === 'prev') return [iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), iso(new Date(d.getFullYear(), d.getMonth(), 0))];
  if (kind === 'year') return [`${d.getFullYear()}-01-01`, todayISO()];
  return ['', ''];
}

export async function render(main) {
  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem(KEY) || '{}'); } catch { saved = {}; }
  const forcedStatus = sessionStorage.getItem('gri-orders-status');
  if (forcedStatus) { saved.status = forcedStatus; sessionStorage.removeItem('gri-orders-status'); }
  const f = { q: '', status: '', contractor_id: '', contractor_name: '', date_from: '', date_to: '', sort: 'date_desc', page: 1, ...saved };

  const q = input({ type: 'search', value: f.q, placeholder: 'Numer, kontrahent, NIP, trasa, opis…', 'aria-label': 'Szukaj' });
  const status = h('select', {}, [['', 'Wszystkie'], ['draft', 'Szkice'], ['issued', 'Wystawione'], ['cancelled', 'Anulowane']]
    .map(([v, l]) => h('option', { value: v, selected: f.status === v }, l)));
  const dateFrom = input({ type: 'date', value: f.date_from });
  const dateTo = input({ type: 'date', value: f.date_to });
  const sort = h('select', {}, [['date_desc', 'Data ↓'], ['date_asc', 'Data ↑'], ['number', 'Numer'], ['updated', 'Ostatnio zmieniane']]
    .map(([v, l]) => h('option', { value: v, selected: f.sort === v }, l)));
  const contractorCombo = combobox({
    value: f.contractor_name,
    placeholder: 'Wszyscy',
    freeText: false,
    source: async (text) => (await api.get('/contractors', { q: text, page_size: 20 })).items,
    label: (c) => c.name,
    sublabel: (c) => c.nip || '',
    onSelect: (c) => { f.contractor_id = c.id; f.contractor_name = c.name; reload(1); },
    onInput: (v) => { if (!v) { f.contractor_id = ''; f.contractor_name = ''; reload(1); } },
  });
  const periodChips = h('div', { class: 'chips' }, [['month', 'Ten miesiąc'], ['prev', 'Poprzedni miesiąc'], ['year', 'Ten rok'], ['all', 'Cały okres']]
    .map(([k, l]) => h('button', { type: 'button', class: 'chip', onclick: () => { [dateFrom.value, dateTo.value] = periodRange(k); reload(1); } }, l)));

  const tbody = h('tbody', {});
  const pagerBox = h('div', {});

  const searchEl = h('div', { class: 'filters', role: 'search' }, field({ label: 'Szukaj', name: 'q', control: q, cls: 'grow' }));
  const filtersEl = h('div', { class: 'filters' },
    field({ label: 'Status', name: 'status', control: status }),
    field({ label: 'Kontrahent', name: 'contractor', control: contractorCombo.el }),
    field({ label: 'Data od', name: 'date_from', control: dateFrom }),
    field({ label: 'Data do', name: 'date_to', control: dateTo }),
    field({ label: 'Sortuj', name: 'sort', control: sort }));

  const exportBtn = (fmt) => {
    const b = button(fmt.toUpperCase(), { iconName: 'download', small: true, title: `Eksport rejestru (${fmt.toUpperCase()}) z bieżącymi filtrami`,
      onClick: () => withBusy(b, () => download('/reports/export', { params: { format: fmt, ...params(false) } }).catch(showError)) });
    return b;
  };

  mount(main, 
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Rejestr zleceń'), h('div', { class: 'sub' }, 'Kliknij zlecenie, aby zobaczyć szczegóły, historię i dokumenty.')),
      h('div', { class: 'actions' }, exportBtn('xlsx'), exportBtn('csv'),
        can.edit() ? h('a', { class: 'btn primary', href: '#/zlecenia/nowe' }, icon('plus'), 'Nowe zlecenie') : null)),
    h('div', { class: 'card' }, searchEl,
      h('details', { class: 'filters-box', open: window.innerWidth > 720 || !!(f.status || f.contractor_id || f.date_from || f.date_to) },
        h('summary', {}, 'Filtry, okres i sortowanie'), filtersEl, periodChips)),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data responsive' },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Numer'), h('th', { scope: 'col' }, 'Status'), h('th', { scope: 'col' }, 'Data'),
        h('th', { scope: 'col' }, 'Kontrahent'), h('th', { scope: 'col' }, 'Usługa / ceny netto'), h('th', { scope: 'col', class: 'num' }, 'Wartość netto'))),
      tbody)),
    pagerBox);

  function params(withPage = true) {
    const p = { q: q.value.trim(), status: status.value, contractor_id: f.contractor_id, date_from: dateFrom.value, date_to: dateTo.value };
    if (withPage) Object.assign(p, { sort: sort.value, page: f.page, page_size: 25 });
    return p;
  }

  async function reload(page = f.page) {
    f.page = page;
    Object.assign(f, { q: q.value, status: status.value, date_from: dateFrom.value, date_to: dateTo.value, sort: sort.value });
    sessionStorage.setItem(KEY, JSON.stringify(f));
    if (dateFrom.value && dateTo.value && dateTo.value < dateFrom.value) {
      tbody.replaceChildren(emptyRow(6, 'Data „do” jest wcześniejsza niż „od”.'));
      return;
    }
    try {
      const data = await api.get('/orders', params());
      tbody.replaceChildren(...(data.items.length ? data.items.map((o) => h('tr', {
        class: 'clickable', tabindex: '0',
        onclick: () => navigate(`/zlecenia/${o.id}`),
        onkeydown: (e) => { if (e.key === 'Enter') navigate(`/zlecenia/${o.id}`); },
      },
      h('td', { class: 'primary-cell nowrap', 'data-label': 'Numer' }, o.number || h('span', { class: 'muted' }, `szkic #${o.id}`), o.revision > 1 ? h('span', { class: 'badge neutral', title: 'Liczba korekt' }, ` K${o.revision - 1}`) : null),
      h('td', { 'data-label': 'Status' }, statusBadge(o.status)),
      h('td', { 'data-label': 'Data', class: 'nowrap' }, fmtDate(o.issue_date)),
      h('td', { 'data-label': 'Kontrahent' }, o.contractor_name),
      h('td', { 'data-label': 'Usługa', class: 'small' }, h('div', {}, o.service_short), h('div', { class: 'muted' }, o.items_summary)),
      h('td', { 'data-label': 'Wartość', class: 'num' }, o.total_net ? fmtPLN(o.total_net) : '—'))) : [emptyRow(6, 'Brak zleceń spełniających kryteria.')]));
      pagerBox.replaceChildren(pagination(data.total, data.page, data.page_size, (p) => reload(p)));
    } catch (err) { showError(err); }
  }

  const deb = debounce(() => reload(1), 300);
  q.addEventListener('input', deb);
  for (const el of [status, dateFrom, dateTo, sort]) el.addEventListener('change', () => reload(1));
  await reload();
  q.focus();
  return null;
}
