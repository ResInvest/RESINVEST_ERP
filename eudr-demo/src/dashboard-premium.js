/* dashboard-premium.js */
/* =========================================================================
   ResInvest ERP 3.12 (demo EUDR) — Pulpit: obrót miesiąca (premium)
   * „Zakupy od firm” i „Sprzedaż” — dwie karty obok siebie; kliknięcie otwiera
     pełny widok: kontrahenci (rozwijani) i ich transakcje w MP, m³ i t,
   * „Lasy Państwowe” — tabela miesiąca: nadleśnictwo → leśnictwo → transakcje,
     rozwijana wierszami albo w całości,
   * „Rejestr ilości” — sumy miesięcy (MP · m³ · t) dla trzech zestawień.
   Widok dekoruje istniejący pulpit (Views.pulpit) — nie zmienia jego kodu.
   Liczby: R.TradeStats (te same pola operacji co ewidencja obrotu i raporty).
   ========================================================================= */
(function (root) {
  "use strict";
  const UI = root.RIWUI;
  const { R, t, tp, esc, $, $$, ic, Store, App, Views, Modal, Tip, toCSV, csvNum, download } = UI;
  const { fmt, fmtQ, money, Dates } = R;
  const TS = R.TradeStats;
  const th = s => esc(t(s));

  /* ---------------- filtr: miesiąc, zakres magazynów, grupa produktów ---------------- */
  function filter() {
    const f = App.tabs.prem || (App.tabs.prem = { ym: Dates.ym(App.today()), scope: "wh", cat: "all" });
    if (!Dates.isYM(f.ym)) f.ym = Dates.ym(App.today());
    return f;
  }
  function whIds(f) {
    const u = App.user();
    if (f.scope === "wh") return [App.wh().id];
    const acc = R.whAccess(u);
    return acc === null ? Store.state.warehouses.map(w => w.id) : acc;
  }
  const scopeLabel = f => f.scope === "wh" ? App.wh().name : t("wszystkie dostępne magazyny");
  const data = f => TS.dashboard(Store.state, f.ym, { whIds: whIds(f), cat: f.cat }, 6);

  /* ---------------- liczby ---------------- */
  const q = (v, d = 1) => v === null || v === undefined ? "—" : fmtQ(v, d);
  const star = (sum, k) => sum.partial[k] ? `<sup title="${th("Suma niepełna — część produktów nie ma przelicznika na tę miarę")}">*</sup>` : "";
  const tCell = r => r.t === null ? "—" : `${esc(fmtQ(r.t, 2))}${r.tSource === "waga" ? ` <span class="obr-w" title="${th("Waga rzeczywista (kwit wagowy / waga ręczna / wagony)")}">⚖</span>` : r.tSource === "przelicznik" ? ` <span class="dim" title="${th("Orientacyjnie z przelicznika produktu")}">≈</span>` : ""}`;
  const unitL = u => u === "m3" ? "m³" : u;
  const triple = s => `<div class="obr-tot">
      <div><b>${esc(q(s.mp, 1))}${star(s, "mp")}</b><u>MP</u></div>
      <div><b>${esc(q(s.m3, 1))}${star(s, "m3")}</b><u>m³</u></div>
      <div><b>${esc(q(s.t, 1))}${star(s, "t")}</b><u>t</u></div></div>`;

  /** Kolumny miesięcy (t) — 6 słupków, bieżący wyróżniony. */
  function miniCols(reg, key, ym) {
    const W = 220, H = 58, pad = 14, max = Math.max(1, ...reg.map(m => m[key].t)), bw = (W - 8) / reg.length - 8;
    const bars = reg.map((m, i) => {
      const h = Math.max(m[key].t > 0 ? 2 : 0, (m[key].t / max) * (H - pad - 6)), x = 4 + i * ((W - 8) / reg.length) + 4;
      return `<rect x="${x}" y="${H - pad - h}" width="${bw}" height="${h}" rx="3" class="${m.ym === ym ? "on" : ""}" data-tip="${esc(`<b>${esc(Dates.label(m.ym))}</b><br>${esc(q(m[key].mp))} MP · ${esc(q(m[key].m3))} m³ · ${esc(q(m[key].t))} t<br>${esc(tp("{n} transakcja|{n} transakcje|{n} transakcji", m[key].count))}`)}"/>
        <text x="${x + bw / 2}" y="${H - 2}" text-anchor="middle">${esc(Dates.short(m.ym).split(" ")[0])}</text>`;
    }).join("");
    return `<svg class="obr-cols" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${th("Tony w ostatnich 6 miesiącach")}">${bars}</svg>`;
  }

  /** Karta (zakupy od firm / sprzedaż): sumy, najwięksi kontrahenci, 6 miesięcy; całość otwiera pełny widok. */
  function card(kind, D, f) {
    const meta = KINDS[kind], X = D[kind], top = X.groups.slice(0, 4), maxT = Math.max(1, ...top.map(g => g.sum.t || 0));
    return `<div class="obr-card obr-${kind}" id="obr-${kind}" data-obr="${kind}" role="button" tabindex="0" aria-label="${esc(t(meta.title))} — ${th("pokaż transakcje")}">
      <div class="obr-h"><span class="obr-i">${ic(meta.icon, 18)}</span><div class="obr-ti"><b>${th(meta.title)}</b><small>${esc(Dates.label(f.ym))} · ${esc(tp("{n} transakcja|{n} transakcje|{n} transakcji", X.sum.count))}</small></div><span class="obr-go">${th("Szczegóły")} ${ic("chevR", 14)}</span></div>
      ${triple(X.sum)}
      <div class="obr-val"><span>${th(meta.valueLabel)}</span><b>${esc(money(X.sum.value))}</b>${X.sum.tWeighed > 0 ? `<small>${esc(t("z wagi: {t} t", { t: fmtQ(X.sum.tWeighed, 1) }))}</small>` : ""}</div>
      ${top.length ? `<ul class="obr-top">${top.map(g => `<li><span class="nm" title="${esc(g.label)}">${esc(g.label)}</span><span class="bar"><i style="width:${Math.max(3, (g.sum.t || 0) / maxT * 100)}%"></i></span><span class="v">${esc(q(g.sum.mp, 0))} MP · ${esc(q(g.sum.t, 1))} t</span></li>`).join("")}</ul>` : `<div class="obr-empty">${th(meta.empty)}</div>`}
      <div class="obr-foot">${miniCols(D.register, kind === "firms" ? "firms" : "sales", f.ym)}</div></div>`;
  }

  /** Tabela transakcji (wspólna dla kart, lasów i pełnego widoku). */
  function txTable(rows, kind) {
    const sale = kind === "sales", forest = kind === "forest";
    return `<div class="tbl-wrap"><table class="tbl obr-tx"><thead><tr><th>${th("Data")}</th><th>${th("Nr dokumentu")}</th>${forest ? `<th>${th("Leśnictwo")}</th>` : ""}${sale ? `<th>${th("Miejsce dostawy")}</th>` : ""}<th>${th("Towar")}</th>
        <th class="r">${th("Ilość (dokument)")}</th><th class="r">MP</th><th class="r">m³</th><th class="r">${th("t / waga")}</th><th class="r">${th("Wartość")}</th><th>${th("Magazyn")}</th>${sale ? `<th>${th("Rodzaj")}</th>` : ""}</tr></thead><tbody>
      ${rows.map(r => `<tr class="clickable" data-open-op="${esc(r.opId)}"><td class="nowrap">${esc(Dates.pl(r.date))}</td><td class="mono nowrap">${esc(r.no)}${r.corrected ? ` <span class="badge warn">${th("kor.")}</span>` : ""}</td>
        ${forest ? `<td>${esc(r.lesnictwo || "—")}</td>` : ""}${sale ? `<td>${esc(r.place || "—")}</td>` : ""}<td>${esc(r.productName)}${r.produced ? `<div class="dim small">→ ${esc(r.produced.productName)} ${esc(fmtQ(r.produced.qty))} ${esc(unitL(r.produced.unit))}</div>` : ""}</td>
        <td class="r">${esc(fmtQ(r.qty))} ${esc(unitL(r.unit))}</td><td class="r">${esc(q(r.mp))}</td><td class="r">${esc(q(r.m3))}</td><td class="r">${tCell(r)}</td><td class="r">${esc(money(r.value))}</td><td>${esc(r.whName)}</td>
        ${sale ? `<td>${esc(t(SALE_MODES[r.mode]))}</td>` : ""}</tr>`).join("")}</tbody></table></div>`;
  }
  const sumCells = s => `<span class="r">${esc(q(s.mp))}${star(s, "mp")} MP</span><span class="r">${esc(q(s.m3))}${star(s, "m3")} m³</span><span class="r">${esc(q(s.t))}${star(s, "t")} t</span><span class="r">${esc(money(s.value))}</span>`;

  /** Grupy rozwijane: kontrahent (albo nadleśnictwo → leśnictwo) → transakcje. */
  function groups(list, kind, open) {
    if (!list.length) return `<div class="empty">${th(KINDS[kind].empty)}</div>`;
    return list.map(g => `<details class="obr-grp"${open ? " open" : ""}><summary><span class="nm">${ic("chevR", 14)} <b>${esc(g.label)}</b><small>${esc(tp("{n} transakcja|{n} transakcje|{n} transakcji", g.sum.count))}${g.groups ? " · " + esc(tp("{n} leśnictwo|{n} leśnictwa|{n} leśnictw", g.groups.length)) : ""}</small></span>${sumCells(g.sum)}</summary>
      <div class="obr-grp-b">${g.groups ? g.groups.map(s => `<details class="obr-grp sub"${open ? " open" : ""}><summary><span class="nm">${ic("chevR", 13)} ${th("Leśnictwo")} <b>${esc(s.label)}</b><small>${esc(tp("{n} transakcja|{n} transakcje|{n} transakcji", s.sum.count))}</small></span>${sumCells(s.sum)}</summary>${txTable(s.rows, kind)}</details>`).join("") : txTable(g.rows, kind)}</div></details>`).join("");
  }

  /** Lasy Państwowe — tabela miesiąca na pulpicie (rozwijana wierszami albo w całości). */
  function forestCard(D, f) {
    const X = D.forest;
    return `<div class="card obr-forest" id="obr-forest"><div class="card-h"><span class="obr-i sm">${ic("leaf", 16)}</span><h3>${th("Lasy Państwowe — zakupy z nadleśnictw")}</h3><span class="sub">${esc(Dates.label(f.ym))} · ${esc(tp("{n} transakcja|{n} transakcje|{n} transakcji", X.sum.count))}</span><span class="spacer"></span>
        <button class="btn sm ghost" type="button" data-obr-expand="1">${ic("layers", 13)} ${th("Rozwiń całość")}</button><button class="btn sm ghost" type="button" data-obr-expand="0">${th("Zwiń")}</button><button class="btn sm" type="button" data-obr="forest">${th("Pełny widok")}</button></div>
      <div class="card-b"><div class="obr-forest-sum">${triple(X.sum)}<div class="obr-val"><span>${th("Wartość zakupu")}</span><b>${esc(money(X.sum.value))}</b><small>${esc(tp("{n} nadleśnictwo|{n} nadleśnictwa|{n} nadleśnictw", X.groups.length))}</small></div>${miniCols(D.register, "forest", f.ym)}</div>
        <div class="obr-grp-head"><span>${th("Nadleśnictwo / leśnictwo")}</span><span class="r">MP</span><span class="r">m³</span><span class="r">t</span><span class="r">${th("Wartość")}</span></div>
        <div id="obr-forest-groups">${groups(X.groups, "forest", false)}</div></div></div>`;
  }

  /** Rejestr ilości miesięcy (MP · m³ · t); kliknięcie wiersza zmienia miesiąc pulpitu. */
  function registerCard(D, f) {
    const cell = s => `<td class="r">${esc(q(s.mp, 0))}</td><td class="r">${esc(q(s.m3, 0))}</td><td class="r b">${esc(q(s.t, 1))}</td>`;
    const tot = k => D.register.reduce((a, m) => ({ mp: R.rq(a.mp + m[k].mp), m3: R.rq(a.m3 + m[k].m3), t: R.rq(a.t + m[k].t) }), { mp: 0, m3: 0, t: 0 });
    return `<div class="card obr-reg" id="obr-register"><div class="card-h"><h3>${th("Rejestr ilości — ostatnie 6 miesięcy")}</h3><span class="sub">${esc(scopeLabel(f))}</span></div>
      <div class="tbl-wrap"><table class="tbl obr-reg-t"><thead><tr><th rowspan="2">${th("Miesiąc")}</th><th class="c grp" colspan="3">${th("Zakupy od firm")}</th><th class="c grp" colspan="3">${th("Lasy Państwowe")}</th><th class="c grp" colspan="3">${th("Sprzedaż")}</th></tr>
        <tr>${["MP", "m³", "t"].concat(["MP", "m³", "t"], ["MP", "m³", "t"]).map(u => `<th class="r">${u}</th>`).join("")}</tr></thead>
        <tbody>${D.register.slice().reverse().map(m => `<tr class="clickable${m.ym === f.ym ? " on" : ""}" data-obr-ym="${esc(m.ym)}"><td class="nowrap"><b>${esc(Dates.label(m.ym))}</b></td>${cell(m.firms)}${cell(m.forest)}${cell(m.sales)}</tr>`).join("")}</tbody>
        <tfoot><tr><td>${th("Razem 6 mies.")}</td>${["firms", "forest", "sales"].map(k => { const s = tot(k); return `<td class="r">${esc(q(s.mp, 0))}</td><td class="r">${esc(q(s.m3, 0))}</td><td class="r">${esc(q(s.t, 1))}</td>`; }).join("")}</tr></tfoot></table></div></div>`;
  }

  const KINDS = {
    firms: { title: "Zakupy od firm", icon: "inbox", valueLabel: "Wartość zakupu", empty: "Brak zakupów od firm w tym miesiącu.", csv: "zakupy-firmy" },
    sales: { title: "Sprzedaż", icon: "trend", valueLabel: "Wartość sprzedaży", empty: "Brak sprzedaży w tym miesiącu.", csv: "sprzedaz" },
    forest: { title: "Lasy Państwowe — zakupy z nadleśnictw", icon: "leaf", valueLabel: "Wartość zakupu", empty: "Brak zakupów z nadleśnictw w tym miesiącu.", csv: "zakupy-nadlesnictwa" }
  };
  const SALE_MODES = { WZ: "WZ z magazynu", BEZP: "bezpośrednia z lasu", LANCUCH: "zakup → produkcja → odbiorca" };

  function section(f) {
    const D = data(f), ymNow = Dates.ym(App.today());
    return `<section class="obr" id="obr"><div class="obr-bar"><div class="obr-bar-t"><h2>${th("Obrót miesiąca")}</h2><span>${esc(t("zakupy, sprzedaż i lasy · {w}", { w: scopeLabel(f) }))}</span></div>
        <div class="obr-ctl"><button class="icon-btn" type="button" data-obr-shift="-1" aria-label="${th("Poprzedni miesiąc")}">${ic("chevL", 16)}</button>
          <label class="sr-only" for="obr-ym">${th("Miesiąc")}</label><input class="ctrl sm" type="month" id="obr-ym" value="${esc(f.ym)}" max="${esc(ymNow)}">
          <button class="icon-btn" type="button" data-obr-shift="1" ${f.ym >= ymNow ? "disabled" : ""} aria-label="${th("Następny miesiąc")}">${ic("chevR", 16)}</button>
          <div class="seg" role="group" aria-label="${th("Magazyny")}"><button type="button" data-obr-scope="wh" aria-pressed="${f.scope === "wh"}">${th("Ten magazyn")}</button><button type="button" data-obr-scope="all" aria-pressed="${f.scope === "all"}">${th("Wszystkie")}</button></div>
          <label class="sr-only" for="obr-cat">${th("Produkty")}</label><select class="ctrl sm" id="obr-cat">${[["all", "Wszystkie produkty"], ["zrebka", "Zrębka"], ["drewno", "Drewno"], ["agro", "Produkty tonowe"]].map(([k, l]) => `<option value="${k}" ${f.cat === k ? "selected" : ""}>${th(l)}</option>`).join("")}</select></div></div>
      <div class="obr-grid">${card("firms", D, f)}${card("sales", D, f)}</div>
      ${forestCard(D, f)}
      ${registerCard(D, f)}</section>`;
  }

  /* ---------------- pełny widok (okno) ---------------- */
  /** Tekst do CSV: komórka zaczynająca się od = + - @ byłaby w arkuszu formułą — poprzedzona apostrofem. */
  const safeCell = v => { const s = String(v == null ? "" : v); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; };
  function csvOf(kind, X, f) {
    const sale = kind === "sales";
    const head = ["Data", "Nr dokumentu", sale ? "Odbiorca" : "Dostawca", ...(kind === "forest" ? ["Leśnictwo"] : []), ...(sale ? ["Miejsce dostawy", "Rodzaj"] : []), "Towar", "Ilość", "Jednostka", "MP", "m³ (ekw.)", "t", "Źródło tony", "Wartość zł", "Magazyn"];
    const x = safeCell;
    const rows = X.rows.map(r => [Dates.pl(r.date), x(r.no), x(sale ? r.buyerName : r.supplierName), ...(kind === "forest" ? [x(r.lesnictwo)] : []), ...(sale ? [x(r.place), t(SALE_MODES[r.mode])] : []), x(r.productName), csvNum(r.qty), unitL(r.unit), csvNum(r.mp), csvNum(r.m3), csvNum(r.t), r.tSource, csvNum(r.value), x(r.whName)]);
    download(`${KINDS[kind].csv}-${f.ym}.csv`, toCSV(head, rows), "text/csv;charset=utf-8");
  }
  function openDetail(kind) {
    const f = filter();
    let qtext = "", open = kind !== "forest" ? false : true;
    const body = () => {
      const D = data(f), X = D[kind], ql = qtext.toLowerCase();
      const flt = !ql ? X.groups : X.groups.map(g => {
        const hit = r => [r.no, r.productName, r.lesnictwo, r.place, g.label].join(" ").toLowerCase().includes(ql);
        if (g.groups) { const subs = g.groups.map(s => Object.assign({}, s, { rows: s.rows.filter(hit) })).filter(s => s.rows.length); return subs.length ? Object.assign({}, g, { groups: subs.map(s => Object.assign(s, { sum: TS.totals(s.rows) })), sum: TS.totals([].concat(...subs.map(s => s.rows))) }) : null; }
        const rows = g.rows.filter(hit); return rows.length ? Object.assign({}, g, { rows, sum: TS.totals(rows) }) : null;
      }).filter(Boolean);
      return `<div class="obr-dlg-bar"><button class="icon-btn" type="button" data-d-shift="-1" aria-label="${th("Poprzedni miesiąc")}">${ic("chevL", 16)}</button><b>${esc(Dates.label(f.ym))}</b><button class="icon-btn" type="button" data-d-shift="1" ${f.ym >= Dates.ym(App.today()) ? "disabled" : ""} aria-label="${th("Następny miesiąc")}">${ic("chevR", 16)}</button>
          <div class="field grow"><label class="sr-only" for="obr-q">${th("Szukaj")}</label><input class="ctrl sm" type="search" id="obr-q" placeholder="${th("Szukaj: kontrahent, dokument, towar, leśnictwo")}" value="${esc(qtext)}"></div>
          <button class="btn sm ghost" type="button" data-d-open="1">${th("Rozwiń wszystko")}</button><button class="btn sm ghost" type="button" data-d-open="0">${th("Zwiń")}</button><button class="btn sm" type="button" data-d-csv>${ic("dl", 13)} CSV</button></div>
        <div class="obr-kpis"><div><small>${th("Transakcje")}</small><b>${X.sum.count}</b></div><div><small>MP</small><b>${esc(q(X.sum.mp))}${star(X.sum, "mp")}</b></div><div><small>m³</small><b>${esc(q(X.sum.m3))}${star(X.sum, "m3")}</b></div>
          <div><small>${th("Tony")}</small><b>${esc(q(X.sum.t))}</b>${X.sum.tWeighed > 0 ? `<small>${esc(t("z wagi: {t} t", { t: fmtQ(X.sum.tWeighed, 1) }))}</small>` : ""}</div><div><small>${th(KINDS[kind].valueLabel)}</small><b>${esc(money(X.sum.value))}</b></div></div>
        <div class="obr-grp-head"><span>${th(kind === "sales" ? "Odbiorca" : kind === "forest" ? "Nadleśnictwo / leśnictwo" : "Dostawca")}</span><span class="r">MP</span><span class="r">m³</span><span class="r">t</span><span class="r">${th("Wartość")}</span></div>
        <div class="obr-groups">${groups(flt, kind, open || !!ql)}</div>
        <p class="help mt3">${th("m³ — ekwiwalent drewna litego z przelicznika produktu (MP ÷ współczynnik). ⚖ — waga rzeczywista z kwitu, ≈ — orientacyjnie z przelicznika. * — suma niepełna (produkt bez przelicznika). Kliknij transakcję, aby otworzyć dokument.")}</p>`;
    };
    const m = Modal.open({ id: "obr-detail", xwide: true, title: t(KINDS[kind].title), sub: esc(`${t("transakcje miesiąca z nazwami kontrahentów")} · ${scopeLabel(f)}`), body: body(), footer: `<button class="btn primary" type="button" data-ok>${th("Zamknij")}</button>` });
    const bindBody = () => {
      Tip.bind(m.body);
      $$("[data-open-op]", m.body).forEach(tr => tr.onclick = () => UI.OpDetail.open(tr.dataset.openOp));
      $$("[data-d-shift]", m.body).forEach(b => b.onclick = () => { f.ym = Dates.addMonths(f.ym, Number(b.dataset.dShift)); rerender(); });
      $$("[data-d-open]", m.body).forEach(b => b.onclick = () => { open = b.dataset.dOpen === "1"; $$("details", m.body).forEach(d => { d.open = open; }); });
      $("[data-d-csv]", m.body).onclick = () => csvOf(kind, data(f)[kind], f);
      const qi = $("#obr-q", m.body); qi.oninput = () => { qtext = qi.value; const pos = qi.selectionStart; rerender(); const n = $("#obr-q", m.body); n.focus(); n.setSelectionRange(pos, pos); };
    };
    const rerender = () => { m.body.innerHTML = body(); bindBody(); };
    bindBody();
    // miesiąc zmieniony w oknie — pulpit pokazuje ten sam miesiąc po zamknięciu
    const close = m.close; m.close = () => { close(); App.render(); };
    $("[data-ok]", m.el).onclick = () => m.close();
  }

  function bind(page) {
    const f = filter(), sec = $("#obr", page);
    if (!sec) return;
    const go = () => App.render();
    $$("[data-obr]", sec).forEach(el => { const o = () => openDetail(el.dataset.obr); el.onclick = e => { e.stopPropagation(); o(); }; el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); o(); } }; });
    $$("[data-obr-shift]", sec).forEach(b => b.onclick = () => { f.ym = Dates.addMonths(f.ym, Number(b.dataset.obrShift)); go(); });
    const ymI = $("#obr-ym", sec); ymI.onchange = () => { if (Dates.isYM(ymI.value)) { f.ym = ymI.value; go(); } };
    $$("[data-obr-scope]", sec).forEach(b => b.onclick = () => { f.scope = b.dataset.obrScope; go(); });
    $("#obr-cat", sec).onchange = e => { f.cat = e.target.value; go(); };
    $$("[data-obr-ym]", sec).forEach(tr => tr.onclick = () => { f.ym = tr.dataset.obrYm; go(); });
    $$("[data-obr-expand]", sec).forEach(b => b.onclick = () => { const on = b.dataset.obrExpand === "1"; $$("#obr-forest-groups details", sec).forEach(d => { d.open = on; }); });
    $$("#obr-forest [data-open-op]", sec).forEach(tr => tr.onclick = () => UI.OpDetail.open(tr.dataset.openOp));
    Tip.bind(sec);
  }

  /* ---------------- dekoracja pulpitu ---------------- */
  const base = Views.pulpit;
  Views.pulpit = Object.assign({}, base, {
    html(...a) {
      const html = base.html.apply(this, a);
      let sec;
      try { sec = section(filter()); } catch (e) { console.error(e); sec = `<div class="info-line err">${ic("alert", 15)}<span>${esc(t("Nie udało się wyświetlić obrotu miesiąca: {m}", { m: e.message }))}</span></div>`; }
      const i = html.indexOf('<div class="dash-main">');
      return i < 0 ? html + sec : html.slice(0, i) + sec + html.slice(i);
    },
    bind(page, ...a) { base.bind.call(this, page, ...a); bind(page); }
  });
  UI.Premium = { openDetail, section, data, safeCell };
})(typeof globalThis !== "undefined" ? globalThis : this);
