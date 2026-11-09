/* Testy funkcji wersji 3.9:  node --test tests/features39.test.mjs
   Zabudowa i pojemność pojazdów (długość × szerokość × wysokość = MP), zapełnienie naczepy / kontenerów w każdym kursie,
   raporty floty (pojazdy, kursy, kierowcy) oraz rębaków i operatorów — dzień, tydzień, miesiąc. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";

const require = createRequire(import.meta.url);
globalThis.RIW_CONFIG = JSON.parse(readFileSync(new URL("../config/app.config.json", import.meta.url), "utf8"));
require("../app/src/i18n.js");
for (const f of readdirSync(new URL("../app/src/", import.meta.url)).filter(f => /^i18n\.d\d+\.js$/.test(f)).sort()) require("../app/src/" + f);
const R = require("../app/src/engine.js");
const Service = require("../app/src/service.js");
require("../app/src/planner.js");
const FR = require("../app/src/fleetrep.js");
require("../app/src/seed.js");

const TODAY = "2026-09-23";
const fresh = () => R.Seed.build(TODAY);
const U = (s, id) => s.users.find(u => u.id === id);
const ctx = (s, uid = "u_kier") => ({ user: U(s, uid), today: TODAY, source: "test" });
const draft = over => R.Seed.draftOf(over.date || TODAY, Object.assign({ transport: { mode: "none", place: "RiC Zabrze" } }, over));
const commit = (s, d, c) => { const r = R.commitOperation(s, d, c || ctx(s)); assert.equal(r.ok, true, r.error); return r.op; };
const VEH = { name: "MAN TGS — hakowiec", reg: "SK 4411H", type: "ciezarowy", status: "aktywny", driverId: "dr_nowak", whId: "wh_zab" };
const SALE = q => ({ type: "SPRZEDAZ", sale: { productId: "pr_zr_lesna", qty: String(q), unit: "MP", buyerId: "pa_ec_zab", price: "90", priceUnit: "MP", weightMode: "auto" } });

/* ============================== zabudowa i pojemność ============================== */
test("pojazd: pojemność = długość × szerokość × wysokość (MP); hakowiec = suma dwóch kontenerów; zapis w audycie", () => {
  const s = fresh();
  const r = R.Fleet.save(s, "vehicles", Object.assign({}, VEH, { body: "hakowiec", compartments: [{ l: "6,5", w: "2,4", h: "2,5" }, { l: "7", w: "2.4", h: "2,5" }] }), ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.rec.compartments.map(c => [c.name, c.l, c.w, c.h]), [["Kontener na samochodzie", 6.5, 2.4, 2.5], ["Kontener na przyczepie", 7, 2.4, 2.5]]);
  assert.equal(r.rec.capacityMP, 81);
  assert.equal(R.vehicleCapacityMP(r.rec), 81);
  assert.ok(s.audit.some(a => a.entity === "fleet" && a.entityId === r.rec.id));
  const wf = R.Fleet.save(s, "vehicles", Object.assign({}, VEH, { reg: "SK 4412H", body: "ruchoma_podloga", compartments: [{ l: "13,4", w: "2,45", h: "2,8" }] }), ctx(s));
  assert.equal(wf.rec.capacityMP, 91.92);
  const plain = R.Fleet.save(s, "vehicles", Object.assign({}, VEH, { reg: "SK 4413H" }), ctx(s));
  assert.deepEqual([plain.rec.body, plain.rec.compartments, plain.rec.capacityMP], ["", [], 0], "zabudowa jest opcjonalna");
});

test("pojazd: brak wymiaru, wymiar poza zakresem i nieznana zabudowa są odrzucane", () => {
  const s = fresh();
  const miss = R.Fleet.save(s, "vehicles", Object.assign({}, VEH, { body: "kontener", compartments: [{ l: "6", w: "2,4", h: "" }] }), ctx(s));
  assert.equal(miss.ok, false); assert.ok(miss.errors["comp.0.h"]);
  const big = R.Fleet.save(s, "vehicles", Object.assign({}, VEH, { body: "kontener", compartments: [{ l: "6", w: "4,2", h: "2" }] }), ctx(s));
  assert.ok(big.errors["comp.0.w"], JSON.stringify(big.errors));
  const bad = R.Fleet.save(s, "vehicles", Object.assign({}, VEH, { body: "cysterna" }), ctx(s));
  assert.ok(bad.errors.body);
});

