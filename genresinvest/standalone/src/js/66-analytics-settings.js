// Raporty (miesięczne, roczne, kontrahenci, przedmioty), historia operacji z filtrami,
// ustawienia (firma, numeracja, wartości domyślne, użytkownicy, dane i kopie zapasowe).

VIEWS.reports = (main) => {
  const now = new Date();
  const years = [...new Set([now.getFullYear(), ...Store.state.documents.map((d) => Number(d.data.issue_date.slice(0, 4)))])].sort((a, b) => b - a);
  const year = h('select', { 'aria-label': 'Rok' }, years.map((y) => h('option', { value: y }, String(y))));
  const month = h('select', { 'aria-label': 'Miesiąc' }, h('option', { value: '' }, 'Cały rok'), MONTHS.map((m, i) => h('option', { value: String(i + 1).padStart(2, '0'), selected: i === now.getMonth() }, m)));
  const body = h('div', {});
  const draw = () => {
    const y = year.value; const m = month.value;
    const inYear = Store.state.documents.filter((d) => d.data.issue_date.startsWith(y));
    const inPeriod = inYear.filter((d) => !m || d.data.issue_date.slice(5, 7) === m);
    const issued = inPeriod.filter((d) => d.status === 'issued');
    const rowsMonth = MONTHS.map((name, i) => {
      const mm = String(i + 1).padStart(2, '0');
      const ds = inYear.filter((d) => d.data.issue_date.slice(5, 7) === mm);
      const s1 = (type, st) => ds.filter((d) => d.type === type && d.status === st);
      return { name, zl: s1('zlecenie', 'issued').length, za: s1('zamowienie', 'issued').length, can: ds.filter((d) => d.status === 'cancelled').length,
        zlv: s1('zlecenie', 'issued').reduce((a, d) => a + (docTotal(d) || 0), 0), zav: s1('zamowienie', 'issued').reduce((a, d) => a + (docTotal(d) || 0), 0) };
    });
    const tot = rowsMonth.reduce((a, r) => ({ zl: a.zl + r.zl, za: a.za + r.za, can: a.can + r.can, zlv: a.zlv + r.zlv, zav: a.zav + r.zav }), { zl: 0, za: 0, can: 0, zlv: 0, zav: 0 });
    const byC = {};
    for (const d of issued) { const p = docParty(d); const k = `${d.type}|${p.name}`; byC[k] ||= { type: d.type, name: p.name, n: 0, v: 0 }; byC[k].n++; byC[k].v += docTotal(d) || 0; }
    const byP = {};
    for (const d of issued.filter((x) => x.type === 'zamowienie')) { const k = `${d.data.subject}|${d.data.unit}`; byP[k] ||= { s: d.data.subject, u: d.data.unit, n: 0, q: 0, v: 0, min: Infinity, max: 0 }; const r = byP[k]; r.n++; r.q += d.data.quantity; r.v += docTotal(d) || 0; r.min = Math.min(r.min, d.data.price); r.max = Math.max(r.max, d.data.price); }
    const byR = {};
    for (const d of issued.filter((x) => x.type === 'zlecenie')) for (const it of d.data.items) { const k = `${it.route}|${it.unit}`; byR[k] ||= { r: it.route, u: it.unit, n: 0, min: Infinity, max: 0, sum: 0 }; const r = byR[k]; r.n++; r.sum += it.amount; r.min = Math.min(r.min, it.amount); r.max = Math.max(r.max, it.amount); }
    const periodLabel = m ? `${MONTHS[Number(m) - 1]} ${y}` : `rok ${y}`;
    const table = (heads, rows, foot) => h('div', { class: 'table-wrap' }, h('table', { class: 'grid-table' }, h('thead', {}, h('tr', {}, heads.map(([t, c]) => h('th', { class: c || '' }, t)))),
      h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: heads.length, class: 'muted center' }, 'Brak wystawionych dokumentów w okresie'))), foot ? h('tfoot', {}, foot) : null));
    const td = (v, l, c = '') => h('td', { 'data-l': l, class: c }, v);
    const z = (gr) => (gr ? fmtMoney(gr) : '—'); const n0 = (n) => (n ? String(n) : '—');
    body.replaceChildren(
      h('section', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('span', { class: 'kpi-l' }, `Zlecenia · ${periodLabel}`), h('span', { class: 'kpi-v' }, String(issued.filter((d) => d.type === 'zlecenie').length))),
        h('div', { class: 'kpi' }, h('span', { class: 'kpi-l' }, `Zamówienia · ${periodLabel}`), h('span', { class: 'kpi-v' }, String(issued.filter((d) => d.type === 'zamowienie').length))),
        h('div', { class: 'kpi' }, h('span', { class: 'kpi-l' }, 'Wartość zamówień netto'), h('span', { class: 'kpi-v money' }, fmtMoney(issued.filter((d) => d.type === 'zamowienie').reduce((a, d) => a + (docTotal(d) || 0), 0)))),
        h('div', { class: 'kpi' }, h('span', { class: 'kpi-l' }, 'Wartość zleceń netto (z ilością)'), h('span', { class: 'kpi-v money' }, fmtMoney(issued.filter((d) => d.type === 'zlecenie').reduce((a, d) => a + (docTotal(d) || 0), 0))))),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, `Rok ${y} — miesiące`), btn('CSV', { small: true, icon: 'download', onClick: () => csvDownload(`Raport_roczny_${y}.csv`, ['Miesiąc', 'Zlecenia', 'Wartość zleceń', 'Zamówienia', 'Wartość zamówień', 'Anulowane'], rowsMonth.map((r) => [r.name, r.zl, moneyInput(r.zlv), r.za, moneyInput(r.zav), r.can])) })),
        table([['Miesiąc'], ['Zlecenia', 'num'], ['Wartość zleceń', 'num'], ['Zamówienia', 'num'], ['Wartość zamówień', 'num'], ['Anulowane', 'num']],
          rowsMonth.map((r) => h('tr', { class: m && MONTHS[Number(m) - 1] === r.name ? 'hl-row' : '' }, td(r.name, 'Miesiąc', 'strong'), td(n0(r.zl), 'Zlecenia', 'num'), td(z(r.zlv), 'Wartość zleceń', 'num'), td(n0(r.za), 'Zamówienia', 'num'), td(z(r.zav), 'Wartość zamówień', 'num'), td(n0(r.can), 'Anulowane', 'num'))),
          h('tr', {}, h('td', {}, 'Razem'), h('td', { class: 'num' }, String(tot.zl)), h('td', { class: 'num' }, fmtMoney(tot.zlv)), h('td', { class: 'num' }, String(tot.za)), h('td', { class: 'num' }, fmtMoney(tot.zav)), h('td', { class: 'num' }, String(tot.can))))),
      h('div', { class: 'split-2' },
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, `Kontrahenci · ${periodLabel}`)),
          table([['Kontrahent'], ['Typ'], ['Dok.', 'num'], ['Wartość netto', 'num']], Object.values(byC).sort((a, b) => b.v - a.v || b.n - a.n).map((r) => h('tr', {}, td(r.name, 'Kontrahent', 'strong'), td(DOC_TYPES[r.type].plural, 'Typ'), td(String(r.n), 'Dok.', 'num'), td(fmtMoney(r.v), 'Wartość', 'num'))))),
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, `Przedmioty zamówień · ${periodLabel}`)),
          table([['Przedmiot'], ['Ilość', 'num'], ['Cena min–max', 'num'], ['Wartość', 'num']], Object.values(byP).map((r) => h('tr', {}, td(r.s, 'Przedmiot', 'strong'), td(`${fmtQty(r.q)} ${r.u}`, 'Ilość', 'num'), td(r.min === r.max ? fmtMoney(r.min) : `${fmtMoney(r.min)} – ${fmtMoney(r.max)}`, 'Cena', 'num'), td(fmtMoney(r.v), 'Wartość', 'num')))))),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, `Trasy i stawki zleceń · ${periodLabel}`)),
        table([['Trasa / pozycja'], ['Jednostka'], ['Liczba', 'num'], ['Min', 'num'], ['Średnia', 'num'], ['Max', 'num']], Object.values(byR).sort((a, b) => b.n - a.n).map((r) => h('tr', {}, td(r.r, 'Trasa', 'strong'), td(r.u, 'Jednostka'), td(String(r.n), 'Liczba', 'num'), td(fmtMoney(r.min), 'Min', 'num'), td(fmtMoney(Math.round(r.sum / r.n)), 'Średnia', 'num'), td(fmtMoney(r.max), 'Max', 'num'))))));
  };
  mount(main, h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Raporty'), h('p', { class: 'sub' }, 'Liczone z dokumentów wystawionych — bez szkiców i anulowanych. Wartość zlecenia liczy się, gdy podano ilości.')),
    h('div', { class: 'row' }, year, month)), body);
  year.addEventListener('change', draw); month.addEventListener('change', draw);
  draw();
  return Store.onChange(draw);
};

