/* =========================================================================
   ResInvest ERP 3.9 — warstwa S: raporty floty i rębaków (silnik)

   Źródło: zatwierdzone operacje (bez anulowanych i usuniętych) w okresie i magazynach.
   Pojazdy   — kursy transportu własnego i zewnętrznego: liczba kursów, MP, tony (waga
               rzeczywista z kursów; brak wagi = przelicznik firmowy MP → t), km, koszt,
               średnie i maksymalne zapełnienie naczepy / kontenerów (MP ÷ pojemność).
   Kierowcy  — te same kursy według kierowcy zapisanego w kursie.
   Rębaki    — produkcje: liczba, MP zrębki, m³ zużytego drewna, tony orientacyjne, koszt rąbania.
   Operatorzy rębaków — te same produkcje według operatora.
   Okresy: dzień, tydzień (poniedziałek–niedziela) albo miesiąc. Moduł działa w przeglądarce i w Node.
   ========================================================================= */
(function (root) {
  "use strict";
  const R = root.RIW || (typeof require === "function" ? require("./engine.js") : null);
  const { round, rq, byId, Units, Dates, EPS } = R;
  const str = v => String(v == null ? "" : v).trim();
  const normReg = x => String(x || "").replace(/\s+/g, "").toUpperCase();
  const PERIODS = { day: "Dzień", week: "Tydzień", month: "Miesiąc" };

  /** Zakres okresu zawierającego datę: dzień, tydzień ISO (pon–niedz) albo miesiąc kalendarzowy. */
  function periodRange(kind, date) {
    const d = Dates.isISO(date) ? date : Dates.localToday();
    if (kind === "day") return { from: d, to: d };
    if (kind === "month") { const ym = d.slice(0, 7); return { from: Dates.monthStart(ym), to: Dates.monthEnd(ym) }; }
    const from = Dates.weekStart(d);
    return { from, to: Dates.addDays(from, 6) };
  }

  function opsIn(state, f) {
    const W = f.whIds ? new Set(f.whIds) : null;
    return state.operations.filter(o => !o.deleted && o.status !== "CANCELLED" && o.status !== "PENDING" && o.status !== "DRAFT" &&
      o.date >= f.from && o.date <= f.to && (!W || W.has(o.whId) || (o.toWhId && W.has(o.toWhId))));
  }

  /** Kursy operacji z ilością w MP, tonami i zapełnieniem (dla operacji sprzed 3.9 — liczone z bieżącej pojemności pojazdu). */
  function runsOf(state, op) {
    const T = op.transport || {}, cfg = state.config;
    if (!Array.isArray(T.runs) || !["own", "external", "mixed"].includes(T.mode)) return [];
    const unit = T.qtyUnit || "";
    return T.runs.map(r => {
      const kind = r.kind || T.mode;
      const veh = (r.vehicleId && byId(state.fleet.vehicles, r.vehicleId)) || state.fleet.vehicles.find(v => r.reg && normReg(v.reg) === normReg(r.reg)) || null;
      const qtyMP = r.qtyMP != null ? r.qtyMP : unit === "MP" ? (Number(r.qty) || 0) : 0;
      const cap = r.capacityMP != null ? r.capacityMP : R.vehicleCapacityMP(veh);
      const fill = r.fillPct != null ? r.fillPct : cap > 0 && qtyMP > 0 ? round(qtyMP / cap * 100, 1) : null;
      const weighed = r.weightT !== null && r.weightT !== undefined && Number.isFinite(Number(r.weightT));
      const t = weighed ? Number(r.weightT) : rq(qtyMP * cfg.mp_t);
      return {
        opId: op.id, opNo: op.no, date: op.date, kind, vehicleId: veh ? veh.id : (r.vehicleId || ""),
        vehicleName: veh ? veh.name : str(r.vehicleName), reg: str(r.reg) || (veh ? veh.reg : ""),
        company: kind === "external" ? str(r.company || T.company) : "", driver: str(kind === "own" ? r.driverName : r.driver) || "—",
        qtyMP: rq(qtyMP), t: rq(t), weighed, km: Number(r.km) || 0, cost: Number(r.cost) || 0, capacityMP: cap > 0 ? cap : null, fillPct: fill
      };
    });
  }

  function addRun(a, r) {
    a.runs++; a.qtyMP = rq(a.qtyMP + r.qtyMP); a.t = rq(a.t + r.t); a.km = rq(a.km + r.km); a.cost = round(a.cost + r.cost, 2);
    if (!r.weighed) a.tAuto++;
    if (r.fillPct !== null) { a.fillSum += r.fillPct; a.fillN++; a.fillMax = Math.max(a.fillMax, r.fillPct); }
    a.days.add(r.date); a.opIds.add(r.opId);
  }
  const blank = extra => Object.assign({ runs: 0, qtyMP: 0, t: 0, tAuto: 0, km: 0, cost: 0, fillSum: 0, fillN: 0, fillMax: 0, days: new Set(), opIds: new Set() }, extra);
  const finish = a => Object.assign(a, { avgFillPct: a.fillN ? round(a.fillSum / a.fillN, 1) : null, maxFillPct: a.fillN ? a.fillMax : null, days: a.days.size, opIds: [...a.opIds] });
  const total = list => list.reduce((s, x) => ({ runs: s.runs + (x.runs || 0), productions: s.productions + (x.productions || 0), qtyMP: rq(s.qtyMP + (x.qtyMP || 0)), t: rq(s.t + (x.t || 0)), km: rq(s.km + (x.km || 0)), cost: round(s.cost + (x.cost || 0), 2), rawM3: rq(s.rawM3 + (x.rawM3 || 0)) }), { runs: 0, productions: 0, qtyMP: 0, t: 0, km: 0, cost: 0, rawM3: 0 });

  /** Pojazdy: kursy, MP, tony, km, koszt, zapełnienie (posortowane po MP). */
  function vehicles(state, f) {
    const m = new Map(), runs = [];
    for (const op of opsIn(state, f)) for (const r of runsOf(state, op)) {
      runs.push(r);
      const k = r.vehicleId || "reg:" + normReg(r.reg);
      if (!m.has(k)) m.set(k, blank({ key: k, name: r.vehicleName || r.reg || "—", reg: r.reg, owner: r.kind === "external" ? "external" : "own", company: r.company, capacityMP: r.capacityMP }));
      const a = m.get(k); addRun(a, r); if (r.capacityMP) a.capacityMP = r.capacityMP;
    }
    const rows = [...m.values()].map(finish).sort((a, b) => b.qtyMP - a.qtyMP || a.name.localeCompare(b.name, "pl"));
    return { rows, total: total(rows), runs: runs.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.opNo).localeCompare(String(b.opNo))) };
  }
  /** Kierowcy: kursy, MP, tony, km, pojazdy (według kierowcy zapisanego w kursie). */
  function drivers(state, f) {
    const m = new Map();
    for (const op of opsIn(state, f)) for (const r of runsOf(state, op)) {
      const k = r.driver.toLowerCase() + "|" + (r.kind === "external" ? r.company.toLowerCase() : "");
      if (!m.has(k)) m.set(k, blank({ key: k, name: r.driver, company: r.company, owner: r.kind === "external" ? "external" : "own", vehicles: new Set() }));
      const a = m.get(k); addRun(a, r); a.vehicles.add(r.reg);
    }
    const rows = [...m.values()].map(a => finish(Object.assign(a, { vehicles: [...a.vehicles].filter(Boolean).join(", ") }))).sort((a, b) => b.runs - a.runs || b.qtyMP - a.qtyMP);
    return { rows, total: total(rows) };
  }

  /** Produkcje (rębanie) w okresie: rębak, operator, MP zrębki, m³ drewna, tony orientacyjne, koszt rąbania. */
  function productions(state, f) {
    const cfg = state.config, out = [];
    for (const op of opsIn(state, f)) {
      const P = op.production;
      if (!P || !(P.outQty > 0)) continue;
      const ch = byId(state.fleet.chippers, P.chipperId), prod = byId(state.products, P.outProductId);
      const mp = P.outUnit === "MP" ? P.outQty : (() => { try { return Units.convert(P.outQty, P.outUnit, "MP", prod, cfg); } catch (e) { return 0; } })();
      out.push({
        opId: op.id, opNo: op.no, date: op.date, chipperKey: P.chipperId || "name:" + str(P.chipperName).toLowerCase(),
        chipper: str(P.chipperName) || (ch ? ch.name : "") || "—", chipperOwner: P.chipperOwner || (ch ? ch.owner || "own" : "own"),
        company: str(P.chipperCompany), operator: str(P.operatorName) || "—", qtyMP: rq(mp), rawM3: P.consumeUnit === "m3" ? rq(P.consumeQty || 0) : 0,
        t: prod ? Units.mass(P.outQty, prod, cfg) : rq(mp * cfg.mp_t), cost: round(P.chippingCost || 0, 2), place: P.ndl ? `Nadleśnictwo ${P.ndl}${P.lesnictwo ? " · " + P.lesnictwo : ""}` : (op.place || "")
      });
    }
    return out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.opNo).localeCompare(String(b.opNo)));
  }
  function groupProd(list, keyOf, extra) {
    const m = new Map();
    for (const p of list) {
      const k = keyOf(p);
      if (!m.has(k)) m.set(k, Object.assign({ key: k, productions: 0, qtyMP: 0, rawM3: 0, t: 0, cost: 0, days: new Set(), opIds: [] }, extra(p)));
      const a = m.get(k);
      a.productions++; a.qtyMP = rq(a.qtyMP + p.qtyMP); a.rawM3 = rq(a.rawM3 + p.rawM3); a.t = rq(a.t + p.t); a.cost = round(a.cost + p.cost, 2); a.days.add(p.date); a.opIds.push(p.opId);
    }
    return [...m.values()].map(a => Object.assign(a, { days: a.days.size, perDayMP: a.days.size ? rq(a.qtyMP / a.days.size) : 0 })).sort((a, b) => b.qtyMP - a.qtyMP);
  }
  /** Rębaki: ile który rębak zrąbał (MP), z ilu produkcji, w ile dni; koszt rąbania. */
  function chippers(state, f) {
    const list = productions(state, f);
    const rows = groupProd(list, p => p.chipperKey, p => ({ name: p.chipper, owner: p.chipperOwner, company: p.company, operators: new Set() }));
    for (const r of rows) r.operators = [...new Set(list.filter(p => p.chipperKey === r.key).map(p => p.operator))].join(", ");
    return { rows, total: total(rows), list };
  }
  /** Operatorzy rębaków: ile który operator zrąbał (MP), na jakich rębakach. */
  function operators(state, f) {
    const list = productions(state, f);
    const rows = groupProd(list, p => p.operator.toLowerCase(), p => ({ name: p.operator }));
    for (const r of rows) r.chippers = [...new Set(list.filter(p => p.operator.toLowerCase() === r.key).map(p => p.chipper))].join(", ");
    return { rows, total: total(rows) };
  }

  R.FleetReports = { PERIODS, periodRange, runsOf, vehicles, drivers, productions, chippers, operators };
  if (typeof module !== "undefined" && module.exports) module.exports = R.FleetReports;
})(typeof globalThis !== "undefined" ? globalThis : this);
