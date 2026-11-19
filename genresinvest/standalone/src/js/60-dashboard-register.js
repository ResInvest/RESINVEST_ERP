// Pulpit (stan miesiąca, wykres 12 miesięcy, szkice, kopie) i rejestry zleceń / zamówień.

function monthKey(iso) { return iso.slice(0, 7); }

VIEWS.dashboard = (main) => {
  const st = Store.state;
  const now = new Date();
  const mk = monthKey(todayISO());
  const issuedThisMonth = (type) => st.documents.filter((d) => d.type === type && d.status !== 'draft' && d.status !== 'cancelled' && monthKey(d.data.issue_date) === mk);
  const zl = issuedThisMonth('zlecenie');
  const za = issuedThisMonth('zamowienie');
  const zaValue = za.reduce((a, d) => a + (docTotal(d) || 0), 0);
  const drafts = st.documents.filter((d) => d.status === 'draft');
  const firstName = Session.user.name.split(' ')[0];

  // 12 miesięcy: liczba wystawionych dokumentów wg typu
  const months = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MONTHS[d.getMonth()].slice(0, 3) }); }
  for (const m of months) {
    m.zl = st.documents.filter((d) => d.type === 'zlecenie' && d.status === 'issued' && monthKey(d.data.issue_date) === m.key).length;
    m.za = st.documents.filter((d) => d.type === 'zamowienie' && d.status === 'issued' && monthKey(d.data.issue_date) === m.key).length;
  }
  const max = Math.max(1, ...months.map((m) => m.zl + m.za));
  const W = 600; const H = 150; const bw = W / 12;
  const chart = s('svg', { viewBox: `0 0 ${W} ${H + 22}`, class: 'chart', role: 'img', 'aria-label': 'Wystawione dokumenty w ostatnich 12 miesiącach' },
    ...months.flatMap((m, i) => {
      const x = i * bw + bw * 0.22; const w = bw * 0.56;
      const hz = (m.zl / max) * H; const ha = (m.za / max) * H;
      const t = s('title'); t.textContent = `${m.label}: zlecenia ${m.zl}, zamówienia ${m.za}`;
      return [
        s('rect', { x, y: H - hz, width: w, height: Math.max(hz, 0.0001), rx: 2, class: 'bar-zl' }, t),
        s('rect', { x, y: H - hz - ha, width: w, height: Math.max(ha, 0.0001), rx: 2, class: 'bar-za' }),
        (() => { const tx = s('text', { x: x + w / 2, y: H + 16, 'text-anchor': 'middle', class: 'chart-l' }); tx.textContent = m.label; return tx; })(),
      ];
    }),
    s('line', { x1: 0, x2: W, y1: H + 0.5, y2: H + 0.5, class: 'chart-axis' }));

  const lastExport = st.meta.lastExport;
  const exportAge = lastExport ? (Date.now() - new Date(lastExport).getTime()) / 864e5 : Infinity;
  const backupNote = exportAge > 7 ? h('div', { class: 'callout warn' },
    h('div', {}, h('strong', {}, lastExport ? `Ostatnia kopia do pliku: ${fmtDate(lastExport.slice(0, 10))}` : 'Nie zapisano jeszcze kopii danych do pliku'),
      h('p', {}, 'Dane są w tej przeglądarce. Zapisuj kopię do pliku co tydzień (np. na dysk sieciowy), żeby nie stracić ich przy czyszczeniu przeglądarki lub awarii komputera.')),
    btn('Zapisz kopię teraz', { kind: 'primary', icon: 'shield', onClick: (e) => busy(e.currentTarget, async () => { const n = await Store.exportBackup(); toast(`Zapisano kopię ${n}`, 'success'); go('/'); route(); }) })) : null;

  const docRow = (d) => h('a', { class: 'doc-row', href: `#/dok/${d.id}` },
    h('span', { class: `doc-type t-${d.type}` }, icon(d.type === 'zlecenie' ? 'truck' : 'cart', 16)),
    h('span', { class: 'doc-main' }, h('strong', {}, docLabel(d)), h('small', {}, `${docParty(d).name || '—'} · ${docSummary(d)}`)),
    statusTag(d.status), h('span', { class: 'doc-date' }, fmtDate(d.data.issue_date)));

  mount(main, 
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, `Dzień dobry, ${firstName}`), h('p', { class: 'sub' }, `${now.getDate()} ${MONTHS_GEN[now.getMonth()]} ${now.getFullYear()}`)),
      canEdit() ? h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/zamowienia/nowe' }, icon('cart'), h('span', {}, 'Nowe zamówienie')), h('a', { class: 'btn primary', href: '#/zlecenia/nowe' }, icon('truck'), h('span', {}, 'Nowe zlecenie'))) : null),
    backupNote,
    h('section', { class: 'kpis', 'aria-label': 'Ten miesiąc' },
      h('div', { class: 'kpi' }, h('span', { class: 'kpi-l' }, 'Zlecenia wystawione w tym miesiącu'), h('span', { class: 'kpi-v' }, String(zl.length))),
      h('div', { class: 'kpi' }, h('span', { class: 'kpi-l' }, 'Zamówienia wystawione w tym miesiącu'), h('span', { class: 'kpi-v' }, String(za.length))),
      h('div', { class: 'kpi' }, h('span', { class: 'kpi-l' }, 'Wartość zamówień netto (wg ilości bazowej)'), h('span', { class: 'kpi-v money' }, fmtMoney(zaValue))),
      h('div', { class: 'kpi' }, h('span', { class: 'kpi-l' }, 'Szkice do wystawienia'), h('span', { class: 'kpi-v' }, String(drafts.length)))),
    h('div', { class: 'split-2' },
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Ostatnie dokumenty'), h('a', { href: '#/zlecenia', class: 'link' }, 'Rejestr')),
        st.documents.length ? h('div', { class: 'doc-list' }, [...st.documents].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 7).map(docRow))
          : emptyState('Nie ma jeszcze dokumentów', 'Wystaw pierwsze zlecenie albo zamówienie — kontrahenci i słowniki ze wzorów są już wczytane.', canEdit() ? h('a', { class: 'btn primary', href: '#/zlecenia/nowe' }, 'Nowe zlecenie') : null)),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Wystawione w ostatnich 12 miesiącach'),
        h('span', { class: 'legend' }, h('i', { class: 'lg-zl' }), 'zlecenia', h('i', { class: 'lg-za' }), 'zamówienia')), chart)),
    drafts.length ? h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Szkice czekające na wystawienie')), h('div', { class: 'doc-list' }, drafts.slice(0, 6).map(docRow))) : null,
    h('p', { class: 'hint-line' }, h('kbd', {}, 'Ctrl K'), ' szukaj i polecenia', h('kbd', {}, 'Alt N'), ' nowe zlecenie', h('kbd', {}, 'Alt M'), ' nowe zamówienie'));
};

