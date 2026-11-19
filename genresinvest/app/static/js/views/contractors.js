// Kartoteka kontrahentów: wyszukiwanie, dodawanie/edycja, dezaktywacja, import i eksport CSV.

import { api, download } from '../api.js';
import { h, mount, icon, button, field, input, pagination, emptyRow, debounce, toast, showError, confirmDialog, modal, withBusy } from '../ui.js';
import { can } from '../app.js';
import { contractorModal } from './contractor-modal.js';

export async function render(main) {
  const q = input({ type: 'search', placeholder: 'Nazwa, NIP, miasto, telefon…', value: sessionStorage.getItem('gri-contractor-q') || '' });
  sessionStorage.removeItem('gri-contractor-q');
  const active = h('select', {}, [['', 'Wszyscy'], ['true', 'Aktywni'], ['false', 'Nieaktywni']].map(([v, l]) => h('option', { value: v }, l)));
  const tbody = h('tbody', {});
  const pager = h('div', {});
  let page = 1;

  const exportBtn = button('Eksport CSV', { small: true, iconName: 'download', onClick: () => withBusy(exportBtn, () => download('/contractors/export.csv').catch(showError)) });
  mount(main, 
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Kontrahenci'), h('div', { class: 'sub' }, 'Zleceniobiorcy (przewoźnicy, usługodawcy). Dane są kopiowane do zlecenia w chwili wystawienia.')),
      h('div', { class: 'actions' }, exportBtn,
        can.edit() ? button('Import CSV', { small: true, iconName: 'upload', onClick: importDialog }) : null,
        can.edit() ? button('Nowy kontrahent', { kind: 'primary', iconName: 'plus', onClick: async () => { if (await contractorModal()) load(); } }) : null)),
    h('div', { class: 'card' }, h('div', { class: 'grid' },
      field({ label: 'Szukaj', name: 'q', control: q, cls: 'col-8' }),
      field({ label: 'Status', name: 'active', control: active, cls: 'col-4' }))),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data responsive' },
      h('thead', {}, h('tr', {}, ['Nazwa', 'NIP', 'Adres', 'Telefon', 'Status', ''].map((t) => h('th', { scope: 'col' }, t)))),
      tbody)),
    pager);

  async function load(p = page) {
    page = p;
    try {
      const data = await api.get('/contractors', { q: q.value.trim(), active: active.value, page, page_size: 25 });
      tbody.replaceChildren(...(data.items.length ? data.items.map((c) => h('tr', {},
        h('td', { class: 'primary-cell', 'data-label': 'Nazwa' }, c.name, c.notes ? h('div', { class: 'small muted' }, c.notes) : null),
        h('td', { 'data-label': 'NIP', class: 'nowrap' }, c.nip || h('span', { class: 'muted' }, '—')),
        h('td', { 'data-label': 'Adres' }, `${c.street}, ${c.postal_code} ${c.city}${c.country !== 'PL' ? ` (${c.country})` : ''}`),
        h('td', { 'data-label': 'Telefon', class: 'nowrap' }, c.phone || '—'),
        h('td', { 'data-label': 'Status' }, h('span', { class: `badge ${c.is_active ? 'issued' : 'neutral'}` }, c.is_active ? 'aktywny' : 'nieaktywny')),
        h('td', { class: 'actions' }, can.edit() ? [
          button('', { small: true, kind: 'ghost', iconName: 'edit', title: `Edytuj ${c.name}`, onClick: async () => { if (await contractorModal({ contractor: c })) load(); } }),
          button('', { small: true, kind: 'ghost', iconName: 'trash', title: `Usuń ${c.name}`, onClick: async () => {
            if (!(await confirmDialog({ title: 'Usunąć kontrahenta?', message: `${c.name} — jeśli kontrahent występuje w zleceniach, zostanie tylko dezaktywowany.`, confirmLabel: 'Usuń', danger: true }))) return;
            try { const r = await api.del(`/contractors/${c.id}`); toast(r.message, 'success'); load(); } catch (err) { showError(err); }
          } })] : null))) : [emptyRow(6, 'Brak kontrahentów spełniających kryteria.')]));
      pager.replaceChildren(pagination(data.total, data.page, data.page_size, load));
    } catch (err) { showError(err); }
  }

  function importDialog() {
    modal({
      title: 'Import kontrahentów z CSV',
      build: (close) => {
        const file = h('input', { type: 'file', accept: '.csv,text/csv', autofocus: true });
        const result = h('div', {});
        let lastFile = null;
        const run = async (dry) => {
          if (!file.files[0]) { toast('Wybierz plik CSV', 'error'); file.focus(); return; }
          lastFile = file.files[0];
          try {
            const r = await api.upload('/contractors/import', lastFile, { dry_run: dry });
            result.replaceChildren(
              h('div', { class: `alert ${r.errors.length ? 'warn' : 'info'}` },
                h('strong', {}, dry ? 'Wynik sprawdzenia (nic nie zapisano)' : 'Import zakończony'),
                `Nowi: ${r.created} · zaktualizowani: ${r.updated} · pominięci z błędami: ${r.skipped}`),
              r.errors.length ? h('ul', { class: 'small' }, r.errors.slice(0, 50).map((e) => h('li', {}, `Wiersz ${e.line} (${e.name || 'bez nazwy'}): ${e.messages.join('; ')}`))) : null);
            confirmBtn.disabled = !dry || (r.created + r.updated === 0);
            if (!dry) { load(1); toast('Zaimportowano kontrahentów', 'success'); }
          } catch (err) { result.replaceChildren(h('div', { class: 'alert danger' }, err.message)); }
        };
        const checkBtn = button('Sprawdź plik', { onClick: () => withBusy(checkBtn, () => run(true)) });
        const confirmBtn = button('Importuj', { kind: 'primary', disabled: true, onClick: () => withBusy(confirmBtn, () => run(false)) });
        file.addEventListener('change', () => { confirmBtn.disabled = true; result.replaceChildren(); });
        return {
          body: h('div', { class: 'stack' },
            h('p', {}, 'Kolumny (nagłówek w pierwszym wierszu): ', h('code', {}, 'nazwa;ulica;kod_pocztowy;miejscowosc;kraj;nip;telefon;email;osoba_kontaktowa;uwagi;aktywny'),
              '. Separator ; lub , — kodowanie UTF-8 lub Windows-1250 (Excel). Istniejący kontrahenci (ten sam NIP lub nazwa) zostaną zaktualizowani.'),
            h('p', { class: 'small muted' }, 'Najpierw „Sprawdź plik” — program pokaże błędy bez zapisywania danych.'),
            field({ label: 'Plik CSV', name: 'file', control: file }), result),
          footer: [button('Zamknij', { onClick: () => close() }), checkBtn, confirmBtn],
        };
      },
    });
  }

  q.addEventListener('input', debounce(() => load(1), 300));
  active.addEventListener('change', () => load(1));
  await load(1);
  q.focus();
  return null;
}
