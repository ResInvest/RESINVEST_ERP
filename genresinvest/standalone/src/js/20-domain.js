// Logika biznesowa: typy dokumentów, walidacja, numeracja, cykl życia (szkic → wystawienie →
// korekty → anulowanie), uczenie słowników, model treści dokumentu (wspólny dla podglądu, PDF i DOCX).

const DOC_TYPES = {
  zlecenie: { label: 'Zlecenie', plural: 'Zlecenia', title: 'ZLECENIE', route: 'zlecenia', partyRole: 'Zleceniobiorca', kind: 'przewoznik' },
  zamowienie: { label: 'Zamówienie', plural: 'Zamówienia', title: 'ZAMÓWIENIE', route: 'zamowienia', partyRole: 'Sprzedający', kind: 'dostawca' },
};
const STATUS = { draft: 'Szkic', issued: 'Wystawione', cancelled: 'Anulowane' };

function emptyData(type) {
  const d = Store.state.settings.defaults;
  const now = new Date();
  const base = { contractorId: null, issue_date: todayISO(), issue_place: d.issue_place, payment_days: d.payment_days,
    handler_name: '', handler_phone: '', notes: '' };
  if (type === 'zlecenie') {
    return { ...base, contact_name: '', contact_phone: '', service_short: '', service_detailed: '', cargo: '',
      origin: 'jak wyżej', destination: 'jak wyżej', loading_term: `${MONTHS[now.getMonth()]} ${now.getFullYear()}`,
      items: [{ route: '', amount: null, unit: d.units[0] || 'zł/fracht', qty: null }] };
  }
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { ...base, subject: '', valid_until: todayISO(end), pickup: '', quantity: null, tolerance: '', unit: d.order_units[0] || 'mp',
    material: '', price: null, payment_method: d.payment_method,
    clauses: Store.state.dict.clauses.filter((c) => c.auto).map((c) => c.text) };
}

// --- Walidacja ------------------------------------------------------------------------------------
function validateDoc(type, data) {
  const e = [];
  const req = (field, val, msg, min = 2) => { if (String(val ?? '').trim().length < min) e.push({ field, message: msg }); };
  const phone = (field, val) => { if (val && !isValidPhone(val)) e.push({ field, message: 'Nieprawidłowy numer telefonu' }); };
  const contractor = Store.state.contractors.find((c) => c.id === data.contractorId);
  if (!contractor) e.push({ field: 'contractorId', message: `Wybierz ${type === 'zlecenie' ? 'Zleceniobiorcę' : 'Sprzedającego'} z listy lub dodaj nowego` });
  if (!data.issue_date || !/^\d{4}-\d{2}-\d{2}$/.test(data.issue_date)) e.push({ field: 'issue_date', message: 'Podaj datę wystawienia' });
  req('issue_place', data.issue_place, 'Podaj miejsce wystawienia');
  if (!Number.isInteger(data.payment_days) || data.payment_days < 0 || data.payment_days > 365) e.push({ field: 'payment_days', message: 'Liczba dni 0–365' });
  phone('handler_phone', data.handler_phone);
  if (type === 'zlecenie') {
    phone('contact_phone', data.contact_phone);
    req('service_short', data.service_short, 'Podaj krótki opis usługi (min. 3 znaki)', 3);
    req('loading_term', data.loading_term, 'Podaj termin załadunku');
    req('handler_name', data.handler_name, 'Podaj osobę prowadzącą sprawę', 3);
    if (!data.items.length) e.push({ field: 'items', message: 'Dodaj co najmniej jedną pozycję cenową' });
    data.items.forEach((it, i) => {
      if (!String(it.route || '').trim()) e.push({ field: `items.${i}.route`, message: 'Podaj trasę / pozycję' });
      if (!it.amount) e.push({ field: `items.${i}.amount`, message: it._amountError || 'Podaj cenę netto, np. 900,00' });
      if (!String(it.unit || '').trim()) e.push({ field: `items.${i}.unit`, message: 'Podaj jednostkę' });
      if (it._qtyError) e.push({ field: `items.${i}.qty`, message: it._qtyError });
    });
  } else {
    req('subject', data.subject, 'Podaj przedmiot zamówienia');
    if (!data.valid_until) e.push({ field: 'valid_until', message: 'Podaj datę obowiązywania' });
    else if (data.issue_date && data.valid_until < data.issue_date) e.push({ field: 'valid_until', message: 'Data obowiązywania jest wcześniejsza niż data zamówienia' });
    req('pickup', data.pickup, 'Podaj miejsce i warunki odbioru');
    if (!data.quantity) e.push({ field: 'quantity', message: data._qtyError || 'Podaj ilość' });
    if (data.tolerance !== '' && data.tolerance !== null && !(Number(data.tolerance) >= 0 && Number(data.tolerance) <= 100)) e.push({ field: 'tolerance', message: 'Tolerancja 0–100%' });
    req('unit', data.unit, 'Podaj jednostkę', 1);
    if (!data.price) e.push({ field: 'price', message: data._priceError || 'Podaj cenę netto za jednostkę' });
    req('payment_method', data.payment_method, 'Podaj metodę płatności');
  }
  return e;
}