// --- Rejestr dokumentów -------------------------------------------------------------------------
VIEWS.register = (main, [routeName]) => {
  const type = routeName === 'zlecenia' ? 'zlecenie' : 'zamowienie';
  const T = DOC_TYPES[type];
  const key = `gri-reg-${type}`;
  let f = { q: '', status: '', from: '', to: '', contractor: '', page: 1 };
  try { f = { ...f, ...JSON.parse(sessionStorage.getItem(key) || '{}') }; } catch { /* */ }
  const q = inp({ type: 'search', value: f.q, placeholder: type === 'zlecenie' ? 'Numer, kontrahent, trasa, usługa…' : 'Numer, sprzedający, przedmiot, miejsce…', 'aria-label': 'Szukaj' });
  const status = h('select', { 'aria-label': 'Status' }, [['', 'Wszystkie statusy'], ['draft', 'Szkice'], ['issued', 'Wystawione'], ['cancelled', 'Anulowane']].map(([v, l]) => h('option', { value: v, selected: f.status === v }, l)));
  const from = inp({ type: 'date', value: f.from, 'aria-label': 'Data od' });
  const to = inp({ type: 'date', value: f.to, 'aria-label': 'Data do' });
  const contractor = h('select', { 'aria-label': 'Kontrahent' }, h('option', { value: '' }, 'Wszyscy kontrahenci'),
    Store.state.contractors.filter((c) => Store.state.documents.some((d) => d.type === type && d.data.contractorId === c.id)).map((c) => h('option', { value: c.id, selected: f.contractor === c.id }, c.name)));
  const body = h('div', {});
  const periodChip = (label, fn) => h('button', { type: 'button', class: 'chip', onclick: () => { [from.value, to.value] = fn(); f.page = 1; draw(); } }, label);
  const now = new Date();

  const filtered = () => Store.state.documents.filter((d) => d.type === type
    && (!status.value || d.status === status.value)
    && (!contractor.value || d.data.contractorId === contractor.value)
    && (!from.value || d.data.issue_date >= from.value) && (!to.value || d.data.issue_date <= to.value)
    && matches(q.value, d.number, docParty(d).name, docParty(d).nip, docSummary(d), d.data.service_short, d.data.subject, d.data.pickup, d.data.loading_term))
    .sort((a, b) => (b.data.issue_date.localeCompare(a.data.issue_date)) || b.created.localeCompare(a.created));

  function draw() {
    Object.assign(f, { q: q.value, status: status.value, from: from.value, to: to.value, contractor: contractor.value });
    sessionStorage.setItem(key, JSON.stringify(f));
    const rows = filtered();
    const per = 30;
    const pageRows = rows.slice((f.page - 1) * per, f.page * per);
    const sum = rows.filter((d) => d.status === 'issued').reduce((a, d) => a + (docTotal(d) || 0), 0);
    body.replaceChildren(
      rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Numer'), h('th', {}, 'Status'), h('th', {}, 'Data'), h('th', {}, T.partyRole),
          h('th', {}, type === 'zlecenie' ? 'Usługa i ceny netto' : 'Przedmiot, ilość, cena'), h('th', { class: 'num' }, 'Wartość netto'))),
        h('tbody', {}, pageRows.map((d) => h('tr', { tabindex: '0', class: 'click', onclick: () => go(`/dok/${d.id}`), onkeydown: (e) => { if (e.key === 'Enter') go(`/dok/${d.id}`); } },
          h('td', { 'data-l': 'Numer', class: 'strong' }, docLabel(d), d.revision > 1 ? h('span', { class: 'tag neutral', title: 'Liczba korekt' }, `K${d.revision - 1}`) : null),
          h('td', { 'data-l': 'Status' }, statusTag(d.status)),
          h('td', { 'data-l': 'Data', class: 'nowrap' }, fmtDate(d.data.issue_date)),
          h('td', { 'data-l': T.partyRole }, docParty(d).name),
          h('td', { 'data-l': 'Opis', class: 'clip' }, h('span', {}, type === 'zlecenie' ? d.data.service_short : d.data.subject), h('small', {}, docSummary(d))),
          h('td', { 'data-l': 'Wartość', class: 'num' }, docTotal(d) ? fmtMoney(docTotal(d)) : '—')))),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 5 }, 'Suma wartości wystawionych (z podaną ilością)'), h('td', { class: 'num' }, fmtMoney(sum))))))
        : emptyState(Store.state.documents.some((d) => d.type === type) ? 'Brak dokumentów spełniających kryteria' : `Nie ma jeszcze ${type === 'zlecenie' ? 'zleceń' : 'zamówień'}`,
          Store.state.documents.some((d) => d.type === type) ? 'Zmień filtry lub wyczyść wyszukiwanie.' : null,
          canEdit() ? h('a', { class: 'btn primary', href: `#/${T.route}/nowe` }, icon('plus'), h('span', {}, `Nowe ${T.label.toLowerCase()}`)) : null),
      pager(rows.length, f.page, per, (p) => { f.page = p; draw(); window.scrollTo(0, 0); }));
  }

  const exportCsv = () => {
    const rows = filtered();
    const headers = type === 'zlecenie'
      ? ['Numer', 'Status', 'Rewizja', 'Data', 'Miejsce', 'Zleceniobiorca', 'NIP', 'Krótki opis usługi', 'Towar', 'Pozycje cenowe', 'Wartość netto', 'Płatność [dni]', 'Termin załadunku', 'Prowadzi', 'Powód anulowania']
      : ['Numer', 'Status', 'Rewizja', 'Data', 'Miejsce', 'Sprzedający', 'NIP', 'Przedmiot', 'Ilość', 'Tolerancja %', 'Jednostka', 'Cena netto', 'Wartość netto', 'Obowiązuje do', 'Miejsce odbioru', 'Płatność [dni]', 'Metoda płatności', 'Powód anulowania'];
    const data = rows.map((d) => {
      const p = docParty(d); const x = d.data;
      const common = [d.number || 'szkic', STATUS[d.status], d.revision, x.issue_date, x.issue_place, p.name, p.nip || ''];
      return type === 'zlecenie'
        ? [...common, x.service_short, x.cargo, x.items.map((i) => `${i.route}: ${moneyInput(i.amount)} ${i.unit}${i.qty ? ` x ${qtyInput(i.qty)}` : ''}`).join('; '), moneyInput(docTotal(d)), x.payment_days, x.loading_term, x.handler_name, d.cancelReason || '']
        : [...common, x.subject, qtyInput(x.quantity), x.tolerance, x.unit, moneyInput(x.price), moneyInput(docTotal(d)), x.valid_until, x.pickup, x.payment_days, x.payment_method, d.cancelReason || ''];
    });
    csvDownload(`Rejestr_${T.plural}_${todayISO()}.csv`, headers, data);
    toast(`Wyeksportowano ${data.length} pozycji do CSV`, 'success');
  };

  mount(main, 
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, T.plural), h('p', { class: 'sub' }, type === 'zlecenie' ? 'Zlecenia przewozu i usług dla Zleceniobiorców' : 'Zamówienia towaru u Sprzedających')),
      h('div', { class: 'row' }, btn('Eksport CSV', { icon: 'download', onClick: exportCsv }),
        canEdit() ? h('a', { class: 'btn primary', href: `#/${T.route}/nowe` }, icon('plus'), h('span', {}, `Nowe ${T.label.toLowerCase()}`)) : null)),
    h('section', { class: 'filters', role: 'search' },
      h('div', { class: 'f-search' }, icon('search', 16), q), status, contractor, from, to,
      h('div', { class: 'chips' },
        periodChip('Ten miesiąc', () => [todayISO(new Date(now.getFullYear(), now.getMonth(), 1)), todayISO()]),
        periodChip('Poprzedni miesiąc', () => [todayISO(new Date(now.getFullYear(), now.getMonth() - 1, 1)), todayISO(new Date(now.getFullYear(), now.getMonth(), 0))]),
        periodChip('Ten rok', () => [`${now.getFullYear()}-01-01`, todayISO()]),
        periodChip('Wszystko', () => ['', '']))),
    body);
  q.addEventListener('input', debounce(() => { f.page = 1; draw(); }, 150));
  for (const el of [status, from, to, contractor]) el.addEventListener('change', () => { f.page = 1; draw(); });
  draw();
  q.focus();
  return Store.onChange(draw);
};