/* ============================== zapełnienie kursów ============================== */
test("kurs floty własnej: zapełnienie = MP w kursie ÷ pojemność pojazdu; średnia operacji; przeładowanie daje ostrzeżenie", () => {
  const s = fresh();
  const plan = R.planOperation(s, draft(Object.assign(SALE(150), { transport: { mode: "own", place: "EC Zabrze", own: { runCount: "2", runs: [
    { vehicleId: "ve_scania", driverId: "dr_kowalski", km: "10", qty: "80" }, { vehicleId: "ve_volvo", driverId: "dr_nowak", km: "10", qty: "70" }] } } })), ctx(s));
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  const T = plan.norm.transport;
  assert.deepEqual(T.runs.map(r => [r.capacityMP, r.qtyMP, r.fillPct]), [[91.92, 80, 87], [97.81, 70, 71.6]]);
  assert.equal(T.avgFillPct, 79.3);
  const over = R.planOperation(s, draft(Object.assign(SALE(100), { transport: { mode: "own", place: "EC Zabrze", own: { runCount: "1", runs: [{ vehicleId: "ve_scania", driverId: "dr_kowalski", km: "10", qty: "100" }] } } })), ctx(s));
  assert.equal(over.ok, true);
  assert.ok(over.warnings.some(w => /przekracza pojemność pojazdu 91,92 MP/.test(w)), over.warnings.join(" | "));
});

test("kurs zewnętrzny: pojemność z floty zewnętrznej po numerze rejestracyjnym; pojazd bez zabudowy — bez zapełnienia", () => {
  const s = fresh();
  const plan = R.planOperation(s, draft(Object.assign(SALE(110), { transport: { mode: "external", place: "EC Zabrze", external: { companyCount: "2", runCount: "2", runs: [
    { company: "ESI Logistics", reg: "esi 18734", km: "20", qty: "90" }, { company: "DAP Trans", reg: "SZA 7K902", km: "20", qty: "20" }] } } })), ctx(s));
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.deepEqual(plan.norm.transport.runs.map(r => [r.capacityMP, r.fillPct]), [[91.92, 97.9], [null, null]]);
});

/* ============================== raporty floty ============================== */
test("raport pojazdów i kierowców (tydzień): kursy, MP, tony, km, średnie i maksymalne zapełnienie", () => {
  const s = fresh();
  commit(s, draft(Object.assign(SALE(150), { transport: { mode: "own", place: "EC Zabrze", own: { runCount: "2", runs: [
    { vehicleId: "ve_scania", driverId: "dr_kowalski", km: "10", qty: "80", weightT: "26,5" }, { vehicleId: "ve_scania", driverId: "dr_wojcik", km: "12", qty: "70" }] } } })));
  const rg = FR.periodRange("week", TODAY);
  assert.deepEqual(rg, { from: "2026-09-21", to: "2026-09-27" });
  const v = FR.vehicles(s, Object.assign({ whIds: ["wh_zab"] }, rg));
  const sc = v.rows.find(a => a.reg === "SGL 4T821");
  assert.deepEqual([sc.runs, sc.qtyMP, sc.km, sc.capacityMP, sc.avgFillPct, sc.maxFillPct], [2, 150, 22, 91.92, 81.6, 87]);
  assert.equal(sc.t, 26.5 + 70 * s.config.mp_t, "tony: waga rzeczywista + przelicznik dla kursu bez wagi");
  assert.equal(v.runs.filter(r => r.reg === "SGL 4T821").length, 2, "lista kursów z zapełnieniem");
  const d = FR.drivers(s, Object.assign({ whIds: ["wh_zab"] }, rg));
  assert.deepEqual(d.rows.filter(a => ["Jan Kowalski", "Tomasz Wójcik"].includes(a.name)).map(a => [a.name, a.runs, a.qtyMP]).sort(), [["Jan Kowalski", 1, 80], ["Tomasz Wójcik", 1, 70]]);
  const month = FR.vehicles(s, Object.assign({ whIds: ["wh_zab"] }, FR.periodRange("month", TODAY)));
  assert.ok(month.total.runs >= v.total.runs);
});

test("raport floty pomija operacje anulowane i spoza magazynu", () => {
  const s = fresh();
  const op = commit(s, draft(Object.assign(SALE(50), { transport: { mode: "own", place: "EC Zabrze", own: { runCount: "1", runs: [{ vehicleId: "ve_volvo", driverId: "dr_nowak", km: "10", qty: "50" }] } } })));
  const q = Object.assign({ whIds: ["wh_zab"] }, FR.periodRange("day", TODAY));
  assert.equal(FR.vehicles(s, q).total.runs, 1);
  assert.equal(FR.vehicles(s, Object.assign({}, q, { whIds: ["wh_bra"] })).total.runs, 0);
  assert.equal(R.cancelOperation(s, op.id, ctx(s), "pomyłka").ok, true);
  assert.equal(FR.vehicles(s, q).total.runs, 0);
});