const ACTION_PL = { create: 'Utworzenie', update: 'Zmiana', delete: 'Usunięcie', issue: 'Wystawienie', correction: 'Korekta', cancel: 'Anulowanie', duplicate: 'Duplikat', export: 'Pobranie', import: 'Import', backup: 'Kopia', restore: 'Przywrócenie', deactivate: 'Dezaktywacja', settings: 'Ustawienia', login: 'Wejście' };
const ENTITY_PL = { zlecenie: 'Zlecenie', zamowienie: 'Zamówienie', contractor: 'Kontrahent', dictionary: 'Słownik', settings: 'Ustawienia', user: 'Użytkownik', system: 'System' };

VIEWS.history = (main) => {
  const q = inp({ type: 'search', placeholder: 'Szukaj w opisie…', 'aria-label': 'Szukaj' });
  const from = inp({ type: 'date', 'aria-label': 'Od' }); const to = inp({ type: 'date', 'aria-label': 'Do' });
  const ent = h('select', { 'aria-label': 'Obiekt' }, h('option', { value: '' }, 'Wszystkie obiekty'), Object.entries(ENTITY_PL).map(([k, v]) => h('option', { value: k }, v)));
  const act = h('select', { 'aria-label': 'Akcja' }, h('option', { value: '' }, 'Wszystkie akcje'), Object.entries(ACTION_PL).map(([k, v]) => h('option', { value: k }, v)));
  const usr = h('select', { 'aria-label': 'Użytkownik' }, h('option', { value: '' }, 'Wszyscy użytkownicy'), [...new Set(Store.state.audit.map((a) => a.user))].map((u) => h('option', { value: u }, u)));
  const body = h('div', {});
  let page = 1;
  const draw = () => {
    const rows = Store.state.audit.filter((a) => (!ent.value || a.entity === ent.value) && (!act.value || a.action === act.value) && (!usr.value || a.user === usr.value)
      && (!from.value || a.ts.slice(0, 10) >= from.value) && (!to.value || a.ts.slice(0, 10) <= to.value) && matches(q.value, a.summary, a.user));
    const per = 50;
    body.replaceChildren(rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid-table' },
      h('thead', {}, h('tr', {}, ['Kiedy', 'Kto', 'Akcja', 'Obiekt', 'Opis'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.slice((page - 1) * per, page * per).map((a) => h('tr', {},
        h('td', { 'data-l': 'Kiedy', class: 'nowrap' }, fmtDateTime(a.ts)), h('td', { 'data-l': 'Kto' }, a.user),
        h('td', { 'data-l': 'Akcja' }, h('span', { class: `tag ${['cancel', 'delete'].includes(a.action) ? 'cancelled' : a.action === 'issue' ? 'issued' : 'neutral'}` }, ACTION_PL[a.action] || a.action)),
        h('td', { 'data-l': 'Obiekt' }, (a.entity === 'zlecenie' || a.entity === 'zamowienie') && a.entityId && Docs.get(a.entityId) ? h('a', { href: `#/dok/${a.entityId}` }, docLabel(Docs.get(a.entityId))) : (ENTITY_PL[a.entity] || a.entity)),
        h('td', { 'data-l': 'Opis', class: 'wide-cell' }, a.summary, a.changes && Object.keys(a.changes).length ? h('details', {}, h('summary', {}, `Zmiany (${Object.keys(a.changes).length})`), changesTable(a.changes)) : null))))))
      : emptyState('Brak wpisów', 'Zmień filtry.'), pager(rows.length, page, per, (p) => { page = p; draw(); }));
  };
  mount(main, h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Historia operacji'), h('p', { class: 'sub' }, 'Kto, co i kiedy zrobił — z porównaniem „było / jest”. Wpisów nie można edytować.')),
    btn('Eksport CSV', { icon: 'download', onClick: () => csvDownload(`Historia_${todayISO()}.csv`, ['Czas', 'Użytkownik', 'Akcja', 'Obiekt', 'Opis'], Store.state.audit.map((a) => [a.ts, a.user, ACTION_PL[a.action] || a.action, ENTITY_PL[a.entity] || a.entity, a.summary])) })),
  h('section', { class: 'filters' }, h('div', { class: 'f-search' }, icon('search', 16), q), from, to, ent, act, usr), body);
  q.addEventListener('input', debounce(() => { page = 1; draw(); }, 150));
  for (const el of [from, to, ent, act, usr]) el.addEventListener('change', () => { page = 1; draw(); });
  draw();
  return Store.onChange(draw);
};

