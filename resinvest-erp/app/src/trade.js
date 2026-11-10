/* =========================================================================
   ResInvest ERP 3.8 — warstwa S: ewidencja obrotu (eksport CSV / XLSX)

   Jeden wiersz = jeden ruch towaru w transakcji (numer WZ):
     Zakup     — dostawca → magazyn (albo prosto do produkcji),
     Produkcja — rąbanie drewna na zrębkę (w transakcji zakupu, sprzedaży bezpośredniej albo na magazynie),
     Sprzedaż  — magazyn / produkcja → odbiorca,
     MM        — przesunięcie między magazynami firmy.
   Transakcja „zakup + produkcja + sprzedaż bezpośrednia” daje trzy wiersze z tym samym numerem WZ.
   Transport (firma, nr rej., km, koszt) jest przypisany do ostatniego wiersza transakcji — ten ruch
   jest przewożony — dzięki temu suma kolumny „Koszt transportu” = koszt transportu w raportach.
   Kolumny są stałe (nazwy z ewidencji firmy), liczby surowe — widok zamienia je na zapis polski.
   Kolumny planera: plan dnia magazynu, plan i wykonanie miesiąca, udział operacji w wykonaniu planu.
   Anulowane i usunięte transakcje są pomijane. Moduł działa w przeglądarce i w Node (testy, serwer).
   ========================================================================= */
