/* Testy funkcji wersji 3.6:  node --test tests/features36.test.mjs
   Zakup z produkcją i sprzedażą bezpośrednią z lasu (bez magazynowania), flota własna i zewnętrzna,
   wysyłka raportów e-mailem (walidacja po stronie przeglądarki). */
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
require("../app/src/seed.js");

const TODAY = "2026-09-23";
const fresh = () => R.Seed.build(TODAY);
const U = (s, id) => s.users.find(u => u.id === id);
const ctx = (s, uid = "u_kier") => ({ user: U(s, uid), today: TODAY, source: "test" });
const draft = over => R.Seed.draftOf(over.date || TODAY, Object.assign({ transport: { mode: "none", place: "RiC Zabrze" } }, over));
const bal = (s, pid, wh = "wh_zab") => R.Stock.balance(s, wh, pid);
const commit = (s, d, c) => { const r = R.commitOperation(s, d, c || ctx(s)); assert.equal(r.ok, true, r.error); return r.op; };
const PURCHASE = { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: "20", unit: "m3", price: "230", weightMode: "auto" };
const LESNA = { enabled: true, type: "lesna", ndl: "Rudy Raciborskie", lesnictwo: "Stanica", kwit: "KW 0300/09/2026" };
const DIRECT_SALE = { enabled: true, direct: true, buyerId: "pa_ec_zab", price: "90", priceUnit: "MP" };

/* ======================= Zakup + produkcja + sprzedaż bezpośrednia z lasu ======================= */
test("zakup: produkcja + sprzedaż bezpośrednia z lasu — stan magazynu bez zmian, PRODUKCJA i SPRZEDAŻ oznaczone jako bezpośrednie", () => {
  const s = fresh();
  const before = [bal(s, "pr_drewno"), bal(s, "pr_zr_lesna")];
  const op = commit(s, draft({ purchase: PURCHASE, production: LESNA, sale: DIRECT_SALE }));
  assert.equal(op.direct, true);
  assert.deepEqual(op.scope, ["ZAKUP", "PRODUKCJA", "SPRZEDAZ"]);
  assert.deepEqual(s.ledger.filter(l => l.opId === op.id).map(l => [l.kind, l.qty, l.direct]),
    [["ZAKUP", 20, false], ["ZUZYCIE", -20, false], ["PRODUKCJA", 80, true], ["SPRZEDAZ", -80, true]]);
  assert.deepEqual([bal(s, "pr_drewno"), bal(s, "pr_zr_lesna")], before, "bez magazynowania: stan drewna i zrębki bez zmian");
  assert.deepEqual(op.documents.map(d => d.type), ["PZ", "RW", "PW", "WZ"]);
  assert.ok(op.documents.find(d => d.type === "WZ").meta.direct);
  assert.equal(op.totals.revenue, 7200);
});

test("zakup bezpośredni: raport miesiąca liczy sprzedaż jako bezpośrednią, historia pokazuje SPRZEDAZ_BEZP", () => {
  const s = fresh();
  const op = commit(s, draft({ purchase: PURCHASE, production: LESNA, sale: DIRECT_SALE }));
  const rep = R.Reports.business(s, { mode: "month", from: "2026-09-01", to: "2026-09-30" });
  const base = R.Reports.business(fresh(), { mode: "month", from: "2026-09-01", to: "2026-09-30" });
  assert.equal(Math.round(rep.sales.valueDirect - base.sales.valueDirect), 7200);
  assert.equal(rep.sales.value, base.sales.value, "sprzedaż przez magazyn bez zmian");
  const hist = R.Reports.history(s, { whId: "wh_zab", to: "2026-09-30" }).filter(r => r.opId === op.id);
  assert.deepEqual(hist.map(r => r.type), ["ZAKUP", "ZUZYCIE", "SPRZEDAZ_BEZP", "SPRZEDAZ_BEZP"]);
});

test("zakup bezpośredni: niepełne zużycie i niepełna sprzedaż dają ostrzeżenia (reszta trafia na stan)", () => {
  const s = fresh();
  const plan = R.planOperation(s, draft({ purchase: PURCHASE, production: Object.assign({}, LESNA, { consumeQty: "15" }), sale: Object.assign({}, DIRECT_SALE, { qtyMP: "50" }) }), ctx(s));
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.ok(plan.warnings.some(w => /Nie całe kupione drewno/.test(w)), plan.warnings.join(" | "));
  assert.ok(plan.warnings.some(w => /Nie cała produkcja jest sprzedana/.test(w)), plan.warnings.join(" | "));
});

