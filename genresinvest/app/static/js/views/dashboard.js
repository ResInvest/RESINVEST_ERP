import { api } from '../api.js';
import { h, mount, icon, fmtPLN, fmtDate, statusBadge, emptyRow, MONTHS } from '../ui.js';
import { can, navigate, state } from '../app.js';

export async function render(main) {
  const [dash, recent, drafts, info] = await Promise.all([
    api.get('/reports/dashboard'),
    api.get('/orders', { page_size: 8, sort: 'updated' }),
    api.get('/orders', { status: 'draft', page_size: 5, sort: 'updated' }),
    api.get('/system/info'),
  ]);
  const m = dash.month.by_status;
  const now = new Date();
  const stat = (label, value, hint) => h('div', { class: 'stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), hint ? h('div', { class: 'hint' }, hint) : null);

  const row = (o) => h('tr', { class: 'clickable', tabindex: '0', onclick: () => navigate(`/zlecenia/${o.id}`), onkeydown: (e) => { if (e.key === 'Enter') navigate(`/zlecenia/${o.id}`); } },
    h('td', { class: 'primary-cell', 'data-label': 'Numer' }, o.number || h('span', { class: 'muted' }, 'szkic')),
    h('td', { 'data-label': 'Status' }, statusBadge(o.status)),
    h('td', { 'data-label': 'Data' }, fmtDate(o.issue_date)),
    h('td', { 'data-label': 'Kontrahent' }, o.contractor_name),
    h('td', { 'data-label': 'Ceny', class: 'small' }, o.items_summary));

  const backupWarn = (() => {
    if (!info.last_backup) return h('div', { class: 'alert warn' }, h('strong', {}, 'Brak kopii zapasowej'), 'Kopia automatyczna zostanie wykonana wkrótce. Administrator może utworzyć ją ręcznie w panelu Administracja.');
    const age = (Date.now() - new Date(info.last_backup).getTime()) / 36e5;
    return age > 48 ? h('div', { class: 'alert warn' }, h('strong', {}, 'Ostatnia kopia zapasowa jest starsza niż 2 dni'), `Utworzona: ${new Date(info.last_backup).toLocaleString('pl-PL')}`) : null;
  })();

  mount(main, 
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, `Dzień dobry, ${state.user.full_name.split(' ')[0]}`), h('div', { class: 'sub' }, `${MONTHS[now.getMonth()]} ${now.getFullYear()} · GenResInvest ${info.version}`)),
      can.edit() ? h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '#/zlecenia/nowe' }, icon('plus'), 'Nowe zlecenie')) : null),
    can.admin() ? backupWarn : null,
    h('div', { class: 'stats' },
      stat('Wystawione w tym miesiącu', String(m.issued?.count || 0), m.issued ? `wartość netto: ${fmtPLN(m.issued.value)}` : null),
      stat('Anulowane w tym miesiącu', String(m.cancelled?.count || 0)),
      stat('Szkice do wystawienia', String(dash.drafts_total)),
      stat('Aktywni kontrahenci', String(dash.contractors_active))),
    drafts.total ? h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Szkice czekające na wystawienie'), h('a', { href: '#/zlecenia', class: 'small', onclick: () => sessionStorage.setItem('gri-orders-status', 'draft') }, 'Wszystkie szkice')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data responsive' },
        h('thead', {}, h('tr', {}, ['Numer', 'Status', 'Data', 'Kontrahent', 'Ceny'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, drafts.items.map(row))))) : null,
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Ostatnio zmieniane zlecenia'), h('a', { href: '#/zlecenia', class: 'small' }, 'Rejestr zleceń')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data responsive' },
        h('thead', {}, h('tr', {}, ['Numer', 'Status', 'Data', 'Kontrahent', 'Ceny'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, recent.items.length ? recent.items.map(row) : emptyRow(5, 'Brak zleceń — utwórz pierwsze zlecenie.'))))),
    h('p', { class: 'muted small' }, 'Skróty: ', h('span', { class: 'kbd' }, 'Alt+N'), ' nowe zlecenie · ', h('span', { class: 'kbd' }, 'Alt+Z'), ' rejestr · ', h('span', { class: 'kbd' }, 'Alt+K'), ' kontrahenci · ', h('span', { class: 'kbd' }, 'Alt+R'), ' raporty'));
  return null;
}
