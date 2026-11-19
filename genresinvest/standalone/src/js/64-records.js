// Kontrahenci (z importem/eksportem CSV) i słowniki (usługi, cennik, przedmioty, miejsca, klauzule, osoby, metody).

VIEWS.contractors = (main) => {
  const q = inp({ type: 'search', placeholder: 'Nazwa, NIP, miasto, telefon…', value: sessionStorage.getItem('gri-cq') || '', 'aria-label': 'Szukaj kontrahenta' });
  sessionStorage.removeItem('gri-cq');
  const role = h('select', { 'aria-label': 'Rola' }, [['', 'Wszystkie role'], ['przewoznik', 'Zleceniobiorcy'], ['dostawca', 'Sprzedający'], ['inactive', 'Nieaktywni']].map(([v, l]) => h('option', { value: v }, l)));
  const body = h('div', {});
  const usage = (id) => Store.state.documents.filter((d) => d.data.contractorId === id).length;
  const draw = () => {
    const rows = Store.state.contractors.filter((c) => matches(q.value, c.name, c.nip, c.city, c.phone)
      && (!role.value || (role.value === 'inactive' ? !c.active : c.active && c.kinds?.includes(role.value)))).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    body.replaceChildren(rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid-table' },
      h('thead', {}, h('tr', {}, ['Nazwa', 'NIP', 'Adres', 'Telefon', 'Rola', 'Dokumenty', ''].map((t, i) => h('th', { class: i === 5 ? 'num' : '' }, t)))),
      h('tbody', {}, rows.map((c) => h('tr', { class: c.active ? '' : 'inactive' },
        h('td', { 'data-l': 'Nazwa', class: 'strong' }, c.name, c.notes ? h('small', {}, c.notes) : null),
        h('td', { 'data-l': 'NIP', class: 'nowrap' }, c.nip || h('span', { class: 'warn-t' }, 'brak')),
        h('td', { 'data-l': 'Adres' }, `${c.street}, ${c.postal_code} ${c.city}`),
        h('td', { 'data-l': 'Telefon', class: 'nowrap' }, c.phone || '—'),
        h('td', { 'data-l': 'Rola' }, (c.kinds || []).map((k) => h('span', { class: 'tag neutral' }, k === 'przewoznik' ? 'Zleceniobiorca' : 'Sprzedający')), c.active ? null : h('span', { class: 'tag cancelled' }, 'nieaktywny')),
        h('td', { 'data-l': 'Dokumenty', class: 'num' }, String(usage(c.id))),
        h('td', { class: 'acts' }, canEdit() ? [
          btn('', { kind: 'ghost icon-only', icon: 'edit', title: `Edytuj ${c.name}`, onClick: () => contractorModal({ contractor: structuredClone(c) }) }),
          btn('', { kind: 'ghost icon-only', icon: 'trash', title: `Usuń ${c.name}`, onClick: async () => {
            const used = usage(c.id);
            if (!(await confirmBox({ title: used ? 'Dezaktywować kontrahenta?' : 'Usunąć kontrahenta?', message: used ? `${c.name} występuje w ${used} dokumentach — zostanie dezaktywowany (historia pozostaje spójna).` : `${c.name} zostanie usunięty z kartoteki.`, ok: used ? 'Dezaktywuj' : 'Usuń', danger: true }))) return;
            await Store.commit((st) => { const i = st.contractors.findIndex((x) => x.id === c.id); if (used) { st.contractors[i].active = false; st.contractors[i].rv += 1; } else st.contractors.splice(i, 1); },
              { action: used ? 'deactivate' : 'delete', entity: 'contractor', entityId: c.id, summary: `${used ? 'Dezaktywowano' : 'Usunięto'} kontrahenta ${c.name}` });
            toast(used ? 'Kontrahent dezaktywowany' : 'Kontrahent usunięty', 'success');
          } })] : null))))))
      : emptyState('Brak kontrahentów', q.value ? 'Zmień wyszukiwanie.' : 'Dodaj pierwszego kontrahenta.'));
  };
  const exportCsv = () => csvDownload(`Kontrahenci_${todayISO()}.csv`, ['nazwa', 'ulica', 'kod_pocztowy', 'miejscowosc', 'kraj', 'nip', 'telefon', 'email', 'osoba_kontaktowa', 'uwagi', 'rola', 'aktywny'],
    Store.state.contractors.map((c) => [c.name, c.street, c.postal_code, c.city, c.country, c.nip, c.phone, c.email, c.contact_person, c.notes, (c.kinds || []).join(','), c.active ? 'tak' : 'nie']));
  const importCsv = () => modal({
    title: 'Import kontrahentów z CSV', size: 'md',
    build: (close) => {
      const file = h('input', { type: 'file', accept: '.csv,text/csv', autofocus: true });
      const out = h('div', {});
      let parsed = null;
      const parse = async () => {
        const f = file.files[0]; if (!f) return;
        const buf = new Uint8Array(await f.arrayBuffer());
        let text = new TextDecoder('utf-8').decode(buf);
        if (text.includes('�')) text = new TextDecoder('windows-1250').decode(buf);
        text = text.replace(/^﻿/, '');
        const sep = (text.split('\n')[0].match(/;/g) || []).length >= (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
        const rows = parseCsv(text, sep);
        const head = rows.shift().map((x) => norm(x).trim());
        const col = (...names) => head.findIndex((x) => names.includes(x));
        const ix = { name: col('nazwa', 'firma', 'name'), street: col('ulica', 'adres', 'street'), postal: col('kod_pocztowy', 'kod pocztowy', 'kod'), city: col('miejscowosc', 'miasto', 'city'),
          country: col('kraj', 'country'), nip: col('nip'), phone: col('telefon', 'tel', 'phone'), email: col('email', 'e-mail'), contact: col('osoba_kontaktowa', 'kontakt'), notes: col('uwagi', 'notes'), role: col('rola'), active: col('aktywny') };
        if (ix.name < 0) { out.replaceChildren(h('div', { class: 'form-alert' }, 'Brak kolumny „nazwa” w nagłówku')); return; }
        const ok = []; const bad = [];
        rows.forEach((r, i) => {
          if (!r.some((x) => x.trim())) return;
          const g = (k) => (ix[k] >= 0 ? String(r[ix[k]] || '').trim() : '');
          const c = { name: g('name'), street: g('street'), postal_code: normPostal(g('postal')), city: g('city'), country: (g('country') || 'PL').toUpperCase(), nip: normNip(g('nip')), phone: g('phone'), email: g('email'),
            contact_person: g('contact'), notes: g('notes'), kinds: g('role') ? g('role').split(',').map((x) => x.trim()).filter((x) => ['przewoznik', 'dostawca'].includes(x)) : ['przewoznik'], active: !['nie', '0', 'false'].includes(g('active').toLowerCase()) };
          const e = [];
          if (c.name.length < 2) e.push('brak nazwy');
          if (c.nip && c.country === 'PL' && !isValidNip(c.nip)) e.push('błędny NIP');
          if (c.country === 'PL' && c.postal_code && !isValidPostal(c.postal_code)) e.push('kod pocztowy');
          if (c.phone && !isValidPhone(c.phone)) e.push('telefon');
          (e.length ? bad : ok).push({ line: i + 2, c, e });
        });
        parsed = ok;
        out.replaceChildren(h('div', { class: `callout ${bad.length ? 'warn' : 'info'}` }, h('div', {}, h('strong', {}, `Poprawnych wierszy: ${ok.length}, z błędami: ${bad.length}`),
          h('p', {}, 'Istniejący kontrahenci (ten sam NIP lub nazwa) zostaną zaktualizowani. Wiersze z błędami zostaną pominięte.'))),
        bad.length ? h('ul', { class: 'small' }, bad.slice(0, 30).map((b) => h('li', {}, `Wiersz ${b.line} (${b.c.name || 'bez nazwy'}): ${b.e.join(', ')}`))) : null);
        go2.disabled = !ok.length;
      };
      file.addEventListener('change', parse);
      const go2 = h('button', { type: 'submit', class: 'btn primary', disabled: true }, 'Importuj');
      return {
        body: h('div', { class: 'stack' }, h('p', {}, 'Nagłówek: ', h('code', {}, 'nazwa;ulica;kod_pocztowy;miejscowosc;kraj;nip;telefon;email;osoba_kontaktowa;uwagi;rola;aktywny'), '. Separator ; lub , · UTF-8 lub Windows-1250 (Excel).'),
          field({ label: 'Plik CSV', name: 'file', control: file }), out),
        footer: [btn('Anuluj', { onClick: () => close() }), go2],
        submit: () => busy(go2, async () => {
          const r = await Store.commit((st) => {
            let created = 0; let updated = 0;
            for (const { c } of parsed) {
              const ex = st.contractors.find((x) => (c.nip && x.nip === c.nip) || norm(x.name) === norm(c.name));
              if (ex) { Object.assign(ex, c, { rv: ex.rv + 1, updated: nowISO() }); updated++; } else { st.contractors.push({ id: uid(), ...c, rv: 1, created: nowISO(), updated: nowISO() }); created++; }
            }
            return { created, updated };
          }, (x) => ({ action: 'import', entity: 'contractor', summary: `Import CSV: nowi ${x.created}, zaktualizowani ${x.updated}` }));
          toast(`Zaimportowano: nowi ${r.created}, zaktualizowani ${r.updated}`, 'success'); close();
        }),
      };
    },
  });
  mount(main, 
    h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Kontrahenci'), h('p', { class: 'sub' }, 'Zleceniobiorcy i Sprzedający. Dane kopiują się do dokumentu w chwili wystawienia.')),
      h('div', { class: 'row wrap' }, btn('Eksport CSV', { icon: 'download', onClick: exportCsv }), canEdit() ? btn('Import CSV', { icon: 'upload', onClick: importCsv }) : null,
        canEdit() ? btn('Nowy kontrahent', { kind: 'primary', icon: 'plus', onClick: () => contractorModal() }) : null)),
    h('section', { class: 'filters' }, h('div', { class: 'f-search' }, icon('search', 16), q), role), body);
  q.addEventListener('input', debounce(draw, 120)); role.addEventListener('change', draw);
  draw(); q.focus();
  return Store.onChange(draw);
};

