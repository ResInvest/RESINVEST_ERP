// Raporty: roczny (miesiące), okresowy wg kontrahentów i tras; eksport rejestru (XLSX/CSV).

import { api, download } from '../api.js';
import { h, mount, button, field, input, fmtPLN, fmtDate, emptyRow, showError, withBusy, todayISO } from '../ui.js';

export async function render(main) {
  const now = new Date();
  const yearSel = h('select', {}, Array.from({ length: 8 }, (_, i) => now.getFullYear() - i).map((y) => h('option', { value: y }, String(y))));
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const from = input({ type: 'date', value: monthStart });
  const to = input({ type: 'date', value: todayISO() });
  const yearBox = h('div', {});
  const periodBox = h('div', {});

  const exportBtn = (fmt) => {
    const b = button(`Rejestr ${fmt.toUpperCase()}`, { small: true, iconName: 'download', onClick: () => withBusy(b, () =>
      download('/reports/export', { params: { format: fmt, date_from: from.value, date_to: to.value } }).catch(showError)) });
    return b;
  };

  mount(main, 
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Raporty'), h('div', { class: 'sub' }, 'Zestawienia miesięczne i roczne. Wartości liczone dla zleceń wystawionych (bez szkiców i anulowanych).'))),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Raport roczny'), h('div', { class: 'row' }, field({ label: 'Rok', name: 'year', control: yearSel }))),
      yearBox),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Raport za okres'), h('div', { class: 'row' }, exportBtn('xlsx'), exportBtn('csv'))),
      h('div', { class: 'grid' },
        field({ label: 'Od', name: 'date_from', control: from, cls: 'col-3' }),
        field({ label: 'Do', name: 'date_to', control: to, cls: 'col-3' }),
        h('div', { class: 'col-6 chips', style: null },
          h('button', { type: 'button', class: 'chip', onclick: () => { from.value = monthStart; to.value = todayISO(); loadPeriod(); } }, 'Ten miesiąc'),
          h('button', { type: 'button', class: 'chip', onclick: () => { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); const e = new Date(now.getFullYear(), now.getMonth(), 0);
            from.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; to.value = `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`; loadPeriod(); } }, 'Poprzedni miesiąc'),
          h('button', { type: 'button', class: 'chip', onclick: () => { from.value = `${now.getFullYear()}-01-01`; to.value = todayISO(); loadPeriod(); } }, 'Ten rok'))),
      periodBox));

  async function loadYear() {
    try {
      const r = await api.get('/reports/yearly', { year: yearSel.value });
      const max = Math.max(1, ...r.months.map((m) => m.issued + m.cancelled));
      const bars = h('div', { class: 'bars', role: 'img', 'aria-label': `Liczba zleceń w miesiącach roku ${r.year}` },
        r.months.map((m) => {
          const fill = h('div', { class: 'fill', title: `${m.name}: wystawione ${m.issued}` });
          fill.style.height = `${(m.issued / max) * 100}%`;
          const fillC = h('div', { class: 'fill cancel', title: `${m.name}: anulowane ${m.cancelled}` });
          fillC.style.height = `${(m.cancelled / max) * 100}%`;
          return h('div', { class: 'bar' }, h('span', {}, m.issued || ''), fillC, fill, h('span', {}, m.name.slice(0, 3)));
        }));
      yearBox.replaceChildren(bars,
        h('div', { class: 'table-wrap' }, h('table', { class: 'data responsive' },
          h('thead', {}, h('tr', {}, ['Miesiąc', 'Wystawione', 'Anulowane', 'Szkice', 'Wartość netto', 'Bez wyceny'].map((t, i) => h('th', { scope: 'col', class: i ? 'num' : '' }, t)))),
          h('tbody', {}, r.months.map((m) => h('tr', {},
            h('td', { class: 'primary-cell', 'data-label': 'Miesiąc' }, m.name),
            h('td', { class: 'num', 'data-label': 'Wystawione' }, String(m.issued)),
            h('td', { class: 'num', 'data-label': 'Anulowane' }, String(m.cancelled)),
            h('td', { class: 'num', 'data-label': 'Szkice' }, String(m.draft)),
            h('td', { class: 'num', 'data-label': 'Wartość netto' }, fmtPLN(m.value)),
            h('td', { class: 'num', 'data-label': 'Bez wyceny', title: 'Zlecenia bez podanych ilości (sama stawka)' }, String(m.without_value))))),
          h('tfoot', {}, h('tr', {}, h('td', {}, `Razem ${r.year}`), h('td', { class: 'num' }, String(r.totals.issued)), h('td', { class: 'num' }, String(r.totals.cancelled)),
            h('td', { class: 'num' }, String(r.totals.draft)), h('td', { class: 'num' }, fmtPLN(r.totals.value)), h('td', { class: 'num' }, String(r.totals.without_value)))))),
        h('p', { class: 'small muted' }, '„Bez wyceny” — zlecenia ze stawką, ale bez ilości: liczone w sztukach, nie w wartości.'));
    } catch (err) { showError(err); }
  }

  async function loadPeriod() {
    if (from.value && to.value && to.value < from.value) { periodBox.replaceChildren(h('div', { class: 'alert warn' }, 'Data „do” jest wcześniejsza niż „od”.')); return; }
    try {
      const [byC, byR] = await Promise.all([
        api.get('/reports/contractors', { date_from: from.value, date_to: to.value }),
        api.get('/reports/routes', { date_from: from.value, date_to: to.value }),
      ]);
      periodBox.replaceChildren(
        h('h3', {}, `Kontrahenci ${fmtDate(byC.date_from)} – ${fmtDate(byC.date_to)}`),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data responsive' },
          h('thead', {}, h('tr', {}, ['Kontrahent', 'Zleceń', 'Wartość netto', 'Pierwsze', 'Ostatnie'].map((t, i) => h('th', { scope: 'col', class: i === 1 || i === 2 ? 'num' : '' }, t)))),
          h('tbody', {}, byC.rows.length ? byC.rows.map((r) => h('tr', {},
            h('td', { class: 'primary-cell', 'data-label': 'Kontrahent' }, r.contractor_name),
            h('td', { class: 'num', 'data-label': 'Zleceń' }, String(r.orders)),
            h('td', { class: 'num', 'data-label': 'Wartość' }, fmtPLN(r.value)),
            h('td', { 'data-label': 'Pierwsze' }, fmtDate(r.first_date)),
            h('td', { 'data-label': 'Ostatnie' }, fmtDate(r.last_date)))) : emptyRow(5, 'Brak wystawionych zleceń w okresie.')))),
        h('h3', {}, 'Trasy i stawki'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data responsive' },
          h('thead', {}, h('tr', {}, ['Trasa / pozycja', 'Jednostka', 'Liczba', 'Min', 'Średnia', 'Max'].map((t, i) => h('th', { scope: 'col', class: i >= 2 ? 'num' : '' }, t)))),
          h('tbody', {}, byR.rows.length ? byR.rows.map((r) => h('tr', {},
            h('td', { class: 'primary-cell', 'data-label': 'Trasa' }, r.route),
            h('td', { 'data-label': 'Jednostka' }, r.unit),
            h('td', { class: 'num', 'data-label': 'Liczba' }, String(r.count)),
            h('td', { class: 'num', 'data-label': 'Min' }, fmtPLN(r.min)),
            h('td', { class: 'num', 'data-label': 'Średnia' }, fmtPLN(r.avg)),
            h('td', { class: 'num', 'data-label': 'Max' }, fmtPLN(r.max)))) : emptyRow(6, 'Brak danych.')))));
    } catch (err) { showError(err); }
  }

  yearSel.addEventListener('change', loadYear);
  from.addEventListener('change', loadPeriod);
  to.addEventListener('change', loadPeriod);
  await Promise.all([loadYear(), loadPeriod()]);
  return null;
}