(function (root) {
  "use strict";
  const R = root.RIW || (typeof require === "function" ? require("./engine.js") : null);
  const P = R.Planner || (typeof require === "function" ? require("./planner.js") : null);
  const { round, rq, byId, Units, EPS } = R;
  const str = v => String(v == null ? "" : v).trim();

  /** Kolumny ewidencji (kolejność i nazwy według zestawienia firmy) + kolumny planera i jednostki cen. */
  const COLUMNS = [
    "Data załadunku do klienta końcowego", "Miejsce załadunku", "Data operacji", "Dostawca", "Zakup/Sprzedaż", "Nr. WZ",
    "Czy magazynowane (TAK / NIE)", "Deklaracja/KZR", "Volumen", "Jednostka miary", "Cena zakupu/produkcji (zł/mp;zł/tona)", "Wartość",
    "Cena sprzedaży (zł/mp;zł/tona)", "Produkt", "Rodzaj zrębki a/b", "Rąbanie własne/wynajęte (kto)", "Koszt rąbania usługa",
    "Transport: Firma", "Nr. Rejestracyjny", "Odległość km", "Koszt transportu", "Odbiorca", "Uwagi", "Miejsce pochodzenia",
    "Data dodania wpisu", "Wolumen_MP", "Wolumen_t", "Wolumen_GJ", "Ruch_magazyn_MP", "Ruch_magazyn_t",
    "Wartość_zakupu_zł_calc", "Wartość_sprzedaży_zł_calc", "Typ_transportu_heurystyka", "Koszt_rąbania_total", "Miesiąc_tekst", "Rok",
    "Jednostka_ceny_zakupu", "Jednostka_ceny_sprzedaży", "Magazyn",
    "Plan_dnia_MP", "Uwagi_planu", "Plan_miesiąca_MP", "Wykonanie_miesiąca_MP", "Realizacja_miesiąca_%", "Wykonanie_planera_MP"
  ];
  const MONTHS = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];
  const BASIS = { DEKL: "Deklaracja", KZR: "KZR" };
  /** Rodzaj zrębki: zrębka leśna = a, zrębka inwestycyjna = b (rodzaj produkcji albo produkt). */
  const CHIP_KIND = { lesna: "a", inwestycyjna: "b" };
  const CHIP_PRODUCT = { pr_zr_lesna: "a", pr_zr_inw: "b" };
  const ulabel = u => u === "m3" ? "m³" : (u || "");

  /** Typ transportu (opis heurystyczny — z trybu transportu i danych kursów). */
  function transportType(T) {
    if (!T || !T.mode || T.mode === "none") return "brak transportu";
    if (T.mode === "own") return "własny";
    if (T.mode === "external") return T.includedInPrice ? "zewnętrzny (wliczony w cenę)" : (T.companies && T.companies.length > 1 ? `zewnętrzny (${T.companies.length} firmy)` : "zewnętrzny");
    if (T.mode === "mixed") return "mieszany (własny + zewnętrzny)";
    if (T.mode === "train") return "kolejowy";
    if (T.mode === "supplier") return "dostawca (w cenie zakupu)";
    return T.mode;
  }
  /** Transport transakcji: firma, numery rejestracyjne, km, koszt. */
  function transportCols(T) {
    if (!T || !T.mode || T.mode === "none") return { firma: "", reg: "", km: "", cost: "" };
    if (T.mode === "train") return { firma: str(T.carrier), reg: [T.trainNo, T.wagonCount ? `${T.wagonCount} wag.` : ""].filter(Boolean).join(" · "), km: "", cost: round(T.cost || 0, 2) };
    if (T.mode === "supplier") return { firma: str(T.company) || "dostawca", reg: "", km: "", cost: round(T.cost || 0, 2) };
    const runs = Array.isArray(T.runs) ? T.runs : [];
    const firms = [];
    if (runs.some(r => r.kind === "own")) firms.push("flota własna");
    for (const r of runs) if (r.kind === "external") { const c = str(r.company || T.company); if (c && !firms.includes(c)) firms.push(c); }
    if (!runs.length && T.company) firms.push(T.company);
    return { firma: firms.join(", "), reg: [...new Set(runs.map(r => str(r.reg)).filter(Boolean))].join(", ") || str(T.reg), km: rq(T.km || 0), cost: round(T.cost || 0, 2) };
  }
  /** Ilość produktu w MP / t / GJ (puste, gdy produkt nie ma przelicznika). */
  function volumes(state, productId, qty, unit, weightT) {
    const cfg = state.config, p = byId(state.products, productId);
    if (!p || qty === "" || qty == null) return { mp: "", t: "", gj: "" };
    let mp = "", t = "";
    try { mp = Units.convert(qty, unit, "MP", p, cfg); } catch (e) { mp = ""; }
    if (weightT != null && weightT !== "" && Number.isFinite(Number(weightT))) t = rq(Number(weightT));
    else { try { t = Units.convert(qty, unit, "t", p, cfg); } catch (e) { try { t = Units.mass(Units.convert(qty, unit, p.unit, p, cfg), p, cfg); } catch (e2) { t = ""; } } }
    return { mp, t, gj: t === "" ? "" : Units.energy(t, cfg) };
  }
  /** Ruch stanu (w jednostce magazynowej produktu) → MP i t. */
  function movement(state, productId, stockQty) {
    const p = byId(state.products, productId);
    if (!p || !stockQty) return { mp: 0, t: 0 };
    const cfg = state.config;
    let mp = ""; try { mp = Units.convert(stockQty, p.unit, "MP", p, cfg); } catch (e) { mp = ""; }
    return { mp, t: Units.mass(stockQty, p, cfg) };
  }
  const partnerName = (state, id) => (byId(state.partners, id) || {}).name || "";
  const whName = (state, id) => (byId(state.warehouses, id) || {}).name || "";
  const localTs = iso => { if (!iso) return ""; const d = new Date(iso); if (isNaN(d)) return String(iso); const z = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };

  /** Pochodzenie surowca: nadleśnictwo / leśnictwo, budowa (wycinka inwestycyjna) albo miejscowość dostawcy. */
  function originOf(state, op) {
    const Pr = op.production || {}, Pu = op.purchase || {};
    if (Pr.ndl) return [`Nadleśnictwo ${Pr.ndl}`, Pr.lesnictwo].filter(Boolean).join(" · ");
    if (Pr.investSite) return Pr.investSite;
    if (Pu.lesnictwo) return [Pu.supplierName || partnerName(state, Pu.supplierId), Pu.lesnictwo].filter(Boolean).join(" · ");
    if (op.purchase) { const s = byId(state.partners, Pu.supplierId); return [s ? s.name : Pu.supplierName, s && s.city].filter(Boolean).join(" · "); }
    if (op.type === "MM" || (op.sale && op.sale.fromStock) || op.type === "PRODUKCJA") return whName(state, op.whId);
    return "";
  }
  /** Miejsce załadunku: bocznica (kolej), las / budowa (produkcja w lesie), magazyn (sprzedaż ze stanu, MM, produkcja na placu). */
  function loadPlaceOf(state, op) {
    const T = op.transport || {};
    if (T.mode === "train" && T.loadPlace) return T.loadPlace;
    if (op.type === "MM" || (op.sale && op.sale.fromStock) || op.type === "PRODUKCJA") return whName(state, op.mm ? op.mm.fromWhId || op.whId : op.whId);
    return originOf(state, op);
  }

  /** Kolumny planera dla magazynu i dnia operacji (pamięć podręczna na jedno wywołanie). */
  function plannerCols(state, op, cache) {
    if (!P) return {};
    const ym = String(op.date).slice(0, 7), key = `${op.whId}|${ym}`;
    if (!cache.has(key)) {
      const [y, m] = ym.split("-").map(Number);
      const to = `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
      const days = P.days(state, [op.whId], `${ym}-01`, to, "9999-12-31");
      const tot = P.totals(days);
      cache.set(key, { byDay: new Map(days.map(d => [d.date, d])), plan: tot.plan, act: tot.act, real: tot.plan > EPS ? round(tot.act / tot.plan * 100, 1) : "" });
    }
    const c = cache.get(key), d = c.byDay.get(op.date) || {}, pop = P.plannerOp(state, op);
    return { planDay: d.plan || 0, planNote: d.note || "", planMonth: c.plan, actMonth: c.act, real: c.real, opMp: pop ? pop.mp : 0 };
  }

  /** Wiersze ewidencji dla operacji (filtr: od, do, magazyny, lista id operacji). */
  function rows(state, f = {}) {
    const W = f.whIds ? new Set(f.whIds) : null, ids = f.opIds ? new Set(f.opIds) : null;
    const ops = state.operations.filter(o => !o.deleted && o.status !== "CANCELLED" && o.status !== "PENDING" && o.status !== "DRAFT" &&
      (!W || W.has(o.whId) || (o.toWhId && W.has(o.toWhId))) && (!f.from || o.date >= f.from) && (!f.to || o.date <= f.to) && (!ids || ids.has(o.id)))
      .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.no).localeCompare(String(b.no)));
    const out = [], cache = new Map();
    for (const op of ops) {
      const Pu = op.purchase, Pr = op.production, S = op.sale, M = op.mm, T = op.transport || {};
      const tot = op.totals || {};
      const base = {
        dataOp: op.date, nr: op.no, dostawca: Pu ? (Pu.supplierName || partnerName(state, Pu.supplierId)) : "",
        basis: Pu ? (BASIS[Pu.basis] || Pu.basis || "") : "", odbiorca: S ? partnerName(state, S.buyerId) : "",
        uwagi: [op.notes, op.extDoc ? `dok. zewn.: ${op.extDoc}` : ""].filter(Boolean).join(" · "), origin: originOf(state, op), load: loadPlaceOf(state, op),
        added: localTs(op.createdAt), month: MONTHS[Number(String(op.date).slice(5, 7)) - 1] || "", year: Number(String(op.date).slice(0, 4)), wh: whName(state, op.whId),
        chipKind: Pr ? (CHIP_KIND[Pr.type] || "") : "", plan: plannerCols(state, op, cache)
      };
      const consumedSame = Pu && Pr && Pr.rawProductId === Pu.productId ? Number(Pr.consumeQty) || 0 : 0;
      const lines = [];
      if (Pu) {
        const stockIn = rq((Pu.stockQty || 0) - consumedSame);
        lines.push({ kind: "Zakup", productId: Pu.productId, qty: Pu.qty, unit: Pu.unit, weightT: Pu.weightT, priceBuy: Pu.price, priceBuyUnit: Pu.priceUnit, value: round(tot.purchaseCost || Pu.cost || 0, 2),
          buyCalc: round((tot.purchaseCost || 0) + (tot.rawCost || 0), 2), stockQty: stockIn });
      }
      if (Pr) {
        const ch = Pr.chipperOwner === "external" ? `wynajęte — ${Pr.chipperCompany || Pr.chipperName || ""}`.trim() : Pr.chipperName ? `własne — ${Pr.chipperName}${Pr.operatorName ? ` (${Pr.operatorName})` : ""}` : "";
        let stock = op.direct ? 0 : Number(Pr.outQty) || 0;
        const rawMove = Pr.mode === "stock" ? -(Number(Pr.consumeQty) || 0) : 0;            // produkcja na magazynie zużywa surowiec ze stanu
        lines.push({ kind: "Produkcja", productId: Pr.outProductId, qty: Pr.outQty, unit: Pr.outUnit, weightT: null, priceBuy: Pr.chipRate, priceBuyUnit: Pr.outUnit, value: round(Pr.chippingCost || 0, 2),
          stockQty: stock, rawMove: rawMove ? { productId: Pr.rawProductId, qty: rawMove } : null, chip: ch, chipService: Pr.chipperOwner === "external" ? round(Pr.chippingCost || 0, 2) : 0, chipTotal: round(Pr.chippingCost || 0, 2),
          buyCalc: Pu ? "" : round(tot.rawCost || 0, 2) });
      }
      if (S) {
        lines.push({ kind: "Sprzedaż", productId: S.productId, qty: S.qty, unit: S.unit, weightT: S.weightT, priceSell: S.price, priceSellUnit: S.priceUnit, value: round(S.revenue || 0, 2),
          sellCalc: round(tot.revenue || S.revenue || 0, 2), stockQty: op.direct ? 0 : -(Number(S.stockQty) || 0), loadDate: op.docDate || op.date });
      }
      if (M) lines.push({ kind: "MM", productId: M.productId, qty: M.qty, unit: M.unit, weightT: M.weightT, value: "", stockQty: 0, mm: `${M.fromWhName || whName(state, M.fromWhId)} → ${M.toWhName || whName(state, M.toWhId)}` });
      if (!lines.length) continue;
      const tr = transportCols(T), last = lines.length - 1;
      lines.forEach((ln, i) => {
        const v = volumes(state, ln.productId, ln.qty, ln.unit, ln.weightT);
        const mv = movement(state, ln.productId, ln.stockQty);
        if (ln.rawMove) { const rm = movement(state, ln.rawMove.productId, ln.rawMove.qty); mv.mp = mv.mp === "" || rm.mp === "" ? "" : rq(mv.mp + rm.mp); mv.t = rq(mv.t + rm.t); }
        const stored = Math.abs(Number(ln.stockQty) || 0) > EPS || !!ln.rawMove || ln.kind === "MM";
        const withTr = i === last;
        const pl = base.plan;
        out.push([
          ln.loadDate || "", base.load, base.dataOp, base.dostawca, ln.kind, base.nr,
          stored ? "TAK" : "NIE", ln.kind === "Zakup" ? base.basis : "", rq(Number(ln.qty) || 0), ulabel(ln.unit), ln.priceBuy != null ? ln.priceBuy : "", ln.value,
          ln.priceSell != null ? ln.priceSell : "", (byId(state.products, ln.productId) || {}).name || "", ln.kind === "Zakup" && !Pr ? (CHIP_PRODUCT[ln.productId] || "") : ln.kind === "Zakup" ? "" : (base.chipKind || CHIP_PRODUCT[ln.productId] || ""),
          ln.chip || "", ln.chipService != null ? ln.chipService : "",
          withTr ? tr.firma : "", withTr ? tr.reg : "", withTr ? tr.km : "", withTr ? tr.cost : "", ln.kind === "Sprzedaż" ? base.odbiorca : ln.kind === "MM" ? ln.mm : "", i === 0 ? base.uwagi : "", base.origin,
          base.added, v.mp, v.t, v.gj, mv.mp, mv.t,
          ln.buyCalc != null ? ln.buyCalc : "", ln.sellCalc != null ? ln.sellCalc : "", withTr ? transportType(T) : "", ln.chipTotal != null ? ln.chipTotal : "", base.month, base.year,
          ln.priceBuy != null ? `zł/${ulabel(ln.priceBuyUnit)}` : "", ln.priceSell != null ? `zł/${ulabel(ln.priceSellUnit)}` : "", base.wh,
          i === 0 ? pl.planDay : "", i === 0 ? pl.planNote : "", pl.planMonth, pl.actMonth, pl.real, i === 0 ? pl.opMp : ""
        ]);
      });
    }
    return out;
  }

  R.Trade = { COLUMNS, rows, transportType, CHIP_KIND };
  if (typeof module !== "undefined" && module.exports) module.exports = R.Trade;
})(typeof globalThis !== "undefined" ? globalThis : this);
