/* Testy funkcji wersji 3.11:  node --test tests/features311.test.mjs
   Nowe pozycje floty wpisywane w formularzu operacji (pojazd, kierowca, rębak, operator) — jak firmy zewnętrzne:
   wybór z kartoteki albo nowa pozycja dopisywana do Floty atomowo z operacją; duplikaty, wycofane pozycje, korekty, audyt. */
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
require("../app/src/seed.js");

const TODAY = "2026-09-23";
const fresh = () => R.Seed.build(TODAY);
const U = (s, id) => s.users.find(u => u.id === id);
const ctx = (s, uid = "u_kier") => ({ user: U(s, uid), today: TODAY, source: "test" });
const draft = over => R.Seed.draftOf(over.date || TODAY, Object.assign({ transport: { mode: "none", place: "RiC Zabrze" } }, over));
const PURCHASE = { supplierId: "pa_drwal", basis: "DEKL", productId: "pr_zr_tow", qty: "30", unit: "MP", price: "50" };
const ownRuns = runs => ({ mode: "own", place: "RiC Zabrze", own: { runCount: String(runs.length), runs: runs.map(r => Object.assign({ km: "12" }, r)) } });
const countFleet = s => Object.fromEntries(Object.entries(s.fleet).map(([k, v]) => [k, v.length]));

test("FleetPick: numer rejestracyjny bez spacji i wielkości liter, etykiety listy, osoby bez wielkości liter", () => {
  const s = fresh();
  assert.equal(R.FleetPick.vehicle(s, "sgl4t821").rec.id, "ve_scania");
  assert.equal(R.FleetPick.vehicle(s, "SGL 4T821 · Scania R450 — ruchoma podłoga").rec.id, "ve_scania", "etykieta z listy");
  assert.deepEqual(R.FleetPick.vehicle(s, " wgm  12345 · Scania R500 ").fresh, { reg: "WGM 12345", name: "Scania R500" });
  assert.equal(R.FleetPick.vehicle(s, "  "), null);
  assert.equal(R.FleetPick.person(s.fleet.drivers, "jan   KOWALSKI").rec.id, "dr_kowalski");
  assert.equal(R.FleetPick.person(s.fleet.drivers, "Jan Kowalski (domyślny)").rec.id, "dr_kowalski");
  assert.deepEqual(R.FleetPick.person(s.fleet.drivers, "Adam  Nowicki").fresh, { name: "Adam Nowicki" });
  assert.equal(R.FleetPick.chipper(s, "jenz hem 583").rec.id, "ch_jenz");
});

test("nowy pojazd i nowy kierowca wpisani w kursie → po zatwierdzeniu w kartotece Floty, operacja wskazuje nowe identyfikatory, audyt", () => {
  const s = fresh(), before = countFleet(s);
  const d = draft({ purchase: PURCHASE, transport: ownRuns([{ vehicleReg: "wgm 77001", driverName: "Adam Nowicki" }]) });
  const plan = R.planOperation(s, d, ctx(s));
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.equal(countFleet(s).vehicles, before.vehicles, "plan nie zmienia kartoteki");
  const r = R.commitOperation(s, d, ctx(s));
  assert.equal(r.ok, true, r.error);
  const v = s.fleet.vehicles.find(x => x.reg === "WGM 77001"), dr = s.fleet.drivers.find(x => x.name === "Adam Nowicki");
  assert.ok(v && dr, "nowe pozycje w kartotece");
  assert.deepEqual([v.status, v.owner, v.driverId, v.whId, v.createdFrom], ["aktywny", "own", dr.id, "", r.op.no]);
  const run = r.op.transport.runs[0];
  assert.deepEqual([run.vehicleId, run.reg, run.driverId, run.driverName], [v.id, "WGM 77001", dr.id, "Adam Nowicki"]);
  assert.equal(run.newVehicle, undefined, "znaczniki tymczasowe usunięte");
  assert.deepEqual([r.op.transport.vehicleId, r.op.transport.driverId], [v.id, dr.id]);
  assert.deepEqual([r.op.input.transport.own.runs[0].vehicleId, r.op.input.transport.own.runs[0].vehicleReg, r.op.input.transport.own.runs[0].driverId], [v.id, "", dr.id]);
  assert.ok(s.audit.some(a => a.entity === "fleet" && a.entityId === v.id && a.relatedNo === r.op.no));
  assert.ok(s.audit.some(a => a.entity === "fleet" && a.entityId === dr.id));
});

