// Formularz zlecenia: nowe zlecenie, edycja szkicu, korekta wystawionego.
// Listy rozwijane z dopisywaniem (kontrahenci, usługi, ceny, jednostki, osoby), walidacja na żywo,
// fokus na pierwszym błędzie, Enter → następne pole, Ctrl+S zapis, Ctrl+P podgląd.

import { api, download, blobUrl } from '../api.js';
import { combobox } from '../combobox.js';
import {
  h, mount, icon, button, field, input, toast, showErrors, clearErrors, enterMovesFocus, withBusy, fmtPLN, parseAmount,
  todayISO, MONTHS, pdfPreview, clearWithin, isValidPhone, statusBadge,
} from '../ui.js';
import { navigate, setDirty, loadSettings } from '../app.js';
import { contractorModal } from './contractor-modal.js';

const ensureArray = (x) => (Array.isArray(x) ? x : x?.items || []);

export async function render(main, { params }) {
  const orderId = params[0] ? Number(params[0]) : null;
  const settings = await loadSettings();
  const [order, units] = await Promise.all([
    orderId ? api.get(`/orders/${orderId}`) : Promise.resolve(null),
    api.get('/units'),
  ]);
  if (order?.status === 'cancelled') {
    mount(main, h('div', { class: 'alert danger' }, 'Zlecenie jest anulowane — nie można go edytować.'));
    return null;
  }
  const isCorrection = order?.status === 'issued';
  let contractor = order ? { id: order.contractor_id, ...order.contractor } : null;
  let handlerId = order?.handler_id ?? null;

  // --- 1. Zleceniobiorca -------------------------------------------------------------------------
  const partyBox = h('div', {});
  const contactName = input({ value: order?.contractor_contact_name || '', maxlength: 120, placeholder: 'np. kierowca / dyspozytor' });
  const contactPhone = input({ value: order?.contractor_contact_phone || '', maxlength: 40, inputmode: 'tel', placeholder: '+48 600 000 000' });

  function showParty() {
    partyBox.replaceChildren();
    if (!contractor) return;
    partyBox.append(h('div', { class: 'selected-party' },
      h('div', {},
        h('strong', {}, contractor.name), h('br'),
        [contractor.street, [contractor.postal_code, contractor.city].filter(Boolean).join(' ')].filter(Boolean).join(', '), h('br'),
        contractor.nip ? `NIP: ${contractor.nip}` : h('span', { class: 'muted' }, 'brak NIP')),
      button('', { small: true, kind: 'ghost', iconName: 'edit', title: 'Edytuj dane kontrahenta', onClick: async () => {
        const full = await api.get(`/contractors/${contractor.id}`);
        const saved = await contractorModal({ contractor: full });
        if (saved) { contractor = saved; contractorCombo.setValue(saved.name); showParty(); }
      } })));
  }

  function selectContractor(c) {
    contractor = c;
    contractorCombo.setValue(c.name);
    if (!contactPhone.value && c.phone) contactPhone.value = c.phone;
    if (!contactName.value && c.contact_person) contactName.value = c.contact_person;
    showParty();
    markDirty();
    clearFieldError('contractor_id');
  }

  const contractorCombo = combobox({
    value: contractor?.name || '',
    placeholder: 'Wpisz nazwę, NIP lub miasto…',
    freeText: false,
    source: async (q) => ensureArray(await api.get('/contractors', { q, active: true, page_size: 20 })),
    label: (c) => c.name,
    sublabel: (c) => [c.nip ? `NIP ${c.nip}` : null, c.city].filter(Boolean).join(' · '),
    onSelect: selectContractor,
    allowCreate: true,
    createLabel: (q) => `+ Dodaj nowego kontrahenta „${q}”…`,
    onCreate: async (q) => {
      const saved = await contractorModal({ prefillName: q });
      if (saved) selectContractor(saved); else contractorCombo.input.focus();
    },
    onInput: () => { if (contractor && contractorCombo.input.value !== contractor.name) { contractor = null; showParty(); } },
  });
  showParty();

  // --- 2. Usługa ----------------------------------------------------------------------------------
  const detailed = h('textarea', { maxlength: 2000, rows: 2 }, order?.service_detailed || '');
  const cargo = input({ value: order?.cargo_type || '', maxlength: 200, placeholder: 'np. PKS (Łupina ziarna palmowego)' });
  const serviceCombo = combobox({
    value: order?.service_short || '',
    placeholder: 'Wybierz z listy lub wpisz nowy opis…',
    maxlength: 300,
    source: async (q) => api.get('/services', { q, active: true, limit: 30 }),
    label: (s) => s.short_description,
    sublabel: (s) => s.cargo_type,
    onSelect: (s) => {
      // Wybór z listy = świadoma decyzja użytkownika: uzupełniamy opis i towar ze słownika.
      if (s.detailed_description) detailed.value = s.detailed_description;
      if (s.cargo_type) cargo.value = s.cargo_type;
      clearWithin(form.querySelector('[aria-labelledby="s2"]'));
      markDirty();
    },
    allowCreate: true,
    createLabel: (q) => `+ Nowy opis usługi: „${q.length > 50 ? `${q.slice(0, 50)}…` : q}” (zapisze się w słowniku)`,
    onCreate: (q) => { serviceCombo.setValue(q); detailed.focus(); },
  });

  // --- 3. Ceny netto ------------------------------------------------------------------------------
  const rowsBox = h('div', {});
  const totalLine = h('div', { class: 'summary-line', 'aria-live': 'polite' });
  const rows = [];

  function addRow(item = {}, focus = false) {
    const amount = input({ value: item.net_amount ? String(item.net_amount).replace('.', ',') : '', inputmode: 'decimal', class: 'num', placeholder: '0,00', maxlength: 16 });
    const qty = input({ value: item.quantity ? String(item.quantity).replace('.', ',') : '', inputmode: 'decimal', class: 'num', placeholder: 'opcjonalnie', maxlength: 14 });
    const value = h('div', { class: 'value' });
    const row = { amount, qty, value };
    const unitCombo = combobox({
      value: item.unit || units[0] || 'zł/fracht',
      maxlength: 40,
      source: async (q) => units.filter((u) => !q || u.toLowerCase().includes(q.toLowerCase())).map((u) => ({ u })),
      label: (x) => x.u,
      allowCreate: true,
      createLabel: (q) => `+ Jednostka „${q}”`,
      onCreate: (q) => { unitCombo.setValue(q); units.push(q); qty.focus(); },
    });
    const routeCombo = combobox({
      value: item.route || '',
      maxlength: 200,
      placeholder: 'np. Zabrze - Chorzów',
      source: async (q) => api.get('/prices', { q, active: true, limit: 30 }),
      label: (p) => p.route,
      sublabel: (p) => `${fmtPLN(p.net_amount)} · ${p.unit}`,
      onSelect: (p) => { amount.value = p.net_amount.replace('.', ','); unitCombo.setValue(p.unit); clearWithin(row.el); recalc(); amount.focus(); amount.select(); },
      allowCreate: true,
      createLabel: (q) => `+ Nowa pozycja „${q}” (zapisze się w słowniku cen)`,
      onCreate: (q) => { routeCombo.setValue(q); amount.focus(); },
    });
    Object.assign(row, { routeCombo, unitCombo });
    const remove = button('', { kind: 'ghost', iconName: 'trash', title: 'Usuń pozycję', onClick: () => {
      if (rows.length === 1) { toast('Zlecenie musi mieć co najmniej jedną pozycję cenową', 'error'); return; }
      rows.splice(rows.indexOf(row), 1); row.el.remove(); renumber(); recalc(); markDirty();
    } });
    remove.classList.add('remove');
    row.el = h('div', { class: 'price-row' },
      h('div', { class: 'pos' }),
      field({ label: 'Trasa / pozycja', name: 'route', control: routeCombo.el, required: true, cls: 'route-field' }),
      field({ label: 'Cena netto', name: 'net_amount', control: amount, required: true, cls: '' }),
      field({ label: 'Jednostka', name: 'unit', control: unitCombo.el, required: true, cls: '' }),
      field({ label: 'Ilość', name: 'quantity', control: qty, cls: '' }),
      value, remove);
    for (const el of [amount, qty]) el.addEventListener('input', recalc);
    amount.addEventListener('blur', () => { const n = parseAmount(amount.value); if (!Number.isNaN(n) && n > 0) amount.value = n.toFixed(2).replace('.', ','); });
    rows.push(row);
    rowsBox.append(row.el);
    renumber();
    recalc();
    if (focus) routeCombo.input.focus();
  }

  function renumber() {
    rows.forEach((r, i) => {
      r.el.querySelector('.pos').textContent = `${i + 1}.`;
      r.el.querySelectorAll('[data-field]').forEach((w) => {
        const base = w.dataset.field.split('.').pop();
        w.dataset.field = `items.${i}.${base}`;
      });
    });
  }

  function recalc() {
    let total = 0;
    let complete = true;
    for (const r of rows) {
      const a = parseAmount(r.amount.value);
      const q = r.qty.value.trim() ? parseAmount(r.qty.value) : NaN;
      if (!Number.isNaN(a) && !Number.isNaN(q)) {
        const v = Math.round(a * q * 100) / 100;
        r.value.textContent = fmtPLN(v);
        total += v;
      } else { r.value.textContent = '—'; complete = false; }
    }
    totalLine.replaceChildren();
    if (complete && rows.length) totalLine.append(h('span', {}, 'Wartość zlecenia netto:'), h('span', {}, fmtPLN(total)));
    else totalLine.append(h('span', { class: 'muted small' }, 'Podaj ilości, aby wyliczyć wartość zlecenia (opcjonalnie).'));
  }

  (order?.items?.length ? order.items : [{}]).forEach((it) => addRow(it));
  const paymentDays = input({ type: 'number', min: 0, max: 365, value: String(order?.payment_days ?? settings.defaults.payment_days), inputmode: 'numeric', class: 'num' });
  const paymentChips = h('div', { class: 'chips' }, [7, 14, 21, 30, 45, 60].map((d) => h('button', { type: 'button', class: 'chip', onclick: () => { paymentDays.value = d; markDirty(); } }, `${d} dni`)));

  // --- 4. Realizacja ------------------------------------------------------------------------------
  const origin = input({ value: order?.origin_point ?? 'jak wyżej', maxlength: 300 });
  const destination = input({ value: order?.destination_point ?? 'jak wyżej', maxlength: 300 });
  const now = new Date();
  const monthLabel = (offset) => { const d = new Date(now.getFullYear(), now.getMonth() + offset, 1); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
  const loadingTerm = input({ value: order?.loading_term || monthLabel(0), maxlength: 200 });
  const termChips = h('div', { class: 'chips' },
    [monthLabel(0), monthLabel(1), 'Do uzgodnienia', 'Niezwłocznie'].map((t) => h('button', { type: 'button', class: 'chip', onclick: () => { loadingTerm.value = t; markDirty(); } }, t)));

  // --- 5. Osoby, miejsce, data --------------------------------------------------------------------
  const handlerPhone = input({ value: order?.handler_phone || '', maxlength: 40, inputmode: 'tel' });
  const handlerCombo = combobox({
    value: order?.handler_name || '',
    maxlength: 120,
    placeholder: 'Imię i nazwisko',
    source: async (q) => api.get('/handlers', { q, active: true, limit: 30 }),
    label: (x) => x.full_name,
    sublabel: (x) => x.phone,
    onSelect: (x) => { handlerId = x.id; handlerPhone.value = x.phone; clearWithin(form.querySelector('[aria-labelledby="s5"]')); markDirty(); handlerPhone.focus(); },
    allowCreate: true,
    createLabel: (q) => `+ Nowa osoba „${q}” (zapisze się w słowniku)`,
    onCreate: (q) => { handlerCombo.setValue(q); handlerId = null; handlerPhone.value = ''; handlerPhone.focus(); },
    onInput: () => { handlerId = null; },
  });
  const issuePlace = input({ value: order?.issue_place || settings.defaults.issue_place, maxlength: 120 });
  const issueDate = input({ type: 'date', value: order?.issue_date || todayISO(), min: '2000-01-01', max: '2100-12-31' });
  const notes = h('textarea', { maxlength: 2000, rows: 3, placeholder: 'Dodatkowe warunki, uwagi do realizacji (opcjonalnie)' }, order?.notes || '');
  const learn = h('input', { type: 'checkbox', checked: true });
  const correctionReason = h('textarea', { maxlength: 500, rows: 2, placeholder: 'np. zmiana terminu załadunku na prośbę przewoźnika' });

  // --- Złożenie widoku ----------------------------------------------------------------------------
  const form = h('form', { novalidate: true, class: 'order-form' },
    isCorrection ? h('div', { class: 'card' },
      h('div', { class: 'alert warn' }, h('strong', {}, `Korekta zlecenia ${order.number}`),
        'Zlecenie jest już wystawione. Zapis utworzy nową rewizję dokumentu (poprzednie wersje pozostaną w historii).'),
      field({ label: 'Powód korekty', name: 'correction_reason', control: correctionReason, required: true })) : null,
    h('section', { class: 'card', 'aria-labelledby': 's1' },
      h('h2', { id: 's1' }, h('span', { class: 'step' }, '1'), 'Zleceniobiorca'),
      h('div', { class: 'grid' },
        h('div', { class: 'col-12' }, field({ label: 'Kontrahent', name: 'contractor_id', control: contractorCombo.el, required: true, help: 'Wybierz z kartoteki albo dopisz nowego — wpisz nazwę i wybierz „+ Dodaj”.' }), partyBox),
        field({ label: 'Osoba kontaktowa Zleceniobiorcy', name: 'contractor_contact_name', control: contactName, cls: 'col-6' }),
        field({ label: 'Telefon Zleceniobiorcy', name: 'contractor_contact_phone', control: contactPhone, cls: 'col-6' }))),
    h('section', { class: 'card', 'aria-labelledby': 's2' },
      h('h2', { id: 's2' }, h('span', { class: 'step' }, '2'), 'Usługa'),
      h('div', { class: 'grid' },
        field({ label: 'Krótki opis usługi', name: 'service_short', control: serviceCombo.el, required: true, help: 'Krótko i dokładnie, np. „Przewóz PKS za pomocą auta typu wywrotka.”' }),
        field({ label: 'Dokładny opis usługi', name: 'service_detailed', control: detailed, cls: 'col-8' }),
        field({ label: 'Rodzaj przewożonego towaru', name: 'cargo_type', control: cargo, cls: 'col-4' }))),
    h('section', { class: 'card', 'aria-labelledby': 's3' },
      h('div', { class: 'card-head' },
        h('h2', { id: 's3' }, h('span', { class: 'step' }, '3'), 'Cena netto'),
        button('Dodaj pozycję', { small: true, iconName: 'plus', onClick: () => { addRow({}, true); markDirty(); } })),
      h('div', { 'data-field': 'items' }, h('div', { class: 'error', role: 'alert' })),
      rowsBox, totalLine,
      h('div', { class: 'grid' },
        field({ label: 'Termin płatności (dni od daty wystawienia faktury)', name: 'payment_days', control: h('div', { class: 'stack' }, paymentDays, paymentChips), required: true, cls: 'col-6' }))),
    h('section', { class: 'card', 'aria-labelledby': 's4' },
      h('h2', { id: 's4' }, h('span', { class: 'step' }, '4'), 'Realizacja'),
      h('div', { class: 'grid' },
        field({ label: 'Punkt wyjściowy (załadunek)', name: 'origin_point', control: origin, cls: 'col-6' }),
        field({ label: 'Punkt docelowy (rozładunek)', name: 'destination_point', control: destination, cls: 'col-6' }),
        field({ label: 'Termin załadunku', name: 'loading_term', control: h('div', { class: 'stack' }, loadingTerm, termChips), required: true }))),
    h('section', { class: 'card', 'aria-labelledby': 's5' },
      h('h2', { id: 's5' }, h('span', { class: 'step' }, '5'), 'Osoby, miejsce i data'),
      h('div', { class: 'grid' },
        field({ label: 'Sprawę prowadzi (ResInvest)', name: 'handler_name', control: handlerCombo.el, required: true, cls: 'col-6' }),
        field({ label: 'Telefon osoby prowadzącej', name: 'handler_phone', control: handlerPhone, cls: 'col-6' }),
        field({ label: 'Miejsce wystawienia', name: 'issue_place', control: issuePlace, required: true, cls: 'col-6' }),
        field({ label: 'Data wystawienia', name: 'issue_date', control: issueDate, required: true, cls: 'col-6' }),
        field({ label: 'Uwagi (drukowane na zleceniu)', name: 'notes', control: notes }),
        h('label', { class: 'check col-12' }, learn, 'Zapisuj nowe opisy usług, ceny i osoby w słownikach (do wyboru z listy w kolejnych zleceniach)'))));

  const btnPreview = button('Podgląd', { iconName: 'eye', title: 'Podgląd PDF (Ctrl+P)', onClick: () => withBusy(btnPreview, preview) });
  const btnDocx = button('DOCX', { iconName: 'doc', title: 'Pobierz projekt jako DOCX', onClick: () => withBusy(btnDocx, () => previewDownload('docx')) });
  const btnSave = button(isCorrection ? 'Zapisz korektę' : 'Zapisz szkic', { kind: isCorrection ? 'primary' : '', iconName: 'check', title: 'Zapisz (Ctrl+S)', onClick: () => withBusy(btnSave, () => save(false)) });
  const btnIssue = !isCorrection ? button('Zapisz i wystaw', { kind: 'primary', iconName: 'pdf', onClick: () => withBusy(btnIssue, () => save(true)) }) : null;
  const bar = h('div', { class: 'action-bar' },
    h('span', { class: 'info' }, 'Pola oznaczone * są wymagane · ', h('span', { class: 'kbd' }, 'Ctrl+S'), ' zapis · ', h('span', { class: 'kbd' }, 'Enter'), ' następne pole'),
    btnPreview, btnDocx, btnSave, btnIssue);

  mount(main, 
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, isCorrection ? `Korekta zlecenia ${order.number}` : order ? 'Edycja szkicu zlecenia' : 'Nowe zlecenie'),
        h('div', { class: 'sub' }, order ? statusBadge(order.status) : 'Dokument powstanie na papierze firmowym ResInvest (PDF i DOCX).')),
      h('div', { class: 'actions' }, h('a', { class: 'btn ghost', href: order ? `#/zlecenia/${order.id}` : '#/zlecenia' }, icon('back'), 'Wróć'))),
    form, bar);

  enterMovesFocus(form);
  form.addEventListener('input', markDirty);
  form.addEventListener('submit', (e) => e.preventDefault());

  function markDirty() { setDirty(true); }
  function clearFieldError(name) {
    const w = form.querySelector(`[data-field="${name}"]`);
    w?.querySelector('[aria-invalid]')?.removeAttribute('aria-invalid');
    const e = w?.querySelector('.error'); if (e) e.textContent = '';
  }

  // --- Zbieranie danych i walidacja ---------------------------------------------------------------
  function collect() {
    return {
      contractor_id: contractor?.id ?? 0,
      issue_date: issueDate.value,
      issue_place: issuePlace.value.trim(),
      contractor_contact_name: contactName.value.trim(),
      contractor_contact_phone: contactPhone.value.trim(),
      service_short: serviceCombo.input.value.trim(),
      service_detailed: detailed.value.trim(),
      cargo_type: cargo.value.trim(),
      origin_point: origin.value.trim(),
      destination_point: destination.value.trim(),
      loading_term: loadingTerm.value.trim(),
      payment_days: Number(paymentDays.value),
      handler_id: handlerId,
      handler_name: handlerCombo.input.value.trim(),
      handler_phone: handlerPhone.value.trim(),
      notes: notes.value.trim(),
      items: rows.map((r) => ({
        route: r.routeCombo.input.value.trim(),
        net_amount: r.amount.value.trim(),
        unit: r.unitCombo.input.value.trim(),
        quantity: r.qty.value.trim() || null,
      })),
      save_to_dictionaries: learn.checked,
      row_version: order?.row_version ?? null,
      correction_reason: isCorrection ? correctionReason.value.trim() : null,
    };
  }

  function validate(d) {
    const errs = [];
    if (isCorrection && d.correction_reason.length < 5) errs.push({ field: 'correction_reason', message: 'Podaj powód korekty (min. 5 znaków)' });
    if (!d.contractor_id) errs.push({ field: 'contractor_id', message: 'Wybierz kontrahenta z listy lub dodaj nowego' });
    if (d.contractor_contact_phone && !isValidPhone(d.contractor_contact_phone)) errs.push({ field: 'contractor_contact_phone', message: 'Nieprawidłowy numer telefonu' });
    if (d.service_short.length < 3) errs.push({ field: 'service_short', message: 'Podaj krótki opis usługi (min. 3 znaki)' });
    d.items.forEach((it, i) => {
      if (!it.route) errs.push({ field: `items.${i}.route`, message: 'Podaj trasę / pozycję' });
      const a = parseAmount(it.net_amount);
      if (Number.isNaN(a) || a <= 0) errs.push({ field: `items.${i}.net_amount`, message: 'Cena netto > 0, np. 900,00' });
      else if (Math.round(a * 100) / 100 !== a) errs.push({ field: `items.${i}.net_amount`, message: 'Najwyżej 2 miejsca po przecinku' });
      if (!it.unit) errs.push({ field: `items.${i}.unit`, message: 'Podaj jednostkę' });
      if (it.quantity) { const q = parseAmount(it.quantity); if (Number.isNaN(q) || q <= 0) errs.push({ field: `items.${i}.quantity`, message: 'Ilość > 0' }); }
    });
    if (!Number.isInteger(d.payment_days) || d.payment_days < 0 || d.payment_days > 365) errs.push({ field: 'payment_days', message: 'Liczba dni 0–365' });
    if (d.loading_term.length < 2) errs.push({ field: 'loading_term', message: 'Podaj termin załadunku' });
    if (d.handler_name.length < 3) errs.push({ field: 'handler_name', message: 'Podaj osobę prowadzącą' });
    if (d.handler_phone && !isValidPhone(d.handler_phone)) errs.push({ field: 'handler_phone', message: 'Nieprawidłowy numer telefonu' });
    if (d.issue_place.length < 2) errs.push({ field: 'issue_place', message: 'Podaj miejsce wystawienia' });
    if (!d.issue_date) errs.push({ field: 'issue_date', message: 'Podaj datę wystawienia' });
    // API przyjmuje kwoty z kropką dziesiętną
    d.items.forEach((it) => {
      const a = parseAmount(it.net_amount); if (!Number.isNaN(a)) it.net_amount = a.toFixed(2);
      if (it.quantity) { const q = parseAmount(it.quantity); if (!Number.isNaN(q)) it.quantity = String(q); }
    });
    return errs;
  }

  function checked() {
    const d = collect();
    const errs = validate(d);
    if (errs.length) { showErrors(form, errs, errs.length > 1 ? `Popraw ${errs.length} pola formularza` : null); return null; }
    clearErrors(form);
    return d;
  }

  function handleApiError(err) {
    if (err.status === 422 || err.status === 409) showErrors(form, err.errors, err.errors?.length ? (err.errors.some((e) => !e.field) ? err.message : null) : err.message);
    else toast(err.message, 'error');
  }

  async function preview() {
    const d = checked();
    if (!d) return;
    try {
      const { url, name } = await blobUrl('/orders/preview', { params: { format: 'pdf' }, body: d });
      pdfPreview(url, name);
    } catch (err) { handleApiError(err); }
  }

  async function previewDownload(fmt) {
    const d = checked();
    if (!d) return;
    try { await download('/orders/preview', { params: { format: fmt }, body: d }); } catch (err) { handleApiError(err); }
  }

  async function save(issue) {
    const d = checked();
    if (!d) return;
    try {
      let saved = orderId ? await api.put(`/orders/${orderId}`, d) : await api.post('/orders', d);
      setDirty(false);
      if (issue) {
        saved = await api.post(`/orders/${saved.id}/issue`, { row_version: saved.row_version });
        toast(`Wystawiono zlecenie ${saved.number}`, 'success');
        try { await download(`/orders/${saved.id}/document`, { params: { format: 'pdf' } }); } catch (err) { toast(`Zlecenie zapisane, ale pobieranie PDF nie powiodło się: ${err.message}`, 'error'); }
      } else {
        toast(isCorrection ? `Zapisano korektę zlecenia ${saved.number}` : 'Zapisano szkic zlecenia', 'success');
      }
      navigate(`/zlecenia/${saved.id}`);
    } catch (err) { handleApiError(err); }
  }

  const onKey = (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key.toLowerCase() === 's') { e.preventDefault(); btnSave.click(); }
    if (e.key.toLowerCase() === 'p') { e.preventDefault(); btnPreview.click(); }
  };
  document.addEventListener('keydown', onKey);
  setTimeout(() => (isCorrection ? correctionReason : contractor ? serviceCombo.input : contractorCombo.input).focus(), 0);
  return () => { document.removeEventListener('keydown', onKey); setDirty(false); };
}
