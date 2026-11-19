// Wspólne elementy interfejsu: budowanie DOM bez innerHTML (ochrona XSS), okna, powiadomienia,
// formatowanie, walidacja formularzy z obsługą fokusu.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') el.value = value;
    else if (key === 'checked') el.checked = !!value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Jak Element.append, ale pomija null/false (warunkowe fragmenty widoku). */
export function mount(el, ...children) { append(el, children); return el; }

/** Usuwa oznaczenia błędów wewnątrz elementu (np. po uzupełnieniu pól ze słownika). */
export function clearWithin(el) {
  el.querySelectorAll('[aria-invalid="true"]').forEach((x) => x.removeAttribute('aria-invalid'));
  el.querySelectorAll('.field .error').forEach((x) => { x.textContent = ''; });
}

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

const ICONS = {
  dashboard: 'M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z',
  orders: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 7V3.5L18.5 9zM8 13h8v2H8zm0 4h8v2H8z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z',
  contractors: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3m-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3m0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5m8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5',
  dict: 'M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2M6 4h5v8l-2.5-1.5L6 12z',
  reports: 'M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z',
  history: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.95 8.95 0 0 0 13 21a9 9 0 0 0 0-18m-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8z',
  admin: 'M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2',
  menu: 'M3 18h18v-2H3zm0-5h18v-2H3zm0-7v2h18V6z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  pdf: 'M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5zm4-3H19v1h1.5V11H19v2h-1.5V7h3zM9 9.5h1v-1H9zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4zm10 5.5h1v-3h-1z',
  doc: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8zM16 18H8v-2h8zm0-4H8v-2h8zm-3-5V3.5L18.5 9z',
  eye: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5M12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10m0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z',
  copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2m0 16H8V7h11z',
  download: 'M19 9h-4V3H9v6H5l7 7zM5 18v2h14v-2z',
  upload: 'M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z',
  logout: 'M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  ban: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2M4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.902 7.902 0 0 1 4 12m8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.902 7.902 0 0 1 20 12c0 4.42-3.58 8-8 8',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z',
};

export function icon(name, cls = 'ico') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'currentColor');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name] || '');
  svg.append(path);
  return svg;
}

export function button(label, { kind = '', onClick, iconName, type = 'button', title, small = false, id, disabled } = {}) {
  return h('button', {
    type, class: `btn ${kind} ${small ? 'sm' : ''}`.trim(), onclick: onClick, title: title || undefined, id, disabled,
    'aria-label': !label && title ? title : undefined,
  }, iconName ? icon(iconName) : null, label || null);
}

/** Blokuje przycisk na czas operacji asynchronicznej (zapobiega podwójnemu zapisowi). */
export async function withBusy(btn, fn) {
  if (!btn || btn.disabled) return undefined;
  btn.disabled = true;
  btn.classList.add('busy');
  btn.setAttribute('aria-busy', 'true');
  try { return await fn(); } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
    btn.removeAttribute('aria-busy');
  }
}

// --- Formatowanie -------------------------------------------------------------------------------
const plnFmt = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtPLN = (v) => (v === null || v === undefined || v === '' ? '—' : `${plnFmt.format(Number(v))} zł`);
export const fmtAmount = (v) => (v === null || v === undefined || v === '' ? '' : plnFmt.format(Number(v)));
export function fmtDate(v) {
  if (!v) return '—';
  const [y, m, d] = String(v).slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}
export function fmtDateTime(v) {
  if (!v) return '—';
  const iso = String(v).endsWith('Z') || String(v).includes('+') ? v : `${v}Z`;
  return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
}
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
export const STATUS = { draft: 'Szkic', issued: 'Wystawione', cancelled: 'Anulowane' };
export const statusBadge = (s) => h('span', { class: `badge ${s}` }, STATUS[s] || s);
export function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Zamienia tekst kwoty („1 234,5”) na liczbę lub NaN. */
export function parseAmount(text) {
  let t = String(text ?? '').replace(/[\s ]|zł|PLN/g, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '');
  t = t.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  return Number(t);
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// --- Powiadomienia -------------------------------------------------------------------------------
export function toast(message, kind = 'info', timeout = 4500) {
  const box = document.getElementById('toasts');
  const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    h('span', {}, message),
    h('button', { type: 'button', 'aria-label': 'Zamknij', onclick: () => el.remove() }, '×'));
  box.append(el);
  if (timeout) setTimeout(() => el.remove(), kind === 'error' ? timeout * 2 : timeout);
}

export function showError(err) {
  toast(err?.message || 'Wystąpił błąd', 'error');
}

