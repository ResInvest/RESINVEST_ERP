/* Testy modułu „Plan placu / pryzmy / terminarz pociągów / załadunek” (silnik):  node --test tests/yardplan315.test.mjs
   pryzmy jako podział stanu z księgi, infrastruktura, terminarz, automatyczny przydział i kolory, niedobór,
   brak podwójnego przypisania, symulacja (warianty, kalkulator), rezerwacja przy zatwierdzeniu, realizacja i dokument WZ,
   uprawnienia, izolacja magazynów, audyt, zgodność z ewidencją. */
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
const Y = R.YardPlan;

const TODAY = "2026-11-10";
const ctxOf = (s, uid) => ({ user: R.byId(s.users, uid), today: TODAY, now: TODAY + "T08:00:00.000Z" });
/** Wykonanie komendy; zwraca nowy stan (albo ten sam przy odmowie) i wynik. */
function run(s, uid, cmd, args) { const r = Service.run(s, cmd, args, ctxOf(s, uid)); return { s: r.state || s, res: r.res, changed: !!r.state }; }
const must = (s, uid, cmd, args) => { const r = run(s, uid, cmd, args); assert.equal(r.res.ok, true, `${cmd}: ${r.res.error} ${JSON.stringify(r.res.errors || "")}`); return r; };
/** Baza przykładowa bez pryzm i pociągów z danych przykładowych — testy budują własne. */
const base = () => { const s = R.Seed.build(TODAY); s.yard = []; s.trains = []; s.loadPlans = []; return s; };
const stock = (s, p = "pr_zr_lesna") => R.Stock.balance(s, "wh_zab", p);
const pile = (over = {}) => Object.assign({ whId: "wh_zab", name: "Fortum", productId: "pr_zr_lesna", qty: "1000", shape: "pryzma", hei: "5", x: 120, y: 60, w: 60, h: 15, rot: 0, status: "AVAILABLE" }, over);
const train = (over = {}) => Object.assign({ whId: "wh_zab", no: "PKP-1", buyerId: "pa_ec_zab", arrivalDate: "2026-11-12", arrivalTime: "06:00", loadDate: "2026-11-12", loadStart: "07:00", loadEnd: "15:00", reqQty: "1500" }, over);
/** Plac z infrastrukturą wzorcową i trzema pryzmami w różnej odległości od miejsca załadunku (125; 33). */
function yard() {
  let s = must(base(), "u_admin", "yardobj.template", { whId: "wh_zab" }).s;
  let a = must(s, "u_admin", "pile.save", pile({ name: "F1", qty: "1000", x: 125, y: 50 })); s = a.s;
  let b = must(s, "u_admin", "pile.save", pile({ name: "F2", qty: "800", x: 125, y: 80 })); s = b.s;
  let c = must(s, "u_admin", "pile.save", pile({ name: "F3", qty: "600", x: 200, y: 130 })); s = c.s;
  return { s, F1: a.res.pile.id, F2: b.res.pile.id, F3: c.res.pile.id };
}

test("pryzma: podział stanu z księgi — numer, przeliczenia ERP, objętość geometryczna, suma ≤ ewidencja", () => {
  let s = base();
  const led = stock(s);
  const r = must(s, "u_admin", "pile.save", pile({ qty: "2 250" })); s = r.s;
  const p = r.res.pile;
  assert.equal(p.no, "P-001"); assert.equal(p.kind, "pile");
  const q = Y.pileQty(s, p);
  assert.equal(q.qty, 2250); assert.equal(q.mp, 2250);
  assert.equal(q.m3, 2250 / s.config.m3_mp, "1 m³ = 4 MP (przelicznik ERP)");
  assert.equal(q.t, R.Units.mass(2250, R.byId(s.products, "pr_zr_lesna"), s.config), "masa wg logiki ERP");
  assert.equal(q.geo, 2250, "przekrój trójkątny 60 × 15 × 5 m — nie prostopadłościan (4 500)");
  assert.equal(Y.geoVolume({ shape: "prostopadloscian", w: 60, h: 15, hei: 5 }), 4500);
  assert.equal(Y.geoVolume({ shape: "trapez", w: 60, h: 15, hei: 5, topW: 5 }), 3000);
  assert.equal(Y.geoVolume({ shape: "kopula", w: 60, h: 15, hei: 5 }), 3000);
  assert.equal(stock(s), led, "utworzenie pryzmy nie zmienia stanu magazynu");
  const over = run(s, "u_admin", "pile.save", pile({ name: "X", qty: String(led) }));
  assert.equal(over.res.ok, false); assert.match(over.res.errors.qty, /najwyżej/);
  const c = Y.consistency(s, "wh_zab").find(x => x.productId === "pr_zr_lesna");
  assert.deepEqual([c.ledger, c.inPiles, c.free, c.over], [led, 2250, led - 2250, false]);
  assert.equal(s.audit.at(-1).entity, "yard"); assert.equal(s.audit.at(-1).action, "Pryzma — utworzenie");
});