// --- Ustawienia i dane ------------------------------------------------------------------------------
VIEWS.settings = (main) => {
  let cur = sessionStorage.getItem('gri-set') || 'data';
  const body = h('div', {}); const head = h('div', {});
  const TABS = [['data', 'Dane i kopie'], ['company', 'Firma'], ['numbering', 'Numeracja'], ['defaults', 'Wartości domyślne'], ['users', 'Użytkownicy'], ['about', 'O programie']];
  const adminOnly = (el) => (isAdmin() ? el : h('div', { class: 'callout info' }, h('div', {}, h('strong', {}, 'Tylko administrator'), h('p', {}, 'Zmiany w tej części może wprowadzić profil z rolą administratora.'))));
  const formOf = (defs, values, onSave) => {
    const ctl = {};
    const grid = h('div', { class: 'form-grid' }, defs.map(([k, label, opts = {}]) => {
      const c = opts.select ? h('select', {}, opts.select.map(([v, l]) => h('option', { value: v, selected: String(values[k]) === v }, l)))
        : opts.area ? h('textarea', { rows: 3, maxlength: 1500 }, values[k] ?? '') : inp({ value: Array.isArray(values[k]) ? values[k].join(', ') : values[k] ?? '', maxlength: opts.max || 200, type: opts.num ? 'number' : 'text' });
      ctl[k] = c;
      return field({ label, name: k, control: c, required: !!opts.req, help: opts.help, cls: opts.cls || 'c6' });
    }));
    formKeys(grid);
    const save = btn('Zapisz zmiany', { kind: 'primary', icon: 'check', onClick: (e) => busy(e.currentTarget, async () => {
      const v = {}; const errs = [];
      for (const [k, , opts = {}] of defs) {
        let x = ctl[k].value.trim();
        if (opts.num) x = Number(x);
        if (opts.list) x = x.split(',').map((t) => t.trim()).filter(Boolean);
        if (opts.req && (x === '' || (Array.isArray(x) && !x.length))) errs.push({ field: k, message: 'Pole jest wymagane' });
        const er = opts.check?.(x); if (er) errs.push({ field: k, message: er });
        v[k] = x;
      }
      if (errs.length) { setErrors(grid, errs); return; }
      await onSave(v); toast('Zapisano ustawienia', 'success');
    }) });
    return h('div', { class: 'panel' }, grid, h('div', { class: 'panel-foot' }, save));
  };
  const views = {
    data: async () => {
      const keys = await Store.snapshotKeys();
      const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
      const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
      const file = h('input', { type: 'file', accept: '.json,application/json' });
      const KIND = { auto: 'automatyczna (dzienna)', manual: 'ręczna', 'pre-restore': 'przed przywróceniem' };
      return [
        h('div', { class: 'callout info' }, h('div', {}, h('strong', {}, 'Gdzie są dane?'),
          h('p', {}, 'W bazie tej przeglądarki na tym komputerze (IndexedDB). Każda zmiana zapisuje się od razu, transakcyjnie. Program codziennie robi migawkę wewnętrzną (30 ostatnich). Kopia do pliku chroni dane przed wyczyszczeniem przeglądarki — rób ją co tydzień i trzymaj na dysku sieciowym.'),
          h('p', { class: 'small' }, `Rozmiar danych: ${(JSON.stringify(Store.state).length / 1024).toFixed(0)} KB · dokumentów: ${Store.state.documents.length} · trwały zapis przeglądarki: ${persisted === null ? 'nieznany' : persisted ? 'tak' : 'nie (przeglądarka może wyczyścić dane przy braku miejsca)'}${est ? ` · zajęte ${(est.usage / 1048576).toFixed(1)} MB` : ''}`))),
        h('div', { class: 'split-2' },
          h('section', { class: 'panel' }, h('h2', {}, 'Kopia do pliku'), h('p', { class: 'muted' }, `Ostatnia: ${Store.state.meta.lastExport ? fmtDateTime(Store.state.meta.lastExport) : 'nigdy'}`),
            btn('Zapisz kopię wszystkich danych', { kind: 'primary', icon: 'shield', onClick: (e) => busy(e.currentTarget, async () => { const n = await Store.exportBackup(); toast(`Zapisano ${n}`, 'success'); }) })),
          h('section', { class: 'panel' }, h('h2', {}, 'Przywróć z pliku'), h('p', { class: 'muted' }, 'Zastępuje wszystkie dane zawartością kopii (np. przeniesienie na inny komputer). Bieżący stan trafi do migawki „przed przywróceniem”.'),
            h('div', { class: 'inline' }, file, adminOnly(btn('Przywróć', { kind: 'danger', icon: 'upload', onClick: (e) => busy(e.currentTarget, async () => {
              if (!file.files[0]) { toast('Wybierz plik kopii (.json)', 'error'); return; }
              if (!(await confirmBox({ title: 'Przywrócić dane z pliku?', message: 'Wszystkie obecne dane zostaną zastąpione zawartością kopii.', ok: 'Przywróć', danger: true }))) return;
              await Store.importBackup(file.files[0]); toast('Przywrócono dane z kopii', 'success');
            }) }))))),
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Migawki wewnętrzne'), btn('Utwórz migawkę', { small: true, icon: 'layers', onClick: async () => { await Store.snapshot('manual'); toast('Utworzono migawkę', 'success'); paint(); } })),
          keys.length ? h('ul', { class: 'snaps' }, keys.map((k) => { const [ts, kind] = k.split('|'); return h('li', {}, h('span', {}, h('strong', {}, fmtDateTime(ts)), h('small', {}, KIND[kind] || kind)),
            isAdmin() ? btn('Przywróć', { small: true, onClick: async () => { if (!(await confirmBox({ title: 'Przywrócić migawkę?', message: `Dane wrócą do stanu z ${fmtDateTime(ts)}.`, ok: 'Przywróć', danger: true }))) return; await Store.restoreSnapshot(k); toast('Przywrócono migawkę', 'success'); } }) : null); })) : h('p', { class: 'muted' }, 'Brak migawek.')),
      ];
    },
    company: () => adminOnly(formOf([
      ['name', 'Nazwa na dokumentach', { req: true }], ['legal_name', 'Pełna nazwa (stopka)', { req: true }], ['street', 'Ulica', { req: true }],
      ['postal_code', 'Kod pocztowy', { req: true, cls: 'c3', check: (v) => (isValidPostal(v) ? null : 'Format 00-000') }], ['city', 'Miejscowość', { req: true, cls: 'c3' }],
      ['nip', 'NIP', { req: true, cls: 'c4', check: (v) => (isValidNip(v) ? null : 'Nieprawidłowy NIP') }], ['regon', 'REGON', { cls: 'c4' }], ['krs', 'KRS', { cls: 'c4' }],
      ['court', 'Sąd rejestrowy', { cls: 'c12', max: 300 }], ['share_capital', 'Kapitał zakładowy'], ['correspondence_address', 'Adres do korespondencji'], ['website', 'Strona www'],
    ], Store.state.settings.company, (v) => Store.commit((st) => { st.settings.company = { ...st.settings.company, ...v, nip: normNip(v.nip) }; }, { action: 'settings', entity: 'settings', summary: 'Zmieniono dane firmy' }))),
    numbering: () => adminOnly(h('div', { class: 'stack' }, ...['zlecenie', 'zamowienie'].map((t) => h('div', {}, h('h2', {}, DOC_TYPES[t].plural), formOf([
      ['pattern', 'Wzór numeru', { req: true, help: '{SEQ} numer, {MM} miesiąc, {YYYY} rok, {YY} rok 2-cyfrowy', check: validatePattern, max: 50 }],
      ['digits', 'Cyfr w numerze', { num: true, req: true, cls: 'c3', check: (v) => (v >= 1 && v <= 8 ? null : '1–8') }],
      ['reset', 'Numeracja od 1', { select: [['monthly', 'co miesiąc'], ['yearly', 'co rok']], cls: 'c3' }],
    ], Store.state.settings.numbering[t], (v) => Store.commit((st) => { st.settings.numbering[t] = v; }, { action: 'settings', entity: 'settings', summary: `Zmieniono numerację: ${DOC_TYPES[t].plural}` })))))),
    defaults: () => adminOnly(formOf([
      ['issue_place', 'Miejsce wystawienia', { req: true }], ['payment_days', 'Termin płatności [dni]', { num: true, req: true, cls: 'c3', check: (v) => (v >= 0 && v <= 365 ? null : '0–365') }],
      ['payment_method', 'Metoda płatności (zamówienia)', { req: true }],
      ['payment_text', 'Tekst płatności na zleceniu', { req: true, help: '{days} = liczba dni', check: (v) => (v.includes('{days}') ? null : 'Tekst musi zawierać {days}') }],
      ['units', 'Jednostki cen zleceń (po przecinku)', { list: true, req: true, cls: 'c12' }], ['order_units', 'Jednostki zamówień (po przecinku)', { list: true, req: true, cls: 'c12' }],
    ], Store.state.settings.defaults, (v) => Store.commit((st) => { st.settings.defaults = { ...st.settings.defaults, ...v }; }, { action: 'settings', entity: 'settings', summary: 'Zmieniono wartości domyślne' }))),
    users: () => {
      const ROLE = { admin: 'Administrator', user: 'Użytkownik', viewer: 'Podgląd' };
      const edit = (u) => {
        const name = inp({ value: u?.name || '', maxlength: 80 });
        const role = h('select', {}, Object.entries(ROLE).map(([k, l]) => h('option', { value: k, selected: (u?.role || 'user') === k }, l)));
        const pin = inp({ type: 'password', inputmode: 'numeric', maxlength: 12, placeholder: u?.pin ? 'bez zmian' : 'opcjonalnie, 4–12 cyfr' });
        const active = h('input', { type: 'checkbox', checked: u ? u.active : true });
        const g = h('div', { class: 'form-grid' }, field({ label: 'Imię i nazwisko', name: 'name', control: name, required: true, cls: 'c12' }), field({ label: 'Rola', name: 'role', control: role, cls: 'c6' }),
          field({ label: 'PIN', name: 'pin', control: pin, cls: 'c6', help: 'PIN chroni profil przed pomyłką, nie zastępuje hasła systemowego.' }), h('label', { class: 'check c12' }, active, 'Profil aktywny'));
        modal({ title: u ? 'Edycja profilu' : 'Nowy profil', size: 'sm', build: (close) => {
          const save = h('button', { type: 'submit', class: 'btn primary' }, 'Zapisz');
          return { body: g, footer: [btn('Anuluj', { onClick: () => close() }), save], submit: () => busy(save, async () => {
            const e = [];
            if (name.value.trim().length < 3) e.push({ field: 'name', message: 'Min. 3 znaki' });
            if (pin.value && !/^\d{4,12}$/.test(pin.value)) e.push({ field: 'pin', message: '4–12 cyfr' });
            if (u?.id === Session.userId && (role.value !== 'admin' || !active.checked) && u.role === 'admin') e.push({ field: 'role', message: 'Nie możesz odebrać sobie roli administratora' });
            if (e.length) { setErrors(g, e); return; }
            const pinHash = pin.value ? await sha256Hex(`gri:${pin.value}`) : u?.pin || null;
            await Store.commit((st) => {
              const v = { name: name.value.trim(), role: role.value, active: active.checked, pin: pinHash };
              if (u) Object.assign(st.users.find((x) => x.id === u.id), v); else st.users.push({ id: uid(), ...v });
            }, { action: u ? 'update' : 'create', entity: 'user', summary: `${u ? 'Zmieniono' : 'Dodano'} profil ${name.value.trim()}` });
            toast('Zapisano profil', 'success'); close(); paint();
          }) };
        } });
      };
      return adminOnly(h('div', { class: 'stack' },
        h('div', { class: 'callout info' }, h('div', {}, h('strong', {}, 'Profile użytkowników'), h('p', {}, 'Profil podpisuje operacje w historii. Wersja HTML działa na jednym komputerze; do pracy wielu osób jednocześnie na wspólnych danych służy wersja serwerowa GenResInvest (instalator Windows).'))),
        h('div', { class: 'panel-head' }, h('span', {}), btn('Nowy profil', { kind: 'primary', icon: 'plus', onClick: () => edit(null) })),
        h('div', { class: 'table-wrap' }, h('table', { class: 'grid-table' }, h('thead', {}, h('tr', {}, ['Profil', 'Rola', 'PIN', 'Status', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, Store.state.users.map((u) => h('tr', {}, h('td', { class: 'strong', 'data-l': 'Profil' }, u.name), h('td', { 'data-l': 'Rola' }, ROLE[u.role]), h('td', { 'data-l': 'PIN' }, u.pin ? 'ustawiony' : '—'),
            h('td', { 'data-l': 'Status' }, h('span', { class: `tag ${u.active ? 'issued' : 'neutral'}` }, u.active ? 'aktywny' : 'wyłączony')), h('td', { class: 'acts' }, btn('', { kind: 'ghost icon-only', icon: 'edit', title: 'Edytuj', onClick: () => edit(u) })))))))));
    },
    about: () => h('section', { class: 'panel about' },
      h('img', { src: `data:image/png;base64,${ASSETS.logo}`, alt: 'ResInvest Commodities', class: 'about-logo' }),
      h('h2', {}, `GenResInvest ${BUILD.version}`), h('p', {}, 'Generator zleceń i zamówień na papierze firmowym ResInvest Commodities PL S.A.'),
      h('dl', { class: 'dl' }, h('dt', {}, 'Wersja'), h('dd', {}, `${BUILD.version} (build ${BUILD.hash}, ${BUILD.date})`), h('dt', {}, 'Tryb'), h('dd', {}, 'Program w jednym pliku HTML — działa bez internetu i bez instalacji'),
        h('dt', {}, 'Biblioteki'), h('dd', {}, 'jsPDF (MIT), fflate (MIT), czcionki Liberation Sans (SIL OFL 1.1)'), h('dt', {}, 'Autor'), h('dd', {}, 'Program stworzony przez Roesner Mateusz dla ResInvest Commodities')),
      h('p', { class: 'muted small' }, 'Skróty: Ctrl+K szukaj i polecenia · Alt+N nowe zlecenie · Alt+M nowe zamówienie · Ctrl+S zapis · Enter następne pole')),
  };
  const paint = async () => {
    head.replaceChildren(tabs(TABS.map(([k, l]) => [k, l]), cur, (k) => { cur = k; sessionStorage.setItem('gri-set', k); paint(); }));
    const content = await views[cur]();
    body.replaceChildren(...[content].flat());
  };
  mount(main, h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Ustawienia i dane'), h('p', { class: 'sub' }, 'Kopie zapasowe, dane firmy, numeracja, profile.'))), head, body);
  paint();
  return null;
};