function parseCsv(text, sep) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
    if (ch === '"') q = true; else if (ch === sep) { row.push(cur); cur = ''; } else if (ch === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += ch;
  }
  if (cur || row.length) { row.push(cur.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

// --- Słowniki -------------------------------------------------------------------------------------
const DICTS = {
  services: { label: 'Opisy usług', hint: 'Krótki i dokładny opis usługi oraz rodzaj towaru — do zleceń.',
    cols: [['Krótki opis', (x) => x.short], ['Towar', (x) => x.cargo]], title: (x) => x.short,
    fields: (x) => [['short', 'Krótki opis usługi', h('textarea', { rows: 2, maxlength: 300 }, x.short || ''), true], ['detailed', 'Dokładny opis', h('textarea', { rows: 3, maxlength: 2000 }, x.detailed || '')], ['cargo', 'Rodzaj towaru', inp({ value: x.cargo || '', maxlength: 200 })]] },
  prices: { label: 'Cennik tras', hint: 'Trasa lub pozycja z ceną netto i jednostką — do zleceń.',
    cols: [['Trasa / pozycja', (x) => x.route], ['Cena netto', (x) => fmtMoney(x.amount), 'num'], ['Jednostka', (x) => x.unit]], title: (x) => x.route,
    fields: (x) => [['route', 'Trasa / pozycja', inp({ value: x.route || '', maxlength: 200 }), true], ['amount', 'Cena netto [zł]', inp({ value: moneyInput(x.amount), inputmode: 'decimal', class: 'num' }), true, 'money'], ['unit', 'Jednostka', inp({ value: x.unit || 'zł/fracht', maxlength: 40 }), true]] },
  products: { label: 'Przedmioty zamówień', hint: 'Towar, opis surowca i pomiaru, jednostka i cena bazowa — do zamówień.',
    cols: [['Przedmiot', (x) => x.name], ['Jednostka', (x) => x.unit], ['Cena bazowa', (x) => (x.price ? fmtMoney(x.price) : '—'), 'num']], title: (x) => x.name,
    fields: (x) => [['name', 'Przedmiot zamówienia', inp({ value: x.name || '', maxlength: 200 }), true], ['material', 'Surowiec i pomiar', h('textarea', { rows: 3, maxlength: 2000 }, x.material || '')], ['unit', 'Jednostka', inp({ value: x.unit || 'mp', maxlength: 40 }), true], ['price', 'Cena bazowa netto [zł] (opcjonalnie)', inp({ value: moneyInput(x.price), inputmode: 'decimal', class: 'num' }), false, 'money']] },
  places: { label: 'Miejsca odbioru', hint: 'Adresy i warunki odbioru towaru — do zamówień.', cols: [['Miejsce i warunki', (x) => x.text]], title: (x) => x.text,
    fields: (x) => [['text', 'Miejsce i warunki odbioru', h('textarea', { rows: 2, maxlength: 300 }, x.text || ''), true]] },
  clauses: { label: 'Klauzule (uwagi)', hint: 'Warunki drukowane w rubryce „Uwagi” zamówienia. „Domyślna” = zaznaczona w nowym zamówieniu.',
    cols: [['Treść', (x) => x.text], ['Domyślna', (x) => (x.auto ? 'tak' : '—')]], title: (x) => x.text,
    fields: (x) => [['text', 'Treść klauzuli', h('textarea', { rows: 3, maxlength: 500 }, x.text || ''), true], ['auto', 'Zaznaczaj w nowych zamówieniach', h('input', { type: 'checkbox', checked: !!x.auto }), false, 'bool']] },
  methods: { label: 'Metody płatności', hint: 'np. przelew, przedpłata.', cols: [['Metoda', (x) => x.text]], title: (x) => x.text,
    fields: (x) => [['text', 'Metoda płatności', inp({ value: x.text || '', maxlength: 200 }), true]] },
  handlers: { label: 'Osoby prowadzące', hint: 'Pracownicy ResInvest prowadzący sprawę.', cols: [['Imię i nazwisko', (x) => x.name], ['Telefon', (x) => x.phone]], title: (x) => x.name,
    fields: (x) => [['name', 'Imię i nazwisko', inp({ value: x.name || '', maxlength: 120 }), true], ['phone', 'Telefon', inp({ value: x.phone || '', maxlength: 40, inputmode: 'tel' }), false, 'phone']] },
};

VIEWS.dicts = (main) => {
  let cur = sessionStorage.getItem('gri-dict') || 'services';
  const head = h('div', {}); const body = h('div', {});
  const edit = (key, item) => {
    const def = DICTS[key];
    const fl = def.fields(item || {});
    const grid = h('div', { class: 'form-grid' }, fl.map(([name, label, ctl, req, kind]) => (kind === 'bool' ? h('label', { class: 'check c12' }, ctl, label) : field({ label, name, control: ctl, required: req, cls: 'c12' }))));
    formKeys(grid);
    modal({ title: item ? `Edycja: ${def.label}` : `Nowa pozycja: ${def.label}`, size: 'md', build: (close) => {
      const save = h('button', { type: 'submit', class: 'btn primary' }, 'Zapisz');
      return { body: grid, footer: [btn('Anuluj', { onClick: () => close() }), save], submit: () => busy(save, async () => {
        const v = {}; const e = [];
        for (const [name, , ctl, req, kind] of fl) {
          if (kind === 'bool') { v[name] = ctl.checked; continue; }
          const raw = ctl.value.trim();
          if (req && !raw) { e.push({ field: name, message: 'Pole jest wymagane' }); continue; }
          if (kind === 'money') { if (!raw) { v[name] = null; continue; } const r = parseMoneyGr(raw); if (r.error) e.push({ field: name, message: r.error }); else v[name] = r.value; continue; }
          if (kind === 'phone' && raw && !isValidPhone(raw)) e.push({ field: name, message: 'Nieprawidłowy telefon' });
          v[name] = clean(raw, 2000);
        }
        if (e.length) { setErrors(grid, e); return; }
        await Store.commit((st) => {
          const list = st.dict[key];
          if (item) Object.assign(list.find((x) => x.id === item.id), v); else list.push({ id: uid(), uses: 0, ...v });
        }, { action: item ? 'update' : 'create', entity: 'dictionary', summary: `${item ? 'Zmieniono' : 'Dodano'} w słowniku „${def.label}”: ${def.title(v).slice(0, 80)}` });
        toast('Zapisano', 'success'); close();
      }) };
    } });
  };
  const draw = () => {
    const def = DICTS[cur];
    const list = [...Store.state.dict[cur]].sort((a, b) => (b.uses || 0) - (a.uses || 0));
    head.replaceChildren(tabs(Object.entries(DICTS).map(([k, d]) => [k, d.label, Store.state.dict[k].length]), cur, (k) => { cur = k; sessionStorage.setItem('gri-dict', k); draw(); }),
      h('div', { class: 'panel-head' }, h('p', { class: 'muted' }, def.hint), canEdit() ? btn('Dodaj', { kind: 'primary', icon: 'plus', onClick: () => edit(cur, null) }) : null));
    body.replaceChildren(list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid-table' },
      h('thead', {}, h('tr', {}, def.cols.map(([t, , c]) => h('th', { class: c || '' }, t)), h('th', { class: 'num' }, 'Użycia'), h('th', {}))),
      h('tbody', {}, list.map((x) => h('tr', {}, def.cols.map(([t, fn, c], i) => h('td', { 'data-l': t, class: `${c || ''} ${i === 0 ? 'strong pre' : ''}` }, fn(x))),
        h('td', { 'data-l': 'Użycia', class: 'num' }, String(x.uses || 0)),
        h('td', { class: 'acts' }, canEdit() ? [btn('', { kind: 'ghost icon-only', icon: 'edit', title: 'Edytuj', onClick: () => edit(cur, x) }),
          btn('', { kind: 'ghost icon-only', icon: 'trash', title: 'Usuń', onClick: async () => {
            if (!(await confirmBox({ title: 'Usunąć pozycję?', message: 'Dokumenty mają własną kopię tekstu — usunięcie nie zmieni wystawionych dokumentów.', ok: 'Usuń', danger: true }))) return;
            await Store.commit((st) => { st.dict[cur] = st.dict[cur].filter((y) => y.id !== x.id); }, { action: 'delete', entity: 'dictionary', summary: `Usunięto ze słownika „${def.label}”: ${def.title(x).slice(0, 80)}` });
          } })] : null))))))
      : emptyState('Słownik jest pusty', 'Pozycje dopisują się też automatycznie przy zapisie dokumentów.'));
  };
  mount(main, h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Słowniki'), h('p', { class: 'sub' }, 'Wartości do wyboru z list rozwijanych. Nowe wpisy z dokumentów dopisują się tu same.'))), head, body);
  draw();
  return Store.onChange(draw);
};