test("pryzma: przesunięcie, obrót, wymiary, status, usunięcie — każda zmiana w audycie; walidacja i uprawnienia", () => {
  let s = base();
  let r = must(s, "u_admin", "pile.save", pile()); s = r.s; const id = r.res.pile.id;
  r = must(s, "u_mag", "yardobj.move", { id, x: 90, y: 70, rot: 30 }); s = r.s;
  assert.deepEqual([r.res.object.x, r.res.object.y, r.res.object.rot], [90, 70, 30]);
  assert.equal(s.audit.at(-1).action, "Pryzma — zmiana położenia"); assert.equal(s.audit.at(-1).userId, "u_mag");
  r = must(s, "u_admin", "yardobj.move", { id, w: 70, h: 18 }); s = r.s;
  assert.equal(s.audit.at(-1).action, "Pryzma — zmiana wymiarów");
  r = must(s, "u_admin", "pile.save", { id, status: "BLOCKED", qualityNote: "wilgotność powyżej normy", moisture: "55" }); s = r.s;
  assert.equal(s.audit.at(-1).action, "Pryzma — zmiana statusu");
  assert.equal(run(s, "u_admin", "yardobj.move", { id, x: 9999 }).res.ok, false, "poza placem");
  assert.equal(run(s, "u_admin", "pile.save", { id, hei: "0" }).res.ok, false);
  assert.equal(run(s, "u_admin", "pile.save", { id }).res.code, "NOCHANGE");
  for (const u of ["u_view", "u_aud"]) assert.equal(run(s, u, "pile.save", pile()).res.ok, false, u);
  assert.equal(run(s, "u_kbra", "yardobj.move", { id, x: 10 }).res.ok, false, "kierownik innego magazynu");
  r = must(s, "u_admin", "yardobj.remove", { id }); s = r.s;
  assert.equal(Y.piles(s, "wh_zab").length, 0);
  assert.deepEqual(R.validateStateShape(s), []);
});

test("infrastruktura: układ wzorcowy (tor, załadunek, droga, szlaban, waga, kontenery, próbki, tablica, ogrodzenie), edycja", () => {
  let s = must(base(), "u_admin", "yardobj.template", { whId: "wh_zab" }).s;
  const kinds = new Set(Y.infra(s, "wh_zab").map(o => o.kind));
  assert.deepEqual([...kinds].sort(), Object.keys(Y.INFRA).sort());
  assert.equal(Y.infra(s, "wh_zab").filter(o => o.kind === "sample").length, 5);
  assert.equal(run(s, "u_admin", "yardobj.template", { whId: "wh_zab" }).res.ok, false, "tylko na pusty plac");
  const r = must(s, "u_admin", "yardobj.save", { whId: "wh_zab", kind: "container", label: "Waga — biuro", x: 50, y: 50 }); s = r.s;
  assert.equal(r.res.object.w, Y.INFRA.container.w);
  s = must(s, "u_admin", "yardobj.remove", { id: r.res.object.id }).s;
  assert.equal(run(s, "u_admin", "yardobj.save", { whId: "wh_zab", kind: "ufo" }).res.ok, false);
  assert.equal(Y.infra(s, "wh_bra").length, 0, "inne magazyny bez zmian");
});