// --- Numeracja (bez luk, nadawana przy wystawieniu) ------------------------------------------------
function periodKey(type, isoDate, reset) {
  const [y, m] = isoDate.split('-');
  return `${type}:${reset === 'yearly' ? y : `${y}-${m}`}`;
}
function renderNumber(pattern, seq, digits, isoDate) {
  const [y, m] = isoDate.split('-');
  return pattern.replace(/\{SEQ\}/g, String(seq).padStart(digits, '0')).replace(/\{MM\}/g, m).replace(/\{YYYY\}/g, y).replace(/\{YY\}/g, y.slice(2));
}
function validatePattern(p) {
  if (!p.includes('{SEQ}')) return 'Wzór musi zawierać {SEQ}';
  if (/\{(?!SEQ\}|MM\}|YYYY\}|YY\})/.test(p)) return 'Dozwolone znaczniki: {SEQ} {MM} {YYYY} {YY}';
  if (p.length > 50) return 'Wzór jest za długi';
  return null;
}

// --- Migawki i podsumowania ---------------------------------------------------------------------
function contractorSnapshot(c) {
  return { id: c.id, name: c.name, street: c.street, postal_code: c.postal_code, city: c.city, country: c.country, nip: c.nip, phone: c.phone };
}
function docTotal(doc) {
  const d = doc.data;
  if (doc.type === 'zlecenie') {
    const vals = d.items.map((i) => valueGr(i.amount, i.qty));
    return vals.length && vals.every((v) => v !== null) ? vals.reduce((a, b) => a + b, 0) : null;
  }
  return valueGr(d.price, d.quantity);
}
function docParty(doc) {
  return doc.status === 'draft'
    ? contractorSnapshot(Store.state.contractors.find((c) => c.id === doc.data.contractorId) || { name: '—' })
    : doc.contractor;
}
function docSummary(doc) {
  const d = doc.data;
  if (doc.type === 'zlecenie') return d.items.map((i) => `${i.route}: ${fmtMoney(i.amount)}${i.unit.replace(/^zł/, '')}`).join('; ');
  return `${d.subject} · ${fmtQty(d.quantity)} ${d.unit} × ${fmtMoney(d.price)}`;
}
function docLabel(doc) { return doc.number || `Szkic ${DOC_TYPES[doc.type].label.toLowerCase()}a`; }

function stripTransient(data) {
  const out = structuredClone(data);
  for (const k of Object.keys(out)) if (k.startsWith('_')) delete out[k];
  if (out.items) out.items = out.items.map((i) => Object.fromEntries(Object.entries(i).filter(([k]) => !k.startsWith('_'))));
  return out;
}

function flatForDiff(doc) {
  const d = doc.data;
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (k === 'items') out['pozycje cenowe'] = v.map((i) => `${i.route}: ${moneyInput(i.amount)} ${i.unit}${i.qty ? ` × ${qtyInput(i.qty)}` : ''}`).join('; ');
    else if (k === 'clauses') out.uwagi = v.join(' | ');
    else if (k === 'price') out.cena = moneyInput(v);
    else if (k === 'quantity') out['ilość'] = qtyInput(v);
    else if (k === 'contractorId') out.kontrahent = Store.state.contractors.find((c) => c.id === v)?.name || v;
    else out[k] = v;
  }
  return out;
}
function diff(a, b) {
  const ch = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[k] ?? '') !== JSON.stringify(b[k] ?? '')) ch[k] = { before: a[k] ?? '', after: b[k] ?? '' };
  }
  return ch;
}

