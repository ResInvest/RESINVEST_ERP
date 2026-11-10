/* =========================================================================
   ResInvest ERP 3.5 — warstwa S: planer zakupów (silnik)

   Ręcznie wpisuje się tylko PLAN DNIA [MP] (magazyn × dzień). Wszystko inne planer
   czyta z zatwierdzonych operacji — wartości AUTO są tylko do odczytu, a błąd poprawia
   się korektą dokumentu. Dzięki temu planer zawsze zgadza się ze stanami i raportami.

   Wykonanie [MP] — operacje zakupu MP (bez anulowanych i usuniętych):
     * zakup z produkcją (PZ → RW → PW) — wynik produkcji w MP,
     * produkcja w lesie przy sprzedaży bezpośredniej — wynik produkcji w MP,
     * zakup materiału prowadzonego w MP (np. zrębka towar) — ilość przyjęta.
   Sprzedaż z magazynu, produkcja ze stanu, MM i zakup drewna bez produkcji NIE są zakupem MP.
   Tony   = waga zważonych kursów + niezważona reszta ilości × przelicznik firmowy (MP → t).
   Cena   = (wartość zakupu + koszt surowca) ÷ wykonanie [zł/MP].
   Km, transport, kursy — z kursów (karta TR) tych operacji; kierowcy i pojazdy — z kursów.
   Realizacja = wykonanie ÷ plan DO DZIŚ (przyszłe dni nie zaniżają wyniku).
   Moduł działa w przeglądarce i w Node (serwer, testy).
   ========================================================================= */