/* ============================== raporty rębaków ============================== */
test("raport rębaków i operatorów (dzień / tydzień / miesiąc): MP zrębki, m³ drewna, dni, koszt rąbania", () => {
  const s = fresh();
  commit(s, draft({ type: "PRODUKCJA", production: { rawProductId: "pr_drewno", consumeQty: "10", outProductId: "pr_zr_lesna", outQty: "40", chipperId: "ch_jenz", operatorId: "op_lis", chipRate: "10" } }));
  const day = FR.chippers(s, Object.assign({ whIds: ["wh_zab"] }, FR.periodRange("day", TODAY)));
  const jenz = day.rows.find(a => a.name === "Jenz HEM 583");
  assert.ok(jenz, JSON.stringify(day.rows));
  assert.deepEqual([jenz.productions, jenz.qtyMP, jenz.rawM3, jenz.days, jenz.cost, jenz.operators], [1, 40, 10, 1, 400, "Krzysztof Lis"]);
  const ops = FR.operators(s, Object.assign({ whIds: ["wh_zab"] }, FR.periodRange("day", TODAY)));
  assert.deepEqual(ops.rows.map(a => [a.name, a.qtyMP, a.chippers]), [["Krzysztof Lis", 40, "Jenz HEM 583"]]);
  const month = FR.chippers(s, FR.periodRange("month", TODAY));
  assert.ok(month.total.qtyMP > day.total.qtyMP, "miesiąc obejmuje więcej produkcji niż dzień");
  assert.ok(month.list.every(p => p.date >= "2026-09-01" && p.date <= "2026-09-30"));
});

test("zapis pojazdu z zabudową przez Service (na kopii stanu; magazynier bez fleet.edit — odmowa)", () => {
  const s = fresh();
  const rec = Object.assign({}, R.byId(s.fleet.vehicles, "ve_daf"), { compartments: [{ l: 13.6, w: 2.48, h: 2.9 }] });
  const no = Service.run(s, "fleet.save", { kind: "vehicles", rec }, ctx(s, "u_mag"));
  assert.notEqual(no.res && no.res.ok, true, "magazynier nie zapisze floty");
  assert.equal(no.state, null);
  const ok = Service.run(s, "fleet.save", { kind: "vehicles", rec }, ctx(s, "u_kier"));
  assert.equal(ok.res.ok, true, ok.res.error);
  assert.equal(R.byId(ok.state.fleet.vehicles, "ve_daf").capacityMP, 97.81);
  assert.equal(R.byId(s.fleet.vehicles, "ve_daf").capacityMP, 91.92, "stan źródłowy bez zmian (zmiana na kopii)");
});

/* ============================== 3.10.1: pojazd bez kierowcy domyślnego ============================== */
test("pojazd własny bez kierowcy domyślnego („—”) zapisuje się; w kursie trzeba wtedy wybrać kierowcę", () => {
  const s = fresh();
  const r = R.Fleet.save(s, "vehicles", Object.assign({}, VEH, { reg: "SK 5500N", driverId: "" }), ctx(s));
  assert.equal(r.ok, true, JSON.stringify(r.errors || r.error));
  const v = s.fleet.vehicles.find(x => x.reg === "SK 5500N");
  assert.equal(v.driverId, "");
  assert.equal(R.Fleet.save(s, "vehicles", Object.assign({}, VEH, { reg: "SK 5501N", driverId: "dr_nieistniejacy" }), ctx(s)).ok, false, "nieznany kierowca odrzucony");
  const PURCHASE = { supplierId: "pa_drwal", basis: "DEKL", productId: "pr_zr_tow", qty: "5", unit: "MP", price: "50" };
  const bad = R.planOperation(s, draft({ purchase: PURCHASE, transport: { mode: "own", place: "RiC Zabrze", own: { runCount: "1", runs: [{ vehicleId: v.id, driverId: "", km: "10" }] } } }), ctx(s));
  assert.ok(Object.keys(bad.errors || {}).some(k => /driverId/.test(k)), "kurs bez kierowcy — błąd przy polu kierowcy");
  const ok = R.planOperation(s, draft({ purchase: PURCHASE, transport: { mode: "own", place: "RiC Zabrze", own: { runCount: "1", runs: [{ vehicleId: v.id, driverId: "dr_kowalski", km: "10" }] } } }), ctx(s));
  assert.ok(!Object.keys(ok.errors || {}).some(k => /driverId/.test(k)), JSON.stringify(ok.errors));
});