test("zakup bezpośredni: korekta nie może zmienić rodzaju sprzedaży (bezpośrednia ↔ przez magazyn)", () => {
  const s = fresh();
  const op = commit(s, draft({ purchase: PURCHASE, production: LESNA, sale: DIRECT_SALE }));
  const r = R.correctOperation(s, op.id, draft({ purchase: PURCHASE, production: LESNA, sale: Object.assign({}, DIRECT_SALE, { direct: false }) }), "test", ctx(s));
  assert.equal(r.ok, false);
  const ok = R.correctOperation(s, op.id, draft({ purchase: PURCHASE, production: LESNA, sale: Object.assign({}, DIRECT_SALE, { price: "95" }) }), "zmiana ceny", ctx(s));
  assert.equal(ok.ok, true, ok.error);
  assert.equal(s.ledger.filter(l => l.opId === op.id && l.kind === "KOREKTA").length, 0, "zmiana ceny nie rusza stanów");
});

test("zakup: dotychczasowa sprzedaż wyniku produkcji przez magazyn (operacje sprzed 3.6) działa bez zmian", () => {
  const s = fresh();
  const op = commit(s, draft({ purchase: PURCHASE, production: LESNA, sale: { enabled: true, buyerId: "pa_ec_zab", price: "90" } }));
  assert.equal(op.direct, false);
  assert.ok(s.ledger.filter(l => l.opId === op.id).every(l => !l.direct));
});

test("zakup: sprzedaż bez produkcji jest odrzucana", () => {
  const s = fresh();
  const plan = R.planOperation(s, draft({ purchase: PURCHASE, sale: DIRECT_SALE }), ctx(s));
  assert.equal(plan.ok, false);
});

/* ================================ flota własna / zewnętrzna ================================ */
test("flota: pojazd firmy zewnętrznej — wymagana firma, bez kierowcy z kartoteki; pojazd własny — kierowca opcjonalny (3.10.1), ale z kartoteki", () => {
  const s = fresh(), c = ctx(s);
  const bad = R.Fleet.save(s, "vehicles", { name: "Iveco", owner: "external", reg: "WX 1234A", type: "ciezarowy", status: "aktywny" }, c);
  assert.equal(bad.ok, false); assert.ok(bad.errors.company);
  const ok = R.Fleet.save(s, "vehicles", { name: "Iveco", owner: "external", company: "Trans-Bud", reg: "wx 1234a", type: "ciezarowy", status: "aktywny", driverId: "dr_nowak", driverName: "Jan Wiśniewski" }, c);
  assert.equal(ok.ok, true, ok.error);
  assert.deepEqual([ok.rec.owner, ok.rec.company, ok.rec.driverId, ok.rec.driverName, ok.rec.reg], ["external", "Trans-Bud", "", "Jan Wiśniewski", "WX 1234A"]);
  const own = R.Fleet.save(s, "vehicles", { name: "Scania", reg: "SGL 1111", type: "ciezarowy", status: "aktywny", company: "x", driverId: "dr_brak" }, c);
  assert.equal(own.ok, false); assert.ok(own.errors.driverId, "kierowca spoza kartoteki odrzucony");
  const own0 = R.Fleet.save(s, "vehicles", { name: "Scania", reg: "SGL 1110", type: "ciezarowy", status: "aktywny", company: "x" }, c);
  assert.equal(own0.ok, true, "bez kierowcy domyślnego („—”)"); assert.equal(own0.rec.driverId, "");
  const own2 = R.Fleet.save(s, "vehicles", { name: "Scania", reg: "SGL 1111", type: "ciezarowy", status: "aktywny", driverId: "dr_nowak", company: "x", driverName: "y" }, c);
  assert.equal(own2.ok, true); assert.deepEqual([own2.rec.owner, own2.rec.company, own2.rec.driverName], ["own", "", ""]);
});

test("flota: dane demonstracyjne mają pojazdy firm zewnętrznych; dotychczasowe pojazdy bez pola owner to flota własna", () => {
  const s = fresh();
  const ext = s.fleet.vehicles.filter(v => v.owner === "external");
  assert.deepEqual(ext.map(v => v.reg).sort(), ["ESI 18734", "ESI 20511", "SPY 92FR", "SZA 7K901", "SZA 7K902"]);
  assert.ok(ext.every(v => v.company && !v.driverId));
  assert.ok(s.fleet.vehicles.filter(v => v.owner !== "external").every(v => v.driverId));
});

test("flota: transport własny nie przyjmuje pojazdu firmy zewnętrznej", () => {
  const s = fresh();
  const plan = R.planOperation(s, draft({ purchase: Object.assign({}, PURCHASE, { qty: "5" }), transport: { mode: "own", place: "RiC Zabrze", own: { runCount: "1", runs: [{ vehicleId: "ve_ext_esi1", driverId: "dr_nowak", km: "10" }] } } }), ctx(s));
  assert.equal(plan.ok, false);
  assert.match(JSON.stringify(plan.errors), /firmy zewnętrznej/);
  const ok = R.planOperation(s, draft({ purchase: Object.assign({}, PURCHASE, { qty: "5" }), transport: { mode: "own", place: "RiC Zabrze", own: { runCount: "1", runs: [{ vehicleId: "ve_scania", driverId: "dr_kowalski", km: "10" }] } } }), ctx(s));
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
});