// --- Słowniki: „dopisz, gdy jeszcze nie ma” -----------------------------------------------------
function learn(st, type, data) {
  const bump = (list, pred, create) => { const f = list.find(pred); if (f) f.uses = (f.uses || 0) + 1; else list.push({ id: uid(), uses: 1, ...create }); };
  const D = st.dict;
  if (data.handler_name) bump(D.handlers, (x) => x.name === data.handler_name && (x.phone || '') === (data.handler_phone || ''), { name: data.handler_name, phone: data.handler_phone || '' });
  if (type === 'zlecenie') {
    bump(D.services, (x) => x.short === data.service_short, { short: data.service_short, detailed: data.service_detailed, cargo: data.cargo });
    for (const it of data.items) bump(D.prices, (x) => x.route === it.route && x.amount === it.amount && x.unit === it.unit, { route: it.route, amount: it.amount, unit: it.unit });
    if (!st.settings.defaults.units.includes(data.items[0]?.unit)) for (const it of data.items) if (!st.settings.defaults.units.includes(it.unit)) st.settings.defaults.units.push(it.unit);
  } else {
    bump(D.products, (x) => x.name === data.subject, { name: data.subject, material: data.material, unit: data.unit, price: data.price });
    bump(D.places, (x) => x.text === data.pickup, { text: data.pickup });
    bump(D.methods, (x) => x.text === data.payment_method, { text: data.payment_method });
    for (const c of data.clauses) bump(D.clauses, (x) => x.text === c, { text: c, auto: false });
    if (!st.settings.defaults.order_units.includes(data.unit)) st.settings.defaults.order_units.push(data.unit);
  }
}