test("terminarz: dodanie, walidacja, zmiana statusu, usunięcie; uprawnienia", () => {
  let s = base();
  let r = must(s, "u_kier", "train.save", train()); s = r.s; const id = r.res.train.id;
  assert.equal(r.res.train.status, "PLANNED"); assert.equal(r.res.train.recipient, R.byId(s.partners, "pa_ec_zab").name);
  const bad = run(s, "u_kier", "train.save", { whId: "wh_zab", no: "", buyerId: "x", arrivalDate: "12.11.2026", arrivalTime: "25:00", reqQty: "0", loadStart: "10:00", loadEnd: "09:00" });
  assert.deepEqual(Object.keys(bad.res.errors).sort(), ["arrivalDate", "arrivalTime", "buyerId", "loadEnd", "no", "reqQty"]);
  assert.match(run(s, "u_kier", "train.save", train()).res.errors.no, /już jest/);
  assert.equal(run(s, "u_kier", "train.save", { id, status: "DONE" }).res.ok, false, "„Zakończony” tylko przez realizację");
  assert.equal(run(s, "u_mag", "train.save", train({ no: "X" })).res.code, "FORBIDDEN", "magazynier nie planuje pociągów");
  r = must(s, "u_kier", "train.save", { id, status: "DELAYED", notes: "awaria lokomotywy" }); s = r.s;
  assert.equal(s.audit.at(-1).action, "Pociąg — zmiana statusu");
  s = must(s, "u_kier", "train.remove", { id }).s;
  assert.equal(s.trains.length, 0);
});

test("automatyczny przydział: najbliższy pociąg — zielone pryzmy najbliżej miejsca załadunku; kolejny — pomarańczowe; reszta niebieska", () => {
  let { s, F1, F2, F3 } = yard();
  let r = must(s, "u_kier", "train.save", train({ no: "PKP-1", loadDate: "2026-11-12", arrivalDate: "2026-11-12", reqQty: "1500" })); s = r.s; const t1 = r.res.train.id;
  assert.deepEqual([r.res.allocation.need, r.res.allocation.total, r.res.allocation.shortage, r.res.allocation.isNext], [1500, 1500, 0, true], "wynik przydziału od razu po dodaniu pociągu");
  r = must(s, "u_kier", "train.save", train({ no: "PKP-2", loadDate: "2026-11-15", arrivalDate: "2026-11-15", reqQty: "500" })); s = r.s; const t2 = r.res.train.id;
  const A = Y.allocate(s, "wh_zab");
  assert.equal(A.next, t1); assert.deepEqual(A.order, [t1, t2]);
  assert.deepEqual(A.byTrain.get(t1).lines.map(l => [l.pileId, l.qty]), [[F1, 1000], [F2, 500]], "F1 (17 m) przed F2 (47 m)");
  assert.deepEqual(A.byTrain.get(t2).lines.map(l => [l.pileId, l.qty]), [[F2, 300], [F3, 200]]);
  assert.deepEqual([F1, F2, F3].map(id => A.byPile.get(id).color), ["green", "green", "orange"]);
  assert.equal(A.byPile.get(F3).free, 400);
  // ta sama ilość nigdy w dwóch pociągach: suma części każdej pryzmy ≤ ilość pryzmy
  for (const p of Y.piles(s, "wh_zab")) assert.ok(A.byPile.get(p.id).parts.reduce((x, y) => x + y.qty, 0) <= p.qty + 1e-9, p.no);
  // wcześniejszy termin przejmuje pierwszeństwo
  s = must(s, "u_kier", "train.save", train({ no: "PKP-0", loadDate: "2026-11-11", arrivalDate: "2026-11-11", reqQty: "900" })).s;
  const B = Y.allocate(s, "wh_zab");
  assert.equal(R.byId(s.trains, B.next).no, "PKP-0");
  assert.deepEqual(B.byTrain.get(B.next).lines.map(l => [l.pileId, l.qty]), [[F1, 900]]);
  assert.deepEqual([F1, F2, F3].map(id => B.byPile.get(id).color), ["green", "orange", "orange"]);
});

