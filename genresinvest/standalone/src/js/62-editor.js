// Edytor dokumentu (zlecenie / zamówienie): formularz po lewej, papier A4 na żywo po prawej.
// Fokus pola podświetla jego miejsce na dokumencie. Listy rozwijane z dopisywaniem nowych wartości.

function contractorModal({ contractor = null, prefill = '', kind = 'przewoznik' } = {}) {
  return new Promise((resolve) => {
    const c = contractor || { name: prefill, street: '', postal_code: '', city: '', country: 'PL', nip: '', phone: '', email: '', contact_person: '', notes: '', active: true, kinds: [kind] };
    const f = {
      name: inp({ value: c.name, maxlength: 200, autofocus: true }), nip: inp({ value: c.nip || '', maxlength: 20, inputmode: 'numeric', placeholder: '10 cyfr' }),
      street: inp({ value: c.street, maxlength: 200, placeholder: 'ul. Przykładowa 1' }), postal_code: inp({ value: c.postal_code, maxlength: 16, inputmode: 'numeric', placeholder: '00-000' }),
      city: inp({ value: c.city, maxlength: 120 }), country: inp({ value: c.country || 'PL', maxlength: 2 }),
      phone: inp({ value: c.phone || '', maxlength: 40, inputmode: 'tel', placeholder: '+48 600 000 000' }), email: inp({ value: c.email || '', maxlength: 160, type: 'email' }),
      contact_person: inp({ value: c.contact_person || '', maxlength: 120 }), notes: h('textarea', { rows: 2, maxlength: 2000 }, c.notes || ''),
      przewoznik: h('input', { type: 'checkbox', checked: (c.kinds || []).includes('przewoznik') }), dostawca: h('input', { type: 'checkbox', checked: (c.kinds || []).includes('dostawca') }),
      active: h('input', { type: 'checkbox', checked: c.active !== false }),
    };
    const nipOk = h('span', { class: 'ok-hint' });
    f.nip.addEventListener('input', () => { nipOk.textContent = isValidNip(f.nip.value) ? 'NIP poprawny' : ''; });
    f.postal_code.addEventListener('blur', () => { f.postal_code.value = normPostal(f.postal_code.value); });
    const body = h('div', { class: 'form-grid' },
      field({ label: 'Nazwa firmy', name: 'name', control: f.name, required: true, cls: 'c8' }),
      field({ label: 'NIP', name: 'nip', control: f.nip, cls: 'c4', hint: nipOk }),
      field({ label: 'Ulica i numer', name: 'street', control: f.street, required: true, cls: 'c12' }),
      field({ label: 'Kod pocztowy', name: 'postal_code', control: f.postal_code, required: true, cls: 'c3' }),
      field({ label: 'Miejscowość', name: 'city', control: f.city, required: true, cls: 'c6' }),
      field({ label: 'Kraj', name: 'country', control: f.country, cls: 'c3', help: 'Kod ISO, np. PL' }),
      field({ label: 'Telefon', name: 'phone', control: f.phone, cls: 'c6' }),
      field({ label: 'E-mail', name: 'email', control: f.email, cls: 'c6' }),
      field({ label: 'Osoba kontaktowa', name: 'contact_person', control: f.contact_person, cls: 'c12' }),
      field({ label: 'Uwagi', name: 'notes', control: f.notes, cls: 'c12' }),
      h('fieldset', { class: 'c12 checks' }, h('legend', {}, 'Rola kontrahenta'),
        h('label', { class: 'check' }, f.przewoznik, 'Zleceniobiorca (przewoźnik, usługodawca)'),
        h('label', { class: 'check' }, f.dostawca, 'Sprzedający (dostawca towaru)'),
        h('label', { class: 'check' }, f.active, 'Aktywny')));
    formKeys(body);
    modal({
      title: contractor ? 'Edycja kontrahenta' : 'Nowy kontrahent', size: 'md', onClose: (r) => resolve(r || null),
      build: (close) => {
        const save = h('button', { type: 'submit', class: 'btn primary' }, 'Zapisz kontrahenta');
        return {
          body,
          footer: [btn('Anuluj', { onClick: () => close(null) }), save],
          submit: () => busy(save, async () => {
            const v = {
              name: clean(f.name.value, 200), nip: normNip(f.nip.value), street: clean(f.street.value, 200), postal_code: normPostal(f.postal_code.value),
              city: clean(f.city.value, 120), country: (f.country.value.trim() || 'PL').toUpperCase(), phone: clean(f.phone.value, 40), email: clean(f.email.value, 160),
              contact_person: clean(f.contact_person.value, 120), notes: clean(f.notes.value), active: f.active.checked,
              kinds: [f.przewoznik.checked && 'przewoznik', f.dostawca.checked && 'dostawca'].filter(Boolean),
            };
            const e = [];
            if (v.name.length < 2) e.push({ field: 'name', message: 'Podaj nazwę firmy' });
            if (v.nip && v.country === 'PL' && !isValidNip(v.nip)) e.push({ field: 'nip', message: 'Nieprawidłowy NIP (błędna suma kontrolna)' });
            if (v.nip && Store.state.contractors.some((x) => x.nip === v.nip && x.id !== contractor?.id)) e.push({ field: 'nip', message: `Kontrahent z tym NIP już istnieje: ${Store.state.contractors.find((x) => x.nip === v.nip).name}` });
            if (v.street.length < 2) e.push({ field: 'street', message: 'Podaj ulicę i numer' });
            if (v.country === 'PL' && !isValidPostal(v.postal_code)) e.push({ field: 'postal_code', message: 'Format 00-000' });
            if (v.city.length < 2) e.push({ field: 'city', message: 'Podaj miejscowość' });
            if (v.phone && !isValidPhone(v.phone)) e.push({ field: 'phone', message: 'Nieprawidłowy numer telefonu' });
            if (v.email && !isValidEmail(v.email)) e.push({ field: 'email', message: 'Nieprawidłowy e-mail' });
            if (!v.kinds.length) e.push({ field: 'name', message: 'Zaznacz rolę kontrahenta (na dole okna)' });
            if (e.length) { setErrors(body, e); return; }
            const saved = await Store.commit((st) => {
              if (contractor) {
                const x = st.contractors.find((y) => y.id === contractor.id);
                if (x.rv !== contractor.rv) throw new Error('Kontrahent został w międzyczasie zmieniony. Odśwież i spróbuj ponownie.');
                const before = { ...x };
                Object.assign(x, v, { rv: x.rv + 1, updated: nowISO() });
                const ch = diff(Object.fromEntries(Object.keys(v).map((k) => [k, before[k]])), v);
                return { x: structuredClone(x), ch };
              }
              const x = { id: uid(), ...v, rv: 1, created: nowISO(), updated: nowISO() };
              st.contractors.push(x);
              return { x: structuredClone(x), ch: null };
            }, (r) => ({ action: contractor ? 'update' : 'create', entity: 'contractor', entityId: r.x.id, summary: `${contractor ? 'Zmieniono' : 'Dodano'} kontrahenta ${r.x.name}`, changes: r.ch || undefined }));
            toast(contractor ? 'Zapisano kontrahenta' : `Dodano kontrahenta ${saved.x.name}`, 'success');
            close(saved.x);
          }),
        };
      },
    });
  });
}

