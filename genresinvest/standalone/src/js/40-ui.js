// Komponenty interfejsu: ikony, przyciski, pola z walidacją i fokusem, okna, powiadomienia,
// combobox z wyszukiwaniem i opcją „+ Dodaj”, zakładki.

const ICON = {
  home: 'M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z',
  truck: 'M3 6h11v9H3zM14 9h4l3 3v3h-7zM7 18.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm11 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z',
  cart: 'M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2M10 20a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm8 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z',
  users: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm13 9v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zm0 16a2 2 0 0 1 2-2h13v2',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 2',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 2-4-4',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h6',
  pdf: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M8 15h2.5a1.5 1.5 0 0 0 0-3H8v5',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
  upload: 'M12 20V9m0 0-4 4m4-4 4 4M5 4h14',
  edit: 'm4 20 4-1 11-11-3-3L5 16zM14 6l3 3',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  check: 'm5 12 5 5 9-10',
  x: 'M6 6l12 12M18 6 6 18',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.6 5.6l12.8 12.8',
  back: 'M19 12H5m6-6-6 6 6 6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  shield: 'M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-14v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  layers: 'm12 3 9 5-9 5-9-5zM3 13l9 5 9-5',
};
function icon(name, size = 18) {
  return s('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'ico' },
    s('path', { d: ICON[name] || '' }));
}

function btn(label, { kind = '', icon: ic, onClick, title, type = 'button', disabled, small, id } = {}) {
  return h('button', { type, class: ['btn', kind, small ? 'sm' : ''].filter(Boolean).join(' '), onclick: onClick, title, disabled, id, 'aria-label': !label ? title : undefined },
    ic ? icon(ic, small ? 16 : 18) : null, label ? h('span', {}, label) : null);
}
async function busy(button, fn) {
  if (!button || button.disabled) return undefined;
  button.disabled = true; button.classList.add('is-busy');
  try { return await fn(); } catch (err) { console.error(err); toast(err.message || String(err), 'error'); return undefined; } finally { button.disabled = false; button.classList.remove('is-busy'); }
}

// --- Powiadomienia ------------------------------------------------------------------------------
function toast(message, kind = 'info', ms = 4200) {
  const box = $('#toasts');
  const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    h('span', {}, message), h('button', { type: 'button', class: 'toast-x', 'aria-label': 'Zamknij', onclick: () => el.remove() }, icon('x', 14)));
  box.append(el);
  if (ms) setTimeout(() => el.remove(), kind === 'error' ? ms * 2 : ms);
}