// --- Operacje na dokumentach ---------------------------------------------------------------------
const Docs = {
  get(id) { return Store.state.documents.find((d) => d.id === id) || null; },

  async saveDraft(type, id, data, { learnDicts = true, rv = null } = {}) {
    const clean = stripTransient(data);
    return Store.commit((st) => {
      let doc = id ? st.documents.find((d) => d.id === id) : null;
      if (doc) {
        if (rv !== null && doc.rv !== rv) throw new Error('Dokument został w międzyczasie zmieniony (inna karta). Odśwież i spróbuj ponownie.');
        if (doc.status !== 'draft') throw new Error('Wystawiony dokument zmienia się przez korektę');
        doc._before = flatForDiff(doc);
        doc.data = clean; doc.rv += 1; doc.updated = nowISO();
      } else {
        doc = { id: uid(), type, number: null, status: 'draft', revision: 0, rv: 1, data: clean, contractor: null, issuer: null,
          revisions: [], created: nowISO(), updated: nowISO(), createdBy: currentUserName() };
        st.documents.unshift(doc);
      }
      if (learnDicts) learn(st, type, clean);
      const changes = doc._before ? diff(doc._before, flatForDiff(doc)) : null;
      delete doc._before;
      return { id: doc.id, changes };
    }, (r) => ({ action: r.changes ? 'update' : 'create', entity: type, entityId: r.id, summary: r.changes ? `Zmieniono szkic: ${DOC_TYPES[type].label.toLowerCase()}` : `Utworzono szkic: ${DOC_TYPES[type].label.toLowerCase()}`, changes: r.changes || undefined }));
  },

  async issue(id) {
    return Store.commit((st) => {
      const doc = st.documents.find((d) => d.id === id);
      if (!doc) throw new Error('Nie znaleziono dokumentu');
      if (doc.status !== 'draft') throw new Error('Dokument jest już wystawiony');
      const errors = validateDoc(doc.type, doc.data);
      if (errors.length) throw new Error(`Uzupełnij dane: ${errors[0].message}`);
      const c = st.contractors.find((x) => x.id === doc.data.contractorId);
      const cfg = st.settings.numbering[doc.type];
      const key = periodKey(doc.type, doc.data.issue_date, cfg.reset);
      const seq = (st.counters[key] || 0) + 1;
      const number = renderNumber(cfg.pattern, seq, cfg.digits, doc.data.issue_date);
      if (st.documents.some((d) => d.number === number)) throw new Error(`Numer ${number} jest już zajęty — sprawdź ustawienia numeracji`);
      st.counters[key] = seq;
      Object.assign(doc, { number, status: 'issued', revision: 1, rv: doc.rv + 1, contractor: contractorSnapshot(c),
        issuer: structuredClone(st.settings.company), issuedAt: nowISO(), issuedBy: currentUserName(), updated: nowISO() });
      doc.revisions.push({ revision: 1, kind: 'issue', reason: null, at: nowISO(), by: currentUserName(), snapshot: structuredClone(doc.data) });
      return { id, number, type: doc.type, name: c.name };
    }, (r) => ({ action: 'issue', entity: r.type, entityId: r.id, summary: `Wystawiono ${r.number} dla ${r.name}` }));
  },

  async correct(id, data, reason, rv) {
    const clean = stripTransient(data);
    return Store.commit((st) => {
      const doc = st.documents.find((d) => d.id === id);
      if (doc.rv !== rv) throw new Error('Dokument został w międzyczasie zmieniony. Odśwież i spróbuj ponownie.');
      if (doc.status !== 'issued') throw new Error('Korygować można tylko wystawiony dokument');
      const before = flatForDiff(doc);
      doc.data = clean;
      const changes = diff(before, flatForDiff(doc));
      if (!Object.keys(changes).length) throw new Error('Korekta nie zawiera żadnych zmian');
      const c = st.contractors.find((x) => x.id === clean.contractorId);
      Object.assign(doc, { revision: doc.revision + 1, rv: doc.rv + 1, contractor: contractorSnapshot(c), issuer: structuredClone(st.settings.company), updated: nowISO() });
      doc.revisions.push({ revision: doc.revision, kind: 'correction', reason, at: nowISO(), by: currentUserName(), snapshot: structuredClone(clean) });
      learn(st, doc.type, clean);
      return { id, number: doc.number, type: doc.type, n: doc.revision - 1, changes };
    }, (r) => ({ action: 'correction', entity: r.type, entityId: r.id, summary: `Korekta nr ${r.n} dokumentu ${r.number}: ${reason}`, changes: r.changes }));
  },

  async cancel(id, reason) {
    return Store.commit((st) => {
      const doc = st.documents.find((d) => d.id === id);
      if (doc.status !== 'issued') throw new Error('Anulować można tylko wystawiony dokument');
      Object.assign(doc, { status: 'cancelled', cancelledAt: nowISO(), cancelReason: reason, rv: doc.rv + 1, updated: nowISO() });
      doc.revisions.push({ revision: doc.revision, kind: 'cancel', reason, at: nowISO(), by: currentUserName(), snapshot: structuredClone(doc.data) });
      return { id, number: doc.number, type: doc.type };
    }, (r) => ({ action: 'cancel', entity: r.type, entityId: r.id, summary: `Anulowano ${r.number}: ${reason}` }));
  },

  async remove(id) {
    return Store.commit((st) => {
      const i = st.documents.findIndex((d) => d.id === id);
      const doc = st.documents[i];
      if (doc.status !== 'draft') throw new Error('Usunąć można tylko szkic. Wystawiony dokument można anulować.');
      st.documents.splice(i, 1);
      return { id, type: doc.type, data: doc.data };
    }, (r) => ({ action: 'delete', entity: r.type, entityId: r.id, summary: 'Usunięto szkic', snapshot: r.data }));
  },

  async duplicate(id) {
    return Store.commit((st) => {
      const src = st.documents.find((d) => d.id === id);
      const data = structuredClone(src.data);
      data.issue_date = todayISO();
      const doc = { id: uid(), type: src.type, number: null, status: 'draft', revision: 0, rv: 1, data, contractor: null, issuer: null,
        revisions: [], created: nowISO(), updated: nowISO(), createdBy: currentUserName() };
      st.documents.unshift(doc);
      return { id: doc.id, type: doc.type, from: src.number || 'szkicu' };
    }, (r) => ({ action: 'duplicate', entity: r.type, entityId: r.id, summary: `Nowy szkic na podstawie ${r.from}` }));
  },
};

