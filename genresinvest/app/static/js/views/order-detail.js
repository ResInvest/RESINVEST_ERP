// Szczegóły zlecenia: dane, akcje (wystaw, korekta, anuluj, duplikuj, usuń), dokumenty, historia rewizji.

import { api, download, blobUrl } from '../api.js';
import {
  h, icon, button, fmtPLN, fmtDate, fmtDateTime, fmtSize, statusBadge, toast, showError, withBusy,
  confirmDialog, reasonDialog, pdfPreview, mount,
} from '../ui.js';
import { can, navigate } from '../app.js';
import { renderChanges } from './history.js';

const KIND = { issue: 'Wystawienie', correction: 'Korekta', cancel: 'Anulowanie' };

export async function render(main, { params }) {
  const id = Number(params[0]);
  const [o, revisions, documents, auditLog] = await Promise.all([
    api.get(`/orders/${id}`),
    api.get(`/orders/${id}/revisions`),
    api.get(`/orders/${id}/documents`),
    api.get('/audit', { entity: 'order', entity_id: String(id), page_size: 100 }),
  ]);
  const reload = () => { main.replaceChildren(); render(main, { params }); };

  const docBtn = (fmt) => {
    const b = button(fmt === 'pdf' ? 'Pobierz PDF' : 'Pobierz DOCX', { kind: fmt === 'pdf' ? 'primary' : '', iconName: fmt === 'pdf' ? 'pdf' : 'doc',
      onClick: () => withBusy(b, async () => {
        try { await download(`/orders/${id}/document`, { params: { format: fmt } }); } catch (err) { showError(err); }
      }) });
    return b;
  };
  const previewBtn = button('Podgląd', { iconName: 'eye', onClick: () => withBusy(previewBtn, async () => {
    try {
      const { url, name } = await blobUrl(`/orders/${id}/document`, { params: { format: 'pdf', inline: true } });
      pdfPreview(url, name, () => download(`/orders/${id}/document`, { params: { format: 'pdf' } }).catch(showError));
    } catch (err) { showError(err); }
  }) });

  const actions = [previewBtn, docBtn('pdf'), docBtn('docx')];
  if (can.edit()) {
    if (o.status === 'draft') {
      const issue = button('Wystaw zlecenie', { kind: 'primary', iconName: 'check', onClick: () => withBusy(issue, async () => {
        if (!(await confirmDialog({ title: 'Wystawić zlecenie?', message: 'Zlecenie otrzyma kolejny numer, a dokument zostanie zarchiwizowany. Dalsze zmiany będą możliwe tylko jako korekta.', confirmLabel: 'Wystaw' }))) return;
        try {
          const r = await api.post(`/orders/${id}/issue`, { row_version: o.row_version });
          toast(`Wystawiono zlecenie ${r.number}`, 'success');
          await download(`/orders/${id}/document`, { params: { format: 'pdf' } }).catch(showError);
          reload();
        } catch (err) { showError(err); }
      }) });
      actions.unshift(issue);
      actions.push(h('a', { class: 'btn', href: `#/zlecenia/${id}/edycja` }, icon('edit'), 'Edytuj'));
      actions.push(button('Usuń szkic', { kind: 'danger', iconName: 'trash', onClick: async () => {
        if (!(await confirmDialog({ title: 'Usunąć szkic?', message: 'Szkic zostanie trwale usunięty (wpis pozostanie w historii operacji).', confirmLabel: 'Usuń', danger: true }))) return;
        try { await api.del(`/orders/${id}`); toast('Usunięto szkic', 'success'); navigate('/zlecenia'); } catch (err) { showError(err); }
      } }));
    }
    if (o.status === 'issued') {
      actions.push(h('a', { class: 'btn', href: `#/zlecenia/${id}/edycja` }, icon('edit'), 'Korekta'));
      actions.push(button('Anuluj zlecenie', { kind: 'danger', iconName: 'ban', onClick: async () => {
        const reason = await reasonDialog({ title: `Anulowanie zlecenia ${o.number}`, label: 'Powód anulowania', confirmLabel: 'Anuluj zlecenie', danger: true });
        if (!reason) return;
        try { await api.post(`/orders/${id}/cancel`, { reason, row_version: o.row_version }); toast('Zlecenie anulowane', 'success'); reload(); } catch (err) { showError(err); }
      } }));
    }
    actions.push(button('Duplikuj', { iconName: 'copy', title: 'Nowy szkic na podstawie tego zlecenia', onClick: async () => {
      try { const d = await api.post(`/orders/${id}/duplicate`); toast('Utworzono nowy szkic', 'success'); navigate(`/zlecenia/${d.id}/edycja`); } catch (err) { showError(err); }
    } }));
  }

  const c = o.contractor || {};
  const dl = (pairs) => h('dl', { class: 'dl' }, pairs.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));

  mount(main, 
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, o.number ? `Zlecenie ${o.number}` : `Szkic zlecenia #${o.id}`),
        h('div', { class: 'sub row' }, statusBadge(o.status), o.revision > 1 ? h('span', { class: 'badge neutral' }, `Korekta nr ${o.revision - 1}`) : null,
          h('span', {}, `${o.issue_place}, ${fmtDate(o.issue_date)}`))),
      h('div', { class: 'actions' }, h('a', { class: 'btn ghost', href: '#/zlecenia' }, icon('back'), 'Rejestr'))),
    o.status === 'cancelled' ? h('div', { class: 'alert danger' }, h('strong', {}, `Zlecenie anulowane ${fmtDateTime(o.cancelled_at)}`), `Powód: ${o.cancel_reason}`) : null,
    o.status === 'draft' ? h('div', { class: 'alert info' }, h('strong', {}, 'To jest szkic'), 'Dokument ma znak wodny „PROJEKT” i nie ma numeru. Wystaw zlecenie, aby nadać numer i zarchiwizować dokument.') : null,
    h('div', { class: 'action-bar' }, actions),
    h('div', { class: 'grid' },
      h('section', { class: 'card col-6' }, h('h2', {}, 'Zleceniobiorca'),
        dl([['Firma', c.name], ['Adres', [c.street, [c.postal_code, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')], ['NIP', c.nip],
          ['Kontakt', [o.contractor_contact_name, o.contractor_contact_phone].filter(Boolean).join(': ')]]),
        h('p', { class: 'small muted' }, h('a', { href: '#/kontrahenci', onclick: () => sessionStorage.setItem('gri-contractor-q', c.name || '') }, 'Kartoteka kontrahenta'))),
      h('section', { class: 'card col-6' }, h('h2', {}, 'Realizacja'),
        dl([['Termin załadunku', o.loading_term], ['Punkt wyjściowy', o.origin_point], ['Punkt docelowy', o.destination_point],
          ['Płatność', `${o.payment_days} dni od daty wystawienia faktury`], ['Prowadzi', [o.handler_name, o.handler_phone].filter(Boolean).join(': ')],
          ['Utworzył', o.created_by], ['Wystawiono', o.issued_at ? fmtDateTime(o.issued_at) : null]])),
      h('section', { class: 'card col-12' }, h('h2', {}, 'Usługa i ceny netto'),
        dl([['Krótki opis', o.service_short], ['Dokładny opis', o.service_detailed], ['Rodzaj towaru', o.cargo_type], ['Uwagi', o.notes]]),
        h('div', { class: 'table-wrap', style: null }, h('table', { class: 'data responsive' },
          h('thead', {}, h('tr', {}, ['Lp.', 'Trasa / pozycja', 'Cena netto', 'Jednostka', 'Ilość', 'Wartość netto'].map((t, i) => h('th', { scope: 'col', class: i >= 2 && i !== 3 ? 'num' : '' }, t)))),
          h('tbody', {}, o.items.map((it) => h('tr', {},
            h('td', { 'data-label': 'Lp.' }, `${it.position}.`),
            h('td', { class: 'primary-cell', 'data-label': 'Trasa' }, it.route),
            h('td', { class: 'num', 'data-label': 'Cena netto' }, fmtPLN(it.net_amount)),
            h('td', { 'data-label': 'Jednostka' }, it.unit),
            h('td', { class: 'num', 'data-label': 'Ilość' }, it.quantity ? it.quantity.replace('.', ',') : '—'),
            h('td', { class: 'num', 'data-label': 'Wartość' }, it.value ? fmtPLN(it.value) : '—')))),
          o.total_net ? h('tfoot', {}, h('tr', {}, h('td', { colspan: 5 }, 'Razem netto'), h('td', { class: 'num' }, fmtPLN(o.total_net)))) : null))),
      h('section', { class: 'card col-6' }, h('h2', {}, 'Dokumenty archiwalne'),
        documents.length ? h('ul', { class: 'timeline' }, documents.map((d) => h('li', {},
          h('div', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); download(`/orders/documents/${d.id}/download`).catch(showError); } }, d.file_name)),
          h('div', { class: 'meta' }, `Rewizja ${d.revision} · ${d.format.toUpperCase()} · ${fmtSize(d.size_bytes)} · ${fmtDateTime(d.created_at)}`),
          h('div', { class: 'meta mono', title: 'Suma kontrolna SHA-256' }, `SHA-256: ${d.sha256.slice(0, 16)}…`))))
          : h('p', { class: 'muted' }, o.status === 'draft' ? 'Dokumenty archiwalne powstają po wystawieniu zlecenia.' : 'Dokument zostanie zarchiwizowany przy pierwszym pobraniu.')),
      h('section', { class: 'card col-6' }, h('h2', {}, 'Historia zlecenia'),
        revisions.length ? h('ul', { class: 'timeline' }, revisions.map((r) => h('li', {},
          h('strong', {}, `${KIND[r.kind] || r.kind}${r.kind === 'correction' ? ` nr ${r.revision - 1}` : ''}`),
          h('div', { class: 'meta' }, `${fmtDateTime(r.created_at)} · ${r.created_by}`),
          r.reason ? h('div', {}, `Powód: ${r.reason}`) : null))) : null,
        h('details', {}, h('summary', {}, `Dziennik operacji (${auditLog.total})`),
          h('ul', { class: 'timeline' }, auditLog.items.map((a) => h('li', {},
            h('div', {}, a.summary),
            h('div', { class: 'meta' }, `${fmtDateTime(a.ts)} · ${a.username}`),
            a.details?.zmiany ? renderChanges(a.details.zmiany) : null)))))));
  return null;
}