VIEWS.editor = (main, params, path) => {
  const st = Store.state;
  const existing = params[0] && !['zlecenia', 'zamowienia'].includes(params[0]) ? Docs.get(params[0]) : null;
  if (params[0] && !['zlecenia', 'zamowienia'].includes(params[0]) && !existing) { mount(main, emptyState('Nie znaleziono dokumentu')); return null; }
  if (!canEdit()) { mount(main, emptyState('Brak uprawnień', 'Twój profil ma tylko podgląd.')); return null; }
  const type = existing ? existing.type : (params[0] === 'zlecenia' ? 'zlecenie' : 'zamowienie');
  if (existing?.status === 'cancelled') { mount(main, emptyState('Dokument jest anulowany', 'Anulowanego dokumentu nie można zmieniać. Możesz go zduplikować.')); return null; }
  const T = DOC_TYPES[type];
  const correction = existing?.status === 'issued';
  const data = existing ? structuredClone(existing.data) : emptyData(type);
  const draftDoc = () => ({ ...(existing || {}), type, status: existing?.status || 'draft', number: existing?.number || null, revision: correction ? existing.revision + 1 : (existing?.revision || 0), data, issuer: null,
    contractor: contractorSnapshot(Store.state.contractors.find((c) => c.id === data.contractorId) || { name: '' }) });
  const D = st.dict;

  // --- Podgląd na żywo --------------------------------------------------------------------------
  const paperHost = h('div', { class: 'paper-scale' });
  const paperWrap = h('div', { class: 'paper-wrap' }, paperHost);
  let focusKey = null;
  let raf = 0;
  const renderPreview = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const paper = renderPaper(buildDocModel(draftDoc()));
      paperHost.replaceChildren(paper);
      highlight();
      fitPaper();
    });
  };
  const highlight = () => {
    $$('.pp.hl, .paper-date.hl', paperHost).forEach((x) => x.classList.remove('hl'));
    if (!focusKey) return;
    const els = $$(`[data-f="${CSS.escape(focusKey)}"]`, paperHost);
    els.forEach((x) => x.classList.add('hl'));
    if (els[0] && matchMedia('(min-width: 1100px)').matches) {
      const box = paperWrap.getBoundingClientRect(); const r = els[0].getBoundingClientRect();
      if (r.top < box.top + 40 || r.bottom > box.bottom - 40) paperWrap.scrollBy({ top: r.top - box.top - box.height / 3, behavior: 'smooth' });
    }
  };
  const fitPaper = () => {
    const w = paperWrap.clientWidth - 32;
    const scale = Math.min(1, w / 794);
    paperHost.style.setProperty('--scale', scale);
    const p = paperHost.firstElementChild;
    if (p) paperHost.style.height = `${p.offsetHeight * scale}px`;
  };
  const ro = new ResizeObserver(fitPaper);
  ro.observe(paperWrap);

  const form = h('form', { class: 'doc-form', novalidate: true });
  const touch = () => { App.dirty = true; renderPreview(); };
  form.addEventListener('input', touch);
  form.addEventListener('focusin', (e) => {
    const w = e.target.closest('[data-field]');
    let k = w?.dataset.field || null;
    if (k && /^items\.\d+\./.test(k)) k = k.split('.').slice(0, 2).join('.');
    if (k === 'contact_name') k = 'contact_phone';
    if (k === 'handler_phone') k = 'handler_name';
    if (k === 'tolerance') k = 'quantity';
    if (k === 'issue_place') k = 'issue_date';
    if (k && k.startsWith('clause')) k = 'clauses';
    focusKey = k; highlight();
  });
  formKeys(form);
  const section = (n, title, ...kids) => h('section', { class: 'fsec', 'aria-labelledby': `fs-${n}` }, h('h2', { id: `fs-${n}` }, h('span', { class: 'fsec-n' }, String(n)), title), h('div', { class: 'form-grid' }, kids));
  const chips = (values, apply) => h('div', { class: 'chips' }, values.map(([label, v]) => h('button', { type: 'button', class: 'chip', onclick: () => { apply(v ?? label); touch(); } }, label)));

  // --- Kontrahent (wspólne) -------------------------------------------------------------------
  const partyCard = h('div', { class: 'party-card', hidden: true });
  const showParty = () => {
    const c = st.contractors.find((x) => x.id === data.contractorId);
    partyCard.hidden = !c;
    if (!c) return;
    partyCard.replaceChildren(h('div', {}, h('strong', {}, c.name), h('span', {}, [c.street, `${c.postal_code} ${c.city}`].filter((x) => x.trim()).join(', ')), h('span', { class: c.nip ? '' : 'warn-t' }, c.nip ? `NIP ${c.nip}` : 'Brak NIP — uzupełnij w kartotece')),
      btn('', { kind: 'ghost icon-only', icon: 'edit', title: 'Edytuj dane kontrahenta', onClick: async () => { const r = await contractorModal({ contractor: structuredClone(Store.state.contractors.find((x) => x.id === c.id)) }); if (r) { showParty(); renderPreview(); } } }));
  };
  const contactPhone = type === 'zlecenie' ? inp({ value: data.contact_phone, maxlength: 40, inputmode: 'tel', placeholder: '+48 600 000 000' }) : null;
  const contactName = type === 'zlecenie' ? inp({ value: data.contact_name, maxlength: 120, placeholder: 'np. dyspozytor, kierowca' }) : null;
  const selectContractor = (c) => {
    data.contractorId = c.id; partyCombo.set(c.name); showParty(); clearFieldError(form, 'contractorId');
    if (contactPhone && !contactPhone.value && c.phone) { contactPhone.value = c.phone; data.contact_phone = c.phone; }
    if (contactName && !contactName.value && c.contact_person) { contactName.value = c.contact_person; data.contact_name = c.contact_person; }
    touch();
  };
  const partyCombo = combo({
    value: st.contractors.find((c) => c.id === data.contractorId)?.name || '',
    placeholder: 'Wpisz nazwę, NIP lub miasto…',
    source: (q) => Store.state.contractors.filter((c) => c.active && matches(q, c.name, c.nip, c.city))
      .sort((a, b) => Number(b.kinds?.includes(T.kind)) - Number(a.kinds?.includes(T.kind)) || a.name.localeCompare(b.name, 'pl')),
    label: (c) => c.name, sub: (c) => [c.nip ? `NIP ${c.nip}` : 'bez NIP', c.city, c.kinds?.includes(T.kind) ? null : 'inna rola'].filter(Boolean).join(' · '),
    onSelect: selectContractor, create: true, createLabel: (q) => `Dodaj nowego kontrahenta „${q}”…`,
    onCreate: async (q) => { const c = await contractorModal({ prefill: q, kind: T.kind }); if (c) selectContractor(c); else partyCombo.input.focus(); },
    onInput: (v) => { const c = st.contractors.find((x) => x.id === data.contractorId); if (c && v !== c.name) { data.contractorId = null; showParty(); } },
  });
  showParty();

  // --- Osoba prowadząca, miejsce, data (wspólne) ---------------------------------------------------
  const handlerPhone = inp({ value: data.handler_phone, maxlength: 40, inputmode: 'tel' });
  const handlerCombo = combo({
    value: data.handler_name, max: 120, placeholder: 'Imię i nazwisko',
    source: (q) => Store.state.dict.handlers.filter((x) => matches(q, x.name, x.phone)).sort((a, b) => b.uses - a.uses),
    label: (x) => x.name, sub: (x) => x.phone,
    onSelect: (x) => { data.handler_name = x.name; data.handler_phone = x.phone; handlerPhone.value = x.phone; clearFieldError(form, 'handler_name'); touch(); handlerPhone.focus(); },
    create: true, createLabel: (q) => `Nowa osoba „${q}” — zapisze się w słowniku`, onCreate: (q) => { handlerCombo.set(q); data.handler_name = q; handlerPhone.focus(); touch(); },
    onInput: (v) => { data.handler_name = v; },
  });
  handlerPhone.addEventListener('input', () => { data.handler_phone = handlerPhone.value.trim(); });
  const place = inp({ value: data.issue_place, maxlength: 120 });
  place.addEventListener('input', () => { data.issue_place = place.value; });
  const date = inp({ type: 'date', value: data.issue_date, min: '2000-01-01', max: '2100-12-31' });
  date.addEventListener('input', () => { data.issue_date = date.value; });
  const payDays = inp({ type: 'number', min: 0, max: 365, value: String(data.payment_days), inputmode: 'numeric', class: 'num' });
  payDays.addEventListener('input', () => { data.payment_days = payDays.value === '' ? NaN : Number(payDays.value); });
  const payChips = chips([[7], [14], [21], [30], [45], [60]].map(([d]) => [`${d} dni`, d]), (d) => { payDays.value = d; data.payment_days = d; });
  const notes = h('textarea', { rows: 3, maxlength: 2000, placeholder: 'Opcjonalnie — drukowane na dokumencie' }, data.notes);
  notes.addEventListener('input', () => { data.notes = notes.value; });
  const learnBox = h('input', { type: 'checkbox', checked: true });
  const reason = h('textarea', { rows: 2, maxlength: 500, placeholder: 'np. zmiana ceny po negocjacjach' });

  const bindText = (key, el) => { el.addEventListener('input', () => { data[key] = el.value; }); return el; };
  const now = new Date();
  const monthLabel = (o) => { const d = new Date(now.getFullYear(), now.getMonth() + o, 1); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

  // --- Sekcje specyficzne -------------------------------------------------------------------------
  let rowsApi = null;
  if (type === 'zlecenie') {
    const detailed = bindText('service_detailed', h('textarea', { rows: 2, maxlength: 2000 }, data.service_detailed));
    const cargo = bindText('cargo', inp({ value: data.cargo, maxlength: 200, placeholder: 'np. PKS (Łupina ziarna palmowego)' }));
    const svc = combo({
      value: data.service_short, max: 300, placeholder: 'Wybierz z listy lub wpisz nowy opis…',
      source: (q) => Store.state.dict.services.filter((x) => matches(q, x.short, x.cargo)).sort((a, b) => b.uses - a.uses),
      label: (x) => x.short, sub: (x) => x.cargo,
      onSelect: (x) => { data.service_short = x.short; if (x.detailed) { detailed.value = x.detailed; data.service_detailed = x.detailed; } if (x.cargo) { cargo.value = x.cargo; data.cargo = x.cargo; } clearFieldError(form, 'service_short'); touch(); },
      create: true, createLabel: (q) => `Nowy opis usługi: „${q.length > 48 ? `${q.slice(0, 48)}…` : q}”`, onCreate: (q) => { svc.set(q); data.service_short = q; detailed.focus(); touch(); },
      onInput: (v) => { data.service_short = v; },
    });
    const rowsBox = h('div', { class: 'price-rows' });
    const totalBox = h('div', { class: 'total-line', 'aria-live': 'polite' });
    const units = () => Store.state.settings.defaults.units;
    const recalc = () => {
      const vals = data.items.map((i) => valueGr(i.amount, i.qty));
      totalBox.replaceChildren(...[].concat(vals.length && vals.every((x) => x !== null)
        ? [h('span', {}, 'Wartość zlecenia netto'), h('strong', {}, fmtMoney(vals.reduce((a, b) => a + b, 0)))]
        : h('span', { class: 'muted' }, 'Podaj ilości, aby policzyć wartość zlecenia (opcjonalnie).')));
    };
    const drawRows = (focusIdx = null) => {
      rowsBox.replaceChildren(...data.items.map((it, i) => {
        const amount = inp({ value: moneyInput(it.amount), inputmode: 'decimal', class: 'num', placeholder: '0,00', maxlength: 16 });
        const qty = inp({ value: qtyInput(it.qty), inputmode: 'decimal', class: 'num', placeholder: 'opcjonalnie', maxlength: 14 });
        const val = h('output', { class: 'row-val' }, it.amount && it.qty ? fmtMoney(valueGr(it.amount, it.qty)) : '—');
        const unit = combo({ value: it.unit, max: 40, source: (q) => units().filter((u) => matches(q, u)).map((u) => ({ u })), label: (x) => x.u,
          onSelect: (x) => { it.unit = x.u; touch(); }, create: true, createLabel: (q) => `Jednostka „${q}”`, onCreate: (q) => { unit.set(q); it.unit = q; qty.focus(); touch(); }, onInput: (v) => { it.unit = v.trim(); } });
        const route = combo({ value: it.route, max: 200, placeholder: 'np. Zabrze - Chorzów',
          source: (q) => Store.state.dict.prices.filter((x) => matches(q, x.route)).sort((a, b) => b.uses - a.uses),
          label: (x) => x.route, sub: (x) => `${fmtMoney(x.amount)} · ${x.unit}`,
          onSelect: (x) => { it.route = x.route; it.amount = x.amount; it.unit = x.unit; delete it._amountError; amount.value = moneyInput(x.amount); unit.set(x.unit); clearFieldError(form, `items.${i}.route`); clearFieldError(form, `items.${i}.amount`); touch(); recalc(); amount.focus(); amount.select(); },
          create: true, createLabel: (q) => `Nowa pozycja „${q}” — zapisze się w cenniku`, onCreate: (q) => { route.set(q); it.route = q; amount.focus(); touch(); },
          onInput: (v) => { it.route = v.trim(); } });
        amount.addEventListener('input', () => { const r = parseMoneyGr(amount.value); it.amount = r.value || null; it._amountError = r.error; val.textContent = it.amount && it.qty ? fmtMoney(valueGr(it.amount, it.qty)) : '—'; recalc(); });
        amount.addEventListener('blur', () => { if (it.amount) amount.value = moneyInput(it.amount); });
        qty.addEventListener('input', () => { const r = parseQty(qty.value); it.qty = r.value ?? null; it._qtyError = r.error; val.textContent = it.amount && it.qty ? fmtMoney(valueGr(it.amount, it.qty)) : '—'; recalc(); });
        const del = btn('', { kind: 'ghost icon-only', icon: 'trash', title: `Usuń pozycję ${i + 1}`, onClick: () => {
          if (data.items.length === 1) { toast('Zlecenie musi mieć co najmniej jedną pozycję cenową', 'error'); return; }
          data.items.splice(i, 1); drawRows(); recalc(); touch();
        } });
        const row = h('div', { class: 'price-row' }, h('span', { class: 'pr-n' }, `${i + 1}.`),
          field({ label: 'Trasa / pozycja', name: `items.${i}.route`, control: route.el, required: true, cls: 'pr-route' }),
          field({ label: 'Cena netto', name: `items.${i}.amount`, control: amount, required: true }),
          field({ label: 'Jednostka', name: `items.${i}.unit`, control: unit.el, required: true }),
          field({ label: 'Ilość', name: `items.${i}.qty`, control: qty }),
          h('div', { class: 'field pr-val' }, h('div', { class: 'field-top' }, h('span', { class: 'lbl' }, 'Wartość')), val), del);
        if (focusIdx === i) setTimeout(() => route.input.focus(), 0);
        return row;
      }));
    };
    rowsApi = { drawRows };
    drawRows(); recalc();
    const origin = bindText('origin', inp({ value: data.origin, maxlength: 300 }));
    const dest = bindText('destination', inp({ value: data.destination, maxlength: 300 }));
    const term = bindText('loading_term', inp({ value: data.loading_term, maxlength: 200 }));
    bindText('contact_name', contactName); bindText('contact_phone', contactPhone);
    form.append(
      section(1, 'Zleceniobiorca',
        h('div', { class: 'c12' }, field({ label: 'Kontrahent', name: 'contractorId', control: partyCombo.el, required: true, help: 'Wybierz z kartoteki albo wpisz nazwę i wybierz „Dodaj nowego kontrahenta”.' }), partyCard),
        field({ label: 'Osoba kontaktowa Zleceniobiorcy', name: 'contact_name', control: contactName, cls: 'c6' }),
        field({ label: 'Telefon Zleceniobiorcy', name: 'contact_phone', control: contactPhone, cls: 'c6' })),
      section(2, 'Usługa',
        field({ label: 'Krótki opis usługi', name: 'service_short', control: svc.el, required: true, cls: 'c12', help: 'Krótko i dokładnie — np. „Przewóz PKS za pomocą auta typu wywrotka.”' }),
        field({ label: 'Dokładny opis usługi', name: 'service_detailed', control: detailed, cls: 'c8' }),
        field({ label: 'Rodzaj przewożonego towaru', name: 'cargo', control: cargo, cls: 'c4' })),
      h('section', { class: 'fsec', 'aria-labelledby': 'fs-3' },
        h('div', { class: 'fsec-head' }, h('h2', { id: 'fs-3' }, h('span', { class: 'fsec-n' }, '3'), 'Cena netto'),
          btn('Dodaj pozycję', { small: true, icon: 'plus', onClick: () => { data.items.push({ route: '', amount: null, unit: units()[0] || 'zł/fracht', qty: null }); drawRows(data.items.length - 1); recalc(); touch(); } })),
        h('div', { dataset: { field: 'items' } }, h('div', { class: 'err', role: 'alert' })),
        rowsBox, totalBox,
        h('div', { class: 'form-grid' }, field({ label: 'Płatność — dni od daty wystawienia faktury', name: 'payment_days', control: h('div', { class: 'stack' }, payDays, payChips), required: true, cls: 'c12' }))),
      section(4, 'Realizacja',
        field({ label: 'Punkt wyjściowy (załadunek)', name: 'origin', control: origin, cls: 'c6' }),
        field({ label: 'Punkt docelowy (rozładunek)', name: 'destination', control: dest, cls: 'c6' }),
        field({ label: 'Termin załadunku', name: 'loading_term', control: h('div', { class: 'stack' }, term, chips([[monthLabel(0)], [monthLabel(1)], ['Do uzgodnienia'], ['Niezwłocznie']], (v) => { term.value = v; data.loading_term = v; })), required: true, cls: 'c12' })),
    );
  } else {
    const material = bindText('material', h('textarea', { rows: 3, maxlength: 2000, placeholder: 'np. Zrębka drzewna, pozostałość z przemysłu drzewnego/tartacznego. Pomiar na podstawie dokumentacji z dostaw.' }, data.material));
    const qty = inp({ value: qtyInput(data.quantity), inputmode: 'decimal', class: 'num', maxlength: 14, placeholder: 'np. 1000' });
    const tol = inp({ value: data.tolerance === null ? '' : String(data.tolerance).replace('.', ','), inputmode: 'decimal', class: 'num', maxlength: 5, placeholder: 'np. 20' });
    const price = inp({ value: moneyInput(data.price), inputmode: 'decimal', class: 'num', maxlength: 16, placeholder: '0,00' });
    const valueOut = h('output', { class: 'big-val' });
    const recalc = () => { const v = valueGr(data.price, data.quantity); valueOut.replaceChildren(...[].concat(v ? [h('span', {}, 'Szacunkowa wartość netto'), h('strong', {}, fmtMoney(v))] : h('span', { class: 'muted' }, 'Wartość policzy się po podaniu ilości i ceny'))); };
    qty.addEventListener('input', () => { const r = parseQty(qty.value, { required: true }); data.quantity = r.value ?? null; data._qtyError = r.error; recalc(); });
    tol.addEventListener('input', () => { data.tolerance = tol.value.trim() === '' ? '' : Number(tol.value.replace(',', '.')); });
    price.addEventListener('input', () => { const r = parseMoneyGr(price.value); data.price = r.value || null; data._priceError = r.error; recalc(); });
    price.addEventListener('blur', () => { if (data.price) price.value = moneyInput(data.price); });
    const unit = combo({ value: data.unit, max: 40, source: (q) => Store.state.settings.defaults.order_units.filter((u) => matches(q, u)).map((u) => ({ u })), label: (x) => x.u,
      onSelect: (x) => { data.unit = x.u; touch(); }, create: true, createLabel: (q) => `Jednostka „${q}”`, onCreate: (q) => { unit.set(q); data.unit = q; touch(); }, onInput: (v) => { data.unit = v.trim(); } });
    const subject = combo({
      value: data.subject, max: 200, placeholder: 'np. Zrębka drzewna',
      source: (q) => Store.state.dict.products.filter((x) => matches(q, x.name, x.material)).sort((a, b) => b.uses - a.uses),
      label: (x) => x.name, sub: (x) => [x.unit, x.price ? `${fmtMoney(x.price)}/${x.unit}` : null].filter(Boolean).join(' · '),
      onSelect: (x) => {
        data.subject = x.name;
        if (x.material) { material.value = x.material; data.material = x.material; }
        if (x.unit) { unit.set(x.unit); data.unit = x.unit; }
        if (x.price && !data.price) { price.value = moneyInput(x.price); data.price = x.price; }
        clearFieldError(form, 'subject'); recalc(); touch();
      },
      create: true, createLabel: (q) => `Nowy przedmiot „${q}” — zapisze się w słowniku`, onCreate: (q) => { subject.set(q); data.subject = q; material.focus(); touch(); },
      onInput: (v) => { data.subject = v; },
    });
    const pickup = combo({ value: data.pickup, max: 300, placeholder: 'Adres i warunki odbioru',
      source: (q) => Store.state.dict.places.filter((x) => matches(q, x.text)).sort((a, b) => b.uses - a.uses), label: (x) => x.text,
      onSelect: (x) => { data.pickup = x.text; clearFieldError(form, 'pickup'); touch(); }, create: true, createLabel: (q) => `Nowe miejsce „${q}”`, onCreate: (q) => { pickup.set(q); data.pickup = q; touch(); },
      onInput: (v) => { data.pickup = v; } });
    const method = combo({ value: data.payment_method, max: 200,
      source: (q) => Store.state.dict.methods.filter((x) => matches(q, x.text)).sort((a, b) => b.uses - a.uses), label: (x) => x.text,
      onSelect: (x) => { data.payment_method = x.text; touch(); }, create: true, createLabel: (q) => `Nowa metoda „${q}”`, onCreate: (q) => { method.set(q); data.payment_method = q; touch(); },
      onInput: (v) => { data.payment_method = v; } });
    const valid = inp({ type: 'date', value: data.valid_until, min: '2000-01-01', max: '2100-12-31' });
    valid.addEventListener('input', () => { data.valid_until = valid.value; });
    const endOf = (m) => todayISO(new Date(now.getFullYear(), now.getMonth() + m + 1, 0));
    const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return todayISO(d); };
    const qEnd = () => { const qm = Math.floor(now.getMonth() / 3) * 3 + 3; return todayISO(new Date(now.getFullYear(), qm, 0)); };
    // Klauzule (uwagi) — wybór z biblioteki + własne
    const clauseBox = h('div', { class: 'clauses' });
    const newClause = inp({ maxlength: 500, placeholder: 'Wpisz nową klauzulę i naciśnij Dodaj' });
    const drawClauses = () => {
      const lib = Store.state.dict.clauses.map((c) => c.text);
      const all = [...lib, ...data.clauses.filter((c) => !lib.includes(c))];
      clauseBox.replaceChildren(...all.map((text, i) => {
        const cb = h('input', { type: 'checkbox', checked: data.clauses.includes(text), id: `cl-${i}` });
        cb.addEventListener('change', () => {
          if (cb.checked) data.clauses = all.filter((t) => t === text || data.clauses.includes(t));
          else data.clauses = data.clauses.filter((t) => t !== text);
          touch();
        });
        return h('label', { class: 'clause', for: `cl-${i}`, dataset: { field: `clause-${i}` } }, cb, h('span', {}, text));
      }));
    };
    drawClauses();
    const addClause = () => {
      const t = clean(newClause.value, 500);
      if (t.length < 5) { setErrors(form, [{ field: 'clause-new', message: 'Klauzula jest za krótka' }]); return; }
      if (!data.clauses.includes(t)) data.clauses.push(t);
      newClause.value = ''; drawClauses(); touch(); newClause.focus();
    };
    newClause.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addClause(); } });
    form.append(
      section(1, 'Sprzedający',
        h('div', { class: 'c12' }, field({ label: 'Kontrahent', name: 'contractorId', control: partyCombo.el, required: true, help: 'Dostawca towaru — wybierz z kartoteki albo dodaj nowego.' }), partyCard)),
      section(2, 'Przedmiot zamówienia',
        field({ label: 'Przedmiot zamówienia', name: 'subject', control: subject.el, required: true, cls: 'c12' }),
        field({ label: 'Surowiec i pomiar', name: 'material', control: material, cls: 'c12', help: 'Opis surowca, pochodzenie, sposób pomiaru ilości.' })),
      h('section', { class: 'fsec', 'aria-labelledby': 'fs-3' }, h('h2', { id: 'fs-3' }, h('span', { class: 'fsec-n' }, '3'), 'Ilość i cena'),
        h('div', { class: 'form-grid' },
          field({ label: 'Ilość', name: 'quantity', control: qty, required: true, cls: 'c4' }),
          field({ label: 'Tolerancja ±%', name: 'tolerance', control: tol, cls: 'c3', help: 'np. 20 → „1000 (+/-20%)”' }),
          field({ label: 'Jednostka', name: 'unit', control: unit.el, required: true, cls: 'c5' }),
          field({ label: 'Cena netto za jednostkę [PLN]', name: 'price', control: price, required: true, cls: 'c6' }),
          h('div', { class: 'c6 val-cell' }, valueOut),
          field({ label: 'Termin płatności [dni]', name: 'payment_days', control: h('div', { class: 'stack' }, payDays, payChips), required: true, cls: 'c6' }),
          field({ label: 'Metoda płatności', name: 'payment_method', control: method.el, required: true, cls: 'c6' }))),
      section(4, 'Odbiór i termin',
        field({ label: 'Miejsce i warunki odbioru towaru', name: 'pickup', control: pickup.el, required: true, cls: 'c12' }),
        field({ label: 'Zamówienie obowiązuje do', name: 'valid_until', control: h('div', { class: 'stack' }, valid,
          chips([['Koniec miesiąca', endOf(0)], ['Koniec następnego', endOf(1)], ['+30 dni', plusDays(30)], ['Koniec kwartału', qEnd()]], (v) => { valid.value = v; data.valid_until = v; })), required: true, cls: 'c12' })),
      h('section', { class: 'fsec', 'aria-labelledby': 'fs-5' }, h('h2', { id: 'fs-5' }, h('span', { class: 'fsec-n' }, '5'), 'Uwagi i warunki'),
        h('p', { class: 'muted small' }, 'Zaznacz klauzule drukowane w rubryce „Uwagi”. Nowe klauzule zapiszą się w bibliotece.'),
        clauseBox,
        h('div', { class: 'form-grid' }, field({ label: 'Nowa klauzula', name: 'clause-new', control: h('div', { class: 'inline' }, newClause, btn('Dodaj', { icon: 'plus', onClick: addClause })), cls: 'c12' }))),
    );
    recalc();
  }

  form.append(
    section(type === 'zlecenie' ? 5 : 6, 'Osoby, miejsce i data',
      field({ label: type === 'zlecenie' ? 'Sprawę prowadzi (ResInvest)' : 'Osoba prowadząca (opcjonalnie)', name: 'handler_name', control: handlerCombo.el, required: type === 'zlecenie', cls: 'c6' }),
      field({ label: 'Telefon osoby prowadzącej', name: 'handler_phone', control: handlerPhone, cls: 'c6' }),
      field({ label: 'Miejsce wystawienia', name: 'issue_place', control: place, required: true, cls: 'c6' }),
      field({ label: 'Data wystawienia', name: 'issue_date', control: date, required: true, cls: 'c6' }),
      field({ label: type === 'zlecenie' ? 'Uwagi' : 'Dodatkowa uwaga', name: 'notes', control: notes, cls: 'c12' }),
      h('label', { class: 'check c12' }, learnBox, 'Zapisuj nowe wartości w słownikach (do wyboru z listy w kolejnych dokumentach)')));
  if (correction) {
    form.prepend(h('section', { class: 'fsec correction' },
      h('div', { class: 'callout warn' }, h('div', {}, h('strong', {}, `Korekta dokumentu ${existing.number}`), h('p', {}, 'Dokument jest wystawiony. Zapis utworzy kolejną rewizję („Korekta nr ' + existing.revision + '”); poprzednie wersje zostaną w historii.'))),
      h('div', { class: 'form-grid' }, field({ label: 'Powód korekty', name: 'reason', control: reason, required: true, cls: 'c12' }))));
  }

  // --- Zapis, wystawienie, eksport --------------------------------------------------------------
  const check = () => {
    const errs = validateDoc(type, data);
    if (correction && reason.value.trim().length < 5) errs.unshift({ field: 'reason', message: 'Podaj powód korekty (min. 5 znaków)' });
    if (errs.length) { setErrors(form, errs, errs.length > 1 ? `Do poprawy: ${errs.length} pola` : null); showSide('form'); return false; }
    clearErrors(form); return true;
  };
  const save = async (issue) => {
    if (!check()) return;
    let id = existing?.id;
    if (correction) {
      await Docs.correct(id, data, reason.value.trim(), existing.rv);
      toast(`Zapisano korektę ${existing.number}`, 'success');
    } else {
      const r = await Docs.saveDraft(type, id, data, { learnDicts: learnBox.checked, rv: existing?.rv ?? null });
      id = r.id;
      if (issue) {
        const res = await Docs.issue(id);
        toast(`Wystawiono ${res.number}`, 'success');
        await exportDoc(Docs.get(id), 'pdf');
      } else toast('Zapisano szkic', 'success');
    }
    App.dirty = false;
    go(`/dok/${id}`);
  };
  const exportDraft = (fmt) => {
    if (!data.contractorId) { setErrors(form, [{ field: 'contractorId', message: 'Wybierz kontrahenta, aby pobrać projekt' }]); return; }
    const model = buildDocModel(draftDoc());
    downloadBlob(fmt === 'pdf' ? renderPdf(model) : renderDocx(model), `${model.fileStem}.${fmt}`);
  };
  const bSave = btn(correction ? 'Zapisz korektę' : 'Zapisz szkic', { kind: correction ? 'primary' : '', icon: 'check', title: 'Ctrl+S', onClick: (e) => busy(e.currentTarget, () => save(false)) });
  const bIssue = correction ? null : btn('Zapisz i wystaw', { kind: 'primary', icon: 'pdf', onClick: (e) => busy(e.currentTarget, () => save(true)) });
  const bar = h('div', { class: 'action-bar' },
    h('span', { class: 'bar-info' }, h('kbd', {}, 'Enter'), ' następne pole ', h('kbd', {}, 'Ctrl S'), ' zapis'),
    btn('PDF', { kind: 'ghost', icon: 'download', title: 'Pobierz projekt PDF', onClick: (e) => busy(e.currentTarget, () => exportDraft('pdf')) }),
    btn('DOCX', { kind: 'ghost', icon: 'download', title: 'Pobierz projekt DOCX', onClick: (e) => busy(e.currentTarget, () => exportDraft('docx')) }),
    bSave, bIssue);

  const seg = h('div', { class: 'seg only-narrow', role: 'tablist' },
    h('button', { type: 'button', role: 'tab', 'aria-selected': 'true', onclick: () => showSide('form') }, 'Formularz'),
    h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', onclick: () => showSide('paper') }, 'Podgląd dokumentu'));
  const layout = h('div', { class: 'editor', dataset: { side: 'form' } },
    h('div', { class: 'editor-form' }, form, bar),
    h('aside', { class: 'editor-paper', 'aria-label': 'Podgląd dokumentu na żywo' }, h('div', { class: 'paper-label' }, icon('eye', 16), h('span', {}, 'Podgląd na żywo'), h('small', {}, 'PDF dzieli treść na strony A4')), paperWrap));
  function showSide(side) { layout.dataset.side = side; $$('button', seg).forEach((b, i) => b.setAttribute('aria-selected', String((i === 0) === (side === 'form')))); if (side === 'paper') fitPaper(); }

  mount(main, 
    h('header', { class: 'page-head' },
      h('div', {}, h('p', { class: 'crumb' }, h('a', { href: `#/${T.route}` }, T.plural), ' / ', existing ? docLabel(existing) : 'nowy dokument'),
        h('h1', {}, correction ? `Korekta: ${existing.number}` : existing ? `Edycja szkicu — ${T.label.toLowerCase()}` : `Nowe ${T.label.toLowerCase()}`)),
      seg),
    layout);
  renderPreview();
  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); bSave.click(); } };
  document.addEventListener('keydown', onKey);
  setTimeout(() => (correction ? reason : data.contractorId ? form.querySelector('[data-field="service_short"] input, [data-field="subject"] input') : partyCombo.input)?.focus(), 30);
  return () => { document.removeEventListener('keydown', onKey); ro.disconnect(); App.dirty = false; void rowsApi; };
};
