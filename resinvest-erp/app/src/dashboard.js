/* =========================================================================
   ResInvest ERP 3.0 — Pulpit główny
   * nagłówek z podsumowaniem miesiąca aktywnego magazynu,
   * szybkie akcje, wskaźniki z trendem (zmiana względem poprzedniego miesiąca),
   * wykres: sprzedaż i zakupy w ostatnich 6 miesiącach (paleta sprawdzona
     walidatorem kontrastu i rozróżnialności dla daltonistów w każdym motywie),
   * obroty wg typu operacji (zakres do wyboru), stany z linią 30 dni,
   * aktywność użytkowników (dziennik audytu) i lista spraw do załatwienia.
   Wszystkie liczby z silnika (RIW.Reports / RIW.Stock) — te same co w raportach.
   ========================================================================= */
(function (root) {
  "use strict";
  const UI = root.RIWUI;
  const { R, t, tp, N_, esc, $, $$, ic, Store, App, Views, statusBadge, opsTable, bindOps, drillAttr, bindDrill, periodControls, bindPeriod, rangeOf, hbar, sparkline, Tip, qtyByUnit, initials } = UI;
  const { fmt, fmtQ, money, Units, Dates, Stock } = R;
  const th = s => esc(t(s));

  /** Zmiana procentowa względem poprzedniego okresu (null gdy brak bazy). */
  function delta(cur, prev) {
    if (!(Math.abs(prev) > 0.004)) return cur > 0.004 ? { txt: t("nowe"), cls: "up" } : null;
    const d = (cur - prev) / Math.abs(prev) * 100;
    if (Math.abs(d) < 0.5) return { txt: "0%", cls: "" };
    return { txt: `${d > 0 ? "▲" : "▼"} ${fmt(Math.abs(d), 0)}%`, cls: d > 0 ? "up" : "down" };
  }
  const deltaHtml = (d, prevLabel) => d ? `<span class="delta ${d.cls}" title="${esc(t("względem: {m}", { m: prevLabel }))}">${esc(d.txt)}</span>` : "";

  /** Wykres kolumnowy (grupy po 2 serie, jedna oś w zł) z podpowiedzią nad całą grupą. */
  function columns(data, series, { id, height = 230 } = {}) {
    const W = 640, H = height, padL = 48, padR = 8, padT = 12, padB = 26;
    const max = Math.max(1, ...data.flatMap(d => series.map(s => d[s.key])));
    const step = (() => { const raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; })();
    const top = step * 4, iw = W - padL - padR, ih = H - padT - padB;
    const y = v => padT + ih - v / top * ih;
    const short = v => v >= 1e6 ? fmt(v / 1e6, 1) + " " + t("mln") : v >= 1e3 ? fmt(v / 1e3, 0) + " " + t("tys.") : fmt(v, 0);
    const gw = iw / data.length, bw = Math.min(26, (gw - 14) / series.length - 2);
    let g = "";
    for (let i = 0; i <= 4; i++) { const v = step * i, yy = y(v); g += `<line class="grid-l" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/><text x="${padL - 6}" y="${yy + 3.5}" text-anchor="end">${esc(short(v))}</text>`; }
    data.forEach((d, i) => {
      const cx = padL + gw * i + gw / 2, x0 = cx - (series.length * (bw + 2) - 2) / 2;
      series.forEach((s, j) => {
        const v = d[s.key], x = x0 + j * (bw + 2), yy = y(v), h = padT + ih - yy;
        if (h > 0.5) { const r = Math.min(4, h, bw / 2); g += `<path class="bar" fill="${s.color}" d="M${x},${padT + ih} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${padT + ih} Z"/>`; }
      });
      g += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>`;
      g += `<rect class="col-hit" x="${padL + gw * i}" y="${padT}" width="${gw}" height="${ih}" data-tip="${esc(`<b>${esc(d.title)}</b><br>` + series.map(s => `${esc(s.label)}: ${esc(money(d[s.key]))}`).join("<br>") + (d.note ? `<br>${esc(d.note)}` : ""))}"/>`;
    });
    g += `<line class="axis" x1="${padL}" x2="${W - padR}" y1="${padT + ih}" y2="${padT + ih}"/>`;
    return `<svg class="cols" id="${id}" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(series.map(s => s.label).join(" / "))}">${g}</svg>`;
  }

  Views.pulpit = {
    html() {
      const S = Store.state, wh = App.wh(), u = App.user(), cfg = S.config, today = App.today(), ym = Dates.ym(today), prevYm = Dates.addMonths(ym, -1);
      const biz = m => R.Reports.business(S, { mode: "month", from: Dates.monthStart(m), to: m === ym ? today : Dates.monthEnd(m), whId: wh.id });
      const month = biz(ym), prev = R.Reports.business(S, { mode: "month", from: Dates.monthStart(prevYm), to: Dates.monthEnd(prevYm), whId: wh.id });
      const f = App.tabs.dash || (App.tabs.dash = { mode: "month", noYear: false });
      const rg = rangeOf(f);
      const turn = R.Reports.turnover(S, rg.from, rg.to, wh.id);
      const stock = Stock.byProduct(S, wh.id);
      const byCat = { m3: 0, MP: 0, t: 0 }, massCat = { m3: 0, MP: 0, t: 0 };
      for (const [pid, q] of stock) { const p = App.product(pid); if (!p) continue; byCat[p.unit] = R.rq(byCat[p.unit] + q); massCat[p.unit] += Units.mass(q, p, cfg); }
      const valuation = R.Reports.business(S, { mode: "custom", from: today, to: today, whId: wh.id }).valuation;
      const valTotal = valuation.filter(v => v.priced).reduce((a, v) => a + v.closingValue, 0), unpriced = valuation.filter(v => !v.priced).length;
      const mT = cat => (month.turnover.find(x => x.cat === cat) || {});
      const sales = r => r.sales.value + r.sales.valueDirect;
      const costs = r => r.purchases.value + r.production.chippingCost + r.transport.cost + ((r.extras && r.extras.cost) || 0);
      const prevLabel = Dates.label(prevYm);
      const opsMonth = S.operations.filter(o => o.whId === wh.id && Dates.ym(o.date) === ym && o.status !== "CANCELLED").length;
      const series30 = (unit) => { const ids = S.products.filter(p => p.unit === unit).map(p => p.id); const days = 30, out = []; const per = ids.map(id => Stock.series(S, wh.id, id, today, days)); for (let i = 0; i < days; i++) out.push({ date: per[0] ? per[0][i].date : today, qty: per.reduce((a, s) => a + s[i].qty, 0) }); return out; };

      /* ---------- nagłówek ---------- */
      const h = new Date().getHours();
      const hello = h < 5 || h >= 18 ? t("Dobry wieczór") : t("Dzień dobry");
      const openPrev = S.inventory.filter(p => p.whId === wh.id && p.status === "OTWARTA" && p.ym < ym).length;
      const hero = `<section class="hero" id="dash-hero"><div class="rings" aria-hidden="true"></div>
        <div class="hero-top"><div class="titles"><div class="hello">${esc(hello)}, ${esc(u.name.split(" ")[0])}</div>
          <h2>${esc(t("Pulpit — {w}", { w: wh.name }))}</h2>
          <p>${esc(t("{m} · dane na {d} · te same liczby co w raportach i PDF", { m: Dates.label(ym), d: Dates.pl(today) }))}</p>
          <div class="hero-chips"><span class="hero-chip">${ic("user", 13)} ${esc(App.roleLabel(u.role))}</span><span class="hero-chip">${ic(Store.mode === "server" ? "server" : "db", 13)} ${esc(Store.mode === "server" ? t("Praca wielostanowiskowa") : t("Tryb lokalny"))}</span>${openPrev ? `<span class="hero-chip warn">${ic("alert", 13)} ${esc(tp("{n} niezamknięty okres|{n} niezamknięte okresy|{n} niezamkniętych okresów", openPrev))}</span>` : ""}</div></div>
          <div class="actions">${App.can("op.create") ? `<a class="btn primary" href="#/nowa">${ic("plus", 15)} ${th("Nowa operacja")}</a>` : ""}<a class="btn" href="#/raporty">${ic("chart", 15)} ${th("Raport miesiąca")}</a></div></div>
        <div class="hero-stats" id="hero-stats">
          <div><b>${esc(money(sales(month)))}</b><span>${th("Sprzedaż w miesiącu")}</span></div>
          <div><b>${esc(money(costs(month)))}</b><span>${th("Koszty: zakup, rąbanie, transport, operacje dodatkowe")}</span></div>
          <div><b>${esc(money(sales(month) - costs(month)))}</b><span>${th("Wynik operacji w miesiącu")}</span></div>
          <div><b>${opsMonth}</b><span>${esc(tp("operacja w miesiącu|operacje w miesiącu|operacji w miesiącu", opsMonth))}</span></div></div></section>`;

      /* ---------- szybkie akcje ---------- */
      const qa = (preset, icon, title, sub) => `<a class="qa" href="#/nowa?preset=${preset}"><span class="qi">${ic(icon, 18)}</span><span><b>${th(title)}</b><span>${th(sub)}</span></span></a>`;
      const quick = App.can("op.create") ? `<div class="qa-grid" id="quick">
          ${qa("zakup", "inbox", N_("Zakup"), N_("dostawca → magazyn (PZ)"))}
          ${qa("wz", "out", N_("Sprzedaż z magazynu"), N_("magazyn → odbiorca (WZ)"))}
          ${qa("produkcja", "factory", N_("Produkcja na magazynie"), N_("podaj MP → zużycie liczy system"))}
          ${qa("bezposrednia", "truck", N_("Produkcja + sprzedaż bezp."), N_("las → produkcja → odbiorca"))}
          ${qa("mm", "swap", N_("Przesunięcie MM"), N_("magazyn → magazyn"))}</div>` : "";

      /* ---------- wskaźniki ---------- */
      const kpi = ({ id, icon, tone = "", title, value, unit, sub, d, drill, spark }) => `<div class="kpi2" id="${id}"><div class="k-h"><span class="k-i ${tone}">${ic(icon, 17)}</span><span class="k-t">${esc(title)}</span></div>
        <div class="k-v"${drillAttr(drill, title)}>${value}${unit ? `<u>${esc(unit)}</u>` : ""}</div><div class="k-s">${deltaHtml(d, prevLabel)}${sub ? `<span>${sub}</span>` : ""}</div>${spark || ""}</div>`;
      const kpis = [
        kpi({ id: "kpi-wood", icon: "layers", title: t("Drewno na stanie"), value: fmtQ(byCat.m3, 1), unit: "m³", sub: `≈ ${fmt(massCat.m3, 0)} t · ≈ ${fmt(massCat.m3 * cfg.t_gj, 0)} GJ`, spark: sparkline(series30("m3"), "m³", 90, 26, "var(--chart-a)") }),
        kpi({ id: "kpi-chip", icon: "box", title: t("Zrębka na stanie (wszystkie)"), value: fmtQ(byCat.MP, 1), unit: "MP", sub: `≈ ${fmt(massCat.MP, 0)} t · ≈ ${fmt(massCat.MP * cfg.t_gj, 0)} GJ`, spark: sparkline(series30("MP"), "MP", 90, 26, "var(--chart-a)") }),
        kpi({ id: "kpi-ton", icon: "box", tone: "gold", title: t("Produkty tonowe"), value: fmtQ(byCat.t, 1), unit: "t", sub: esc(t("≈ {gj} GJ · PKS, łupina", { gj: fmt(massCat.t * cfg.t_gj, 0) })) }),
        kpi({ id: "kpi-value", icon: "coins", tone: "gold", title: t("Wartość stanu (wycena)"), value: fmt(valTotal, 0), unit: "zł", sub: esc(unpriced ? t("bez wyceny: {n} poz.", { n: unpriced }) : t("średnia cena zakupu")) }),
        kpi({ id: "kpi-purchase", icon: "inbox", tone: "info", title: t("Zakup (miesiąc)"), value: fmt(month.purchases.value, 0), unit: "zł", d: delta(month.purchases.value, prev.purchases.value), sub: `${esc(tp("{n} operacja|{n} operacje|{n} operacji", month.purchases.count))} · ${esc(qtyByUnit(month.purchases.byUnit))}`, drill: mT("ZAKUP").opIds }),
        kpi({ id: "kpi-sales", icon: "trend", title: t("Sprzedaż (miesiąc)"), value: fmt(sales(month), 0), unit: "zł", d: delta(sales(month), sales(prev)), sub: esc(t("w tym bezp. {m}", { m: money(month.sales.valueDirect) })), drill: mT("SPRZEDAZ").opIds }),
        kpi({ id: "kpi-prod", icon: "factory", title: t("Produkcja (miesiąc)"), value: fmtQ(month.production.chippingMP, 1), unit: "MP", d: delta(month.production.chippingMP, prev.production.chippingMP), sub: esc(t("rąbanie {m}", { m: money(month.production.chippingCost) })), drill: mT("PRODUKCJA").opIds }),
        kpi({ id: "kpi-transport", icon: "truck", tone: "info", title: t("Transport (miesiąc)"), value: String(month.transport.trips), unit: t("kursów"), d: delta(month.transport.cost, prev.transport.cost), sub: `${esc(money(month.transport.cost))} · ${fmtQ(month.transport.km, 0)} km` })
      ].join("");

      /* ---------- operacje dodatkowe (wybrany miesiąc) ---------- */
      const xf = App.tabs.dashExtras || (App.tabs.dashExtras = { ym });
      if (!/^\d{4}-\d{2}$/.test(xf.ym || "")) xf.ym = ym;
      const xr = R.Reports.extras(S, Dates.monthStart(xf.ym), xf.ym === ym ? today : Dates.monthEnd(xf.ym), wh.id);
      const xRows = xr.rows.slice(0, 12);
      const extrasCard = `<div class="card mt4" id="dash-extras"><div class="card-h"><h3>${th("OPERACJE DODATKOWE")}</h3><span class="sub">${esc(t("magazyn {w}", { w: wh.name }))}</span><span class="spacer"></span>
          <label class="sr-only" for="xt-month">${th("Miesiąc")}</label><input class="ctrl sm" type="month" id="xt-month" value="${esc(xf.ym)}" max="${esc(ym)}"></div>
        <div class="card-b"><div class="xt-sum" id="xt-sum"><div><small>${th("Koszt łączny")}</small><b id="xt-cost">${esc(money(xr.cost))}</b></div><div><small>${th("Liczba operacji dodatkowych")}</small><b id="xt-count">${xr.count}</b></div><div><small>${th("Miesiąc")}</small><b>${esc(Dates.label(xf.ym))}</b></div></div>
          ${xr.byType.length ? `<div class="xt-types">${xr.byType.map(b => `<span class="chip">${esc(b.name)}: ${b.count} · ${esc(money(b.cost))}</span>`).join("")}</div>` : ""}
          ${xRows.length ? `<div class="tbl-wrap"><table class="tbl stack" id="xt-table"><thead><tr><th>${th("Data")}</th><th>${th("Rodzaj")}</th><th>${th("Pojazd")}</th><th>${th("Magazyn")}</th><th>${th("Dokument / produkcja")}</th><th class="r">${th("Koszt")}</th></tr></thead><tbody>${xRows.map(r => `<tr class="clickable" data-open-op="${esc(r.opId)}"><td data-l="${th("Data")}">${esc(Dates.pl(r.date))}</td><td data-l="${th("Rodzaj")}">${esc(r.typeName)}${r.desc ? `<div class="dim small">${esc(r.desc)}</div>` : ""}</td><td data-l="${th("Pojazd")}">${esc(r.vehicleName ? r.vehicleName + (r.reg ? " · " + r.reg : "") : "—")}</td><td data-l="${th("Magazyn")}">${esc(r.whName)}</td><td data-l="${th("Dokument / produkcja")}" class="mono">${esc(r.docNo)}</td><td data-l="${th("Koszt")}" class="r">${esc(money(r.cost))}</td></tr>`).join("")}</tbody></table></div>${xr.rows.length > xRows.length ? `<p class="help mt2">${esc(t("Pokazano {n} z {m} — pełna lista w raporcie miesiąca.", { n: xRows.length, m: xr.rows.length }))}</p>` : ""}` : `<div class="empty">${th("Brak operacji dodatkowych w wybranym miesiącu.")}</div>`}</div></div>`;

      /* ---------- wykres 6 miesięcy ---------- */
      const months = []; for (let i = 5; i >= 0; i--) months.push(Dates.addMonths(ym, -i));
      const data = months.map(m => { const r = m === ym ? month : m === prevYm ? prev : biz(m); return { label: Dates.short(m), title: Dates.label(m), sales: sales(r), purchase: r.purchases.value, note: t("Wynik: {m}", { m: money(sales(r) - costs(r)) }) }; });
      const ser = [{ key: "sales", label: t("Sprzedaż"), color: "var(--chart-a)" }, { key: "purchase", label: t("Zakupy"), color: "var(--chart-b)" }];
      const chartTbl = `<div class="tbl-wrap hidden" id="trend-table"><table class="tbl"><thead><tr><th>${th("Miesiąc")}</th><th class="r">${th("Sprzedaż")}</th><th class="r">${th("Zakupy")}</th></tr></thead><tbody>${data.map(d => `<tr><td>${esc(d.title)}</td><td class="r">${esc(money(d.sales))}</td><td class="r">${esc(money(d.purchase))}</td></tr>`).join("")}</tbody></table></div>`;
      const chart = `<div class="card" id="dash-trend"><div class="card-h"><h3>${th("Sprzedaż i zakupy — ostatnie 6 miesięcy")}</h3><span class="sub">${esc(t("magazyn {w} · zł netto", { w: wh.name }))}</span><span class="spacer"></span>
          <div class="legend">${ser.map(s => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join("")}</div>
          <button class="btn sm ghost" type="button" id="trend-toggle" aria-pressed="false">${ic("list", 13)} ${th("Tabela")}</button></div>
        <div class="card-b" id="trend-chart">${columns(data, ser, { id: "trend-svg" })}</div>${chartTbl}</div>`;

      /* ---------- obroty ---------- */
      const turnItems = ["ZAKUP", "PRODUKCJA", "ZUZYCIE", "SPRZEDAZ", "MM"].map(c => { const x = turn.find(y => y.cat === c); return { label: x.label, value: x.count, t: x, drill: x.opIds.join(",") }; });
      const turnover = `<div class="card" id="dash-turnover"><div class="card-h"><h3>${th("OBROTY WEDŁUG TYPU OPERACJI")}</h3><span class="sub">${esc(rg.label)}</span></div>
          <div class="toolbar">${periodControls(f, "dash")}</div>
          <div class="card-b"><p class="help mb3">${th("Liczba operacji w zakresie (bez anulowanych). Ilości pokazane osobno dla każdej jednostki — jednostek się nie sumuje. Kliknij wiersz, aby zobaczyć operacje.")}</p>
            ${hbar(turnItems, { id: "turn-chart", valueText: i => t("{n} op.", { n: i.value }), tip: i => `<b>${esc(i.label)}</b><br>${esc(tp("{n} operacja|{n} operacje|{n} operacji", i.value))}<br>${esc(qtyByUnit(i.t.byUnit))}${i.t.value !== null ? `<br>${esc(i.t.valueLabel)}: ${esc(money(i.t.value))}` : ""}` })}
            <div class="turn-grid mt4" id="turn-cards">${turnItems.map(i => `<div class="turn-card"><small>${esc(i.label)}</small><b>${esc(qtyByUnit(i.t.byUnit))}</b>${i.t.value !== null ? `<small>${esc(i.t.valueLabel)}: ${esc(money(i.t.value))}</small>` : `<small>—</small>`}</div>`).join("")}</div></div></div>`;

      /* ---------- stany ---------- */
      const prods = S.products.filter(p => Math.abs(stock.get(p.id) || 0) > R.EPS);
      const maxBy = {}; prods.forEach(p => { maxBy[p.unit] = Math.max(maxBy[p.unit] || 0, stock.get(p.id)); });
      const tiles = prods.map(p => {
        const q = stock.get(p.id), o = Units.orient(q, p, cfg);
        return `<button class="stile" type="button" data-stock-product="${esc(p.id)}"><div class="st-h"><b title="${esc(p.name)}">${esc(p.name)}</b><small>${esc(p.code)}</small></div>
          <div class="st-v">${esc(App.qtyNative(q, p.id, 1))}</div><div class="st-s">${p.unit === "t" ? "" : `≈ ${fmt(o.t, 0)} t · `}≈ ${fmt(o.gj, 0)} GJ</div>
          <div class="meter"><i style="width:${Math.max(3, q / maxBy[p.unit] * 100)}%"></i></div>
          <div class="mt2">${sparkline(Stock.series(S, wh.id, p.id, today, 30), Units.label(p.unit), 180, 28)}</div></button>`;
      }).join("");
      const stockCard = `<div class="card" id="dash-stock-card"><div class="card-h"><h3>${th("Stany magazynowe wg produktu")}</h3><span class="sub">${th("jednostka produktu · masa i energia orientacyjnie · linia = ostatnie 30 dni")}</span><span class="spacer"></span><a class="btn sm" href="#/stany">${th("Wszystkie stany")}</a></div>
          <div class="card-b"><div class="stock-tiles" id="dash-stock">${tiles || `<div class="empty">${th("Brak stanów.")}</div>`}</div></div></div>`;

      /* ---------- aktywność ---------- */
      const tone = a => a.event === "cancel" ? "err" : /correction/.test(a.event || "") ? "warn" : a.event === "create" ? "ok" : a.event === "print" || a.event === "backup" ? "info" : "";
      const icon = a => a.event === "cancel" ? "ban" : /correction/.test(a.event || "") ? "edit" : a.event === "create" ? "check" : a.event === "print" ? "print" : a.entity === "inventory" ? "clipboard" : a.entity === "fleet" ? "truck" : a.entity === "user" ? "user" : "file";
      const feed = S.audit.filter(a => !a.whId || a.whId === wh.id).slice(-8).reverse();
      const activity = `<div class="card" id="dash-activity"><div class="card-h"><h3>${th("Ostatnia aktywność")}</h3><span class="spacer"></span><a class="btn sm" href="#/historia">${th("Historia")}</a></div>
          <div class="card-b" style="padding-top:4px;padding-bottom:4px"><ul class="feed">${feed.map(a => `<li><span class="fi ${tone(a)}">${ic(icon(a), 14)}</span><div style="min-width:0"><div><b>${esc(a.userName === "System" ? t("System") : a.userName)}</b> · ${esc(R.auditText(a))}${a.opNo ? ` <span class="mono dim">${esc(a.opNo)}</span>` : ""}</div><div class="when">${esc(Dates.pl(a.ts.slice(0, 10)))} ${esc(a.ts.slice(11, 16))} · ${esc(t(a.source || ""))}</div></div></li>`).join("") || `<li class="dim">${th("Brak wpisów.")}</li>`}</ul></div></div>`;

      /* ---------- sprawy do załatwienia ---------- */
      const drafts = S.drafts.filter(d => d.userId === u.id);
      const per = R.Inventory.find(S, wh.id, ym);
      const alerts = [];
      const pendingForMe = S.drafts.filter(d => d.status === "PENDING" && R.canApprove(u, d.whId)).length;
      if (pendingForMe) alerts.push({ cls: "warn", href: "#/operacje", title: tp("{n} operacja czeka na zatwierdzenie|{n} operacje czekają na zatwierdzenie|{n} operacji czeka na zatwierdzenie", pendingForMe), text: t("Sprawdź i zatwierdź albo odrzuć z podaniem powodu.") });
      const mmIn = R.mmInTransit(S, wh.id, "in"), mmOut = R.mmInTransit(S, wh.id, "out");
      if (mmIn.length) alerts.push({ cls: "warn", href: "#/mm", title: tp("{n} MM do przyjęcia|{n} MM do przyjęcia|{n} MM do przyjęcia", mmIn.length), text: t("Towar w drodze do magazynu {w} — przyjmij MM, aby zwiększyć stan.", { w: wh.name }) });
      if (mmOut.length) alerts.push({ cls: "info", href: "#/mm", title: tp("{n} MM wysłane — w drodze|{n} MM wysłane — w drodze|{n} MM wysłanych — w drodze", mmOut.length), text: t("Czeka na przyjęcie przez magazyn docelowy.") });
      const myRejected = S.drafts.filter(d => d.userId === u.id && d.rejectReason && d.status !== "PENDING").length;
      if (myRejected) alerts.push({ cls: "warn", href: "#/operacje", title: tp("{n} operacja odrzucona|{n} operacje odrzucone|{n} operacji odrzuconych", myRejected), text: t("Popraw według uwag kierownika i przekaż ponownie.") });
      const myPending = S.drafts.filter(d => d.userId === u.id && d.status === "PENDING").length;
      if (myPending && !pendingForMe) alerts.push({ cls: "info", href: "#/operacje", title: tp("{n} operacja przekazana|{n} operacje przekazane|{n} operacji przekazanych", myPending), text: t("Czeka na zatwierdzenie przez kierownika magazynu.") });
      const regs = App.can("users.manage") ? S.users.filter(x => x.selfRegistered && R.statusOf(x) === "INVITED").length : 0;
      if (regs) alerts.push({ cls: "warn", href: "#/uzytkownicy", title: tp("{n} zgłoszenie rejestracji|{n} zgłoszenia rejestracji|{n} zgłoszeń rejestracji", regs), text: t("Nadaj rolę i magazyn albo odrzuć zgłoszenie.") });
      if (Store.mode === "local" && root.RIW_Auth && root.RIW_Auth.LocalAuth.info(u.id).demo) alerts.push({ cls: "info", href: "#/profil", title: t("Hasło startowe konta"), text: t("Konto używa hasła demonstracyjnego — zmień je w „Mój profil” przed pracą na prawdziwych danych.") });
      if (openPrev) alerts.push({ cls: "", href: "#/inwentaryzacja", title: tp("{n} niezamknięty okres|{n} niezamknięte okresy|{n} niezamkniętych okresów", openPrev), text: t("Zamknij poprzednie miesiące — do tego czasu dokumenty z tych okresów można zmieniać.") });
      if (!per) alerts.push({ cls: "info", href: "#/inwentaryzacja", title: t("Okres {ym} nie jest otwarty", { ym }), text: t("Otwórz okres inwentaryzacji bieżącego miesiąca, aby przygotować zamknięcie.") });
      else alerts.push({ cls: per.status === "OTWARTA" ? "info" : "ok", href: "#/inwentaryzacja", title: t("Okres {ym}: {s}", { ym, s: t(R.INV_STATUS[per.status]) }), text: t("Po zamknięciu okresu dokumenty z tego miesiąca są tylko do odczytu — zmiany wyłącznie korektą z bieżącą datą.") });
      if (drafts.length) alerts.push({ cls: "info", href: `#/nowa?draft=${drafts[0].id}`, title: tp("{n} wersja robocza|{n} wersje robocze|{n} wersji roboczych", drafts.length), text: t("Dokończ i zatwierdź albo usuń szkic w rejestrze operacji.") });
      if (unpriced) alerts.push({ cls: "info", href: "#/raporty", title: t("Pozycje bez wyceny: {n}", { n: unpriced }), text: t("Brak zakupów tych produktów — wycena stanu jest niepełna.") });
      const alertIcon = c => c === "ok" ? "check" : c === "info" ? "bell" : "alert";
      const todo = `<div class="card" id="dash-todo"><div class="card-h"><h3>${th("Do załatwienia")}</h3></div><div class="card-b"><div class="alerts">${alerts.map(a => `<a class="alert-item ${a.cls}" href="${a.href}"><span class="ai">${ic(alertIcon(a.cls), 16)}</span><span><b>${esc(a.title)}</b>${esc(a.text)}</span></a>`).join("")}</div>
          <h4 class="mini-h">${th("Przeliczniki")}</h4><dl class="money-list"><dt>${th("1 m³ drewna")}</dt><dd>${fmtQ(cfg.m3_mp)} ${th("MP zrębki")}</dd><dt>1 MP</dt><dd>${fmtQ(1 / cfg.m3_mp, 3)} m³ · ${fmt(cfg.mp_t, 2)} t</dd><dt>${th("1 t biomasy")}</dt><dd>≈ ${fmt(cfg.t_gj, 1)} GJ</dd><dt>${th("Cena za rąbanie")}</dt><dd>${fmt(cfg.chipRateDefault)} zł/MP</dd></dl></div></div>`;

      /* ---------- ostatnie operacje ---------- */
      const last = S.operations.filter(o => o.whId === wh.id || o.toWhId === wh.id).slice().sort((a, b) => a.createdAt < b.createdAt ? 1 : -1).slice(0, 8);
      const lastOps = `<div class="card mt4"><div class="card-h"><h3>${th("Ostatnie operacje")}</h3><span class="spacer"></span><a class="btn sm" href="#/operacje">${th("Wszystkie operacje")}</a></div>${opsTable(last, { id: "last-ops", compact: true })}</div>`;

      return `${hero}${quick}<div class="kpi2-grid" id="kpis">${kpis}</div>
        <div class="dash-main">${chart}${turnover}</div>
        ${extrasCard}
        <div class="mt4">${stockCard}</div>
        <div class="dash-row">${activity}${todo}</div>
        ${lastOps}`;
    },
    bind(page) {
      const f = App.tabs.dash;
      bindPeriod(page, f, "dash", () => App.render());
      $$("[data-drill]", page).forEach(el => { if (el.classList.contains("hbar-row")) el.classList.add("drill"); });
      bindDrill(page); bindOps(page); Tip.bind(page);
      $$("[data-stock-product]", page).forEach(b => b.onclick = () => { const S = Store.state; if (root.RIWUI.Views.stany && root.RIWUI.Views.stany.card) root.RIWUI.Views.stany.card(App.user().whId, b.dataset.stockProduct); });
      const xm = $("#xt-month", page);
      if (xm) xm.onchange = () => { if (/^\d{4}-\d{2}$/.test(xm.value)) { App.tabs.dashExtras = { ym: xm.value }; App.render(); } };
      $$("[data-open-op]", page).forEach(tr => tr.onclick = () => root.RIWUI.OpDetail.open(tr.dataset.openOp));
      const tg = $("#trend-toggle", page);
      if (tg) tg.onclick = () => { const on = tg.getAttribute("aria-pressed") !== "true"; tg.setAttribute("aria-pressed", String(on)); $("#trend-table", page).classList.toggle("hidden", !on); $("#trend-chart", page).classList.toggle("hidden", on); };
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