// --- Model treści dokumentu --------------------------------------------------------------------
// Wiersz: {kind:'pair', cells:[cell,cell]} | {kind:'full', cell} | {kind:'kv', label, cell}
// Komórka: lista akapitów {t, b?, size?: 's'|'m'|'l', bullet?, label?, field?, muted?}
function buildDocModel(doc) {
  const st = Store.state;
  const T = DOC_TYPES[doc.type];
  const d = doc.data;
  const issuer = doc.issuer?.name ? doc.issuer : st.settings.company;
  const party = docParty(doc);
  const p = (t, o = {}) => ({ t: String(t ?? ''), ...o });
  const partyLines = (x, field) => [
    p(`Firma: ${x.name || ''}`, { b: true, field }),
    x.street ? p(x.street, { field }) : null,
    (x.postal_code || x.city) ? p(`${x.postal_code || ''} ${x.city || ''}`.trim(), { field }) : null,
    x.country && x.country !== 'PL' ? p(x.country, { field }) : null,
    x.nip ? p(`NIP: ${x.nip}`, { field }) : null,
  ].filter(Boolean);
  const rev = doc.revision > 1 ? `Korekta nr ${doc.revision - 1}` : '';
  const model = {
    title: doc.number ? `${T.title} nr ${doc.number}` : `${T.title} — PROJEKT`,
    subtitle: [rev, doc.status === 'cancelled' ? 'ANULOWANE' : ''].filter(Boolean).join(' · '),
    watermark: doc.status === 'draft' ? 'PROJEKT' : doc.status === 'cancelled' ? 'ANULOWANE' : null,
    dateLine: null,
    rows: [],
    signatures: [],
    placeDate: `${d.issue_place || ''}, dnia ${fmtDate(d.issue_date)}`,
    footer: [],
    website: issuer.website || '',
  };
  if (doc.type === 'zlecenie') {
    const prices = d.items.map((it, i) => {
      let line = `${i + 1}. ${it.route || '…'}: ${it.amount ? `${fmtMoney(it.amount, false)} ${it.unit || 'zł'}` : '…'}`;
      const v = valueGr(it.amount, it.qty);
      if (it.qty) line += ` × ${fmtQty(it.qty)}${v ? ` = ${fmtMoney(v)} netto` : ''}`;
      return p(line, { b: true, size: 'l', field: `items.${i}` });
    });
    const total = docTotal(doc);
    const details = [
      ['Dokładny opis usługi', d.service_detailed || d.service_short, 'service_detailed'],
      ['Rodzaj przewożonego towaru', d.cargo, 'cargo'],
      ['Punkt wyjściowy (załadunek)', d.origin, 'origin'],
      ['Punkt docelowy (rozładunek)', d.destination, 'destination'],
    ].filter(([, v]) => v).map(([l, v, f]) => p(v, { label: `${l}: `, size: 'l', field: f }));
    model.rows.push(
      { kind: 'pair', cells: [[p('Zleceniobiorca:', { b: true, size: 's' }), ...partyLines(party, 'contractorId')], [p('Zleceniodawca:', { b: true, size: 's' }), ...partyLines(issuer)]] },
      { kind: 'full', cell: [p('Krótki opis usługi:', { b: true, size: 's' }), p(d.service_short || '…', { size: 'l', field: 'service_short' })] },
      { kind: 'full', cell: [p('Cena netto:', { b: true, size: 's' }), ...prices,
        d.items.length > 1 && total ? p(`Wartość zlecenia netto: ${fmtMoney(total)}`, { b: true, size: 'l' }) : null,
        p(st.settings.defaults.payment_text.replace('{days}', d.payment_days), { b: true, size: 'l', field: 'payment_days', gap: true })].filter(Boolean) },
      { kind: 'full', cell: [...details,
        p('Terminy załadunku:', { size: 'l', gap: true }), p(d.loading_term, { size: 'l', field: 'loading_term' }),
        p('Po stronie Zleceniodawcy sprawę prowadzi:', { size: 'l', gap: true }), p([d.handler_name, d.handler_phone].filter(Boolean).join(': ') || '…', { size: 'l', field: 'handler_name' }),
        p('Po stronie Zleceniobiorcy:', { size: 'l' }), p([d.contact_name, d.contact_phone].filter(Boolean).join(': ') || '—', { size: 'l', field: 'contact_phone' })] },
    );
    if (d.notes) model.rows.push({ kind: 'full', cell: [p('Uwagi:', { b: true, size: 's' }), p(d.notes, { field: 'notes' })] });
    model.signatures = ['Zleceniobiorca', 'Zleceniodawca'];
  } else {
    model.dateLine = model.placeDate;
    const qty = d.quantity ? `${fmtQty(d.quantity)}${d.tolerance !== '' && d.tolerance !== null && Number(d.tolerance) > 0 ? ` (+/-${String(d.tolerance).replace('.', ',')}%)` : ''}` : '…';
    const total = docTotal(doc);
    const kv = (label, cell, field) => model.rows.push({ kind: 'kv', label, cell: (Array.isArray(cell) ? cell : [p(cell || '…', { field })]) });
    kv('Przedmiot zamówienia', d.subject, 'subject');
    kv('Zamawiający', [p(issuer.legal_name || issuer.name), p(`${issuer.street}, ${issuer.postal_code} ${issuer.city}`), p(`NIP: ${issuer.nip}`)]);
    kv('Sprzedający', [p(party.name || '…', { field: 'contractorId' }), party.street ? p(`${party.street}, ${party.postal_code || ''} ${party.city || ''}`.trim(), { field: 'contractorId' }) : null,
      party.nip ? p(`NIP: ${party.nip}`, { field: 'contractorId' }) : null].filter(Boolean));
    kv('Czas obowiązywania zamówienia', d.valid_until ? `Do ${fmtDate(d.valid_until)}` : '…', 'valid_until');
    kv('Miejsce i warunki odbioru towaru', d.pickup, 'pickup');
    kv('Ilość', qty, 'quantity');
    kv('Jednostka', d.unit, 'unit');
    if (d.material) kv('Surowiec i pomiar', d.material, 'material');
    kv('Termin płatności', `${d.payment_days} dni`, 'payment_days');
    kv(`Cena (PLN)/${d.unit || 'jedn.'} netto`, d.price ? `${fmtMoney(d.price, false)} PLN/${d.unit}` : '…', 'price');
    if (total) kv('Szacunkowa wartość netto', `${fmtMoney(total)} (wg ilości bazowej)`, 'quantity');
    kv('Metoda płatności', d.payment_method, 'payment_method');
    if (d.handler_name) kv('Osoba prowadząca', [d.handler_name, d.handler_phone].filter(Boolean).join(', '), 'handler_name');
    const notes = [...d.clauses.map((c) => p(c, { bullet: true, field: 'clauses' })), d.notes ? p(d.notes, { bullet: true, field: 'notes' }) : null].filter(Boolean);
    if (notes.length) kv('Uwagi', notes);
    model.signatures = ['Sprzedający', 'Zamawiający'];
  }
  const f = issuer;
  model.footer = [
    `${f.legal_name || f.name}, siedziba: ${f.street}, ${f.postal_code} ${f.city}`,
    f.correspondence_address ? `Adres do korespondencji: ${f.correspondence_address}` : null,
    [f.nip && `NIP: ${f.nip}`, f.regon && `REGON: ${f.regon}`, f.krs && `KRS: ${f.krs}`].filter(Boolean).join(', ') + (f.court ? ` - ${f.court}` : ''),
    f.share_capital ? `Wysokość kapitału zakładowego ${f.share_capital}` : null,
  ].filter(Boolean);
  const partyName = party?.name || '';
  model.fileStem = `${safeFile(T.label)}_${safeFile(doc.number || 'PROJEKT')}_${safeFile(partyName)}${doc.revision > 1 ? `_korekta${doc.revision - 1}` : ''}${doc.status === 'cancelled' ? '_ANULOWANE' : ''}`;
  return model;
}