// --- Okna modalne (fokus wchodzi do okna i wraca po zamknięciu) ------------------------------------
function modal({ title, size = '', build, onClose }) {
  const opener = document.activeElement;
  const dlg = h('dialog', { class: `modal ${size}`, 'aria-labelledby': 'mdl-title' });
  let done = false;
  const close = (result) => {
    if (done) return; done = true;
    dlg.close(); dlg.remove();
    if (opener?.focus) opener.focus();
    onClose?.(result);
  };
  const { body, footer, submit } = build(close);
  const form = h('form', { class: 'modal-in', novalidate: true },
    h('header', { class: 'modal-head' }, h('h2', { id: 'mdl-title' }, title),
      h('button', { type: 'button', class: 'btn ghost icon-only', 'aria-label': 'Zamknij', onclick: () => close(null) }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
    footer ? h('footer', { class: 'modal-foot' }, footer) : null);
  form.addEventListener('submit', (e) => { e.preventDefault(); submit?.(); });
  dlg.append(form);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
  document.body.append(dlg);
  dlg.showModal();
  const first = dlg.querySelector('.modal-body [autofocus], .modal-body input:not([type=hidden]):not([readonly]):not([type=checkbox]), .modal-body textarea, .modal-body select');
  (first || dlg.querySelector('.modal-foot .btn.primary') || dlg).focus();
  return { close, dlg };
}
function confirmBox({ title, message, ok = 'Potwierdź', danger = false }) {
  return new Promise((resolve) => modal({
    title, onClose: (r) => resolve(!!r),
    build: (close) => ({ body: h('p', { class: 'lead' }, message), footer: [btn('Anuluj', { onClick: () => close(false) }), h('button', { type: 'button', class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => close(true), autofocus: true }, ok)] }),
  }));
}
function reasonBox({ title, label, ok, danger = false }) {
  return new Promise((resolve) => modal({
    title, onClose: (r) => resolve(r || null),
    build: (close) => {
      const ta = h('textarea', { rows: 3, maxlength: 500, autofocus: true });
      const f = field({ label, name: 'reason', control: ta, required: true });
      return {
        body: f,
        submit: () => { const v = ta.value.trim(); if (v.length < 5) { setErrors(f, [{ field: 'reason', message: 'Podaj powód (min. 5 znaków)' }]); return; } close(v); },
        footer: [btn('Anuluj', { onClick: () => close(null) }), h('button', { type: 'submit', class: `btn ${danger ? 'danger' : 'primary'}` }, ok)],
      };
    },
  }));
}

// --- Pola formularza, błędy, fokus ----------------------------------------------------------------
let fseq = 0;
function field({ label, name, control, required = false, help, cls = '', hint }) {
  const target = control.matches?.('input,select,textarea') ? control : control.querySelector('input,select,textarea');
  const id = target?.id || `fld-${++fseq}`;
  if (target) {
    target.id = id; target.name = target.name || name;
    if (required) target.setAttribute('aria-required', 'true');
    target.setAttribute('aria-describedby', `${id}-err${help ? ` ${id}-help` : ''}`);
  }
  return h('div', { class: `field ${cls}`, dataset: { field: name } },
    h('div', { class: 'field-top' }, h('label', { for: id }, label, required ? h('span', { class: 'req', title: 'Pole wymagane' }, '*') : null), hint || null),
    control,
    help ? h('div', { class: 'help', id: `${id}-help` }, help) : null,
    h('div', { class: 'err', id: `${id}-err`, role: 'alert' }));
}
const inp = (attrs = {}) => h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', ...attrs });

function clearErrors(root) {
  $$('[aria-invalid="true"]', root).forEach((x) => x.removeAttribute('aria-invalid'));
  $$('.field .err', root).forEach((x) => { x.textContent = ''; });
  $('.form-alert', root)?.remove();
}
/** Pokazuje błędy przy polach i ustawia fokus na pierwszym (z przewinięciem). */
function setErrors(root, errors, general) {
  clearErrors(root);
  let first = null;
  const unplaced = [];
  for (const e of errors) {
    const wrap = $(`[data-field="${CSS.escape(e.field)}"]`, root);
    if (!wrap) { unplaced.push(e); continue; }
    const ctl = $('input,select,textarea', wrap);
    ctl?.setAttribute('aria-invalid', 'true');
    const er = $('.err', wrap); if (er && !er.textContent) er.textContent = e.message;
    if (!first) first = ctl;
  }
  if (unplaced.length || general) {
    const box = h('div', { class: 'form-alert', role: 'alert', tabindex: '-1' }, h('strong', {}, general || 'Popraw dane'), unplaced.length ? h('ul', {}, unplaced.map((e) => h('li', {}, e.message))) : null);
    root.prepend(box);
    if (!first) { box.focus(); box.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
  if (first) { first.scrollIntoView({ block: 'center', behavior: 'smooth' }); first.focus({ preventScroll: true }); }
}
/** Enter → następne pole; poprawienie pola kasuje jego błąd. */
function formKeys(root) {
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || ['checkbox', 'radio', 'file', 'button', 'submit'].includes(t.type)) return;
    if (t.getAttribute('aria-expanded') === 'true') return;
    e.preventDefault();
    const all = $$('input:not([type=hidden]):not([disabled]):not([readonly]):not([type=checkbox]),select:not([disabled]),textarea:not([disabled])', root).filter((x) => x.offsetParent !== null);
    all[all.indexOf(t) + 1]?.focus();
  });
  const clearOwn = (e) => {
    const t = e.target;
    if (t?.getAttribute?.('aria-invalid') !== 'true') return;
    t.removeAttribute('aria-invalid');
    const er = t.closest('[data-field]')?.querySelector('.err'); if (er) er.textContent = '';
  };
  root.addEventListener('input', clearOwn);
  root.addEventListener('change', clearOwn);
}
function clearFieldError(root, name) {
  const w = $(`[data-field="${CSS.escape(name)}"]`, root);
  if (!w) return;
  $$('[aria-invalid]', w).forEach((x) => x.removeAttribute('aria-invalid'));
  $$('.err', w).forEach((x) => { x.textContent = ''; });
}

// --- Combobox (lista rozwijana z wyszukiwaniem + „+ Dodaj”) ---------------------------------------
let cbseq = 0;
function combo(o) {
  const id = `cb${++cbseq}`;
  const input = inp({ role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': `${id}-l`, value: o.value || '', placeholder: o.placeholder || '', maxlength: o.max || 300, inputmode: o.inputmode });
  const list = h('ul', { class: 'cb-list', id: `${id}-l`, role: 'listbox', hidden: true });
  const wrap = h('div', { class: 'cb' }, input, h('span', { class: 'cb-caret', 'aria-hidden': 'true' }, icon('search', 15)), list);
  let items = []; let active = -1; let open = false;
  const opts = () => $$('li[role=option]', list);
  const close = () => { open = false; list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const setActive = (i) => {
    const os = opts(); if (!os.length) return;
    active = (i + os.length) % os.length;
    os.forEach((el, k) => el.setAttribute('aria-selected', String(k === active)));
    input.setAttribute('aria-activedescendant', os[active].id);
    os[active].scrollIntoView({ block: 'nearest' });
  };
  const choose = (i) => {
    const el = opts()[i]; if (!el) return;
    if (el.dataset.create) { const q = input.value.trim(); close(); o.onCreate?.(q); return; }
    const item = items[Number(el.dataset.i)];
    input.value = o.label(item); close();
    o.onSelect?.(item);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const mark = (text, q) => {
    const i = norm(text).indexOf(norm(q).trim());
    if (!q.trim() || i < 0) return text;
    const L = q.trim().length;
    return [text.slice(0, i), h('mark', {}, text.slice(i, i + L)), text.slice(i + L)];
  };
  const refresh = () => {
    const q = input.value;
    items = o.source(q).slice(0, 40);
    list.replaceChildren(...items.map((it, i) => h('li', { id: `${id}-${i}`, role: 'option', 'aria-selected': 'false', dataset: { i: String(i) }, onmousedown: (e) => { e.preventDefault(); choose(i); } },
      h('span', { class: 'cb-main' }, mark(o.label(it), q)), o.sub?.(it) ? h('span', { class: 'cb-sub' }, o.sub(it)) : null)));
    const exact = items.some((it) => norm(o.label(it)).trim() === norm(q).trim());
    if (o.create && q.trim() && !exact) {
      const i = items.length;
      list.append(h('li', { id: `${id}-${i}`, role: 'option', class: 'cb-create', 'aria-selected': 'false', dataset: { create: '1' }, onmousedown: (e) => { e.preventDefault(); choose(i); } },
        icon('plus', 15), h('span', {}, o.createLabel ? o.createLabel(q.trim()) : `Dodaj „${q.trim()}”`)));
    }
    if (!list.children.length) list.append(h('li', { class: 'cb-empty', role: 'presentation' }, q ? 'Brak wyników' : 'Słownik jest pusty — wpisz nową wartość'));
    open = true; list.hidden = false; input.setAttribute('aria-expanded', 'true'); active = -1;
  };
  input.addEventListener('input', () => { o.onInput?.(input.value); refresh(); });
  input.addEventListener('focus', refresh);
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) refresh(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (open) setActive(active - 1); }
    else if (e.key === 'Enter' && open && active >= 0) { e.preventDefault(); e.stopPropagation(); choose(active); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab' && open && active >= 0) choose(active);
  });
  return { el: wrap, input, set: (v) => { input.value = v ?? ''; }, close };
}

function tabs(items, current, onPick) {
  return h('div', { class: 'tabs', role: 'tablist' }, items.map(([k, label, count]) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(k === current), onclick: () => onPick(k),
  }, label, count !== undefined ? h('span', { class: 'tab-count' }, String(count)) : null)));
}

function statusTag(st) { return h('span', { class: `tag ${st}` }, STATUS[st]); }
function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, title), text ? h('p', {}, text) : null, action || null);
}
function pager(total, page, per, onPage) {
  const pages = Math.max(1, Math.ceil(total / per));
  if (pages <= 1) return h('div', { class: 'pager' }, h('span', {}, `${total} ${total === 1 ? 'pozycja' : 'pozycji'}`));
  return h('nav', { class: 'pager', 'aria-label': 'Strony' }, h('span', {}, `${total} pozycji · strona ${page} z ${pages}`),
    h('div', { class: 'row' }, btn('Poprzednia', { small: true, disabled: page <= 1, onClick: () => onPage(page - 1) }), btn('Następna', { small: true, disabled: page >= pages, onClick: () => onPage(page + 1) })));
}
function csvDownload(name, headers, rows) {
  const esc = (v) => { let t = String(v ?? ''); if (/^[=+\-@]/.test(t) && !/^-?\d/.test(t)) t = `'${t}`; return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const text = '﻿' + [headers, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), name);
}