(function (root) {
  "use strict";
  const R = root.RIW || (typeof require === "function" ? require("./engine.js") : null);
  const { round, rq, Dates, NumParse, byId, uid, clone, audit, Lx, can, canAccessWh, whAccess, EPS } = R;
  const t = (s, p) => R.I18N.t(s, p);
  const N_ = s => s;
  const str = v => String(v == null ? "" : v).trim();
  const nowIso = ctx => (ctx && ctx.now) || new Date().toISOString();

  /** Liczba w zapisie polskim (wpis audytu w postaci kanonicznej). */
  const plNum = n => { const [i, f] = Math.abs(round(n, 2)).toFixed(2).split("."); return R.I18N.num(i, f.replace(/0+$/, ""), "pl"); };
  /** Najdłuższy zakres jednego zapytania (rok przestępny + zapas). */
  const MAX_DAYS = 400;
  const MAX_PLAN = 100000;

  /** Kolejne dni RRRR-MM-DD od `from` do `to` włącznie (nie więcej niż MAX_DAYS). */
  function dayRange(from, to) {
    const out = [];
    if (!Dates.isISO(from) || !Dates.isISO(to) || from > to) return out;
    for (let d = from, i = 0; d <= to && i < MAX_DAYS; d = Dates.addDays(d, 1), i++) out.push(d);
    return out;
  }

  /** Magazyny widoczne w planerze: wskazany (z dostępem) albo „ALL” = wszystkie aktywne dostępne użytkownikowi. */
  function scopeWarehouses(state, user, whId) {
    const acc = whAccess(user);
    const mine = state.warehouses.filter(w => w.active !== false && (acc === null || acc.includes(w.id)));
    if (whId === "ALL") return mine.map(w => w.id);
    return mine.some(w => w.id === whId) ? [whId] : [];
  }

  /** Miejsce zakupu: miejsce transportu albo nadleśnictwo i leśnictwo / wycinka inwestycyjna. */
  function placeOf(op) {
    const P = op.production || {};
    const origin = P.ndl ? [t("Nadleśnictwo {n}", { n: P.ndl }), P.lesnictwo].filter(Boolean).join(" · ") : P.investSite || "";
    return origin || op.place || (op.transport && op.transport.place) || "";
  }

  /**
   * Operacja jako źródło planera: { mp, cost, runs, … } albo null, gdy operacja nie jest zakupem MP.
   * Wykonanie liczone w MP — jednostce planu.
   */
  function plannerOp(state, op) {
    if (!op || op.deleted || op.status === "CANCELLED") return null;
    const P = op.production;
    let mp = 0, kind = "";
    if (op.type === "ZAKUP" && P && P.outUnit === "MP" && P.outQty > 0) { mp = P.outQty; kind = "chain"; }
    else if (op.type === "SPRZEDAZ" && op.direct && P && P.outUnit === "MP" && P.outQty > 0) { mp = P.outQty; kind = "direct"; }
    else if (op.type === "ZAKUP" && !P && op.purchase && op.purchase.stockUnit === "MP" && op.purchase.stockQty > 0) { mp = op.purchase.stockQty; kind = "buy"; }
    if (!(mp > 0)) return null;
    const T = op.transport || {};
    const runs = (Array.isArray(T.runs) ? T.runs : []).map(r => ({
      qty: Number(r.qty) || 0, weightT: r.weightT === null || r.weightT === undefined ? null : Number(r.weightT), km: Number(r.km) || 0, cost: Number(r.cost) || 0,
      driver: str(r.driverName || r.driver) || "—", reg: str(r.reg) || "—", company: r.kind === "external" ? str(r.company || T.company) : "", kind: r.kind || ""
    }));
    const totals = op.totals || {};
    return {
      id: op.id, no: op.no, whId: op.whId, date: op.date, kind, mp: rq(mp),
      cost: round((totals.purchaseCost || 0) + (totals.rawCost || 0), 2),
      place: placeOf(op), runs,
      documents: (op.documents || []).map(d => ({ type: d.type, no: d.no }))
    };
  }

  /** Tony operacji: waga zważonych kursów + niezważona reszta ilości × przelicznik MP → t. */
  function opTonnage(pop, cfg) {
    const weighedRuns = pop.runs.filter(r => r.weightT !== null && Number.isFinite(r.weightT));
    const weighed = rq(weighedRuns.reduce((a, r) => a + r.weightT, 0));
    const weighedQty = weighedRuns.reduce((a, r) => a + r.qty, 0);
    const rest = Math.max(0, pop.mp - weighedQty);
    return { weighed, auto: rq(rest * cfg.mp_t) };
  }

  /** Operacje źródłowe planera w zakresie dla listy magazynów. */
  function operations(state, whIds, from, to) {
    const W = new Set(whIds);
    return state.operations.filter(o => W.has(o.whId) && o.date >= from && o.date <= to).map(o => plannerOp(state, o)).filter(Boolean)
      .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.no).localeCompare(String(b.no)));
  }
  /** Plany dnia w zakresie dla listy magazynów. */
  function plans(state, whIds, from, to) {
    const W = new Set(whIds);
    return (state.plans || []).filter(p => W.has(p.whId) && p.date >= from && p.date <= to);
  }

  /** Dni planera: plan (suma magazynów), wykonanie, tony, koszty, transport, miejsca, operacje źródłowe. */
  function days(state, whIds, from, to, today) {
    const cfg = state.config, ops = operations(state, whIds, from, to), pl = plans(state, whIds, from, to);
    const opsBy = new Map(), plBy = new Map();
    for (const o of ops) { if (!opsBy.has(o.date)) opsBy.set(o.date, []); opsBy.get(o.date).push(o); }
    for (const p of pl) { if (!plBy.has(p.date)) plBy.set(p.date, []); plBy.get(p.date).push(p); }
    return dayRange(from, to).map(date => {
      const dOps = opsBy.get(date) || [], dPl = plBy.get(date) || [];
      let act = 0, tw = 0, ta = 0, cost = 0, km = 0, tr = 0, trips = 0;
      for (const o of dOps) {
        act += o.mp; cost += o.cost;
        const tn = opTonnage(o, cfg); tw += tn.weighed; ta += tn.auto;
        for (const r of o.runs) { km += r.km; tr += r.cost; trips++; }
      }
      return {
        date, future: date > today, weekday: (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7,
        plan: rq(dPl.reduce((a, p) => a + p.planMP, 0)), note: dPl.map(p => p.note).filter(Boolean).join(" · "),
        act: rq(act), t: rq(tw + ta), tWeighed: rq(tw), tAuto: rq(ta), cost: round(cost, 2), km: rq(km), transportCost: round(tr, 2), trips,
        places: [...new Set(dOps.map(o => o.place).filter(Boolean))], opIds: dOps.map(o => o.id), docs: dOps.flatMap(o => o.documents)
      };
    });
  }

  const pct = (a, b) => b > EPS ? round(a / b * 100, 1) : null;
  /** Sumy okresu: realizacja wobec planu DO DZIŚ, średnia cena [zł/MP], transport [zł/MP], udział wagi rzeczywistej. */
  function totals(list) {
    let plan = 0, planToDate = 0, act = 0, tt = 0, tw = 0, cost = 0, km = 0, tr = 0, trips = 0, productionDays = 0;
    for (const d of list) {
      plan += d.plan; if (!d.future) planToDate += d.plan;
      act += d.act; tt += d.t; tw += d.tWeighed; cost += d.cost; km += d.km; tr += d.transportCost; trips += d.trips;
      if (d.act > EPS) productionDays++;
    }
    return {
      plan: rq(plan), planToDate: rq(planToDate), act: rq(act), t: rq(tt), tWeighed: rq(tw), cost: round(cost, 2), km: rq(km), transportCost: round(tr, 2),
      trips, productionDays, realization: pct(act, planToDate),
      avgPrice: act > EPS ? round(cost / act, 2) : null, transportPerMp: act > EPS ? round(tr / act, 2) : null, weighedShare: pct(tw, tt),
      opIds: list.flatMap(d => d.opIds)
    };
  }
  /** Sumy 12 miesięcy roku (indeks 0 = styczeń). */
  function months(list, year) {
    return Array.from({ length: 12 }, (_, m) => {
      const ym = `${year}-${String(m + 1).padStart(2, "0")}`;
      return Object.assign({ ym }, totals(list.filter(d => d.date.startsWith(ym))));
    });
  }
  /** Kursy pogrupowane po kierowcy i pojeździe (widok „Kierowcy i kursy”). */
  function drivers(state, whIds, from, to) {
    const map = new Map();
    for (const o of operations(state, whIds, from, to)) for (const r of o.runs) {
      const k = `${r.driver}|${r.reg}`;
      const a = map.get(k) || { driver: r.driver, reg: r.reg, company: r.company, kind: r.kind, trips: 0, qty: 0, weightT: 0, km: 0, cost: 0, perDay: {}, opIds: [] };
      a.trips++; a.qty += r.qty; a.weightT += r.weightT || 0; a.km += r.km; a.cost += r.cost; a.perDay[o.date] = (a.perDay[o.date] || 0) + 1;
      if (!a.opIds.includes(o.id)) a.opIds.push(o.id);
      map.set(k, a);
    }
    return [...map.values()].sort((a, b) => b.trips - a.trips || a.driver.localeCompare(b.driver, "pl"))
      .map(a => Object.assign(a, { qty: rq(a.qty), weightT: rq(a.weightT), km: rq(a.km), cost: round(a.cost, 2) }));
  }
  /** Kursy jednego dnia (lista szczegółowa). */
  function dayRuns(state, whIds, date) {
    const out = [];
    for (const o of operations(state, whIds, date, date)) o.runs.forEach((r, i) => out.push(Object.assign({ opId: o.id, opNo: o.no, place: o.place, no: i + 1 }, r)));
    return out;
  }

  /**
   * Zapis planu dnia (magazyn × dzień). Liczba ≥ 0, przecinek albo kropka, do 2 miejsc po przecinku.
   * `version` — wersja widziana przez użytkownika: inna niż zapisana → odmowa (ochrona przed nadpisaniem cudzej zmiany).
   * Plan 0 bez uwag usuwa wpis. Audyt: PLAN_UPDATED z wartościami było / jest.
   */
  function setPlan(state, a, ctx) {
    const user = ctx && ctx.user;
    if (!can(user, "planner.edit")) return { ok: false, error: t("Plan zakupów zmienia kierownik albo administrator"), code: "FORBIDDEN" };
    const whId = str(a.whId), date = str(a.date);
    const wh = byId(state.warehouses, whId);
    if (!wh) return { ok: false, field: "whId", error: t("Wybierz magazyn") };
    if (!canAccessWh(user, whId)) return { ok: false, error: t("Brak dostępu do magazynu {w}", { w: wh.name }), code: "FORBIDDEN" };
    if (!Dates.isISO(date)) return { ok: false, field: "date", error: t("Nieprawidłowa data") };
    let planMP = 0;
    if (str(a.planMP) !== "") {
      const p = NumParse.parse(a.planMP);
      if (!p.ok) return { ok: false, field: "planMP", error: t("Plan: {e}", { e: p.error }) };
      if (p.value < 0) return { ok: false, field: "planMP", error: t("Plan nie może być ujemny") };
      if (p.value > MAX_PLAN) return { ok: false, field: "planMP", error: t("Plan dnia nie może przekraczać {n} MP", { n: MAX_PLAN }) };
      if (Math.abs(round(p.value, 2) - p.value) > EPS) return { ok: false, field: "planMP", error: t("Plan podaje się z dokładnością do 0,01 MP") };
      planMP = round(p.value, 2);
    }
    const note = str(a.note).slice(0, 300);
    if (!Array.isArray(state.plans)) state.plans = [];
    const prev = state.plans.find(p => p.whId === whId && p.date === date) || null;
    const seen = a.version === undefined || a.version === null || a.version === "" ? null : Number(a.version);
    if (seen !== null && (prev ? prev.version : 0) !== seen) return { ok: false, code: "CONFLICT", error: t("Plan tego dnia zmienił w międzyczasie inny użytkownik ({u}) — odśwież i wprowadź zmianę ponownie.", { u: prev ? prev.updatedBy : "—" }) };
    if (prev && prev.planMP === planMP && prev.note === note) return { ok: true, unchanged: true, plan: prev };
    if (!prev && planMP === 0 && !note) return { ok: true, unchanged: true, plan: null };
    const before = prev ? { plan: prev.planMP, uwagi: prev.note } : null;
    let rec = null;
    if (planMP === 0 && !note) state.plans = state.plans.filter(p => p !== prev);
    else {
      rec = Object.assign(prev ? clone(prev) : { id: uid("pl"), whId, date, createdAt: nowIso(ctx), createdBy: user.name, version: 0 },
        { planMP, note, updatedAt: nowIso(ctx), updatedBy: user.name, updatedById: user.id });
      rec.version = (prev ? prev.version : 0) + 1;
      if (prev) state.plans[state.plans.indexOf(prev)] = rec; else state.plans.push(rec);
    }
    state.rev += 1;
    audit(state, Object.assign({}, ctx, { user: Object.assign({}, user, { whId }) }), {
      entity: "plan", entityId: `${whId}|${date}`, opNo: date, event: "plan", code: "PLAN_UPDATED",
      act: Lx("Plan zakupów {d} ({w}): {a} → {b} MP", { d: date, w: wh.name, a: plNum(prev ? prev.planMP : 0), b: plNum(planMP) }),
      before, after: rec ? { plan: rec.planMP, uwagi: rec.note } : null, source: (ctx && ctx.source) || N_("Planer zakupów")
    });
    return { ok: true, plan: rec };
  }

  R.Planner = { MAX_DAYS, MAX_PLAN, dayRange, scopeWarehouses, plannerOp, opTonnage, operations, plans, days, totals, months, drivers, dayRuns, setPlan, placeOf };
  if (typeof module !== "undefined" && module.exports) module.exports = R.Planner;
})(typeof globalThis !== "undefined" ? globalThis : this);
