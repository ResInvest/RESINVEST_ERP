// Słowniki: opisy usług, ceny netto (trasy), osoby prowadzące. Wspólny edytor tabelaryczny.

import { api } from '../api.js';
import { h, mount, button, field, input, modal, emptyRow, toast, showError, showErrors, confirmDialog, withBusy, fmtPLN, debounce, parseAmount, isValidPhone, enterMovesFocus } from '../ui.js';
import { can } from '../app.js';

const DEFS = {
  services: {
    title: 'Opisy usług',
    hint: 'Krótki opis trafia do rubryki „Krótki opis usługi”, dokładny — do „Dokładny opis usługi”.',
    endpoint: '/services',
    columns: [['Krótki opis usługi', (x) => x.short_description, 'primary-cell'], ['Rodzaj towaru', (x) => x.cargo_type], ['Użycia', (x) => String(x.usage_count), 'num']],
    label: (x) => x.short_description,
    fields: (x = {}) => [
      { name: 'short_description', label: 'Krótki opis usługi', required: true, control: h('textarea', { rows: 2, maxlength: 300 }, x.short_description || ''), check: (v) => v.length >= 3 || 'Min. 3 znaki' },
      { name: 'detailed_description', label: 'Dokładny opis usługi', control: h('textarea', { rows: 3, maxlength: 2000 }, x.detailed_description || '') },
      { name: 'cargo_type', label: 'Rodzaj przewożonego towaru', control: input({ value: x.cargo_type || '', maxlength: 200 }) },
    ],
  },
  prices: {
    title: 'Ceny netto',
    hint: 'Trasa / pozycja z ceną netto i jednostką — do szybkiego wyboru w zleceniu.',
    endpoint: '/prices',
    columns: [['Trasa / pozycja', (x) => x.route, 'primary-cell'], ['Cena netto', (x) => fmtPLN(x.net_amount), 'num'], ['Jednostka', (x) => x.unit], ['Użycia', (x) => String(x.usage_count), 'num']],
    label: (x) => `${x.route} — ${fmtPLN(x.net_amount)} ${x.unit}`,
    fields: (x = {}) => [
      { name: 'route', label: 'Trasa / pozycja', required: true, control: input({ value: x.route || '', maxlength: 200, placeholder: 'np. Zabrze - Chorzów' }), check: (v) => v.length >= 1 || 'Wymagane' },
      { name: 'net_amount', label: 'Cena netto [zł]', required: true, control: input({ value: x.net_amount ? x.net_amount.replace('.', ',') : '', inputmode: 'decimal', class: 'num' }),
        check: (v) => { const n = parseAmount(v); return (!Number.isNaN(n) && n > 0 && Math.round(n * 100) / 100 === n) || 'Kwota > 0, maks. 2 miejsca po przecinku'; },
        map: (v) => parseAmount(v).toFixed(2) },
      { name: 'unit', label: 'Jednostka', required: true, control: input({ value: x.unit || 'zł/fracht', maxlength: 40 }), check: (v) => v.length >= 1 || 'Wymagane' },
    ],
  },
  handlers: {
    title: 'Osoby prowadzące',
    hint: 'Osoby po stronie ResInvest („Po stronie Zleceniodawcy sprawę prowadzi”).',
    endpoint: '/handlers',
    columns: [['Imię i nazwisko', (x) => x.full_name, 'primary-cell'], ['Telefon', (x) => x.phone], ['E-mail', (x) => x.email || '—'], ['Użycia', (x) => String(x.usage_count), 'num']],
    label: (x) => x.full_name,
    fields: (x = {}) => [
      { name: 'full_name', label: 'Imię i nazwisko', required: true, control: input({ value: x.full_name || '', maxlength: 120 }), check: (v) => v.length >= 3 || 'Min. 3 znaki' },
      { name: 'phone', label: 'Telefon', control: input({ value: x.phone || '', maxlength: 40, inputmode: 'tel' }), check: (v) => !v || isValidPhone(v) || 'Nieprawidłowy numer' },
      { name: 'email', label: 'E-mail', control: input({ value: x.email || '', maxlength: 160, type: 'email' }), map: (v) => v || null },
    ],
  },
};