test("przydział: niedobór, pryzma zablokowana (czerwona) i wyłączona (szara), przypisanie ręczne, anulowanie pociągu", () => {
  let { s, F1, F2, F3 } = yard();
  let r = must(s, "u_kier", "train.save", train({ reqQty: "3000" })); s = r.s; const t1 = r.res.train.id;
  assert.equal(r.res.allocation.shortage, 600, "2 400 MP w pryzmach, potrzeba 3 000");
  s = must(s, "u_admin", "pile.save", { id: F1, status: "BLOCKED" }).s;
  s = must(s, "u_admin", "pile.save", { id: F2, status: "OFF" }).s;
  let A = Y.allocate(s, "wh_zab");
  assert.deepEqual([F1, F2, F3].map(id => A.byPile.get(id).color), ["red", "grey", "green"]);
  assert.equal(A.byTrain.get(t1).shortage, 2400);
  s = must(s, "u_admin", "pile.save", { id: F1, status: "AVAILABLE" }).s;
  s = must(s, "u_admin", "pile.save", { id: F2, status: "AVAILABLE" }).s;
  // ręcznie: F3 (najdalsza) dla drugiego pociągu — pierwszy jej nie dostanie
  r = must(s, "u_kier", "train.save", train({ no: "PKP-2", loadDate: "2026-11-20", arrivalDate: "2026-11-20", reqQty: "300" })); s = r.s; const t2 = r.res.train.id;
  s = must(s, "u_mag", "pile.save", { id: F3, trainId: t2 }).s;
  assert.equal(s.audit.at(-1).action, "Pryzma — przypisanie do pociągu");
  A = Y.allocate(s, "wh_zab");
  assert.deepEqual(A.byTrain.get(t2).lines.map(l => [l.pileId, l.qty, l.source]), [[F3, 300, "manual"]]);
  assert.ok(!A.byTrain.get(t1).lines.some(l => l.pileId === F3));
  s = must(s, "u_kier", "train.save", { id: t2, status: "CANCELLED" }).s;
  assert.equal(R.byId(s.yard, F3).trainId, "", "anulowanie zwalnia przypisanie");
  assert.ok(Y.allocate(s, "wh_zab").byTrain.get(t1).lines.some(l => l.pileId === F3));
});

test("symulacja: warianty A/B/C, kalkulator (wagony, cykle, czas — szacunkowo), zapis projektu bez zmiany stanów", () => {
  let { s, F1, F2, F3 } = yard();
  const led = stock(s);
  let r = must(s, "u_kier", "train.save", train({ reqQty: "700" })); s = r.s; const t1 = r.res.train.id;
  const A = Y.propose(s, t1, "nearest"), B = Y.propose(s, t1, "fewest"), C = Y.propose(s, t1, "fastest");
  assert.deepEqual(A.lines, [{ pileId: F1, qty: 700 }]);
  assert.deepEqual(B.lines, [{ pileId: F1, qty: 700 }], "największa pryzma wystarcza");
  assert.equal(C.shortage, 0);
  const big = must(s, "u_kier", "train.save", { id: t1, reqQty: "1700" }).s;
  assert.deepEqual(Y.propose(big, t1, "nearest").lines.map(l => l.qty), [1000, 700]);
  const P = Object.assign(Y.defaultParams(s.config), { bucketM3: 5, fill: 1, cycleSec: 60, wagonMP: 100, loaders: 2 });
  const c = Y.calc(big, R.byId(big.trains, t1), Y.propose(big, t1, "nearest").lines, P);
  assert.deepEqual([c.mp, c.m3, c.wagons, c.perWagon, c.cycles, c.piles, c.shortage], [1700, 425, 17, 100, 340, 2, 0]);
  assert.equal(c.t, R.Units.mass(1700, R.byId(s.products, "pr_zr_lesna"), s.config));
  assert.ok(c.timeMin > 340 * 60 / 2 / 60 && c.estimated === true, "czas = cykle × (czas cyklu + dojazd) / ładowarki + zmiana pryzmy");
  assert.deepEqual(c.rows.map(x => [x.order, x.before, x.after]), [[1, 1000, 0], [2, 800, 100]]);
  r = must(s, "u_mag", "load.save", { trainId: t1, name: "Wariant A", strategy: "nearest", lines: A.lines, params: { wagonMP: "100" } }); s = r.s;
  assert.equal(r.res.plan.status, "DRAFT"); assert.equal(r.res.calc.wagons, 7);
  assert.equal(stock(s), led, "symulacja nie zmienia stanu magazynu");
  assert.deepEqual(Y.piles(s, "wh_zab").map(p => p.qty), [1000, 800, 600], "ani ilości pryzm");
  assert.equal(Y.reserved(s).size, 0, "projekt niczego nie rezerwuje");
  const bad = run(s, "u_mag", "load.save", { trainId: t1, lines: [{ pileId: F1, qty: "5000" }, { pileId: F1, qty: "1" }, { pileId: "nie_ma", qty: "1" }], params: { fill: "9" } });
  assert.equal(bad.res.ok, false); assert.ok(bad.res.errors["line:" + F1] && bad.res.errors["line:nie_ma"] && bad.res.errors["params.fill"]);
});

