/* tradestats.js */
/* =========================================================================
   ResInvest ERP 3.12 (demo EUDR) — warstwa S: zestawienia obrotu dla pulpitu

   Bez DOM — działa w przeglądarce, na serwerze i w testach (Node).
   Jeden wiersz = jedna transakcja (operacja zatwierdzona, nieanulowana, nieusunięta):
     purchases() — zakupy (dostawca → magazyn / produkcja), z grupą dostawcy
                   (firma albo nadleśnictwo z leśnictwem),
     sales()     — sprzedaż (WZ z magazynu, łańcuch zakup → produkcja → odbiorca,
                   sprzedaż bezpośrednia z lasu), z miejscem dostawy i wagą.
   Ilości w trzech miarach: MP, m³ (ekwiwalent drewna litego wg przelicznika
   produktu) i t. Tona ma źródło: „waga” (kwit wagowy / waga ręczna / wagony),
   „dokument” (produkt liczony w tonach) albo „przelicznik” (orientacyjnie).
   Miara bez przelicznika (np. PKS w MP) = null — nie jest sumowana jako zero,
   suma dostaje znacznik `partial`.
   Liczby pochodzą z tych samych pól operacji co ewidencja obrotu (trade.js).
   ========================================================================= */
(function (root) {
  "use strict";
  const R = root.RIW || (typeof require === "function" ? require("./engine.js") : null);
  const { rq, round, byId, Units, Dates, EPS } = R;
  const str = v => String(v == null ? "" : v).trim();

  /** Operacja w obrocie: zatwierdzona, nieanulowana, nieusunięta (ta sama reguła co ewidencja obrotu). */
  const isLive = op => !!op && !op.deleted && !["CANCELLED", "PENDING", "DRAFT"].includes(op.status);
  const num = v => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) ? null : Number(v);

  /** Ilość w jednostce `unit` → { m3, mp, t } (null, gdy produkt nie ma przelicznika). */
  function measures(state, productId, qty, unit) {
    const p = byId(state.products, productId), cfg = state.config, q = num(qty);
    const out = { m3: null, mp: null, t: null };
    if (!p || q === null) return out;
    const conv = to => { try { return Units.convert(q, unit, to, p, cfg); } catch (e) { return null; } };
    out.m3 = conv("m3"); out.mp = conv("MP"); out.t = conv("t");
    let stockQ = null; try { stockQ = Units.convert(q, unit, p.unit, p, cfg); } catch (e) { stockQ = null; }
    if (out.t === null && stockQ !== null) out.t = Units.mass(stockQ, p, cfg);
    // zrębka (MP) nie ma m³ na dokumentach — ekwiwalent drewna litego z przelicznika produktu (MP ÷ k)
    if (out.m3 === null && stockQ !== null) {
      const { k, tm3 } = Units.factors(p, cfg);
      const x = p.unit === "MP" ? stockQ / k : p.unit === "t" && tm3 > 0 ? stockQ / tm3 : null;
      out.m3 = x !== null && Number.isFinite(x) ? rq(x) : null;
    }
    return out;
  }

  /** Waga z kursów transportu: wszystkie kursy z wagą (kwit wagowy) albo tonaż wagonów (kolej). */
  function transportWeight(T) {
    if (!T || !T.mode || T.mode === "none") return null;
    if (T.mode === "train") return num(T.totalT) > 0 ? rq(T.totalT) : null;
    const runs = Array.isArray(T.runs) ? T.runs : [];
    if (!runs.length || runs.some(r => !(num(r.weightT) > 0))) return null;
    return rq(runs.reduce((a, r) => a + Number(r.weightT), 0));
  }

  /** Tona transakcji: waga rzeczywista ma pierwszeństwo przed przelicznikiem. */
  function tonnage(m, unit, weightT, weightMode, trW) {
    if (weightMode === "manual" && num(weightT) > 0) return { t: rq(weightT), tSource: "waga" };
    if (trW !== null && trW !== undefined) return { t: trW, tSource: "waga" };
    if (unit === "t") return { t: m.t, tSource: "dokument" };
    if (num(weightT) > 0) return { t: rq(weightT), tSource: "przelicznik" };
    return { t: m.t, tSource: m.t === null ? "" : "przelicznik" };
  }

  const inRange = (op, f) => (!f.from || op.date >= f.from) && (!f.to || op.date <= f.to);
  const inWh = (op, f) => !f.whIds || f.whIds.includes(op.whId) || (op.toWhId && f.whIds.includes(op.toWhId));
  const catOk = (state, productId, f) => !f.cat || f.cat === "all" || ((byId(state.products, productId) || {}).cat === f.cat);
  const whName = (state, id) => (byId(state.warehouses, id) || {}).name || "";
  const pName = (state, id) => (byId(state.products, id) || {}).name || "";

  /**
   * Zakupy w zakresie. f: { from, to, whIds?, cat?, kind? ("firma" | "nadlesnictwo") }.
   * Dostawca z kartoteki — także operacje łańcuchowe (zakup + produkcja + sprzedaż).
   */
  function purchases(state, f = {}) {
    const out = [];
    for (const op of state.operations) {
      const P = op.purchase;
      if (!P || !isLive(op) || !inRange(op, f) || !inWh(op, f) || !catOk(state, P.productId, f)) continue;
      const supplier = byId(state.partners, P.supplierId);
      const kind = P.supplierKind || R.partnerKind(supplier) || "firma";
      if (f.kind && f.kind !== kind) continue;
      const m = measures(state, P.productId, P.qty, P.unit);
      const w = tonnage(m, P.unit, P.weightT, P.weightMode, null);
      const Pr = op.production || {};
      out.push({
        opId: op.id, no: op.no, date: op.date, ym: Dates.ym(op.date), whId: op.whId, whName: whName(state, op.whId),
        supplierId: P.supplierId, supplierName: P.supplierName || (supplier ? supplier.name : ""), kind, city: supplier ? str(supplier.city) : "",
        ndl: kind === "nadlesnictwo" ? (R.ndlName(supplier || { name: P.supplierName }) || str(Pr.ndl)) : str(Pr.ndl), lesnictwo: str(P.lesnictwo) || str(Pr.lesnictwo),
        productId: P.productId, productName: pName(state, P.productId), cat: (byId(state.products, P.productId) || {}).cat || "",
        qty: rq(P.qty), unit: P.unit, m3: m.m3, mp: m.mp, t: w.t, tSource: w.tSource,
        value: round((op.totals && op.totals.purchaseCost) || 0, 2), basis: P.basis || "", kwit: str(Pr.kwit),
        produced: op.production ? { productId: Pr.outProductId, productName: pName(state, Pr.outProductId), qty: rq(Pr.outQty || 0), unit: Pr.outUnit } : null,
        corrected: (op.corrections || []).length > 0
      });
    }
    return out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.no).localeCompare(String(b.no)));
  }

  /** Sprzedaż w zakresie. f: { from, to, whIds?, cat? }. */
  function sales(state, f = {}) {
    const out = [];
    const T = R.Trade || {};
    for (const op of state.operations) {
      const S = op.sale;
      if (!S || !isLive(op) || !inRange(op, f) || !inWh(op, f) || !catOk(state, S.productId, f)) continue;
      const buyer = byId(state.partners, S.buyerId);
      const m = measures(state, S.productId, S.qty, S.unit);
      const w = tonnage(m, S.unit, S.weightT, S.weightMode, S.weightMode === "manual" ? null : transportWeight(op.transport));
      const mode = op.direct ? "BEZP" : op.purchase ? "LANCUCH" : "WZ";
      out.push({
        opId: op.id, no: op.no, date: op.date, ym: Dates.ym(op.date), whId: op.whId, whName: whName(state, op.whId),
        buyerId: S.buyerId, buyerName: buyer ? buyer.name : "", city: buyer ? str(buyer.city) : "",
        place: str(op.place) || str((op.transport || {}).place) || (buyer ? str(buyer.city) : ""),
        loadPlace: T.loadPlaceOf ? T.loadPlaceOf(state, op) : "", origin: T.originOf ? T.originOf(state, op) : "",
        productId: S.productId, productName: pName(state, S.productId), cat: (byId(state.products, S.productId) || {}).cat || "",
        qty: rq(S.qty), unit: S.unit, m3: m.m3, mp: m.mp, t: w.t, tSource: w.tSource,
        value: round(S.revenue || 0, 2), mode, transportMode: (op.transport || {}).mode || "none",
        corrected: (op.corrections || []).length > 0
      });
    }
    return out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.no).localeCompare(String(b.no)));
  }

  /** Suma miar; miara pominięta w którymkolwiek wierszu → `partial` (suma niepełna, nie „zero”). */
  function totals(rows) {
    const s = { count: rows.length, m3: 0, mp: 0, t: 0, value: 0, partial: { m3: false, mp: false, t: false }, tWeighed: 0 };
    for (const r of rows) {
      for (const k of ["m3", "mp", "t"]) { if (r[k] === null || r[k] === undefined) s.partial[k] = true; else s[k] = rq(s[k] + r[k]); }
      if (r.tSource === "waga" && r.t !== null) s.tWeighed = rq(s.tWeighed + r.t);
      s.value = round(s.value + (r.value || 0), 2);
    }
    return s;
  }

  /** Grupowanie wierszy (kontrahent, nadleśnictwo, leśnictwo) z sumami; sortowanie malejąco wg t, potem MP. */
  function group(rows, keyOf, labelOf, sub) {
    const m = new Map();
    for (const r of rows) {
      const k = keyOf(r) || "—";
      if (!m.has(k)) m.set(k, { key: k, label: labelOf(r) || "—", rows: [] });
      m.get(k).rows.push(r);
    }
    return [...m.values()].map(g => Object.assign(g, { sum: totals(g.rows) }, sub ? { groups: sub(g.rows) } : {}))
      .sort((a, b) => (b.sum.t - a.sum.t) || (b.sum.mp - a.sum.mp) || String(a.label).localeCompare(String(b.label), "pl"));
  }

  const bySupplier = rows => group(rows, r => r.supplierId || r.supplierName, r => r.supplierName);
  const byBuyer = rows => group(rows, r => r.buyerId, r => r.buyerName);
  /** Lasy: nadleśnictwo → leśnictwo → transakcje. */
  const byForest = rows => group(rows, r => r.supplierId || r.ndl, r => r.supplierName || `Nadleśnictwo ${r.ndl}`, rs => group(rs, r => r.lesnictwo, r => r.lesnictwo || "—"));

  /** Rejestr miesięczny: `months` (RRRR-MM, rosnąco) → sumy zakupów od firm, z lasów i sprzedaży. */
  function monthly(state, months, f = {}) {
    if (!months.length) return [];
    const from = Dates.monthStart(months[0]), to = Dates.monthEnd(months[months.length - 1]);
    const pu = purchases(state, Object.assign({}, f, { from, to })), sa = sales(state, Object.assign({}, f, { from, to }));
    return months.map(ym => ({
      ym,
      firms: totals(pu.filter(r => r.ym === ym && r.kind !== "nadlesnictwo")),
      forest: totals(pu.filter(r => r.ym === ym && r.kind === "nadlesnictwo")),
      sales: totals(sa.filter(r => r.ym === ym))
    }));
  }

  /** Zestaw pulpitu dla miesiąca `ym`: trzy zestawienia z grupami i rejestr ostatnich `span` miesięcy. */
  function dashboard(state, ym, f = {}, span = 6) {
    const from = Dates.monthStart(ym), to = Dates.monthEnd(ym);
    const flt = Object.assign({}, f, { from, to });
    const pu = purchases(state, flt);
    const firms = pu.filter(r => r.kind !== "nadlesnictwo"), forest = pu.filter(r => r.kind === "nadlesnictwo");
    const sa = sales(state, flt);
    const months = []; for (let i = span - 1; i >= 0; i--) months.push(Dates.addMonths(ym, -i));
    return {
      ym,
      firms: { rows: firms, sum: totals(firms), groups: bySupplier(firms) },
      forest: { rows: forest, sum: totals(forest), groups: byForest(forest) },
      sales: { rows: sa, sum: totals(sa), groups: byBuyer(sa) },
      register: monthly(state, months, f)
    };
  }

  R.TradeStats = { isLive, measures, transportWeight, purchases, sales, totals, group, bySupplier, byBuyer, byForest, monthly, dashboard };
  if (typeof module !== "undefined" && module.exports) module.exports = R.TradeStats;
})(typeof globalThis !== "undefined" ? globalThis : this);