export async function render(main) {
  let current = sessionStorage.getItem('gri-dict-tab') || 'services';
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const panel = h('div', { role: 'tabpanel' });
  mount(main, 
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Słowniki'),
      h('div', { class: 'sub' }, 'Wartości do wyboru z listy rozwijanej. Nowe wartości wpisane w zleceniu dopisują się tu automatycznie.'))),
    tabs, panel);

  function drawTabs() {
    tabs.replaceChildren(...Object.entries(DEFS).map(([key, d]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(key === current), onclick: () => { current = key; sessionStorage.setItem('gri-dict-tab', key); drawTabs(); drawPanel(); },
    }, d.title)));
  }

  async function drawPanel() {
    const def = DEFS[current];
    const q = input({ type: 'search', placeholder: 'Szukaj…', 'aria-label': `Szukaj: ${def.title}` });
    const tbody = h('tbody', {});
    panel.replaceChildren(
      h('div', { class: 'card-head' }, h('p', { class: 'muted', style: null }, def.hint),
        can.edit() ? button('Dodaj', { kind: 'primary', iconName: 'plus', onClick: () => edit(null) }) : null),
      h('div', { class: 'card' }, q),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data responsive' },
        h('thead', {}, h('tr', {}, def.columns.map(([t, , cls]) => h('th', { scope: 'col', class: cls === 'num' ? 'num' : '' }, t)), h('th', { scope: 'col' }, 'Status'), h('th', {}))),
        tbody)));
    async function load() {
      try {
        const rows = await api.get(def.endpoint, { q: q.value.trim(), limit: 500 });
        tbody.replaceChildren(...(rows.length ? rows.map((x) => h('tr', {},
          def.columns.map(([t, fn, cls]) => h('td', { 'data-label': t, class: cls || '' }, fn(x))),
          h('td', { 'data-label': 'Status' }, h('span', { class: `badge ${x.is_active ? 'issued' : 'neutral'}` }, x.is_active ? 'aktywna' : 'ukryta')),
          h('td', { class: 'actions' }, can.edit() ? [
            button('', { small: true, kind: 'ghost', iconName: 'edit', title: 'Edytuj', onClick: () => edit(x) }),
            button('', { small: true, kind: 'ghost', iconName: 'trash', title: 'Usuń', onClick: async () => {
              if (!(await confirmDialog({ title: 'Usunąć pozycję?', message: `${def.label(x)} — zlecenia zachowują własną kopię tekstu, więc usunięcie nie zmieni dokumentów.`, confirmLabel: 'Usuń', danger: true }))) return;
              try { await api.del(`${def.endpoint}/${x.id}`); toast('Usunięto', 'success'); load(); } catch (err) { showError(err); }
            } })] : null))) : [emptyRow(def.columns.length + 2, 'Słownik jest pusty.')]));
      } catch (err) { showError(err); }
    }
    function edit(x) {
      const fields = def.fields(x || {});
      const activeBox = h('input', { type: 'checkbox', checked: x ? x.is_active : true });
      const body = h('div', { class: 'grid' },
        fields.map((f) => field({ label: f.label, name: f.name, control: f.control, required: f.required })),
        h('label', { class: 'check col-12' }, activeBox, 'Aktywna (widoczna na liście w zleceniach)'));
      enterMovesFocus(body);
      modal({
        title: x ? `Edycja: ${def.title}` : `Nowa pozycja: ${def.title}`,
        build: (close) => {
          const save = h('button', { type: 'submit', class: 'btn primary' }, 'Zapisz');
          return {
            body,
            form: () => withBusy(save, async () => {
              const data = { is_active: activeBox.checked };
              const errs = [];
              for (const f of fields) {
                const v = f.control.value.trim();
                const res = f.check ? f.check(v) : true;
                if (res !== true) errs.push({ field: f.name, message: res });
                data[f.name] = f.map ? f.map(v) : v;
              }
              if (errs.length) { showErrors(body, errs); return; }
              try {
                if (x) await api.put(`${def.endpoint}/${x.id}`, data); else await api.post(def.endpoint, data);
                toast('Zapisano', 'success'); close(true); load();
              } catch (err) { showErrors(body, err.errors, err.errors?.length ? null : err.message); }
            }),
            footer: [button('Anuluj', { onClick: () => close() }), save],
          };
        },
      });
    }
    q.addEventListener('input', debounce(load, 250));
    await load();
  }

  drawTabs();
  await drawPanel();
  return null;
}