test("zatwierdzenie = rezerwacja: druga rezerwacja tej samej zrębki odrzucona; cofnięcie zwalnia; zmiana pryzmy zablokowana", () => {
  let { s, F1, F2 } = yard();
  let r = must(s, "u_kier", "train.save", train({ no: "A", reqQty: "900" })); s = r.s; const tA = r.res.train.id;
  r = must(s, "u_kier", "train.save", train({ no: "B", loadDate: "2026-11-14", arrivalDate: "2026-11-14", reqQty: "400" })); s = r.s; const tB = r.res.train.id;
  r = must(s, "u_mag", "load.save", { trainId: tA, lines: [{ pileId: F1, qty: "900" }] }); s = r.s; const pA = r.res.plan.id;
  r = must(s, "u_mag", "load.save", { trainId: tB, lines: [{ pileId: F1, qty: "400" }] }); s = r.s; const pB = r.res.plan.id;
  assert.equal(run(s, "u_mag", "load.action", { id: pA, action: "approve" }).res.code, "FORBIDDEN", "magazynier nie zatwierdza");
  s = must(s, "u_kier", "load.action", { id: pA, action: "approve" }).s;
  assert.equal(R.byId(s.trains, tA).status, "PREPARING");
  assert.equal(Y.reserved(s).get(F1), 900);
  const dbl = run(s, "u_kier", "load.action", { id: pB, action: "approve" });
  assert.equal(dbl.res.ok, false); assert.equal(dbl.res.code, "RESERVE"); assert.match(dbl.res.error, /dostępne 100 MP/);
  assert.equal(dbl.changed, false);
  // przydział automatyczny respektuje rezerwację: pociąg B dostaje resztę F1 i F2
  const A = Y.allocate(s, "wh_zab");
  assert.deepEqual(A.byTrain.get(tA).lines.map(l => [l.pileId, l.qty, l.source]), [[F1, 900, "plan"]]);
  assert.deepEqual(A.byTrain.get(tB).lines.map(l => [l.pileId, l.qty]), [[F1, 100], [F2, 300]]);
  assert.match(run(s, "u_admin", "pile.save", { id: F1, qty: "500" }).res.errors.qty, /rezerwację/);
  assert.equal(run(s, "u_admin", "yardobj.remove", { id: F1 }).res.ok, false);
  assert.equal(run(s, "u_mag", "load.save", { id: pA, lines: [{ pileId: F1, qty: "950" }] }).res.code, "FORBIDDEN", "zmiana zatwierdzonego planu wymaga uprawnień");
  s = must(s, "u_kier", "load.action", { id: pA, action: "unapprove" }).s;
  assert.equal(Y.reserved(s).size, 0);
  s = must(s, "u_kier", "load.action", { id: pB, action: "approve" }).s;
  assert.equal(Y.reserved(s).get(F1), 400);
});