// --- Okna modalne -------------------------------------------------------------------------------
/**
 * Otwiera okno modalne. ``build(close)`` zwraca {body, footer}. Fokus trafia na pierwsze pole,
 * Esc zamyka, po zamknięciu fokus wraca do elementu, który okno otworzył.
 */
export function modal({ title, wide = false, build, onClose }) {
  const opener = document.activeElement;
  const dlg = h('dialog', { class: `modal ${wide ? 'wide' : ''}`, 'aria-labelledby': 'modal-title' });
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    dlg.close();
    dlg.remove();
    if (opener && typeof opener.focus === 'function') opener.focus();
    onClose?.(result);
  };
  const { body, footer, form } = build(close);
  const inner = h(form ? 'form' : 'div', { class: 'modal-inner', novalidate: true },
    h('div', { class: 'modal-head' },
      h('h2', { id: 'modal-title' }, title),
      h('button', { type: 'button', class: 'btn ghost icon', 'aria-label': 'Zamknij', onclick: () => close(null) }, icon('close'))),
    h('div', { class: 'modal-body' }, body),
    footer ? h('div', { class: 'modal-foot' }, footer) : null);
  if (form) inner.addEventListener('submit', (e) => { e.preventDefault(); form(); });
  dlg.append(inner);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
  document.body.append(dlg);
  dlg.showModal();
  const first = dlg.querySelector('.modal-body [autofocus], .modal-body input:not([type=hidden]):not([readonly]), .modal-body select, .modal-body textarea');
  (first || dlg.querySelector('.modal-foot .btn.primary') || dlg).focus();
  return { close, dialog: dlg };
}

export function confirmDialog({ title = 'Potwierdź', message, confirmLabel = 'Tak', danger = false }) {
  return new Promise((resolve) => {
    modal({
      title,
      onClose: (r) => resolve(!!r),
      build: (close) => ({
        body: h('p', {}, message),
        footer: [
          button('Anuluj', { onClick: () => close(false) }),
          h('button', { type: 'button', class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => close(true), autofocus: true }, confirmLabel),
        ],
      }),
    });
  });
}

/** Okno z polem „powód” (korekta, anulowanie) — wymaga min. 5 znaków. */
export function reasonDialog({ title, label, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    modal({
      title,
      onClose: (r) => resolve(r || null),
      build: (close) => {
        const input = h('textarea', { id: 'reason', maxlength: 500, required: true, autofocus: true, rows: 3 });
        const err = h('div', { class: 'error', id: 'reason-error' });
        const submit = () => {
          const v = input.value.trim();
          if (v.length < 5) {
            input.setAttribute('aria-invalid', 'true');
            input.setAttribute('aria-describedby', 'reason-error');
            err.textContent = 'Podaj powód (min. 5 znaków)';
            input.focus();
            return;
          }
          close(v);
        };
        return {
          form: submit,
          body: h('div', { class: 'field' }, h('label', { for: 'reason' }, label, h('span', { class: 'req' }, '*')), input, err),
          footer: [button('Anuluj', { onClick: () => close(null) }), h('button', { type: 'submit', class: `btn ${danger ? 'danger' : 'primary'}` }, confirmLabel)],
        };
      },
    });
  });
}

export function pdfPreview(url, name, onDownload) {
  modal({
    title: 'Podgląd dokumentu',
    wide: true,
    onClose: () => setTimeout(() => URL.revokeObjectURL(url), 1000),
    build: (close) => ({
      body: h('iframe', { src: url, title: `Podgląd ${name}` }),
      footer: [
        h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, icon('eye'), 'Otwórz w nowej karcie'),
        onDownload ? button('Pobierz', { iconName: 'download', onClick: onDownload }) : null,
        button('Zamknij', { kind: 'primary', onClick: () => close() }),
      ],
    }),
  });
}

// --- Formularze: pola, walidacja, fokus ----------------------------------------------------------
let fieldSeq = 0;

/** Pole formularza z etykietą, pomocą i miejscem na błąd (powiązane ARIA). */
export function field({ label, name, control, required = false, help, cls = 'col-12' }) {
  const id = control.id || `f-${name.replace(/[^a-z0-9]/gi, '-')}-${++fieldSeq}`;
  const target = control.matches?.('input, select, textarea') ? control : control.querySelector('input, select, textarea');
  if (target) {
    target.id = target.id || id;
    target.name = name;
    if (required) target.setAttribute('aria-required', 'true');
  }
  const errId = `${target?.id || id}-error`;
  const helpId = help ? `${target?.id || id}-help` : null;
  if (target) target.setAttribute('aria-describedby', [helpId, errId].filter(Boolean).join(' '));
  return h('div', { class: `field ${cls}`, dataset: { field: name } },
    h('label', { for: target?.id || id }, label, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null),
    control,
    help ? h('div', { class: 'help', id: helpId }, help) : null,
    h('div', { class: 'error', id: errId, role: 'alert' }));
}