test("ta sama nowa pozycja w kilku kursach jest dopisywana raz; istniejący numer rejestracyjny i kierowca nie tworzą duplikatów", () => {
  const s = fresh(), before = countFleet(s);
  const d = draft({ purchase: PURCHASE, transport: ownRuns([
    { vehicleReg: "SK 9000A", driverName: "Ewa Malinowska", qty: "10" },
    { vehicleReg: "sk9000a", driverName: "ewa malinowska", qty: "10" },
    { vehicleReg: "sgl 4t821", driverName: "jan kowalski", qty: "10" }]) });
  const r = R.commitOperation(s, d, ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.equal(countFleet(s).vehicles, before.vehicles + 1);
  assert.equal(countFleet(s).drivers, before.drivers + 1);
  const ids = r.op.transport.runs.map(x => x.vehicleId);
  assert.equal(ids[0], ids[1]);
  assert.equal(ids[2], "ve_scania");
  assert.equal(r.op.transport.runs[2].driverId, "dr_kowalski");
  // druga operacja z tym samym (już istniejącym) pojazdem — bez kolejnego wpisu
  const r2 = R.commitOperation(s, draft({ purchase: PURCHASE, transport: ownRuns([{ vehicleReg: "SK 9000 A", driverName: "Ewa Malinowska" }]) }), ctx(s));
  assert.equal(r2.ok, true, r2.error);
  assert.equal(countFleet(s).vehicles, before.vehicles + 1);
});

test("walidacja: zły numer rejestracyjny, za krótkie nazwisko, brak pojazdu i kierowcy — błędy przy polach kursu", () => {
  const s = fresh();
  const e = R.planOperation(s, draft({ purchase: PURCHASE, transport: ownRuns([{ vehicleReg: "W#", driverName: "Al" }]) }), ctx(s)).errors;
  assert.match(e["transport.own.runs.0.vehicleId"], /Numer rejestracyjny/);
  assert.match(e["transport.own.runs.0.driverId"], /co najmniej 3 litery/);
  const e2 = R.planOperation(s, draft({ purchase: PURCHASE, transport: ownRuns([{}]) }), ctx(s)).errors;
  assert.match(e2["transport.own.runs.0.vehicleId"], /wpisz numer rejestracyjny/);
  const e3 = R.planOperation(s, draft({ purchase: PURCHASE, transport: ownRuns([{ vehicleReg: "WGM 1234" }]) }), ctx(s)).errors;
  assert.match(e3["transport.own.runs.0.driverId"], /wpisz nowego/, "nowy pojazd nie ma kierowcy domyślnego");
  const ext = R.planOperation(s, draft({ purchase: PURCHASE, transport: ownRuns([{ vehicleReg: s.fleet.vehicles.find(v => v.owner === "external").reg, driverName: "Jan Kowalski" }]) }), ctx(s)).errors;
  assert.match(ext["transport.own.runs.0.vehicleId"], /firmy zewnętrznej/);
});

test("pojazd wycofany wybrany w kursie wraca do pracy przy zatwierdzeniu (ostrzeżenie w planie, wpis audytu)", () => {
  const s = fresh();
  const v = s.fleet.vehicles.find(x => x.id === "ve_volvo"); v.status = "wycofany";
  const d = draft({ purchase: PURCHASE, transport: ownRuns([{ vehicleId: "ve_volvo", driverId: "dr_nowak" }]) });
  const plan = R.planOperation(s, d, ctx(s));
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.ok(plan.warnings.some(w => /Wycofany.*wróci do pracy/.test(w)), plan.warnings.join(" | "));
  const r = R.commitOperation(s, d, ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.equal(R.byId(s.fleet.vehicles, "ve_volvo").status, "aktywny");
  assert.ok(s.audit.some(a => a.entity === "fleet" && a.entityId === "ve_volvo" && /przywrócony do pracy/.test(JSON.stringify(a.act))));
});

test("produkcja: nowy rębak i nowy operator wpisani → kartoteka Floty; istniejący po nazwie; rębak własny wymaga operatora", () => {
  const s = fresh(), before = countFleet(s);
  const P = over => draft({ type: "PRODUKCJA", production: Object.assign({ rawProductId: "pr_drewno", consumeQty: "10", outProductId: "pr_zr_lesna", outQty: "40", chipRate: "10" }, over) });
  const noOp = R.planOperation(s, P({ chipperName: "Musmax WT 10" }), ctx(s));
  assert.match(noOp.errors["production.operatorId"], /wpisz nowego/);
  const r = R.commitOperation(s, P({ chipperName: "Musmax WT 10", operatorName: "Paweł Gajda" }), ctx(s));
  assert.equal(r.ok, true, r.error);
  const ch = s.fleet.chippers.find(c => c.name === "Musmax WT 10"), op = s.fleet.operators.find(o => o.name === "Paweł Gajda");
  assert.ok(ch && op);
  assert.deepEqual([ch.owner, ch.status, ch.operatorId], ["own", "aktywny", op.id]);
  assert.deepEqual([r.op.production.chipperId, r.op.production.operatorId, r.op.production.operatorName], [ch.id, op.id, "Paweł Gajda"]);
  assert.deepEqual([r.op.input.production.chipperId, r.op.input.production.chipperName, r.op.input.production.operatorId], [ch.id, "", op.id]);
  // ten sam rębak i operator wpisani ponownie (inna wielkość liter) — bez duplikatów; operator domyślny z rębaka
  const r2 = R.commitOperation(s, P({ chipperName: "musmax wt 10" }), ctx(s));
  assert.equal(r2.ok, true, r2.error);
  assert.equal(r2.op.production.operatorId, op.id, "operator domyślny rębaka");
  assert.deepEqual([countFleet(s).chippers, countFleet(s).operators], [before.chippers + 1, before.operators + 1]);
});

test("rębak firmy zewnętrznej wybrany po nazwie — operator opisowo, bez dopisywania operatora do kartoteki", () => {
  const s = fresh(), before = countFleet(s);
  const ext = s.fleet.chippers.find(c => c.owner === "external");
  const r = R.commitOperation(s, draft({ type: "PRODUKCJA", production: { rawProductId: "pr_drewno", consumeQty: "10", outProductId: "pr_zr_lesna", outQty: "40", chipperName: ext.name, operatorName: "Operator usługodawcy" } }), ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.op.production.chipperId, r.op.production.chipperOwner, r.op.production.operatorName], [ext.id, "external", "Operator usługodawcy"]);
  assert.deepEqual(countFleet(s), before);
});

test("korekta operacji: nowy kierowca wpisany w korekcie trafia do kartoteki", () => {
  const s = fresh();
  const r = R.commitOperation(s, draft({ purchase: PURCHASE, transport: ownRuns([{ vehicleId: "ve_scania", driverId: "dr_kowalski" }]) }), ctx(s));
  assert.equal(r.ok, true, r.error);
  const nd = JSON.parse(JSON.stringify(r.op.input));
  Object.assign(nd.transport.own.runs[0], { driverId: "", driverName: "Robert Kaczmarek" });
  const c = R.correctOperation(s, r.op.id, Object.assign(nd, { type: r.op.type }), "błędny transport", ctx(s));
  assert.equal(c.ok, true, c.error);
  const dr = s.fleet.drivers.find(x => x.name === "Robert Kaczmarek");
  assert.ok(dr, "kierowca z korekty w kartotece");
  assert.equal(c.op.transport.runs[0].driverId, dr.id);
  assert.equal(c.op.input.transport.own.runs[0].driverId, dr.id);
});

test("magazynier (bez fleet.edit) może wpisać nowy pojazd w operacji — przez Service, na kopii stanu", () => {
  const s = fresh();
  const d = draft({ purchase: PURCHASE, transport: ownRuns([{ vehicleReg: "SZA 55001", driverName: "Kamil Wrona" }]) });
  const out = Service.run(s, "op.commit", { draft: d }, ctx(s, "u_mag"));
  if (out.res && out.res.pending === true) {
    assert.equal(out.state.fleet.vehicles.some(v => v.reg === "SZA 55001"), false, "przed zatwierdzeniem pojazd nie trafia do Floty");
  } else {
    assert.equal(out.res.ok, true, out.res && out.res.error);
    assert.ok(out.state.fleet.vehicles.some(v => v.reg === "SZA 55001"));
  }
  assert.equal(s.fleet.vehicles.some(v => v.reg === "SZA 55001"), false, "stan źródłowy bez zmian");
});

/* ============================== szablony operacji ============================== */
test("szablon: zapis czyści dane jednorazowe; użycie daje formularz na dziś z nowym kluczem; operacja z szablonu się zapisuje", () => {
  const s = fresh();
  const d = draft({ purchase: PURCHASE, notes: "uwaga", extDoc: "FV 1/2026", transport: ownRuns([{ vehicleId: "ve_scania", driverId: "dr_kowalski", kwit: "K-1", weightT: "24,5" }]) });
  const r = R.Templates.save(s, { name: "  Drwal  → Zabrze ", draft: d }, ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.rec.name, "Drwal → Zabrze");
  assert.equal(r.rec.draft.date, undefined); assert.equal(r.rec.draft.notes, undefined); assert.equal(r.rec.draft.idemKey, undefined);
  assert.deepEqual([r.rec.draft.transport.own.runs[0].kwit, r.rec.draft.transport.own.runs[0].weightT], ["", ""]);
  assert.match(r.rec.summary, /SGL 4T821/); assert.match(r.rec.summary, /Jan Kowalski/);
  assert.ok(s.audit.some(a => a.entity === "template" && a.entityId === r.rec.id));
  const n1 = R.Templates.instantiate(r.rec.draft, { today: TODAY }), n2 = R.Templates.instantiate(r.rec.draft, { today: TODAY });
  assert.equal(n1.date, TODAY); assert.notEqual(n1.idemKey, n2.idemKey);
  const op = R.commitOperation(s, n1, ctx(s));
  assert.equal(op.ok, true, op.error);
});

test("szablon: nazwa unikalna w magazynie, prywatny widzi tylko autor, zmiana i usunięcie — autor albo kierownik", () => {
  const s = fresh(), d = draft({ purchase: PURCHASE });
  assert.equal(R.Templates.save(s, { name: "ab", draft: d }, ctx(s)).ok, false, "za krótka nazwa");
  const a = R.Templates.save(s, { name: "Drewno Drwal", draft: d, whId: "wh_zab" }, ctx(s, "u_mag"));
  assert.equal(a.ok, true, a.error);
  assert.equal(R.Templates.save(s, { name: "drewno drwal", draft: d, whId: "wh_zab" }, ctx(s)).ok, false, "duplikat nazwy");
  const p = R.Templates.save(s, { name: "Mój prywatny", draft: d, shared: false, whId: "wh_zab" }, ctx(s, "u_mag"));
  assert.equal(p.ok, true, p.error);
  assert.ok(R.Templates.visible(s, U(s, "u_mag"), "wh_zab").some(x => x.id === p.rec.id));
  assert.ok(!R.Templates.visible(s, U(s, "u_kier"), "wh_zab").some(x => x.id === p.rec.id), "prywatny niewidoczny dla innych");
  assert.ok(R.Templates.visible(s, U(s, "u_kier"), "wh_zab").some(x => x.id === a.rec.id));
  const other = s.users.find(u => u.id !== "u_mag" && u.role === "magazynier");
  if (other) assert.equal(R.Templates.remove(s, a.rec.id, ctx(s, other.id)).ok, false, "inny magazynier nie usuwa");
  const ren = R.Templates.save(s, { id: a.rec.id, name: "Drewno Drwal — Zabrze" }, ctx(s, "u_kier"));
  assert.equal(ren.ok, true, ren.error);
  assert.equal(R.byId(s.templates, a.rec.id).draft.type, "ZAKUP", "zmiana nazwy zachowuje dane");
  assert.equal(R.Templates.remove(s, a.rec.id, ctx(s, "u_kier")).ok, true);
  assert.equal(R.byId(s.templates, a.rec.id), null);
});

test("szablony przez Service: zapis na kopii stanu; projekcja dla użytkownika pokazuje tylko jego prywatne", () => {
  const s = fresh(), d = draft({ purchase: PURCHASE });
  const out = Service.run(s, "template.save", { rec: { name: "Wspólny Zabrze", draft: d, whId: "wh_zab" } }, ctx(s, "u_mag"));
  assert.equal(out.res.ok, true, out.res.error);
  assert.equal((s.templates || []).length, 0, "stan źródłowy bez zmian");
  const priv = Service.run(out.state, "template.save", { rec: { name: "Prywatny", draft: d, shared: false } }, ctx(out.state, "u_kier"));
  assert.equal(priv.res.ok, true, priv.res.error);
  const view = Service.project ? Service.project(priv.state, U(priv.state, "u_mag")) : null;
  if (view) assert.deepEqual(view.templates.map(x => x.name), ["Wspólny Zabrze"]);
});

test("migracja: dane bez listy szablonów dostają pustą listę (bez zmiany schematu)", () => {
  const s = fresh(); delete s.templates;
  const m = R.migrate(JSON.parse(JSON.stringify(s)));
  assert.ok(!m.error, m.error);
  assert.deepEqual(m.state.templates, []);
});

/* ============================== kwity z wagi ============================== */
test("kwity z wagi: kod QR (pary), CSV z kilogramami i separatorem tysięcy, JSON, brutto − tara, błędy", () => {
  const q = R.Scale.parse("KWIT=7096;NETTO=7780;BRUTTO=13560;TARA=5780;REJ=KCY088Y");
  assert.deepEqual(q.tickets.map(x => [x.no, x.netT, x.grossT, x.tareT, x.reg]), [["7096", 7.78, 13.56, 5.78, "KCY088Y"]]);
  const csv = R.Scale.parse("Nr kwitu;Data;Nr rej.;Brutto [kg];Tara [kg];Netto [kg]\n7096;22.07.2026;SGL 4T821;13 560;5 780;7 780\n7097;22.07.2026;SZA12345;40.120;14.300;25.820");
  assert.deepEqual(csv.tickets.map(x => [x.no, x.netT, x.reg]), [["7096", 7.78, "SGL 4T821"], ["7097", 25.82, "SZA12345"]]);
  const json = R.Scale.parse('[{"ticket":"A1","net":24.36,"vehicle":"sk 7788x"},{"kwit":"A2","brutto":"38,1 t","tara":"14 t"}]');
  assert.deepEqual(json.tickets.map(x => [x.no, x.netT]), [["A1", 24.36], ["A2", 24.1]]);
  const lines = R.Scale.parse("KWIT=1;NETTO=24000\nKWIT=2;NETTO=23500");
  assert.deepEqual(lines.tickets.map(x => x.netT), [24, 23.5], "każda linia = osobny kwit (czytnik)");
  assert.equal(R.Scale.parse("KWIT=9;NETTO=150000").tickets.length, 0, "150 t poza zakresem");
  assert.ok(R.Scale.parse("ala ma kota").errors.length);
  assert.ok(R.Scale.parse("{zly").errors.length);
});

test("kwity z wagi: dopasowanie do kursów po numerze rejestracyjnym, potem kolejno; kurs z wagą pomijany", () => {
  const runs = [{ reg: "SGL 4T821", kwit: "", weightT: "" }, { reg: "SZA 12345", kwit: "", weightT: "" }, { reg: "", kwit: "", weightT: "21" }, { reg: "", kwit: "", weightT: "" }];
  const tk = R.Scale.parse("KWIT=1;NETTO=24000;REJ=sza12345\nKWIT=2;NETTO=23000;REJ=SGL4T821\nKWIT=3;NETTO=22000").tickets;
  const m = R.Scale.match(tk, runs);
  assert.deepEqual(m.map(x => [x.ticket.no, x.run, x.by]), [["1", 1, "reg"], ["2", 0, "reg"], ["3", 3, "order"]]);
  const none = R.Scale.match(R.Scale.parse("KWIT=4;NETTO=20000").tickets, [{ reg: "", kwit: "", weightT: "20" }]);
  assert.equal(none[0].run, null);
});

test("FleetPick.resolveDraft: wpisane teksty z szablonu → identyfikatory, gdy pozycja jest już w kartotece", () => {
  const s = fresh();
  const d = { transport: { own: { runs: [{ vehicleId: "", vehicleReg: "sgl 4t821", driverId: "", driverName: "jan kowalski" }, { vehicleId: "", vehicleReg: "WGM 1", driverId: "", driverName: "Nowa Osoba" }] } },
    production: { chipperId: "", chipperName: "jenz hem 583", operatorId: "", operatorName: "krzysztof lis" } };
  R.FleetPick.resolveDraft(s, d);
  assert.deepEqual(d.transport.own.runs.map(r => [r.vehicleId, r.vehicleReg, r.driverId, r.driverName]), [["ve_scania", "", "dr_kowalski", ""], ["", "WGM 1", "", "Nowa Osoba"]]);
  assert.deepEqual([d.production.chipperId, d.production.operatorId], ["ch_jenz", "op_lis"]);
});