test("realizacja: start, wpis ilości i wagonów, wstrzymanie, zakończenie → WZ, stan księgi i pryzm, porównanie z planem", () => {
  let { s, F1, F2 } = yard();
  const led = stock(s), ops0 = s.operations.length;
  let r = must(s, "u_kier", "train.save", train({ reqQty: "1200" })); s = r.s; const t1 = r.res.train.id;
  r = must(s, "u_mag", "load.save", { trainId: t1, lines: [{ pileId: F1, qty: "1000" }, { pileId: F2, qty: "200" }] }); s = r.s; const id = r.res.plan.id;
  assert.equal(run(s, "u_mag", "load.action", { id, action: "start" }).res.ok, false, "najpierw zatwierdzenie");
  s = must(s, "u_kier", "load.action", { id, action: "approve" }).s;
  s = must(s, "u_kier", "load.action", { id, action: "handover" }).s;
  assert.equal(R.byId(s.trains, t1).status, "READY");
  s = must(s, "u_mag", "load.action", { id, action: "start" }).s;
  assert.equal(R.byId(s.trains, t1).status, "LOADING");
  assert.equal(run(s, "u_mag", "load.finish", { id, price: "90", weightT: "300" }).res.ok, false, "bez wpisanych ilości nie ma WZ");
  s = must(s, "u_mag", "load.record", { id, lines: [{ pileId: F1, qty: "980", done: true }], wagons: [{ no: "W1", qty: "120" }, { no: "W2", qty: "118,5" }] }).s;
  assert.equal(run(s, "u_mag", "load.record", { id, lines: [{ pileId: F2, qty: "5000" }] }).res.ok, false, "więcej niż w pryzmie");
  s = must(s, "u_mag", "load.action", { id, action: "pause", note: "przerwa" }).s;
  s = must(s, "u_mag", "load.action", { id, action: "resume" }).s;
  s = must(s, "u_mag", "load.record", { id, lines: [{ pileId: F2, qty: "190", done: true }] }).s;
  assert.deepEqual(Y.progress(R.byId(s.loadPlans, id)), { planned: 1200, done: 1170, diff: -30, left: 30, pct: 98, wagons: 238.5 });
  assert.equal(stock(s), led, "do zakończenia stan magazynu bez zmian");
  assert.equal(run(s, "u_mag", "load.finish", { id, price: "", weightT: "" }).res.ok, false);
  r = must(s, "u_mag", "load.finish", { id, price: "92,50", weightT: "386,1" }); s = r.s;
  assert.match(r.res.no, /^WZ\/\d{3}\/11\/2026$/);
  assert.equal(s.operations.length, ops0 + 1);
  const op = s.operations.at(-1);
  assert.deepEqual([op.type, op.whId, op.sale.productId, op.sale.qty, op.sale.buyerId], ["SPRZEDAZ", "wh_zab", "pr_zr_lesna", 1170, "pa_ec_zab"]);
  assert.equal(stock(s), led - 1170, "księga zmniejszona o rzeczywiście załadowaną ilość");
  assert.deepEqual([R.byId(s.yard, F1).qty, R.byId(s.yard, F2).qty], [20, 610], "pryzmy zmniejszone o pobrane ilości");
  assert.equal(R.byId(s.loadPlans, id).status, "DONE"); assert.equal(R.byId(s.loadPlans, id).opNo, r.res.no);
  assert.deepEqual([R.byId(s.trains, t1).status, R.byId(s.trains, t1).loadedQty], ["DONE", 1170]);
  const c = Y.consistency(s, "wh_zab").find(x => x.productId === "pr_zr_lesna");
  assert.equal(c.over, false, "suma pryzm nadal ≤ ewidencja");
  assert.equal(Y.reserved(s).size, 0, "rezerwacja zwolniona");
  assert.equal(run(s, "u_mag", "load.finish", { id, price: "1", weightT: "1" }).res.ok, false, "drugi raz się nie da");
  assert.equal(run(s, "u_kier", "train.remove", { id: t1 }).res.ok, false);
  assert.deepEqual(R.validateStateShape(s), []);
  assert.ok(s.audit.filter(a => a.entity === "yard").length >= 12);
});

test("izolacja magazynów w widoku użytkownika i kolekcje w starszych danych", () => {
  let { s } = yard();
  s = must(s, "u_kier", "train.save", train()).s;
  const vBra = Service.project(s, R.byId(s.users, "u_kbra"));
  assert.equal(vBra.yard.length, 0); assert.equal(vBra.trains.length, 0);
  const vZab = Service.project(s, R.byId(s.users, "u_mag"));
  assert.ok(vZab.yard.length > 10); assert.equal(vZab.trains.length, 1);
  const old = JSON.parse(JSON.stringify(R.Seed.build(TODAY))); delete old.yard; delete old.trains; delete old.loadPlans;
  const m = R.migrate(old);
  assert.ok(Array.isArray(m.state.yard) && Array.isArray(m.state.trains) && Array.isArray(m.state.loadPlans));
});