export function input(attrs = {}) { return h('input', { type: 'text', autocomplete: 'off', ...attrs }); }

export function clearErrors(root) {
  root.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
  root.querySelectorAll('.field .error').forEach((el) => { el.textContent = ''; });
  root.querySelector('.form-errors')?.remove();
}

/**
 * Pokazuje błędy przy polach ({field, message}) i ustawia fokus na pierwszym błędnym polu.
 * Błędy bez pola (lub dla pól niewidocznych) trafiają do zbiorczej ramki na górze formularza.
 */
export function showErrors(root, errors, fallbackMessage) {
  clearErrors(root);
  const general = [];
  let firstEl = null;
  for (const e of errors || []) {
    const wrapper = e.field ? root.querySelector(`[data-field="${CSS.escape(e.field)}"]`) : null;
    if (!wrapper) { general.push(e); continue; }
    const ctl = wrapper.querySelector('input, select, textarea');
    ctl?.setAttribute('aria-invalid', 'true');
    const errEl = wrapper.querySelector('.error');
    if (errEl && !errEl.textContent) errEl.textContent = e.message;
    if (!firstEl) firstEl = ctl;
  }
  if (general.length || (!errors?.length && fallbackMessage)) {
    const box = h('div', { class: 'form-errors', role: 'alert', tabindex: '-1' },
      h('strong', {}, fallbackMessage || 'Popraw dane formularza'),
      general.length ? h('ul', {}, general.map((e) => h('li', {}, e.message))) : null);
    root.prepend(box);
    if (!firstEl) { box.focus(); box.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
  if (firstEl) {
    firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    firstEl.focus({ preventScroll: true });
  }
  return !!(errors?.length || fallbackMessage);
}

/** Enter przechodzi do następnego pola (poza textarea i przyciskami) — szybkie wypełnianie z klawiatury. */
export function enterMovesFocus(root) {
  // Poprawienie pola usuwa jego komunikat błędu (bez czekania na ponowny zapis).
  const clearOwn = (e) => {
    const t = e.target;
    if (t?.getAttribute?.('aria-invalid') !== 'true') return;
    t.removeAttribute('aria-invalid');
    const err = t.closest('[data-field]')?.querySelector('.error');
    if (err) err.textContent = '';
  };
  root.addEventListener('input', clearOwn);
  root.addEventListener('change', clearOwn);
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || ['checkbox', 'radio', 'submit', 'button', 'file'].includes(t.type)) return;
    if (t.getAttribute('aria-expanded') === 'true') return;
    e.preventDefault();
    const focusables = [...root.querySelectorAll('input:not([type=hidden]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled])')]
      .filter((el) => el.offsetParent !== null);
    const next = focusables[focusables.indexOf(t) + 1];
    if (next) next.focus();
  });
}

/** Sprawdza wymagane pola lokalnie (przed wysłaniem) — komunikaty zgodne z API. */
export function requiredErrors(pairs) {
  return pairs.filter(([, v]) => !String(v ?? '').trim()).map(([fieldName, , msg]) => ({ field: fieldName, message: msg || 'Pole jest wymagane' }));
}

// --- Walidatory (lustro walidacji serwera) ---------------------------------------------------------
export function isValidNip(value) {
  const nip = String(value || '').toUpperCase().replace(/^PL/, '').replace(/[\s-]/g, '');
  if (!/^\d{10}$/.test(nip)) return false;
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = w.reduce((acc, wi, i) => acc + wi * Number(nip[i]), 0) % 11;
  return sum !== 10 && sum === Number(nip[9]);
}
export const isValidPhone = (v) => /^\+?[0-9 ()-]{7,20}$/.test(v) && v.replace(/\D/g, '').length >= 7 && v.replace(/\D/g, '').length <= 15;
export const isValidPostal = (v) => /^\d{2}-\d{3}$/.test(v);
export const isValidEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

export function pagination(total, page, pageSize, onPage) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return h('nav', { class: 'pager', 'aria-label': 'Stronicowanie' },
    h('span', {}, `Rekordów: ${total} · strona ${page} z ${pages}`),
    h('div', { class: 'btns' },
      button('‹ Poprzednia', { small: true, disabled: page <= 1, onClick: () => onPage(page - 1) }),
      button('Następna ›', { small: true, disabled: page >= pages, onClick: () => onPage(page + 1) })));
}

export function emptyRow(colspan, text) {
  return h('tr', {}, h('td', { colspan, class: 'empty' }, text));
}
