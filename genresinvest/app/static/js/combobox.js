// Combobox: pole tekstowe z listą rozwijaną, wyszukiwaniem na żywo i opcją „Dodaj nową wartość”.
// Wzorzec ARIA 1.2 (role=combobox + listbox), pełna obsługa klawiatury: ↑ ↓ Enter Esc Tab.

import { h, debounce } from './ui.js';

let seq = 0;

function highlight(text, query) {
  const label = String(text ?? '');
  if (!query) return label;
  const idx = label.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return label;
  return [label.slice(0, idx), h('mark', {}, label.slice(idx, idx + query.length)), label.slice(idx + query.length)];
}

/**
 * @param {object} o
 * @param {(q:string)=>Promise<any[]>} o.source   źródło podpowiedzi
 * @param {(item)=>string} o.label                tekst opcji (wstawiany do pola)
 * @param {(item)=>string} [o.sublabel]           druga linia opisu
 * @param {(item)=>void} [o.onSelect]             wybór opcji z listy
 * @param {boolean} [o.allowCreate]               pokazuj „+ Dodaj …” dla nowej wartości
 * @param {(q:string)=>string} [o.createLabel]
 * @param {(q:string)=>void} [o.onCreate]         wybór „Dodaj …” (np. otwarcie okna kartoteki)
 * @param {boolean} [o.freeText=true]             pole przyjmuje dowolny tekst (słowniki); false = tylko wybór z listy
 */
export function combobox(o) {
  const id = `cb-${++seq}`;
  const input = h('input', {
    type: 'text', role: 'combobox', autocomplete: 'off', 'aria-autocomplete': 'list', 'aria-expanded': 'false',
    'aria-controls': `${id}-list`, value: o.value || '', placeholder: o.placeholder || '', maxlength: o.maxlength || undefined,
    inputmode: o.inputmode || undefined,
  });
  const list = h('ul', { class: 'combo-list', id: `${id}-list`, role: 'listbox', hidden: true });
  const wrap = h('div', { class: 'combo' }, input, list);
  let items = [];
  let active = -1;
  let requestNo = 0;
  let open = false;
  const freeText = o.freeText !== false;

  const options = () => [...list.querySelectorAll('li[role="option"]')];

  function setActive(i) {
    const opts = options();
    if (!opts.length) { active = -1; input.removeAttribute('aria-activedescendant'); return; }
    active = (i + opts.length) % opts.length;
    opts.forEach((el, idx) => el.setAttribute('aria-selected', idx === active ? 'true' : 'false'));
    input.setAttribute('aria-activedescendant', opts[active].id);
    opts[active].scrollIntoView({ block: 'nearest' });
  }

  function close() {
    open = false;
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function choose(idx) {
    const el = options()[idx];
    if (!el) return;
    if (el.dataset.create) {
      const q = input.value.trim();
      close();
      o.onCreate?.(q);
      return;
    }
    const item = items[Number(el.dataset.index)];
    input.value = o.label(item);
    close();
    o.onSelect?.(item);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function refresh() {
    const q = input.value.trim();
    const my = ++requestNo;
    let result = [];
    try { result = await o.source(q); } catch { result = []; }
    if (my !== requestNo || document.activeElement !== input) return;
    items = result;
    list.replaceChildren();
    items.forEach((item, i) => {
      const sub = o.sublabel?.(item);
      list.append(h('li', { id: `${id}-opt-${i}`, role: 'option', 'aria-selected': 'false', dataset: { index: String(i) },
        onmousedown: (e) => { e.preventDefault(); choose(i); } },
      h('span', {}, highlight(o.label(item), q)), sub ? h('span', { class: 'sub' }, sub) : null));
    });
    const exact = items.some((it) => o.label(it).trim().toLowerCase() === q.toLowerCase());
    if (o.allowCreate && q && !exact) {
      const idx = items.length;
      list.append(h('li', { id: `${id}-opt-${idx}`, role: 'option', class: 'create', 'aria-selected': 'false', dataset: { create: '1' },
        onmousedown: (e) => { e.preventDefault(); choose(idx); } }, o.createLabel ? o.createLabel(q) : `+ Dodaj „${q}”`));
    }
    if (!list.children.length) {
      list.append(h('li', { class: 'muted', role: 'presentation' }, q ? 'Brak wyników' : 'Brak pozycji w słowniku — wpisz nową wartość'));
    }
    open = true;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = -1;
  }

  const debounced = debounce(refresh, 180);
  input.addEventListener('input', () => { o.onInput?.(input.value); debounced(); });
  input.addEventListener('focus', () => refresh());
  input.addEventListener('click', () => { if (!open) refresh(); });
  input.addEventListener('blur', () => setTimeout(() => {
    close();
    if (!freeText) o.onBlurCheck?.(input.value);
  }, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) refresh(); else setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (open) setActive(active - 1); }
    else if (e.key === 'Enter' && open && active >= 0) { e.preventDefault(); e.stopPropagation(); choose(active); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab' && open && active >= 0) { choose(active); }
  });

  return { el: wrap, input, close, setValue: (v) => { input.value = v ?? ''; } };
}
