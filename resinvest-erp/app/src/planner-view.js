/* =========================================================================
   ResInvest ERP 3.5 — Planer zakupów (ekran)
   * Tydzień: wskaźniki, tabela dni z polem planu [MP] (zapis po wyjściu z pola / Enter),
     realizacja dnia, dokumenty źródłowe dnia (okno z operacjami).
   * Miesiące i rok: wykres plan / wykonanie (12 miesięcy), tabela roku.
   * Kierowcy i kursy: kursy tygodnia według kierowcy i pojazdu, lista kursów.
   * Skąd są dane: pola planera i reguły (wartości AUTO tylko do odczytu — poprawka korektą dokumentu).
   Liczby z silnika RIW.Planner — te same w eksporcie CSV / XLSX / PDF.
   ========================================================================= */
(function (root) {
  "use strict";
  const UI = root.RIWUI;
  const { R, t, tp, N_, esc, $, $$, ic, download, csvNum, toCSV, Toast, Modal, Store, App, Views, drillAttr, bindDrill, bindOps, Tip, Printer, xlsxTable, tradeCsv } = UI;
  const { fmt, fmtQ, money, Dates } = R;
  const P = R.Planner;
  const th = s => esc(t(s));
  const DAYS = [N_("Pon"), N_("Wt"), N_("Śr"), N_("Czw"), N_("Pt"), N_("Sob"), N_("Ndz")];
  const VIEWS = [["week", N_("Tydzień")], ["year", N_("Miesiące i rok")], ["drivers", N_("Kierowcy i kursy")], ["sources", N_("Skąd są dane")]];
  const pctText = v => v === null || v === undefined ? "—" : `${fmt(v, 1)}%`;
  const mp = v => `${fmtQ(v, 2)} MP`;
  const zlMp = v => v === null || v === undefined ? "—" : `${fmt(v, 2)} ${t("zł/MP")}`;

  function filters() {
    const today = App.today();
    const f = App.tabs.planer || (App.tabs.planer = { view: "week", whId: App.user().whId, date: today, year: today.slice(0, 4), focus: "" });
    const opts = P.scopeWarehouses(Store.state, App.user(), "ALL");
    if (f.whId !== "ALL" && !opts.includes(f.whId)) f.whId = opts.includes(App.user().whId) ? App.user().whId : (opts[0] || "");
    if (!Dates.isISO(f.date)) f.date = today;
    return f;
  }
  const whIdsOf = f => P.scopeWarehouses(Store.state, App.user(), f.whId);
  const whText = f => f.whId === "ALL" ? t("wszystkie magazyny") : App.whName(f.whId);
  /** Plan można wpisywać dla jednego magazynu (nie w widoku „Wszystkie”) i z uprawnieniem planner.edit. */
  const editable = f => f.whId !== "ALL" && App.can("planner.edit");
  function weekOf(f) {
    const from = Dates.weekStart(f.date), to = Dates.addDays(from, 6);
    return { from, to, days: P.days(Store.state, whIdsOf(f), from, to, App.today()) };
  }
  /** Numer tygodnia ISO. */
  function isoWeek(d) {
    const x = new Date(d + "T00:00:00Z"), day = (x.getUTCDay() + 6) % 7;
    x.setUTCDate(x.getUTCDate() - day + 3);
    const first = new Date(Date.UTC(x.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((x - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  }
  const realCls = v => v === null ? "" : v >= 100 ? "pos" : v >= 80 ? "" : "neg";
  const bar = v => v === null ? "" : `<span class="pl-bar" aria-hidden="true"><i class="${v >= 100 ? "ok" : v >= 80 ? "" : "low"}" style="width:${Math.max(2, Math.min(100, v))}%"></i></span>`;

  /* ---------------- wskaźniki ---------------- */
  function kpis(T, label) {
    const k = (id, title, value, unit, sub, drill) => `<div class="kpi" id="${id}"><div class="k-t">${esc(title)}</div><div class="k-v"${drill ? drillAttr(drill, title) : ""}>${value}${unit ? `<u>${esc(unit)}</u>` : ""}</div><div class="k-s">${sub}</div></div>`;
    return `<div class="grid g4 mb4" id="pl-kpis">
      ${k("pl-k-real", t("Realizacja planu do dziś"), T.realization === null ? "—" : fmt(T.realization, 1), T.realization === null ? "" : "%", `${esc(t("wykonanie {a} z planu {b}", { a: mp(T.act), b: mp(T.planToDate) }))}${bar(T.realization)}`)}
      ${k("pl-k-act", t("Wykonanie"), fmtQ(T.act, 2), "MP", esc(t("{t} t · z wagi {w}", { t: fmtQ(T.t, 1), w: pctText(T.weighedShare) })), T.opIds)}
      ${k("pl-k-cost", t("Wartość zakupu"), fmt(T.cost, 0), "zł", esc(t("średnia cena {p}", { p: zlMp(T.avgPrice) })), T.opIds)}
      ${k("pl-k-tr", t("Transport"), fmt(T.transportCost, 0), "zł", esc(`${zlMp(T.transportPerMp)} · ${tp("{n} kurs|{n} kursy|{n} kursów", T.trips)} · ${fmtQ(T.km, 0)} km`))}
    </div><p class="help mb3">${esc(label)}</p>`;
  }

  /* ---------------- tydzień ---------------- */
  function weekHtml(f) {
    const w = weekOf(f), T = P.totals(w.days), canEdit = editable(f), today = App.today();
    const planMap = new Map(P.plans(Store.state, whIdsOf(f), w.from, w.to).map(p => [p.date, p]));
    const rows = w.days.map(d => {
      const pr = planMap.get(d.date), real = d.future ? null : (d.plan > R.EPS ? R.round(d.act / d.plan * 100, 1) : null);
      const planCell = canEdit
        ? `<input class="ctrl sm plan-in" inputmode="decimal" id="plan-${d.date}" data-plan-date="${d.date}" data-version="${pr ? pr.version : 0}" value="${esc(d.plan > R.EPS ? fmtQ(d.plan, 2) : "")}" placeholder="0" aria-label="${esc(t("Plan [MP] — {d}", { d: Dates.pl(d.date) }))}">`
        : `<b>${d.plan > R.EPS ? esc(fmtQ(d.plan, 2)) : "—"}</b>`;
      const docs = d.docs.length ? `<span${drillAttr(d.opIds, t("{d} — dokumenty źródłowe", { d: Dates.pl(d.date) }))}>${esc(d.docs.filter(x => ["PZ", "PW", "WZ", "TR"].includes(x.type)).map(x => x.no).slice(0, 4).join(", ") || tp("{n} operacja|{n} operacje|{n} operacji", d.opIds.length))}</span>` : "—";
      return `<tr class="${d.date === today ? "pl-today" : ""} ${d.future ? "pl-future" : ""}" data-day="${d.date}">
        <td data-l="${th("Dzień")}" class="nowrap"><b>${esc(t(DAYS[d.weekday]))}</b> ${esc(Dates.pl(d.date))}${d.note ? `<div class="dim small">${esc(d.note)}</div>` : ""}</td>
        <td data-l="${th("Plan [MP]")}" class="r">${planCell}</td>
        <td data-l="${th("Wykonanie [MP]")}" class="r"><b>${d.act > R.EPS ? esc(fmtQ(d.act, 2)) : "—"}</b></td>
        <td data-l="${th("Realizacja")}" class="r ${realCls(real)}">${real === null ? (d.future ? `<span class="dim">${th("przyszły dzień")}</span>` : "—") : esc(pctText(real)) + bar(real)}</td>
        <td data-l="${th("Tony [t]")}" class="r">${d.t > R.EPS ? esc(fmtQ(d.t, 2)) + (d.tWeighed > R.EPS ? `<div class="dim small">${esc(t("z wagi {t}", { t: fmtQ(d.tWeighed, 2) }))}</div>` : "") : "—"}</td>
        <td data-l="${th("Zakup [zł]")}" class="r">${d.cost > R.EPS ? esc(money(d.cost)) : "—"}</td>
        <td data-l="${th("Cena [zł/MP]")}" class="r">${d.act > R.EPS ? esc(fmt(d.cost / d.act, 2)) : "—"}</td>
        <td data-l="${th("Km")}" class="r">${d.km > R.EPS ? esc(fmtQ(d.km, 0)) : "—"}</td>
        <td data-l="${th("Transport [zł]")}" class="r">${d.transportCost > R.EPS ? esc(money(d.transportCost)) : "—"}</td>
        <td data-l="${th("Kursy")}" class="r">${d.trips || "—"}</td>
        <td data-l="${th("Miejsce")}">${esc(d.places.join(" · ") || "—")}</td>
        <td data-l="${th("Dokumenty")}" class="mono">${docs}</td></tr>`;
    }).join("");
    const foot = `<tr><td>${th("Razem tydzień")}</td><td data-l="${th("Plan [MP]")}" class="r">${esc(fmtQ(T.plan, 2))}</td><td data-l="${th("Wykonanie [MP]")}" class="r">${esc(fmtQ(T.act, 2))}</td><td data-l="${th("Realizacja")}" class="r ${realCls(T.realization)}">${esc(pctText(T.realization))}</td><td data-l="${th("Tony [t]")}" class="r">${esc(fmtQ(T.t, 2))}</td><td data-l="${th("Zakup [zł]")}" class="r">${esc(money(T.cost))}</td><td data-l="${th("Cena [zł/MP]")}" class="r">${esc(T.avgPrice === null ? "—" : fmt(T.avgPrice, 2))}</td><td data-l="${th("Km")}" class="r">${esc(fmtQ(T.km, 0))}</td><td data-l="${th("Transport [zł]")}" class="r">${esc(money(T.transportCost))}</td><td data-l="${th("Kursy")}" class="r">${T.trips}</td><td colspan="2"></td></tr>`;
    const head = t("Tydzień {n}: {a} – {b}", { n: isoWeek(w.from), a: Dates.pl(w.from), b: Dates.pl(w.to) });
    return `${kpis(T, t("{h} · {w} · realizacja liczona do dziś — przyszłe dni nie zaniżają wyniku", { h: head, w: whText(f) }))}
      <div class="card" id="pl-week"><div class="card-h"><h3>${esc(head)}</h3><span class="sub">${esc(whText(f))}</span><span class="spacer"></span>
        ${canEdit ? `<span class="badge info">${th("plan [MP] — wpisz i naciśnij Enter")}</span>` : f.whId === "ALL" ? `<span class="badge">${th("suma magazynów — plan wpisuje się w magazynie")}</span>` : `<span class="badge">${th("tylko podgląd — plan wpisuje kierownik lub administrator")}</span>`}</div>
        <div class="tbl-wrap"><table class="tbl stack pl-table" id="pl-week-table"><thead><tr><th>${th("Dzień")}</th><th class="r">${th("Plan [MP]")}</th><th class="r">${th("Wykonanie [MP]")}</th><th class="r">${th("Realizacja")}</th><th class="r">${th("Tony [t]")}</th><th class="r">${th("Zakup [zł]")}</th><th class="r">${th("Cena [zł/MP]")}</th><th class="r">${th("Km")}</th><th class="r">${th("Transport [zł]")}</th><th class="r">${th("Kursy")}</th><th>${th("Miejsce")}</th><th>${th("Dokumenty")}</th></tr></thead>
          <tbody>${rows}</tbody><tfoot>${foot}</tfoot></table></div>
        <p class="help" style="padding:8px 16px">${th("Wykonanie, tony, ceny, km i kursy liczą się automatycznie z zatwierdzonych zakupów MP: zakup z produkcją, produkcja w lesie (sprzedaż bezpośrednia), zakup zrębki. Błąd poprawia się korektą dokumentu.")}</p></div>`;
  }

  /* ---------------- miesiące i rok ---------------- */
  function yearData(f) {
    const y = Number(f.year) || Number(App.today().slice(0, 4));
    const list = P.days(Store.state, whIdsOf(f), `${y}-01-01`, `${y}-12-31`, App.today());
    return { y, months: P.months(list, y), total: P.totals(list) };
  }
  /** Wykres kolumnowy plan / wykonanie [MP] — jedna oś, podpowiedź nad grupą, tabela obok. */
  function chart(months) {
    const W = 640, H = 230, padL = 52, padR = 8, padT = 12, padB = 26;
    const max = Math.max(1, ...months.flatMap(m => [m.plan, m.act]));
    const step = (() => { const raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; })();
    const top = step * 4, iw = W - padL - padR, ih = H - padT - padB, y = v => padT + ih - v / top * ih;
    const gw = iw / 12, bw = Math.min(18, (gw - 10) / 2 - 2);
    const series = [{ key: "plan", label: t("Plan"), color: "var(--chart-b)" }, { key: "act", label: t("Wykonanie"), color: "var(--chart-a)" }];
    let g = "";
    for (let i = 0; i <= 4; i++) { const v = step * i, yy = y(v); g += `<line class="grid-l" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/><text x="${padL - 6}" y="${yy + 3.5}" text-anchor="end">${esc(fmtQ(v, 0))}</text>`; }
    months.forEach((m, i) => {
      const cx = padL + gw * i + gw / 2, x0 = cx - (2 * (bw + 2) - 2) / 2;
      series.forEach((s, j) => {
        const v = m[s.key], x = x0 + j * (bw + 2), yy = y(v), h = padT + ih - yy;
        if (h > 0.5) { const r = Math.min(4, h, bw / 2); g += `<path class="bar" fill="${s.color}" d="M${x},${padT + ih} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${padT + ih} Z"/>`; }
      });
      g += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${esc(Dates.short(m.ym).split(" ")[0])}</text>`;
      g += `<rect class="col-hit" x="${padL + gw * i}" y="${padT}" width="${gw}" height="${ih}" data-month="${m.ym}" data-tip="${esc(`<b>${esc(Dates.label(m.ym))}</b><br>${esc(t("Plan"))}: ${esc(mp(m.plan))}<br>${esc(t("Wykonanie"))}: ${esc(mp(m.act))}<br>${esc(t("Realizacja"))}: ${esc(pctText(m.realization))}`)}"/>`;
    });
    g += `<line class="axis" x1="${padL}" x2="${W - padR}" y1="${padT + ih}" y2="${padT + ih}"/>`;
    return { svg: `<svg class="cols" id="pl-chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(t("Plan i wykonanie [MP] w miesiącach"))}">${g}</svg>`, series };
  }
  function yearHtml(f) {
    const { y, months, total } = yearData(f);
    const c = chart(months);
    const rows = months.map(m => `<tr class="clickable" data-goto-month="${m.ym}"><td data-l="${th("Miesiąc")}"><b>${esc(Dates.label(m.ym))}</b></td><td data-l="${th("Plan [MP]")}" class="r">${esc(fmtQ(m.plan, 2))}</td><td data-l="${th("Wykonanie [MP]")}" class="r"><b>${esc(fmtQ(m.act, 2))}</b></td>
      <td data-l="${th("Realizacja")}" class="r ${realCls(m.realization)}">${esc(pctText(m.realization))}</td><td data-l="${th("Tony [t]")}" class="r">${esc(fmtQ(m.t, 1))}</td><td data-l="${th("Wartość zakupu [zł]")}" class="r">${esc(money(m.cost))}</td>
      <td data-l="${th("Śr. cena [zł/MP]")}" class="r">${esc(m.avgPrice === null ? "—" : fmt(m.avgPrice, 2))}</td><td data-l="${th("Transport [zł/MP]")}" class="r">${esc(m.transportPerMp === null ? "—" : fmt(m.transportPerMp, 2))}</td>
      <td data-l="${th("Kursy")}" class="r">${m.trips}</td><td data-l="${th("Dni z zakupem")}" class="r">${m.productionDays}</td><td data-l="${th("Udział w roku")}" class="r">${total.act > R.EPS ? esc(pctText(R.round(m.act / total.act * 100, 1))) : "—"}</td></tr>`).join("");
    return `${kpis(total, t("Rok {y} · {w}", { y, w: whText(f) }))}
      <div class="card" id="pl-year-chart"><div class="card-h"><h3>${esc(t("Plan i wykonanie {y} [MP]", { y }))}</h3><span class="sub">${esc(whText(f))}</span><span class="spacer"></span>
        <div class="legend">${c.series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join("")}</div></div>
        <div class="card-b">${c.svg}</div></div>
      <div class="card mt4" id="pl-year"><div class="card-h"><h3>${esc(t("Miesiące i rok {y}", { y }))}</h3><span class="sub">${th("kliknij miesiąc — tydzień z jego początku")}</span></div>
        <div class="tbl-wrap"><table class="tbl stack" id="pl-year-table"><thead><tr><th>${th("Miesiąc")}</th><th class="r">${th("Plan [MP]")}</th><th class="r">${th("Wykonanie [MP]")}</th><th class="r">${th("Realizacja")}</th><th class="r">${th("Tony [t]")}</th><th class="r">${th("Wartość zakupu [zł]")}</th><th class="r">${th("Śr. cena [zł/MP]")}</th><th class="r">${th("Transport [zł/MP]")}</th><th class="r">${th("Kursy")}</th><th class="r">${th("Dni z zakupem")}</th><th class="r">${th("Udział w roku")}</th></tr></thead>
        <tbody>${rows}</tbody><tfoot><tr><td>${esc(t("Razem {y}", { y }))}</td><td data-l="${th("Plan [MP]")}" class="r">${esc(fmtQ(total.plan, 2))}</td><td data-l="${th("Wykonanie [MP]")}" class="r">${esc(fmtQ(total.act, 2))}</td><td data-l="${th("Realizacja")}" class="r">${esc(pctText(total.realization))}</td><td data-l="${th("Tony [t]")}" class="r">${esc(fmtQ(total.t, 1))}</td><td data-l="${th("Wartość zakupu [zł]")}" class="r">${esc(money(total.cost))}</td><td data-l="${th("Śr. cena [zł/MP]")}" class="r">${esc(total.avgPrice === null ? "—" : fmt(total.avgPrice, 2))}</td><td data-l="${th("Transport [zł/MP]")}" class="r">${esc(total.transportPerMp === null ? "—" : fmt(total.transportPerMp, 2))}</td><td data-l="${th("Kursy")}" class="r">${total.trips}</td><td data-l="${th("Dni z zakupem")}" class="r">${total.productionDays}</td><td data-l="${th("Udział w roku")}" class="r">100%</td></tr></tfoot></table></div></div>`;
  }

  /* ---------------- kierowcy i kursy ---------------- */
  function driversHtml(f) {
    const w = weekOf(f), whs = whIdsOf(f);
    const list = P.drivers(Store.state, whs, w.from, w.to);
    const dates = P.dayRange(w.from, w.to);
    const runs = dates.flatMap(d => P.dayRuns(Store.state, whs, d).map(r => Object.assign({ date: d }, r)));
    const matrix = list.length ? `<div class="tbl-wrap"><table class="tbl stack" id="pl-drivers-table"><thead><tr><th>${th("Kierowca i pojazd")}</th>${dates.map((d, i) => `<th class="r">${esc(t(DAYS[i]))} ${esc(Dates.pl(d).slice(0, 5))}</th>`).join("")}<th class="r">${th("Kursy")}</th><th class="r">MP</th><th class="r">${th("Tony z wagi [t]")}</th><th class="r">${th("Km")}</th><th class="r">${th("Koszt [zł]")}</th></tr></thead><tbody>
      ${list.map(a => `<tr${drillAttr(a.opIds, `${a.driver} · ${a.reg}`)}><td data-l="${th("Kierowca i pojazd")}"><b>${esc(a.driver)}</b><div class="dim small">${esc(a.reg)}${a.company ? " · " + esc(a.company) : ""}</div></td>${dates.map((d, i) => `<td data-l="${esc(t(DAYS[i]))}" class="r">${a.perDay[d] || ""}</td>`).join("")}
        <td data-l="${th("Kursy")}" class="r"><b>${a.trips}</b></td><td data-l="MP" class="r">${esc(fmtQ(a.qty, 2))}</td><td data-l="${th("Tony z wagi [t]")}" class="r">${a.weightT > R.EPS ? esc(fmtQ(a.weightT, 2)) : "—"}</td><td data-l="${th("Km")}" class="r">${esc(fmtQ(a.km, 0))}</td><td data-l="${th("Koszt [zł]")}" class="r">${esc(money(a.cost))}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">${th("Brak kursów w tym tygodniu.")}</div>`;
    const runList = runs.length ? `<div class="tbl-wrap"><table class="tbl stack" id="pl-runs-table"><thead><tr><th>${th("Dzień")}</th><th>${th("Kurs")}</th><th>${th("Kierowca")}</th><th>${th("Pojazd")}</th><th>${th("Miejsce")}</th><th class="r">MP</th><th class="r">${th("Waga [t]")}</th><th class="r">${th("Km")}</th><th class="r">${th("Koszt [zł]")}</th><th>${th("Operacja")}</th></tr></thead><tbody>
      ${runs.map(r => `<tr class="clickable" data-opid="${esc(r.opId)}"><td data-l="${th("Dzień")}" class="nowrap">${esc(Dates.pl(r.date))}</td><td data-l="${th("Kurs")}">${r.no} · ${esc(r.kind === "external" ? t("zewnętrzny") : t("własny"))}</td><td data-l="${th("Kierowca")}">${esc(r.driver)}</td><td data-l="${th("Pojazd")}">${esc(r.reg)}${r.company ? `<div class="dim small">${esc(r.company)}</div>` : ""}</td><td data-l="${th("Miejsce")}">${esc(r.place || "—")}</td>
        <td data-l="MP" class="r">${esc(fmtQ(r.qty, 2))}</td><td data-l="${th("Waga [t]")}" class="r">${r.weightT === null ? `<span class="dim">${th("brak")}</span>` : esc(fmtQ(r.weightT, 2))}</td><td data-l="${th("Km")}" class="r">${esc(fmtQ(r.km, 0))}</td><td data-l="${th("Koszt [zł]")}" class="r">${esc(money(r.cost))}</td><td data-l="${th("Operacja")}" class="mono">${esc(r.opNo)}</td></tr>`).join("")}</tbody></table></div>` : "";
    return `<div class="card" id="pl-drivers"><div class="card-h"><h3>${esc(t("Kursy w tygodniu według kierowców"))}</h3><span class="sub">${esc(t("{a} – {b} · {w}", { a: Dates.pl(w.from), b: Dates.pl(w.to), w: whText(f) }))}</span></div>${matrix}</div>
      ${runList ? `<div class="card mt4" id="pl-runs"><div class="card-h"><h3>${th("Kursy tygodnia")}</h3><span class="sub">${esc(tp("{n} kurs|{n} kursy|{n} kursów", runs.length))}</span></div>${runList}</div>` : ""}`;
  }

  /* ---------------- skąd są dane ---------------- */
  const SOURCES = [
    [N_("Plan [MP]"), N_("wpisywany ręcznie"), N_("magazyn × dzień; widok „Wszystkie magazyny” sumuje plany. Zmiana zapisuje się w dzienniku audytu (było / jest).")],
    [N_("Wykonanie [MP]"), N_("zakup z produkcją (PW), produkcja w lesie, zakup zrębki (PZ)"), N_("wynik produkcji w MP albo ilość przyjętej zrębki; bez anulowanych i usuniętych operacji.")],
    [N_("Tony [t]"), N_("kursy transportu (waga) + przelicznik firmowy"), N_("waga zważonych kursów + niezważona reszta ilości × przelicznik MP → t z konfiguracji.")],
    [N_("Cena [zł/MP]"), N_("wartość zakupu i surowca z operacji"), N_("(wartość zakupu + koszt surowca) ÷ wykonanie.")],
    [N_("Miejsce"), N_("produkcja i transport"), N_("nadleśnictwo i leśnictwo, miejsce wycinki albo miejsce dostawy.")],
    [N_("Km, transport, kursy"), N_("karta transportu (TR)"), N_("sumy kursów własnych i zewnętrznych operacji zakupu.")],
    [N_("Kierowcy i pojazdy"), N_("kursy transportu"), N_("kursy pogrupowane po kierowcy i pojeździe; liczba kursów na dzień.")],
    [N_("Realizacja"), N_("wyliczana"), N_("wykonanie ÷ plan do dziś — przyszłe dni nie zaniżają wyniku.")]
  ];
  function sourcesHtml() {
    return `<div class="card" id="pl-sources"><div class="card-h"><h3>${th("Pola planera i ich źródło w ERP")}</h3></div>
      <div class="tbl-wrap"><table class="tbl stack"><thead><tr><th>${th("Pole planera")}</th><th>${th("Źródło")}</th><th>${th("Reguła")}</th></tr></thead><tbody>
        ${SOURCES.map(([a, b, c]) => `<tr><td data-l="${th("Pole planera")}"><b>${th(a)}</b></td><td data-l="${th("Źródło")}">${th(b)}</td><td data-l="${th("Reguła")}">${th(c)}</td></tr>`).join("")}</tbody></table></div>
      <div class="card-b"><div class="info-line">${ic("alert", 15)}<span>${th("Sprzedaż z magazynu, produkcja ze stanu, przesunięcia MM i zakup drewna bez produkcji nie wchodzą do planera — to nie są zakupy MP. Wartości AUTO są tylko do odczytu; błąd poprawia się korektą dokumentu, więc planer zawsze zgadza się ze stanami i raportami.")}</span></div></div></div>`;
  }

  /* ---------------- eksport ---------------- */
  function exportRows(f) {
    if (f.view === "year") {
      const { y, months } = yearData(f);
      return { title: t("Planer zakupów — rok {y}", { y }), range: String(y), cols: [t("Miesiąc"), t("Plan [MP]"), t("Wykonanie [MP]"), t("Realizacja %"), t("Tony [t]"), t("Wartość zakupu [zł]"), t("Śr. cena [zł/MP]"), t("Transport [zł/MP]"), t("Kursy")],
        rows: months.map(m => [Dates.label(m.ym), m.plan, m.act, m.realization, m.t, m.cost, m.avgPrice, m.transportPerMp, m.trips]) };
    }
    const w = weekOf(f);
    return { title: t("Planer zakupów — tydzień {n}", { n: isoWeek(w.from) }), range: `${Dates.pl(w.from)} – ${Dates.pl(w.to)}`, cols: [t("Dzień"), t("Plan [MP]"), t("Wykonanie [MP]"), t("Tony [t]"), t("Tony z wagi [t]"), t("Zakup [zł]"), t("Km"), t("Transport [zł]"), t("Kursy"), t("Miejsce"), t("Uwagi")],
      rows: w.days.map(d => [d.date, d.plan, d.act, d.t, d.tWeighed, d.cost, d.km, d.transportCost, d.trips, d.places.join(" · "), d.note]) };
  }

  Views.planer = {
    html() {
      const f = filters();
      const whs = P.scopeWarehouses(Store.state, App.user(), "ALL");
      const nav = f.view === "week" || f.view === "drivers"
        ? `<div class="field"><label for="pl-date">${th("Tydzień z dniem")}</label><div class="row-gap"><button class="btn sm" type="button" id="pl-prev" aria-label="${th("Poprzedni tydzień")}">‹</button><input class="ctrl" type="date" id="pl-date" value="${esc(f.date)}"><button class="btn sm" type="button" id="pl-next" aria-label="${th("Następny tydzień")}">›</button><button class="btn sm ghost" type="button" id="pl-today">${th("Dziś")}</button></div></div>`
        : f.view === "year" ? `<div class="field"><label for="pl-year">${th("Rok")}</label><input class="ctrl" type="number" min="2000" max="2100" id="pl-year" value="${esc(f.year)}"></div>` : "";
      const body = f.view === "year" ? yearHtml(f) : f.view === "drivers" ? driversHtml(f) : f.view === "sources" ? sourcesHtml() : weekHtml(f);
      return `<div class="page-head"><div class="titles"><h2>${th("Planer zakupów")}</h2><p>${th("Plan dzienny zakupów [MP] i wykonanie liczone z zatwierdzonych dokumentów: produkcja z zakupu, produkcja w lesie, zakup zrębki. Ręcznie wpisuje się tylko plan.")}</p></div>
          <div class="actions">${f.view !== "sources" ? `<button class="btn" type="button" id="pl-trade">${ic("dl", 15)} ${th("CSV ewidencji")}</button><button class="btn" type="button" id="pl-csv">${ic("dl", 15)} ${th("CSV planera")}</button><button class="btn" type="button" id="pl-xlsx">${ic("dl", 15)} XLSX</button><button class="btn" type="button" id="pl-pdf">${ic("pdf", 15)} ${th("Generuj PDF")}</button>${App.can("reports.export") ? `<button class="btn" type="button" id="pl-mail">${ic("mail", 15)} ${th("Wyślij e-mailem")}</button>` : ""}` : ""}</div></div>
        <div class="card mb4"><div class="toolbar">
          <div class="field"><label for="pl-wh">${th("Magazyn")}</label><select class="ctrl" id="pl-wh">${whs.map(id => `<option value="${esc(id)}" ${f.whId === id ? "selected" : ""}>${esc(App.whName(id))}</option>`).join("")}${whs.length > 1 ? `<option value="ALL" ${f.whId === "ALL" ? "selected" : ""}>${th("Wszystkie magazyny")}</option>` : ""}</select></div>
          ${nav}
          <div class="field"><span class="lbl-like">${th("Widok")}</span><div class="seg" role="group" aria-label="${th("Widok")}" id="pl-views">${VIEWS.map(([k, l]) => `<button type="button" data-plview="${k}" aria-pressed="${f.view === k}">${th(l)}</button>`).join("")}</div></div></div></div>
        ${body}`;
    },
    bind(page) {
      const f = App.tabs.planer;
      $("#pl-wh", page).onchange = e => { f.whId = e.target.value; App.render(); };
      $$("[data-plview]", page).forEach(b => b.onclick = () => { f.view = b.dataset.plview; App.render(); });
      const shift = n => { f.date = Dates.addDays(f.date, n); App.render(); };
      const pv = $("#pl-prev", page); if (pv) pv.onclick = () => shift(-7);
      const nx = $("#pl-next", page); if (nx) nx.onclick = () => shift(7);
      const td = $("#pl-today", page); if (td) td.onclick = () => { f.date = App.today(); App.render(); };
      const dt = $("#pl-date", page); if (dt) dt.onchange = e => { if (Dates.isISO(e.target.value)) { f.date = e.target.value; App.render(); } };
      const yr = $("#pl-year", page); if (yr) yr.onchange = e => { if (/^\d{4}$/.test(e.target.value)) { f.year = e.target.value; App.render(); } };
      $$("[data-goto-month]", page).forEach(tr => tr.onclick = () => { f.date = tr.dataset.gotoMonth + "-01"; f.view = "week"; App.render(); });
      $$("rect[data-month]", page).forEach(r => r.onclick = () => { f.date = r.dataset.month + "-01"; f.view = "week"; App.render(); });
      bindDrill(page); bindOps(page); Tip.bind(page);
      /* plan dnia: zapis po zmianie (wyjście z pola / Enter); Enter przechodzi do następnego dnia */
      const inputs = $$(".plan-in", page);
      inputs.forEach((inp, i) => {
        inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); f.focus = inputs[i + 1] ? inputs[i + 1].dataset.planDate : ""; inp.blur(); } };
        inp.onchange = async () => {
          if (!f.focus) f.focus = inputs[i + 1] ? inputs[i + 1].dataset.planDate : "";
          const res = await Store.exec("plan.set", { whId: f.whId, date: inp.dataset.planDate, planMP: inp.value, version: Number(inp.dataset.version) }, N_("Planer zakupów"));
          if (!res.ok) { f.focus = inp.dataset.planDate; Toast.err(t("Nie zapisano planu"), res.error); }
          else if (!res.unchanged) Toast.ok(t("Zapisano plan {d}", { d: Dates.pl(inp.dataset.planDate) }), res.plan ? mp(res.plan.planMP) : t("plan usunięty"));
          App.render();
        };
      });
      if (f.focus) { const el = $(`#plan-${f.focus}`, page); f.focus = ""; if (el) { el.focus(); el.select(); } }
      const exp = () => exportRows(f);
      const csv = $("#pl-csv", page);
      if (csv) csv.onclick = () => { const x = exp(); download(`planer_${f.view}_${App.today()}.csv`, toCSV(x.cols, x.rows.map(r => r.map(v => typeof v === "number" ? csvNum(v) : v === null ? "" : v))), "text/csv;charset=utf-8"); };
      const tr = $("#pl-trade", page);
      // ewidencja obrotu za okres planera (tydzień / rok) i jego magazyny — z kolumnami planu dnia i miesiąca
      if (tr) tr.onclick = () => { const y = Number(f.year) || Number(App.today().slice(0, 4)), w = f.view === "year" ? { from: `${y}-01-01`, to: `${y}-12-31` } : weekOf(f); tradeCsv(`ewidencja_planer_${w.from}_${w.to}`, { from: w.from, to: w.to, whIds: whIdsOf(f) }); };
      const xl = $("#pl-xlsx", page);
      if (xl) xl.onclick = () => { const x = exp(); xlsxTable(`planer_${f.view}_${App.today()}`, x.title, x.cols, x.rows.map(r => r.map(v => v === null ? "" : v)), `${whText(f)} · ${x.range}`); };
      const plModel = () => {
        const x = exp();
        return { title: x.title, subtitle: `${whText(f)} · ${x.range}`, orientation: "landscape", rangeText: x.range, whText: whText(f), headerRight: whText(f),
          meta: [[t("Magazyn"), whText(f)], [t("Okres"), x.range]],
          blocks: [{ type: "table", size: 7.5, columns: x.cols.map((c, i) => ({ label: c, w: i === 0 ? 1.4 : i >= x.cols.length - 2 ? 1.8 : 1, align: i === 0 || i >= x.cols.length - 2 ? "left" : "right" })),
            rows: x.rows.map(r => r.map((v, i) => i === 0 ? (Dates.isISO(v) ? Dates.pl(v) : v) : typeof v === "number" ? fmtQ(v, 2) : v === null ? "—" : String(v))) }] };
      };
      const pd = $("#pl-pdf", page); if (pd) pd.onclick = () => Printer.pdf(plModel(), "RAP", "planer");
      const pm = $("#pl-mail", page); if (pm) pm.onclick = () => Printer.mail(plModel(), "RAP", "planer");
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
