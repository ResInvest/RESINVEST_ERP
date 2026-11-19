// Karta dokumentu: dokument w podglądzie, akcje (wystaw, korekta, anuluj, duplikuj, usuń, PDF, DOCX),
// historia rewizji z porównaniem zmian.

const KIND_PL = { issue: 'Wystawienie', correction: 'Korekta', cancel: 'Anulowanie' };

function changesTable(changes) {
  const entries = Object.entries(changes || {});
  if (!entries.length) return null;
  return h('table', { class: 'changes' }, h('thead', {}, h('tr', {}, h('th', {}, 'Pole'), h('th', {}, 'Było'), h('th', {}, 'Jest'))),
    h('tbody', {}, entries.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', { class: 'was' }, String(v.before ?? '') || '—'), h('td', { class: 'now' }, String(v.after ?? '') || '—')))));
}

VIEWS.detail = (main, [id]) => {
  const draw = () => {
    const doc = Docs.get(id);
    main.replaceChildren();
    if (!doc) { mount(main, emptyState('Nie znaleziono dokumentu', 'Mógł zostać usunięty jako szkic.', h('a', { class: 'btn', href: '#/' }, 'Pulpit'))); return; }
    const T = DOC_TYPES[doc.type];
    const party = docParty(doc);
    const model = buildDocModel(doc);
    const actions = [];
    const dl = (fmt, kind = '') => btn(fmt.toUpperCase(), { kind, icon: fmt === 'pdf' ? 'pdf' : 'file', title: `Pobierz ${fmt.toUpperCase()}`, onClick: (e) => busy(e.currentTarget, async () => { const n = await exportDoc(Docs.get(id), fmt); toast(`Pobrano ${n}`, 'success'); }) });
    actions.push(dl('pdf', doc.status === 'draft' ? '' : 'primary'), dl('docx'));
    if (canEdit()) {
      if (doc.status === 'draft') {
        actions.unshift(btn('Wystaw', { kind: 'primary', icon: 'check', onClick: (e) => busy(e.currentTarget, async () => {
          const errs = validateDoc(doc.type, doc.data);
          if (errs.length) { toast(`Uzupełnij dane przed wystawieniem: ${errs[0].message}`, 'error'); go(`/dok/${id}/edycja`); return; }
          if (!(await confirmBox({ title: `Wystawić ${T.label.toLowerCase()}?`, message: 'Dokument otrzyma kolejny numer. Dalsze zmiany będą możliwe tylko jako korekta z podaniem powodu.', ok: 'Wystaw i pobierz PDF' }))) return;
          const r = await Docs.issue(id);
          toast(`Wystawiono ${r.number}`, 'success');
          await exportDoc(Docs.get(id), 'pdf');
        }) }));
        actions.push(h('a', { class: 'btn', href: `#/dok/${id}/edycja` }, icon('edit'), h('span', {}, 'Edytuj')));
        actions.push(btn('Usuń szkic', { kind: 'ghost danger', icon: 'trash', onClick: async () => {
          if (!(await confirmBox({ title: 'Usunąć szkic?', message: 'Szkic zostanie usunięty. Wpis o usunięciu zostanie w historii operacji.', ok: 'Usuń', danger: true }))) return;
          try { await Docs.remove(id); toast('Usunięto szkic', 'success'); go(`/${T.route}`); } catch (err) { toast(err.message, 'error'); }
        } }));
      }
      if (doc.status === 'issued') {
        actions.push(h('a', { class: 'btn', href: `#/dok/${id}/edycja` }, icon('edit'), h('span', {}, 'Korekta')));
        actions.push(btn('Anuluj', { kind: 'ghost danger', icon: 'ban', onClick: async () => {
          const reason = await reasonBox({ title: `Anulowanie ${doc.number}`, label: 'Powód anulowania', ok: 'Anuluj dokument', danger: true });
          if (!reason) return;
          try { await Docs.cancel(id, reason); toast('Dokument anulowany', 'success'); } catch (err) { toast(err.message, 'error'); }
        } }));
      }
      actions.push(btn('Duplikuj', { kind: 'ghost', icon: 'copy', title: 'Nowy szkic na podstawie tego dokumentu', onClick: async () => {
        try { const r = await Docs.duplicate(id); toast('Utworzono nowy szkic', 'success'); go(`/dok/${r.id}/edycja`); } catch (err) { toast(err.message, 'error'); }
      } }));
    }
    const audit = Store.state.audit.filter((a) => a.entityId === id);
    const paperWrap = h('div', { class: 'paper-wrap static' }, h('div', { class: 'paper-scale' }, renderPaper(model)));
    const facts = doc.type === 'zlecenie'
      ? [['Pozycje', doc.data.items.length], ['Wartość netto', docTotal(doc) ? fmtMoney(docTotal(doc)) : 'bez ilości'], ['Termin załadunku', doc.data.loading_term], ['Płatność', `${doc.data.payment_days} dni`]]
      : [['Ilość', `${fmtQty(doc.data.quantity)} ${doc.data.unit}`], ['Cena netto', `${fmtMoney(doc.data.price)}/${doc.data.unit}`], ['Wartość netto', fmtMoney(docTotal(doc))], ['Obowiązuje do', fmtDate(doc.data.valid_until)]];
    mount(main, 
      h('header', { class: 'page-head' },
        h('div', {}, h('p', { class: 'crumb' }, h('a', { href: `#/${T.route}` }, T.plural), ` / ${docLabel(doc)}`),
          h('h1', {}, docLabel(doc)),
          h('p', { class: 'sub row' }, statusTag(doc.status), doc.revision > 1 ? h('span', { class: 'tag neutral' }, `Korekta nr ${doc.revision - 1}`) : null, h('span', {}, `${party.name} · ${doc.data.issue_place}, ${fmtDate(doc.data.issue_date)}`))),
        h('div', { class: 'row wrap' }, actions)),
      doc.status === 'cancelled' ? h('div', { class: 'callout danger' }, h('div', {}, h('strong', {}, `Anulowano ${fmtDateTime(doc.cancelledAt)}`), h('p', {}, `Powód: ${doc.cancelReason}`))) : null,
      doc.status === 'draft' ? h('div', { class: 'callout info' }, h('div', {}, h('strong', {}, 'Szkic bez numeru'), h('p', {}, 'Dokument ma znak wodny „PROJEKT”. Wystaw go, aby nadać numer.'))) : null,
      h('section', { class: 'facts' }, facts.map(([l, v]) => h('div', {}, h('span', {}, l), h('strong', {}, String(v))))),
      h('div', { class: 'detail' },
        paperWrap,
        h('aside', { class: 'panel timeline-panel' }, h('h2', {}, 'Historia dokumentu'),
          h('ol', { class: 'timeline' },
            h('li', {}, h('strong', {}, 'Utworzenie szkicu'), h('small', {}, `${fmtDateTime(doc.created)} · ${doc.createdBy}`)),
            doc.revisions.map((r) => h('li', { class: `k-${r.kind}` }, h('strong', {}, `${KIND_PL[r.kind]}${r.kind === 'correction' ? ` nr ${r.revision - 1}` : ''}`),
              h('small', {}, `${fmtDateTime(r.at)} · ${r.by}`), r.reason ? h('p', {}, r.reason) : null))),
          audit.length ? h('details', {}, h('summary', {}, `Dziennik operacji (${audit.length})`),
            h('ul', { class: 'audit-mini' }, audit.map((a) => h('li', {}, h('span', {}, a.summary), h('small', {}, `${fmtDateTime(a.ts)} · ${a.user}`), a.changes ? changesTable(a.changes) : null)))) : null)));
    requestAnimationFrame(() => {
      const host = $('.paper-scale', paperWrap); const p = host?.firstElementChild;
      if (!p) return;
      const scale = Math.min(1, (paperWrap.clientWidth - 24) / 794);
      host.style.setProperty('--scale', scale); host.style.height = `${p.offsetHeight * scale}px`;
    });
  };
  draw();
  return Store.onChange(draw);
};
