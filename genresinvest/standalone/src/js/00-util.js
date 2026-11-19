// Narzędzia wspólne: DOM bez innerHTML (ochrona XSS), formatowanie PL, kwoty w groszach, walidatory.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  appendAll(el, children);
  return el;
}
function appendAll(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const svgNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...children) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
const nowISO = () => new Date().toISOString();
function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

// --- Kwoty: przechowywane w groszach (int), bez błędów zaokrągleń ---------------------------------
const MAX_GR = 9999999999;
function parseMoneyGr(text) {
  let t = String(text ?? '').replace(/[\s ]|zł|PLN/gi, '');
  if (!t) return { error: 'Podaj kwotę' };
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '');
  t = t.replace(',', '.');
  if (!/^\d+(\.\d{1,})?$/.test(t)) return { error: 'Nieprawidłowa kwota, np. 900,00' };
  const [i, f = ''] = t.split('.');
  if (f.replace(/0+$/, '').length > 2) return { error: 'Najwyżej 2 miejsca po przecinku' };
  const gr = Number(i) * 100 + Number((f + '00').slice(0, 2));
  if (gr <= 0) return { error: 'Kwota musi być większa od zera' };
  if (gr > MAX_GR) return { error: 'Kwota jest zbyt duża' };
  return { value: gr };
}
function parseQty(text, { required = false } = {}) {
  const t = String(text ?? '').replace(/[\s ]/g, '').replace(',', '.');
  if (!t) return required ? { error: 'Podaj ilość' } : { value: null };
  if (!/^\d+(\.\d+)?$/.test(t)) return { error: 'Nieprawidłowa liczba' };
  const [, f = ''] = t.split('.');
  if (f.length > 3) return { error: 'Najwyżej 3 miejsca po przecinku' };
  const n = Number(t);
  if (n <= 0) return { error: 'Ilość musi być większa od zera' };
  if (n > 1e9) return { error: 'Ilość jest zbyt duża' };
  return { value: Math.round(n * 1000) }; // tysięczne części
}
const nbsp = ' ';
function fmtMoney(gr, withCurrency = true) {
  if (gr === null || gr === undefined || Number.isNaN(gr)) return '—';
  const neg = gr < 0; const a = Math.abs(Math.round(gr));
  const zl = Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, nbsp);
  const out = `${neg ? '-' : ''}${zl},${String(a % 100).padStart(2, '0')}`;
  return withCurrency ? `${out}${nbsp}zł` : out;
}
const moneyInput = (gr) => (gr ? fmtMoney(gr, false).replace(/ /g, '') : '');
function fmtQty(milli) {
  if (milli === null || milli === undefined) return '';
  const n = milli / 1000;
  const [i, f] = String(Number(n.toFixed(3))).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, nbsp) + (f ? `,${f}` : '');
}
const qtyInput = (milli) => (milli ? String(Number((milli / 1000).toFixed(3))).replace('.', ',') : '');
const valueGr = (amountGr, qtyMilli) => (amountGr && qtyMilli ? Math.round((amountGr * qtyMilli) / 1000) : null);

// --- Walidatory -----------------------------------------------------------------------------------
function normNip(v) { return String(v || '').toUpperCase().replace(/^PL/, '').replace(/[\s-]/g, ''); }
function isValidNip(v) {
  const nip = normNip(v);
  if (!/^\d{10}$/.test(nip)) return false;
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = w.reduce((a, wi, i) => a + wi * Number(nip[i]), 0) % 11;
  return sum !== 10 && sum === Number(nip[9]);
}
const isValidPostal = (v) => /^\d{2}-\d{3}$/.test(v);
function normPostal(v) { const t = String(v || '').trim(); return /^\d{5}$/.test(t) ? `${t.slice(0, 2)}-${t.slice(2)}` : t; }
const isValidPhone = (v) => /^\+?[0-9 ()-]{7,20}$/.test(v) && v.replace(/\D/g, '').length >= 7 && v.replace(/\D/g, '').length <= 15;
const isValidEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
const clean = (v, max = 2000) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);

function debounce(fn, ms = 200) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
const matches = (q, ...fields) => { const nq = norm(q).trim(); return !nq || fields.some((f) => norm(f).includes(nq)); };

function b64ToBytes(b64) { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
async function sha256Hex(data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (!crypto.subtle) return '';
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeFile(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .replace(/[\\/]/g, '-').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_.-]/g, '').replace(/_+/g, '_').slice(0, 80).replace(/[._-]+$/, '') || 'dokument';
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
/** Jak Element.append, ale pomija null/false (warunkowe fragmenty widoków). */
const mount = (el, ...children) => appendAll(el, children);
