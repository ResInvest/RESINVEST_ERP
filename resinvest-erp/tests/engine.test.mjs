/* Testy jednostkowe silnika Demo v2 (2.1).  Uruchomienie:  node --test tests/engine.test.mjs
   Numeracja w nazwach odpowiada specyfikacji: §22 TEST 1–7, §31.16 A–J, §32.23 TEST 1–10, raporty TEST 11–42. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
globalThis.RIW_CONFIG = JSON.parse(readFileSync(new URL("../config/app.config.json", import.meta.url), "utf8"));
// testy numeracji według rodzaju dokumentu (PZ, WZ, RW, KOR…) — tryb config.docNumbering = "types"; jedna seria WZ: features38.test.mjs
globalThis.RIW_CONFIG.docNumbering = "types";
require("../app/src/i18n.js");
const R = require("../app/src/engine.js");
require("../app/src/seed.js");

const TODAY = "2026-09-23";
const fresh = () => R.Seed.build(TODAY);
const U = (s, id) => s.users.find(u => u.id === id);
const ctx = (s, uid = "u_kier", today = TODAY, whId) => ({ user: whId ? Object.assign({}, U(s, uid), { whId }) : U(s, uid), today, source: "test" });
const draft = over => R.Seed.draftOf(over.date || TODAY, Object.assign({ transport: { mode: "none", place: "RiC Zabrze" } }, over));
const bal = (s, pid, wh = "wh_zab") => R.Stock.balance(s, wh, pid);
const prod = (s, id) => s.products.find(p => p.id === id);
const NB = "\u00A0";
const PURCHASE_A = { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: "20", unit: "m3", price: "230", weightMode: "auto" };
const LESNA = { enabled: true, type: "lesna", ndl: "Rudy Raciborskie", lesnictwo: "Stanica", kwit: "KW 0300/09/2026" };
const WZ = over => draft({ type: "SPRZEDAZ", sale: Object.assign({ productId: "pr_zr_lesna", qty: "500", unit: "MP", buyerId: "pa_ec_zab", price: "90" }, over) });
const DIRECT = (sale = {}, production = {}) => draft({ type: "SPRZEDAZ",
  production: Object.assign({ type: "lesna", ndl: "Rudy Raciborskie", lesnictwo: "Kuźnia", kwit: "KW 1/09/2026", rawProductId: "pr_drewno", outProductId: "pr_zr_lesna", outQty: "600" }, production),
  sale: Object.assign({ direct: true, buyerId: "pa_elektrownia", price: "88", priceUnit: "MP" }, sale),
  transport: { mode: "none", place: "Elektrownia Łaziska" } });
const PROD = over => draft({ type: "PRODUKCJA", production: Object.assign({ rawProductId: "pr_drewno", outProductId: "pr_zr_lesna", outQty: "500" }, over) });
const MM = over => draft({ type: "MM", mm: Object.assign({ productId: "pr_zr_lesna", qty: "300", unit: "MP", toWhId: "wh_bra" }, over), transport: { mode: "none", place: "RiC Brąszewice" } });
const commit = (s, d, c) => { const r = R.commitOperation(s, d, c || ctx(s)); assert.equal(r.ok, true, r.error); return r.op; };
/** Brąszewice z dokładnie `m3` m³ drewna (30 m³ na starcie + zakup różnicy). */
const pysWith = (s, m3) => { const add = m3 - bal(s, "pr_drewno", "wh_bra"); if (add > 0) commit(s, draft({ purchase: Object.assign({}, PURCHASE_A, { qty: String(add).replace(".", ",") }), transport: { mode: "none", place: "RiC Brąszewice" } }), ctx(s, "u_bra")); return s; };

/* ============================ dane startowe i przeliczniki ============================ */
// Uwaga: przykłady ze specyfikacji (6 613 GJ, 23 265 GJ) liczą GJ z masy zaokrąglonej do pełnych ton (778 × 8,5; 2 737 × 8,5).
// Silnik mnoży masę dokładną: 777,784 t × 8,5 = 6 611,16 GJ; 2 736,69 t × 8,5 = 23 261,87 GJ (różnica < 0,02%).
test("Stan startowy = przykłady ze specyfikacji: 817 m³ ≈ 778 t ≈ 6 611 GJ; 8 293 MP ≈ 2 737 t ≈ 23 262 GJ; PKS 728 t = 6 188 GJ", () => {
  const s = fresh();
  const o = (q, id) => R.Units.orient(q, prod(s, id), s.config);
  assert.equal(bal(s, "pr_drewno"), 817);
  assert.deepEqual([Math.round(o(817, "pr_drewno").t), Math.round(o(817, "pr_drewno").gj)], [778, 6611]);
  assert.equal(bal(s, "pr_zr_lesna"), 8293);
  assert.deepEqual([Math.round(o(8293, "pr_zr_lesna").t), Math.round(o(8293, "pr_zr_lesna").gj)], [2737, 23262]);
  assert.equal(bal(s, "pr_pks"), 728);
  assert.deepEqual([o(728, "pr_pks").t, o(728, "pr_pks").gj], [728, 6188]);
  assert.deepEqual(R.validateStateShape(s), []);
});
test("Przeliczniki centralne: 1 m³ = 4 MP, 1 MP = 0,25 m³, 1 MP = 0,33 t, 1 t = 8,5 GJ; PKS/łupina tylko t", () => {
  const s = fresh(), c = s.config, d = prod(s, "pr_drewno"), z = prod(s, "pr_zr_lesna");
  assert.equal(R.Units.convert(1, "m3", "MP", d, c), 4);
  assert.equal(R.Units.convert(1, "MP", "m3", d, c), 0.25);
  assert.equal(R.Units.convert(1, "MP", "t", z, c), 0.33);
  assert.equal(R.Units.energy(1, c), 8.5);
  assert.deepEqual(R.Units.allowed(prod(s, "pr_pks")), ["t"]);
  assert.deepEqual(R.Units.allowed(prod(s, "pr_lupina")), ["t"]);
  assert.throws(() => R.Units.convert(10, "t", "MP", prod(s, "pr_pks"), c));
  assert.ok(R.planOperation(s, draft({ purchase: { supplierId: "pa_agro", basis: "DEKL", productId: "pr_pks", qty: "10", unit: "MP", price: "500" } }), ctx(s)).errors["purchase.unit"]);
});
test("Liczby: 12,50 / 12.50 / 1 250,50 / NBSP / 1.250,50 — ta sama wartość; śmieci odrzucone", () => {
  for (const [t, v] of [["12,50", 12.5], ["12.50", 12.5], ["1 250,50", 1250.5], ["1\u00A0250,50", 1250.5], ["1\u202F250,50", 1250.5], ["1.250,50", 1250.5], ["1,250.50", 1250.5], [" 230 zł/m³ ", 230], ["26,4 t", 26.4], ["8,5 GJ", 8.5], ["−5", -5]]) {
    assert.equal(R.NumParse.parse(t).value, v, t);
  }
  for (const bad of ["abc", "1,2,3.4", "12.5.3,1", "1 2a", "--5", "1.25.0"]) assert.equal(R.NumParse.parse(bad).ok, false, bad);
});

/* ====================================== §22 ====================================== */
test("§22 TEST 1: produkcja na magazynie 500 MP → zużycie 125 m³ (817 → 692 m³), zrębka +500 MP, bez transportu", () => {
  const s = fresh();
  const op = commit(s, PROD());
  assert.equal(op.production.consumeQty, 125);
  assert.equal(bal(s, "pr_drewno"), 692);
  assert.equal(bal(s, "pr_zr_lesna"), 8793);
  assert.deepEqual(op.documents.map(d => d.type), ["RW", "PW"]);
  assert.equal(op.no, op.documents.find(d => d.type === "PW").no);
  assert.equal(op.transport.mode, "none");
  assert.equal(op.transport.place, "RiC Zabrze");
});
test("§22 TEST 2: sprzedaż z magazynu (WZ) 500 MP → 8 293 − 500 = 7 793 MP; stan dostępny / po WZ", () => {
  const s = fresh();
  const op = commit(s, WZ());
  assert.deepEqual([op.sale.onStock, op.sale.after], [8293, 7793]);
  assert.equal(bal(s, "pr_zr_lesna"), 7793);
  assert.deepEqual(op.documents.map(d => d.type), ["WZ"]);
  const p = R.planOperation(s, WZ({ qty: "7793,01" }), ctx(s));
  assert.equal(p.errors["sale.qty"], `Nie można sprzedać 7${NB}793,01 MP. Dostępny stan: 7${NB}793 MP.`);
});
test("§22 TEST 3: produkcja + sprzedaż bezpośrednia 600 MP — stan zrębki i drewna bez zmian", () => {
  const s = fresh();
  const op = commit(s, DIRECT());
  assert.deepEqual(op.documents.map(d => d.type), ["PW", "WZ"]);
  assert.deepEqual([bal(s, "pr_zr_lesna"), bal(s, "pr_drewno")], [8293, 817]);
  assert.equal(op.production.rawQty, 150);
  assert.deepEqual([op.totals.revenue, op.totals.chippingCost], [52800, 6000]);
  assert.ok(s.ledger.filter(l => l.opId === op.id).every(l => l.direct));
});
test("§22 TEST 4: zakup 20 m³ × 230 zł → +20 m³ (= 80 MP), koszt 4 600 zł; łańcuch zakup → produkcja → sprzedaż działa", () => {
  const s = fresh();
  const a = commit(s, draft({ purchase: PURCHASE_A }));
  assert.deepEqual([a.purchase.stockQty, a.totals.purchaseCost, bal(s, "pr_drewno")], [20, 4600, 837]);
  const b = commit(s, draft({ purchase: PURCHASE_A, production: LESNA, sale: { enabled: true, buyerId: "pa_ec_zab", price: "90" } }));
  assert.deepEqual(s.ledger.filter(l => l.opId === b.id).map(l => [l.kind, l.qty]), [["ZAKUP", 20], ["ZUZYCIE", -20], ["PRODUKCJA", 80], ["SPRZEDAZ", -80]]);
  assert.deepEqual([b.totals.chippingCost, b.totals.revenue], [800, 7200]);
});
const TRAIN = t => draft({ type: "SPRZEDAZ", sale: { productId: "pr_zr_lesna", qty: "3636", unit: "MP", buyerId: "pa_ec_zab", price: "80" }, transport: { mode: "train", place: "EC Zabrze", train: Object.assign({ carrier: "PKP Cargo", docNo: "CIM 1", loadPlace: "Bocznica Zabrze", capUnit: "t", capacity: "60", price: "25", priceUnit: "t" }, t) } });
test("§22 TEST 5: pociąg — tonaż wspólny 20 wagonów × 60 t = 1 200 t", () => {
  const s = fresh();
  const t = R.planOperation(s, TRAIN({ wagonCount: "20", tonMode: "same", sameT: "60" }), ctx(s)).norm.transport;
  assert.deepEqual([t.wagonCount, t.totalT, t.totalCapacity, t.cost], [20, 1200, 1200, 30000]);
  assert.equal(t.wagonT.length, 20);
});
test("§22 TEST 6: pociąg — tonaż każdego wagonu 58,4 / 60,1 / 59,7 / 61,2 / 59,8 = 299,2 t; brak wagonu = błąd", () => {
  const s = fresh();
  const t = R.planOperation(s, TRAIN({ wagonCount: "5", tonMode: "each", wagonT: ["58,4", "60,1", "59,7", "61,2", "59,8"] }), ctx(s)).norm.transport;
  assert.deepEqual(t.wagonT, [58.4, 60.1, 59.7, 61.2, 59.8]);
  assert.equal(t.totalT, 299.2);
  assert.ok(R.planOperation(s, TRAIN({ wagonCount: "3", tonMode: "each", wagonT: ["60", "", "59"] }), ctx(s)).errors["transport.train.wagonT.1"]);
  const w = R.planOperation(s, TRAIN({ wagonCount: "1", tonMode: "same", sameT: "45", capUnit: "MP", capacity: "120" }), ctx(s));
  assert.ok(w.warnings.some(x => x.includes("przekracza ładowność")));
});
test("§22 TEST 7: cena za rąbanie — 500 MP × 10 zł = 5 000 zł (domyślna), edytowalna, ujemna odrzucona", () => {
  const s = fresh();
  assert.equal(R.planOperation(s, PROD(), ctx(s)).totals.chippingCost, 5000);
  assert.equal(R.planOperation(s, PROD({ chipRate: "8,50" }), ctx(s)).totals.chippingCost, 4250);
  assert.ok(R.planOperation(s, PROD({ chipRate: "-1" }), ctx(s)).errors["production.chipRate"]);
});

/* ==================================== §31.16 ==================================== */
test("§31.16 A: poprawna produkcja — zużycie liczone automatycznie, masa i GJ orientacyjne", () => {
  const s = fresh();
  const p = R.planOperation(s, PROD(), ctx(s));
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  const o = R.Units.orient(p.norm.production.outQty, prod(s, "pr_zr_lesna"), s.config);
  assert.deepEqual([p.norm.production.consumeQty, o.t, o.gj], [125, 165, 1402.5]);
});
test("§31.16 B: brak surowca — „Dostępne: 100 m³. Wymagane: 125 m³. Brakuje: 25 m³.” i brak zapisu", () => {
  const s = pysWith(fresh(), 100), c = ctx(s, "u_bra");
  const snap = JSON.stringify(s);
  const r = R.commitOperation(s, PROD(), c);
  assert.equal(r.ok, false);
  assert.equal(r.plan.errors["production.outQty"], "Brak wystarczającej ilości surowca. Dostępne: 100 m³. Wymagane: 125 m³. Brakuje: 25 m³.");
  assert.equal(JSON.stringify(s), snap);
});
test("§31.16 C: surowiec = produkt wyjściowy jest blokowany", () => {
  const s = fresh();
  const p = R.planOperation(s, PROD({ rawProductId: "pr_zr_lesna", outProductId: "pr_zr_lesna" }), ctx(s));
  assert.match(p.errors["production.outProductId"], /muszą być różnymi produktami/);
});
test("§31.16 D: brak / błędny przelicznik blokuje produkcję", () => {
  const s = fresh();
  const pks = R.planOperation(s, PROD({ rawProductId: "pr_pks" }), ctx(s));
  assert.match(pks.errors["production.factor"], /^Brak przelicznika t → MP dla wybranego produktu/);
  s.config.m3_mp = 0;
  const z = R.planOperation(s, PROD(), ctx(s));
  assert.match(z.errors["production.factor"], /^Nie można zatwierdzić produkcji\. Brak prawidłowego przelicznika jednostek/);
  assert.equal(z.ok, false);
});
test("§31.16 E: precyzja — 250,0001 MP przy 62,5 m³ nie jest zaokrąglane przed walidacją", () => {
  const s = pysWith(fresh(), 62.5), c = ctx(s, "u_bra");
  assert.equal(R.planOperation(s, PROD({ outQty: "250" }), c).ok, true);
  const p = R.planOperation(s, PROD({ outQty: "250,0001" }), c);
  assert.equal(p.norm.production.consumeQty, 62.500025);
  assert.match(p.errors["production.outQty"], /^Brak wystarczającej ilości surowca/);
});
test("§31.16 F: podwójne kliknięcie — ten sam formularz zapisuje jedną operację", () => {
  const s = fresh(), d = PROD(), n = s.operations.length;
  commit(s, d);
  assert.equal(R.commitOperation(s, d, ctx(s)).duplicate, true);
  assert.equal(s.operations.length, n + 1);
  assert.equal(bal(s, "pr_drewno"), 692);
});
test("§31.16 G: atomowość — odrzucona produkcja nie zostawia RW ani PW, audytu ani numeru", () => {
  const s = fresh(), snap = JSON.stringify(s);
  assert.equal(R.commitOperation(s, PROD({ outQty: "5000" }), ctx(s)).ok, false);
  assert.equal(JSON.stringify(s), snap);
});
test("§31.16 H: podsumowanie przed zatwierdzeniem — stan przed/po surowca i produktu, koszt rąbania", () => {
  const s = fresh();
  const p = R.planOperation(s, PROD(), ctx(s));
  const b = id => p.balances.find(x => x.productId === id);
  assert.deepEqual([b("pr_drewno").before, b("pr_drewno").after], [817, 692]);
  assert.deepEqual([b("pr_zr_lesna").before, b("pr_zr_lesna").after], [8293, 8793]);
  assert.equal(p.totals.chippingCost, 5000);
  assert.deepEqual(p.documents.map(d => d.type), ["RW", "PW"]);
});
test("§31.16 I: sprzedaż bezpośrednia — 650 MP z produkcji 600 MP zablokowane; brak surowca/odbiorcy = błąd", () => {
  const s = fresh();
  assert.match(R.planOperation(s, DIRECT({ qtyMP: "650" }), ctx(s)).errors["sale.qtyMP"], /Nie można sprzedać 650 MP z produkcji 600 MP/);
  const p = R.planOperation(s, DIRECT({ buyerId: "" }, { rawProductId: "" }), ctx(s));
  assert.ok(p.errors["sale.buyerId"] && p.errors["production.rawProductId"]);
  assert.ok(R.planOperation(s, DIRECT({}, { rawProductId: "pr_pks" }), ctx(s)).errors["production.factor"]);
});
test("§31.16 J: walidacja w logice biznesowej — zapis z pominięciem formularza też jest blokowany", () => {
  const s = fresh();
  for (const d of [PROD({ outQty: "-5" }), PROD({ outQty: "abc" }), WZ({ qty: "0" }), MM({ toWhId: "wh_zab" }), Object.assign(WZ(), { date: "2026-09-24" })]) {
    assert.equal(R.commitOperation(s, d, ctx(s)).ok, false);
  }
  assert.equal(R.commitOperation(s, PROD(), ctx(s, "u_view")).ok, false);
});

/* ======================================== MM ======================================== */
test("MM jednoetapowe: Zabrze → Brąszewice 300 MP — stan ogółem bez zmian, blokada ponad stan i na ten sam magazyn", () => {
  const s = fresh();
  s.config.mmMode = "one";
  const tot0 = R.Stock.balance(s, null, "pr_zr_lesna");
  const op = commit(s, MM());
  assert.deepEqual([bal(s, "pr_zr_lesna"), bal(s, "pr_zr_lesna", "wh_bra")], [7993, 520]);
  assert.equal(R.Stock.balance(s, null, "pr_zr_lesna"), tot0);
  assert.deepEqual(op.documents.map(d => d.type), ["MM"]);
  assert.match(R.planOperation(s, MM({ qty: "8000" }), ctx(s)).errors["mm.qty"], /Nie można przesunąć/);
  assert.ok(R.planOperation(s, MM({ toWhId: "wh_zab" }), ctx(s)).errors["mm.toWhId"]);
});

/* ============================ MM: magazyn źródłowy, tryb dwuetapowy, przyjęcie, tonaż ============================ */
const RCV = (s, op, rec, uid = "u_bra") => R.receiveTransfer(s, op.id, rec || {}, ctx(s, uid));
test("MM dwuetapowe: wysłanie → W DRODZE (cel bez zmian) → Przyjmij MM → stan celu rośnie", () => {
  const s = fresh();
  assert.equal(R.mmMode(s.config), "two");
  const tot0 = R.Stock.balance(s, null, "pr_zr_lesna"), dst0 = bal(s, "pr_zr_lesna", "wh_bra");
  const op = commit(s, MM());
  assert.equal(R.mmState(op), "W_DRODZE");
  assert.equal(bal(s, "pr_zr_lesna"), 7993, "źródło zmniejszone przy wysłaniu");
  assert.equal(bal(s, "pr_zr_lesna", "wh_bra"), dst0, "cel bez zmian do przyjęcia");
  assert.equal(R.Stock.balance(s, null, "pr_zr_lesna"), tot0 - 300, "towar w drodze poza stanami magazynów");
  assert.deepEqual(R.mmInTransit(s, "wh_bra", "in").map(o => o.id), [op.id]);
  assert.deepEqual(R.mmInTransit(s, "wh_zab", "out").map(o => o.id), [op.id]);
  const r = RCV(s, op, { qty: "300", unit: "MP", key: "k1" });
  assert.equal(r.ok, true, r.error);
  assert.equal(R.mmState(op), "PRZYJETE");
  assert.equal(bal(s, "pr_zr_lesna", "wh_bra"), dst0 + 300);
  assert.equal(R.Stock.balance(s, null, "pr_zr_lesna"), tot0, "po przyjęciu stan firmy bez zmian");
  assert.equal(RCV(s, op, { qty: "300", key: "k1" }).duplicate, true, "ponowienie z tym samym kluczem — bez drugiego zapisu");
  assert.equal(RCV(s, op, { qty: "300", key: "k2" }).code, "RECEIVED", "drugie przyjęcie odrzucone");
  assert.equal(s.ledger.filter(l => l.opId === op.id && l.whId === "wh_bra").length, 1);
  assert.ok(s.audit.some(a => a.entityId === op.id && a.event === "mm-receive" && a.code === "MM_RECEIVED"));
  assert.equal(R.mmInTransit(s, "wh_bra", "in").length, 0);
});
test("MM: przyjęcie z ilością faktyczną — różnica wymaga przyczyny, raport pokazuje wysłano / przyjęto / różnicę", () => {
  const s = fresh(), dst0 = bal(s, "pr_zr_lesna", "wh_bra");
  const op = commit(s, MM());
  const bad = RCV(s, op, { qty: "290" });
  assert.equal(bad.ok, false);
  assert.match(bad.plan.errors.reason, /wskaż przyczynę/);
  assert.equal(RCV(s, op, { qty: "290", reason: "inna" }).plan.errors.note !== undefined, true, "„inna” wymaga opisu");
  assert.equal(RCV(s, op, { qty: "300", date: "2026-09-24" }).plan.errors.date !== undefined, true, "data z przyszłości");
  assert.equal(RCV(s, op, { qty: "300", date: "2026-09-01" }).plan.errors.date !== undefined, true, "przed wysłaniem");
  const r = RCV(s, op, { qty: "290", reason: "ubytek", note: "osiadanie w transporcie", weightMode: "manual", weightManual: "95,5" });
  assert.equal(r.ok, true, r.error);
  assert.equal(op.mm.receipt.diff, 10);
  assert.equal(op.mm.receipt.weightT, 95.5);
  assert.equal(bal(s, "pr_zr_lesna", "wh_bra"), dst0 + 290);
  const rep = R.Reports.business(s, { mode: "custom", from: "2026-09-01", to: TODAY });
  const row = rep.mm.find(m => m.opId === op.id);
  assert.deepEqual([row.sent, row.received, row.diff, row.mmState], [300, 290, 10, "PRZYJETE"]);
  assert.equal(rep.consistent, true, "bilans spójny także z ubytkiem w transporcie");
});
test("MM: przyjęcie w innej jednostce (t → MP) i przyjęcie tylko przez magazyn docelowy z uprawnieniem", () => {
  const s = fresh();
  const op = commit(s, MM({ qty: "100" }));
  assert.equal(RCV(s, op, { qty: "100" }, "u_mag").code, "FORBIDDEN", "magazynier źródła nie przyjmuje MM do Brąszewic");
  const obs = Object.assign({}, U(s, "u_bra"), { role: "obserwator" });
  assert.equal(R.receiveTransfer(s, op.id, { qty: "100" }, { user: obs, today: TODAY }).code, "FORBIDDEN", "obserwator bez „mm.receive”");
  const r = RCV(s, op, { qty: "33", unit: "t" });
  assert.equal(r.ok, true, r.error);
  assert.equal(op.mm.receipt.stockQty, 100, "33 t ÷ 0,33 t/MP = 100 MP");
  assert.equal(op.mm.receipt.diff, 0);
});
test("MM: wybór magazynu źródłowego — dostęp sprawdzany na serwerze, ten sam magazyn odrzucony", () => {
  const s = fresh();
  // kierownik ma dostęp do Zabrza i Brąszewic — może wysłać z Brąszewic, choć jego magazyn aktywny to Zabrze
  const op = commit(s, MM({ fromWhId: "wh_bra", toWhId: "wh_zab", qty: "50" }));
  assert.equal(op.whId, "wh_bra");
  assert.equal(op.toWhId, "wh_zab");
  assert.equal(op.mm.fromWhName, "RiC Brąszewice");
  // magazynier Zabrza nie ma dostępu do Brąszewic — manipulacja polem fromWhId odrzucona
  const p = R.planOperation(s, MM({ fromWhId: "wh_bra", toWhId: "wh_zab", qty: "10" }), ctx(s, "u_mag"));
  assert.equal(p.errorCodes["mm.fromWhId"], "FORBIDDEN");
  const same = R.planOperation(s, MM({ fromWhId: "wh_zab", toWhId: "wh_zab" }), ctx(s));
  assert.match(same.errors["mm.toWhId"], /nie mogą być takie same/);
  assert.equal(same.errorCodes["mm.toWhId"], "SAME_WH");
  assert.ok(R.planOperation(s, MM({ fromWhId: "wh_xxx" }), ctx(s)).errors["mm.fromWhId"], "nieznany magazyn źródłowy");
  // szkic i operacja przekazana zapamiętują magazyn źródłowy MM
  const sv = R.saveDraft(s, MM({ fromWhId: "wh_bra", toWhId: "wh_zab" }), ctx(s));
  assert.equal(R.byId(s.drafts, sv.id).whId, "wh_bra");
});
test("MM: tonaż automatyczny z przelicznika albo ręczny z kwitu wagowego (ilość na stanie bez zmian)", () => {
  const s = fresh();
  const a = R.planOperation(s, MM({ qty: "300" }), ctx(s));
  assert.equal(a.norm.mm.weightT, R.rq(300 * s.config.mp_t));
  const m = R.planOperation(s, MM({ qty: "300", weightMode: "manual", weightManual: "" }), ctx(s));
  assert.ok(m.errors["mm.weightManual"], "ręczny tonaż wymagany");
  const op = commit(s, MM({ qty: "300", weightMode: "manual", weightManual: "101,2" }));
  assert.equal(op.mm.weightT, 101.2);
  assert.equal(op.documents[0].weightT, 101.2);
  assert.equal(bal(s, "pr_zr_lesna"), 7993, "tonaż nie zmienia ilości");
  const far = R.planOperation(s, MM({ qty: "300", weightMode: "manual", weightManual: "300" }), ctx(s));
  assert.ok(far.warnings.some(w => /25%/.test(w)), "ostrzeżenie o dużej rozbieżności");
});
test("MM: anulowanie w drodze przywraca źródło i blokuje przyjęcie; anulowanie po przyjęciu cofa oba magazyny", () => {
  const s = fresh(), src0 = bal(s, "pr_zr_lesna"), dst0 = bal(s, "pr_zr_lesna", "wh_bra");
  const op = commit(s, MM());
  const c = R.cancelOperation(s, op.id, ctx(s), "pomyłka operatora");
  assert.equal(c.ok, true, c.error);
  assert.equal(bal(s, "pr_zr_lesna"), src0);
  assert.equal(R.mmState(op), "ANULOWANE");
  assert.match(RCV(s, op, { qty: "300" }).error, /anulowany/);
  const op2 = commit(s, MM({ qty: "100" }));
  assert.equal(RCV(s, op2, { qty: "100" }).ok, true);
  assert.equal(R.cancelOperation(s, op2.id, ctx(s), "pomyłka operatora").ok, true);
  assert.deepEqual([bal(s, "pr_zr_lesna"), bal(s, "pr_zr_lesna", "wh_bra")], [src0, dst0]);
});
test("MM: korekta wysłanej ilości — w drodze zmienia źródło; po przyjęciu przyjęcie zostaje, różnica przeliczona", () => {
  const s = fresh(), dst0 = bal(s, "pr_zr_lesna", "wh_bra");
  const op = commit(s, MM());
  const d1 = R.clone(op.input); d1.mm.qty = "250";
  let r = R.correctOperation(s, op.id, d1, "błędnie wpisana ilość", ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.equal(bal(s, "pr_zr_lesna"), 8043);
  assert.equal(R.mmState(op), "W_DRODZE", "korekta nie przyjmuje MM");
  assert.equal(op.mm.twoStage, true);
  assert.equal(RCV(s, op, { qty: "250" }).ok, true);
  const d2 = R.clone(op.input); d2.mm.qty = "260";
  r = R.correctOperation(s, op.id, d2, "korekta dokumentu zewnętrznego", ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.equal(bal(s, "pr_zr_lesna", "wh_bra"), dst0 + 250, "przyjęcie bez zmian");
  assert.equal(op.mm.receipt.diff, 10, "wysłano 260, przyjęto 250");
  const d3 = R.clone(op.input); d3.mm.toWhId = "wh_zab";
  assert.match(R.correctOperation(s, op.id, d3, "inny", ctx(s)).error, /nie zmienia magazynów/);
});
test("MM: przełącznik trybu w konfiguracji (administrator) i migracja 6 → 7", () => {
  const s = fresh();
  assert.equal(R.Settings.save(s, { mmMode: "x" }, ctx(s, "u_admin")).ok, false);
  assert.equal(R.Settings.save(s, { mmMode: "one" }, ctx(s, "u_kier")).code, "FORBIDDEN");
  assert.equal(R.Settings.save(s, { mmMode: "one" }, ctx(s, "u_admin")).ok, true);
  const op = commit(s, MM({ qty: "10" }));
  assert.equal(R.mmState(op), "PRZYJETE");
  assert.equal(op.mm.twoStage, false);
  const old = R.clone(s); old.schema = 6; delete old.config.mmMode; old.rolePerms = { magazynier: ["mm.create", "report.view"] };
  const m = R.migrate(old);
  assert.equal(m.to, R.SCHEMA, "migracja prowadzi do bieżącego schematu (6 → 7 → 8)");
  assert.equal(m.state.config.mmMode, "two");
  assert.ok(m.state.rolePerms.magazynier.includes("mm.receive"));
});

/* ==================================== §32.23 ==================================== */
test("§32.23 TEST 1: anulowanie WZ — nowy dokument AN, stan przywrócony, dokument zostaje ze statusem ANULOWANY", () => {
  const s = fresh();
  const op = commit(s, WZ());
  assert.equal(R.cancelOperation(s, op.id, ctx(s), "").ok, false, "przyczyna wymagana");
  const r = R.cancelOperation(s, op.id, ctx(s), "błędny odbiorca");
  assert.equal(r.ok, true, r.error);
  assert.equal(bal(s, "pr_zr_lesna"), 8293);
  assert.equal(op.status, "CANCELLED");
  assert.match(r.no, /^AN\//);
  assert.ok(s.operations.includes(op), "dokument nie jest usuwany");
  assert.ok(s.ledger.some(l => l.opId === op.id && l.kind === "SPRZEDAZ"), "zapisy pierwotne zostają");
  assert.equal(R.cancelOperation(s, op.id, ctx(s), "x").ok, false, "podwójne anulowanie");
});
test("§32.23 TEST 2: anulowanie zakupu wykorzystanego później — blokada z komunikatem o zależnościach", () => {
  const s = fresh(), c = ctx(s, "u_bra"), k = ctx(s, "u_admin", TODAY, "wh_bra");
  const buy = commit(s, draft({ purchase: Object.assign({}, PURCHASE_A, { qty: "100" }), transport: { mode: "none", place: "RiC Brąszewice" } }), c);
  const use = commit(s, PROD({ outQty: "480" }), c);                  // 120 m³ z 130 m³
  const r = R.cancelOperation(s, buy.id, k, "pomyłka");
  assert.equal(r.ok, false);
  assert.equal(r.blocked, true);
  assert.match(r.error, /^Nie można bezpośrednio anulować dokumentu PZ\/\d{3}\/09\/2026\. Towar z tego dokumentu został wykorzystany w późniejszych operacjach/);
  assert.match(r.error, /Najpierw należy wykonać korektę lub anulowanie operacji zależnych/);
  assert.ok(r.dependents.some(d => d.id === use.id));
  // po anulowaniu operacji zależnej anulowanie zakupu jest możliwe
  assert.equal(R.cancelOperation(s, use.id, k, "kolejność").ok, true);
  assert.equal(R.cancelOperation(s, buy.id, k, "pomyłka").ok, true);
  assert.equal(bal(s, "pr_drewno", "wh_bra"), 30);
});
test("§32.23 TEST 3: zależne operacje bez utraty pokrycia wymagają potwierdzenia (ack)", () => {
  const s = fresh();
  const buy = commit(s, draft({ purchase: Object.assign({}, PURCHASE_A, { qty: "50" }) }));
  commit(s, PROD({ outQty: "40" }));                                   // 10 m³ — pokrycie z 817 m³ nadal jest
  const r = R.cancelOperation(s, buy.id, ctx(s), "test");
  assert.equal(r.needAck, true);
  assert.equal(R.cancelOperation(s, buy.id, ctx(s), "test", { ack: true }).ok, true);
  assert.equal(bal(s, "pr_drewno"), 807);
});
test("§32.23 TEST 4: korekta ilości w górę i w dół — dokument KOR, różnica w księdze, status SKORYGOWANY", () => {
  const s = fresh();
  const op = commit(s, WZ());
  const down = R.clone(op.input); down.sale.qty = "450";
  const pv = R.planCorrection(s, op.id, down, ctx(s));
  assert.equal(pv.ok, true, pv.error);
  assert.deepEqual(pv.deltas.map(d => d.qty), [50]);
  // ilość i tonaż (AUTO — z przelicznika, zmienia się razem z ilością: 50 MP × 0,33 t)
  assert.deepEqual(pv.changes.map(c => [c.field, c.diff]), [["sale.qty", -50], ["sale.weightT", -16.5]]);
  const r = R.correctOperation(s, op.id, down, "błędnie wpisana ilość", ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.match(r.no, /^KOR\//);
  assert.equal(bal(s, "pr_zr_lesna"), 7843);
  assert.equal(op.status, "CORRECTED");
  assert.equal(op.totals.revenue, 40500);
  assert.equal(op.original.sale.qty, 500, "oryginał zachowany");
  const up = R.clone(op.input); up.sale.qty = "600";
  assert.equal(R.correctOperation(s, op.id, up, "błędnie wpisana ilość", ctx(s)).ok, true);
  assert.equal(bal(s, "pr_zr_lesna"), 7693);
  assert.equal(op.corrections.length, 2);
  assert.equal(R.correctOperation(s, op.id, up, "", ctx(s)).ok, false, "powód wymagany");
});
test("§32.23 TEST 5: korekta produkcji zmienia też zużycie surowca (500 → 400 MP: zużycie 125 → 100 m³)", () => {
  const s = fresh();
  const op = commit(s, PROD());
  const d = R.clone(op.input); d.production.outQty = "400";
  const r = R.correctOperation(s, op.id, d, "błędne zużycie surowca", ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([bal(s, "pr_drewno"), bal(s, "pr_zr_lesna")], [717, 8693]);
  assert.equal(op.production.consumeQty, 100);
  assert.equal(op.totals.chippingCost, 4000);
  const big = R.clone(op.input); big.production.outQty = "5000";
  assert.match(R.planCorrection(s, op.id, big, ctx(s)).error, /Brak wystarczającej ilości surowca/);
});
test("§32.23 TEST 6: korekta sprzedaży bezpośredniej zachowuje spójność produkcja = sprzedaż i stan bez zmian", () => {
  const s = fresh();
  const op = commit(s, DIRECT());
  const d = R.clone(op.input); d.production.outQty = "550";
  assert.equal(R.correctOperation(s, op.id, d, "błędnie wpisana ilość", ctx(s)).ok, true);
  assert.equal(bal(s, "pr_zr_lesna"), 8293);
  assert.deepEqual([op.production.outQty, op.sale.qty], [550, 550]);
  const bad = R.clone(op.input); bad.sale.qtyMP = "650";
  assert.equal(R.planCorrection(s, op.id, bad, ctx(s)).ok, false);
});
test("§32.23 TEST 7: korekta wartościowa (cena za rąbanie) — bez ruchu w księdze, różnica wartości", () => {
  const s = fresh();
  const op = commit(s, PROD());
  const n = s.ledger.length;
  const d = R.clone(op.input); d.production.chipRate = "12";
  const r = R.correctOperation(s, op.id, d, "błędna cena", ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.equal(s.ledger.length, n);
  assert.equal(r.correction.valueDelta.chippingCost, 1000);
  assert.equal(op.totals.chippingCost, 6000);
});
test("§32.23 TEST 8: korekta opisowa (uwagi, nr dokumentu zewnętrznego) — bez wpływu na stan i wartości", () => {
  const s = fresh();
  const op = commit(s, WZ());
  const d = R.clone(op.input); d.notes = "kwit 17"; d.extDoc = "FV 12/09";
  const r = R.correctOperation(s, op.id, d, "korekta dokumentu zewnętrznego", ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.correction.descriptiveOnly, true);
  assert.equal(bal(s, "pr_zr_lesna"), 7793);
  assert.equal(R.correctOperation(s, op.id, R.clone(op.input), "inny", ctx(s)).ok, false, "korekta bez zmian odrzucona");
});
test("§32.23 TEST 9: odwrócenie korekty kolejną korektą; korekty nie usuwa się", () => {
  const s = fresh();
  const op = commit(s, WZ());
  const d = R.clone(op.input); d.sale.qty = "450";
  const k1 = R.correctOperation(s, op.id, d, "błędnie wpisana ilość", ctx(s));
  const k2 = R.reverseCorrection(s, op.id, k1.no, "odwrócenie korekty", ctx(s));
  assert.equal(k2.ok, true, k2.error);
  assert.equal(bal(s, "pr_zr_lesna"), 7793);
  assert.equal(op.corrections.length, 2);
  assert.equal(op.corrections[1].reverses, k1.no);
  assert.equal(R.reverseCorrection(s, op.id, k1.no, "x", ctx(s)).ok, false, "tylko ostatnia korekta, nie odwrócenie odwrócenia");
  assert.equal(R.reverseCorrection(s, op.id, k2.no, "x", ctx(s)).ok, false);
  // „Usuń” to soft delete: dokument i jego korekty zostają w danych (status ANULOWANY + znacznik usunięcia)
  const del = R.deleteOperation(s, op.id, ctx(s), "dokument wprowadzony podwójnie");
  assert.equal(del.ok, true, del.error);
  assert.ok(s.operations.includes(op) && op.deleted && op.status === "CANCELLED");
  assert.equal(op.corrections.length, 2, "korekty nie znikają po usunięciu");
});
test("§32.23 TEST 10: uprawnienia i reguły — magazynier nie anuluje ani nie koryguje; anulowanego nie koryguje się", () => {
  const s = fresh();
  const op = commit(s, WZ());
  assert.match(R.cancelOperation(s, op.id, ctx(s, "u_mag"), "x").error, /documents\.cancel/);
  assert.match(R.planCorrection(s, op.id, R.clone(op.input), ctx(s, "u_mag")).error, /documents\.correct/);
  const other = R.clone(op.input); other.type = "MM";
  assert.match(R.planCorrection(s, op.id, other, ctx(s)).error, /rodzaju operacji/);
  R.cancelOperation(s, op.id, ctx(s), "x");
  assert.match(R.planCorrection(s, op.id, R.clone(op.input), ctx(s)).error, /anulowany — nie można go korygować/);
  const ev = s.audit.filter(a => a.entityId === op.id).map(a => a.event);
  assert.deepEqual(ev, ["create", "cancel"]);
});
test("§32: wersja robocza — bez numeru i bez wpływu na stan; zatwierdzenie usuwa szkic", () => {
  const s = fresh(), d = WZ();
  const r = R.saveDraft(s, d, ctx(s));
  assert.equal(r.ok, true);
  assert.equal(bal(s, "pr_zr_lesna"), 8293);
  assert.equal(s.drafts.length, 1);
  d.draftId = r.id;
  commit(s, d);
  assert.equal(s.drafts.length, 0);
});

/* ================================ raporty: TEST 11–42 ================================ */
const REP = (s, f) => R.Reports.business(s, Object.assign({ mode: "month", from: "2026-09-01", to: "2026-09-30" }, f));
const row = (rep, id) => rep.recon.find(r => r.productId === id);
test("TEST 11–13: bilans okresu: stan pocz. + przyjęcia + produkcja − zużycie − sprzedaż ± MM = stan końc. = stan z księgi", () => {
  const s = fresh();
  for (const whId of [null, "wh_zab", "wh_bra"]) {
    const rep = REP(s, { whId });
    assert.equal(rep.consistent, true);
    for (const r of rep.recon) {
      const calc = R.REPORT_COLS.reduce((a, c) => a + r[c], r.opening);
      assert.ok(Math.abs(calc - r.closing) < 1e-6);
      assert.equal(r.closing, R.Stock.balance(s, whId, r.productId, "2026-09-30"));
    }
  }
  const z = row(REP(s, { whId: "wh_zab" }), "pr_zr_tow");
  assert.deepEqual([z.opening, z.MM, z.closing], [300, -50, 250]);
});
test("TEST 14: pusty miesiąc — brak ruchów, zero operacji, bilans spójny", () => {
  const s = fresh();
  const rep = REP(s, { from: "2026-07-01", to: "2026-07-31" });
  assert.equal(rep.recon.length, 0);
  assert.equal(rep.purchases.count + rep.sales.count + rep.production.count + rep.transport.count, 0);
  assert.equal(rep.consistent, true);
});
test("TEST 15–18: sekcje miesiąca — zakupy, produkcja (+ koszt rąbania), sprzedaż, zużycie, transport", () => {
  const s = fresh();
  const rep = REP(s, {});
  assert.deepEqual([rep.purchases.count, rep.purchases.value], [2, 7750]);          // 09-03, 09-08 (09-17 anulowany)
  assert.equal(rep.production.count, 4);
  assert.equal(rep.production.chippingCost, 740 * 10);
  assert.deepEqual([rep.sales.count, rep.sales.countDirect, rep.sales.value, rep.sales.valueDirect], [3, 1, 80 * 90 + 90 * 85, 52800]);
  assert.equal(rep.consumption.reduce((a, c) => a + c.qty, 0), 20 + 10 + 5);
  assert.ok(rep.transport.count >= 5);
  assert.equal(rep.transport.cost, rep.transport.rows.reduce((a, r) => a + r.cost, 0));
  // operacja łańcuchowa: dostawca po stronie zakupów, odbiorca po stronie sprzedaży (z przychodem, nie kosztem)
  const ec = rep.sales.buyers.find(x => x.name === "Elektrociepłownia Zabrze S.A.");
  assert.deepEqual([ec.value, ec.byUnit.MP], [7200, 80]);
  assert.ok(!rep.sales.buyers.some(x => x.name === "Lander Agro"));
  assert.ok(!rep.purchases.suppliers.some(x => x.name === "Biomass Trading B.V."), "anulowany zakup netto 0 nie pojawia się w raporcie biznesowym");
});
test("TEST 19–20: MM w raporcie — magazyn źródłowy −, docelowy +, łącznie 0", () => {
  const s = fresh();
  assert.equal(row(REP(s, { whId: "wh_zab" }), "pr_zr_tow").MM, -50);
  assert.equal(row(REP(s, { whId: "wh_bra" }), "pr_zr_tow").MM, 50);
  assert.equal(row(REP(s, {}), "pr_zr_tow").MM, 0);
  assert.equal(REP(s, {}).mm.length, 1);
});
test("TEST 21–23: korekty i anulowania — raport pokazuje wartości netto i listę dokumentów KOR / AN", () => {
  const s = fresh();
  const rep = REP(s, { whId: "wh_bra" });
  assert.equal(row(rep, "pr_zr_lesna").SPRZEDAZ, -90);
  assert.equal(rep.corrections.length, 1);
  assert.equal(rep.cancellations.length, 1);
  assert.equal(row(rep, "pr_lupina") ? row(rep, "pr_lupina").ZAKUP : 0, 0);
});
test("TEST 24–26: granice miesiąca — operacja z 31.08 w sierpniu, z 01.09 we wrześniu", () => {
  const s = fresh();
  commit(s, Object.assign(WZ({ qty: "10" }), { date: "2026-08-31" }));
  commit(s, Object.assign(WZ({ qty: "20" }), { date: "2026-09-01" }));
  const aug = REP(s, { from: "2026-08-01", to: "2026-08-31", whId: "wh_zab" }), sep = REP(s, { whId: "wh_zab" });
  assert.equal(row(aug, "pr_zr_lesna").SPRZEDAZ, -10);
  assert.equal(row(sep, "pr_zr_lesna").SPRZEDAZ, -80 - 20);
  assert.equal(row(aug, "pr_zr_lesna").closing, row(sep, "pr_zr_lesna").opening);
});
test("TEST 27–28: zakres własny 15.09–25.09 i tydzień / dzień", () => {
  const s = fresh();
  const rg = R.Dates.range({ mode: "custom", from: "2026-09-25", to: "2026-09-15" });
  assert.deepEqual([rg.from, rg.to], ["2026-09-15", "2026-09-25"]);
  const rep = REP(s, { mode: "custom", from: rg.from, to: rg.to });
  assert.equal(rep.purchases.count, 0);                                                // 09-17 anulowany
  assert.equal(rep.sales.countDirect, 1);
  assert.equal(rep.consistent, true);
  assert.deepEqual(Object.values(R.Dates.range({ mode: "week", date: "2026-09-23" })).slice(1, 3), ["2026-09-21", "2026-09-27"]);
  assert.equal(R.Dates.range({ mode: "day", date: "2026-09-22" }).from, "2026-09-22");
  assert.deepEqual([R.Dates.range({ mode: "year", year: "2026" }).from, R.Dates.range({ mode: "year", year: "2026" }).to], ["2026-01-01", "2026-12-31"]);
});
test("TEST 29–30: filtr produktu i kontrahenta", () => {
  const s = fresh();
  const p = REP(s, { productId: "pr_drewno" });
  assert.deepEqual(p.recon.map(r => r.productId), ["pr_drewno"]);
  const k = REP(s, { partnerId: "pa_elektrownia" });
  assert.deepEqual([k.sales.count, k.sales.valueDirect, k.purchases.count], [1, 52800, 0]);
  assert.equal(k.sales.buyers[0].name, "Elektrownia Łaziska");
});
test("TEST 31–32: wycena — średnia cena zakupu; produkt bez zakupu = brak wyceny", () => {
  const s = fresh();
  const v = REP(s, { whId: "wh_zab" }).valuation;
  const drewno = v.find(x => x.productId === "pr_drewno"), pks = v.find(x => x.productId === "pr_pks");
  assert.equal(drewno.priced, true);
  assert.equal(drewno.avg, 230);
  assert.equal(drewno.closingValue, 817 * 230);
  assert.equal(pks.priced, false);
});
test("TEST 33–35: spójność modułów — Pulpit (obroty) = Raport = Stany = Historia", () => {
  const s = fresh();
  const rep = REP(s, { whId: "wh_zab" });
  const hist = R.Reports.history(s, { whId: "wh_zab", to: "2026-09-30" });
  for (const r of rep.recon) {
    const last = hist.filter(h => h.productId === r.productId).at(-1);
    assert.equal(last.after, r.closing, r.name);
    assert.equal(R.Stock.balance(s, "wh_zab", r.productId), r.closing);
  }
  const t = R.Reports.turnover(s, "2026-09-01", "2026-09-30", "wh_zab");
  assert.equal(t.find(x => x.cat === "SPRZEDAZ").byUnit.MP, 80 + 600);
  assert.equal(t.find(x => x.cat === "SPRZEDAZ").byUnit.MP, -(row(rep, "pr_zr_lesna").SPRZEDAZ + row(rep, "pr_zr_lesna").BEZP) + 600 * 2 - 600);
  assert.equal(t.find(x => x.cat === "ZAKUP").value, rep.purchases.value);
});
test("TEST 36–37: korekta w październiku operacji z września — wrzesień bez zmian, korekta w październiku", () => {
  const s = fresh();
  const sepBefore = JSON.stringify(REP(s, { whId: "wh_bra" }).recon);
  const wz = s.operations.find(o => o.no && o.no.startsWith("WZ/002/09"));
  const d = R.clone(wz.input); d.sale.qty = "80";
  const r = R.correctOperation(s, wz.id, d, "błędnie wpisana ilość", ctx(s, "u_admin", "2026-10-02", "wh_bra"));
  assert.equal(r.ok, true, r.error);
  assert.equal(JSON.stringify(REP(s, { whId: "wh_bra" }).recon), sepBefore);
  const oct = REP(s, { whId: "wh_bra", from: "2026-10-01", to: "2026-10-31" });
  assert.equal(row(oct, "pr_zr_lesna").SPRZEDAZ, 10);
  assert.equal(oct.corrections.length, 1);
});
test("TEST 38–39: zamknięty miesiąc — dane zachowane, raport oznacza zamknięcie, zapis w zamkniętym okresie zablokowany", () => {
  const s = fresh(), c = ctx(s);
  const before = JSON.stringify(REP(s, { from: "2026-08-01", to: "2026-08-31", whId: "wh_zab" }).recon);
  R.Inventory.open(s, "2026-08", c); const g = R.Inventory.generate(s, "2026-08", c);
  for (const l of g.period.lines) R.Inventory.setCount(s, "2026-08", l.productId, R.fmtQ(l.bookQty), c);
  assert.equal(R.Inventory.close(s, "2026-08", c).ok, true);
  const aug = REP(s, { from: "2026-08-01", to: "2026-08-31", whId: "wh_zab" });
  assert.equal(JSON.stringify(aug.recon), before);
  assert.equal(aug.closed[0].closed, true);
  assert.ok(R.planOperation(s, Object.assign(WZ(), { date: "2026-08-30" }), c).errors.date);
});
test("TEST 40: kwit produkcji dnia — MP, m³, t, GJ, koszt rąbania", () => {
  const s = fresh();
  const k = R.Reports.productionDay(s, "2026-09-22", "wh_bra");
  assert.deepEqual(k.totals, { count: 1, mp: 20, m3: 5, t: 6.6, gj: 56.1, chipCost: 200, extraCost: 240 });
  assert.equal(k.rows[0].consume, 5);
  assert.equal(k.rows[0].operator, "Adam Mazur");
});
test("TEST 41: historia — stan przed / zmiana / po, filtry typu, użytkownika i kontrahenta", () => {
  const s = fresh();
  const h = R.Reports.history(s, { whId: "wh_bra", productId: "pr_zr_lesna" });
  for (let i = 1; i < h.length; i++) assert.equal(h[i].before, h[i - 1].after);
  assert.ok(h.every(r => Math.abs(r.before + r.change - r.after) < 1e-9));
  assert.deepEqual(R.Reports.history(s, { type: "KOREKTA" }).map(r => r.docNo), ["KOR/001/09/2026"]);
  assert.ok(R.Reports.history(s, { type: "TRANSPORT" }).length >= 5);
  assert.ok(R.Reports.history(s, { userId: "u_bra" }).every(r => r.user === "Paweł Kaczmarek"));
  assert.ok(R.Reports.history(s, { partnerId: "pa_ciep_ryb" }).length >= 2);
});
test("TEST 42: pełny miesiąc E2E w silniku — zakup, produkcja, WZ, MM, bezpośrednia, korekta, anulowanie → bilans spójny", () => {
  const s = fresh(), c = ctx(s);
  const buy = commit(s, draft({ purchase: Object.assign({}, PURCHASE_A, { qty: "100" }) }));
  const pr = commit(s, PROD({ outQty: "400" }));
  const wz = commit(s, WZ({ qty: "300" }));
  commit(s, MM({ qty: "100" }));
  commit(s, DIRECT());
  const d = R.clone(wz.input); d.sale.qty = "250";
  assert.equal(R.correctOperation(s, wz.id, d, "błędnie wpisana ilość", c).ok, true);
  assert.equal(R.cancelOperation(s, pr.id, c, "pomyłka operatora").needAck, true);   // WZ i MM zrębki po produkcji
  assert.equal(R.cancelOperation(s, pr.id, c, "pomyłka operatora", { ack: true }).ok, true);
  const rep = REP(s, {});
  assert.equal(rep.consistent, true);
  assert.equal(row(REP(s, { whId: "wh_zab" }), "pr_drewno").closing, 917);
  assert.equal(bal(s, "pr_zr_lesna"), 8293 - 250 - 100);
  assert.ok(buy.status === "POSTED" && pr.status === "CANCELLED" && wz.status === "CORRECTED");
});

/* ============================ bezpieczeństwo / pozostałe ============================ */
test("Wyścig: dwa WZ na ten sam stan — drugi odrzucony, stan nieujemny", () => {
  const s = fresh();
  const a = WZ({ qty: "5000" }), b = WZ({ qty: "5000" });
  assert.equal(R.planOperation(s, b, ctx(s, "u_kier")).ok, true);
  assert.equal(R.commitOperation(s, a, ctx(s, "u_mag")).ok, true);
  assert.equal(R.commitOperation(s, b, ctx(s, "u_kier")).ok, false);
  assert.equal(bal(s, "pr_zr_lesna"), 3293);
});
test("Transport nie zmienia stanu; produkcja na magazynie nie ma transportu", () => {
  const s = fresh();
  const modes = [{ mode: "none", place: "X" }, { mode: "own", place: "X", own: { vehicleId: "ve_scania", km: "262" } }, { mode: "external", place: "X", external: { company: "DAP", reg: "SZA 7K901", freight: "900" } }, { mode: "train", place: "X", train: { wagonCount: "3", tonMode: "same", sameT: "20", price: "30", priceUnit: "t" } }];
  for (const base of [{ purchase: PURCHASE_A }, { type: "SPRZEDAZ", sale: { productId: "pr_zr_lesna", qty: "500", unit: "MP", buyerId: "pa_ec_zab", price: "90" } }, { type: "MM", mm: { productId: "pr_zr_lesna", qty: "10", unit: "MP", toWhId: "wh_bra" } }]) {
    const sig = modes.map(t => JSON.stringify(R.planOperation(s, draft(Object.assign({}, base, { transport: t })), ctx(s)).postings.map(p => [p.kind, p.whId, p.productId, p.qty])));
    assert.equal(new Set(sig).size, 1, JSON.stringify(base));
  }
  const p = R.planOperation(s, Object.assign(PROD(), { transport: { mode: "own", place: "", own: {} } }), ctx(s));
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  assert.ok(!p.documents.some(d => d.type === "TR"));
});
test("Inwentaryzacja: zamknięcie z różnicą tworzy IN; autozamknięcie na przełomie miesiąca", () => {
  const s = fresh(), c = ctx(s);
  R.Inventory.open(s, "2026-08", c); const g = R.Inventory.generate(s, "2026-08", c);
  for (const l of g.period.lines) R.Inventory.setCount(s, "2026-08", l.productId, R.fmtQ(l.bookQty), c);
  R.Inventory.setCount(s, "2026-08", "pr_drewno", "815,5", c);
  assert.equal(R.Inventory.close(s, "2026-08", ctx(s, "u_mag")).ok, false);
  const cl = R.Inventory.close(s, "2026-08", c);
  assert.deepEqual(cl.diffs, [{ productId: "pr_drewno", qty: -1.5 }]);
  R.Inventory.open(s, "2026-09", c); R.Inventory.generate(s, "2026-09", c);
  assert.equal(R.Inventory.autoClose(s, ctx(s, "u_kier", "2026-10-01"))[0].ok, true);
});
test("Flota i kontrola struktury", () => {
  const s = fresh();
  assert.equal(R.Fleet.save(s, "vehicles", { name: "DAF", reg: "SGL4T821", type: "ciezarowy", status: "aktywny", driverId: "dr_nowak" }, ctx(s)).ok, false);
  assert.equal(R.Fleet.save(s, "chippers", { name: "Rębak 3", status: "aktywny", operatorId: "op_lis" }, ctx(s, "u_mag")).ok, false);
  const old = JSON.parse(JSON.stringify(s)); old.schema = 2;
  assert.ok(R.validateStateShape(old).length);
  const bad = JSON.parse(JSON.stringify(s)); bad.ledger[0].qty = "x";
  assert.ok(R.validateStateShape(bad).length);
});

test("Wydruk / PDF raportu: numer RAP i ślad w audycie", () => {
  const s = fresh();
  const r = R.registerPrint(s, ctx(s), { kind: "RAP", title: "Raport miesięczny", range: "09.2026", format: "pdf" });
  assert.match(r.no, /^RAP\/001\/09\/2026$/);
  assert.equal(s.audit.at(-1).event, "print");
  assert.equal(R.registerPrint(s, ctx(s), { kind: "KWIT", title: "Kwit", format: "print" }).no, "KP/001/09/2026");
});

/* ============================ 2.2: grupy dostawców, kursy transportu ============================ */
const NDL = over => draft({ purchase: Object.assign({ supplierKind: "nadlesnictwo", supplierId: "pa_ndl_rr", lesnictwo: "Stanica", basis: "DEKL", productId: "pr_drewno", qty: "100", unit: "m3", price: "210" }, over) });
test("2.2 Dostawca: nadleśnictwo wymaga leśnictwa; grupa musi zgadzać się z kartoteką", () => {
  const s = fresh();
  assert.equal(R.partnerKind(s.partners.find(p => p.id === "pa_ndl_rr")), "nadlesnictwo");
  assert.equal(R.partnerKind(s.partners.find(p => p.id === "pa_lander")), "firma");
  assert.deepEqual([R.SUPPLIER_KINDS.firma.basis, R.SUPPLIER_KINDS.nadlesnictwo.basis], ["KZR", "DEKL"]);
  assert.match(R.planOperation(s, NDL({ lesnictwo: "" }), ctx(s)).errors["purchase.lesnictwo"], /leśnictwo/);
  assert.match(R.planOperation(s, NDL({ supplierKind: "firma" }), ctx(s)).errors["purchase.supplierName"], /nie należy do grupy/);
  const op = commit(s, NDL());
  assert.deepEqual([op.purchase.supplierKind, op.purchase.lesnictwo, op.purchase.basis], ["nadlesnictwo", "Stanica", "DEKL"]);
  // podstawę można zmienić ręcznie
  assert.equal(R.planOperation(s, NDL({ basis: "KZR" }), ctx(s)).ok, true);
});
test("2.2 Zakup z nadleśnictwa + produkcja: pochodzenie (nadleśnictwo, leśnictwo) uzupełnia się z zakupu", () => {
  const s = fresh();
  const d = NDL(); Object.assign(d.production, { enabled: true, type: "lesna", kwit: "KW 0500/09/2026" });
  const op = commit(s, d);
  assert.deepEqual([op.production.ndl, op.production.lesnictwo], ["Rudy Raciborskie", "Stanica"]);
  assert.equal(op.production.outQty, 400);
});
const RUNS = (n, over = {}) => ({ mode: "own", place: "RiC Zabrze", own: { runCount: String(n), runs: Array.from({ length: n }, (_, i) => Object.assign({ vehicleId: "ve_scania", driverId: "", km: "45", rate: "", kwit: `KW 1${i}/09/2026`, kwitM3: "", qty: "100", weightT: "33" }, over)) } });
test("2.2 Kursy: 4 kursy × 100 MP = 400 MP z produkcji do Zabrza — suma ilości, ton i kosztu; stan bez zmian od transportu", () => {
  const s = fresh();
  const d = NDL(); Object.assign(d.production, { enabled: true, type: "lesna", kwit: "KW 0500/09/2026" }); d.transport = RUNS(4);
  const p = R.planOperation(s, d, ctx(s));
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  const t = p.norm.transport;
  assert.deepEqual([t.runCount, t.totalQty, t.qtyUnit, t.totalWeightT, t.km, t.cost], [4, 400, "MP", 132, 180, 900]);
  assert.equal(t.runs[0].driverName, "Jan Kowalski");
  assert.ok(!p.warnings.some(w => w.includes("Suma kursów")));
  const bez = R.planOperation(s, Object.assign(NDL(), { production: Object.assign(R.clone(d.production)) }), ctx(s));
  assert.deepEqual(p.postings.map(x => [x.kind, x.qty]), bez.postings.map(x => [x.kind, x.qty]));
});
test("2.2 Kursy: przy wielu kursach ilość w kursie wymagana; różnica sumy = ostrzeżenie; brak wagi = ostrzeżenie", () => {
  const s = fresh();
  const d = NDL(); Object.assign(d.production, { enabled: true, type: "lesna", kwit: "KW 0500/09/2026" }); d.transport = RUNS(2, { qty: "" });
  assert.ok(R.planOperation(s, d, ctx(s)).errors["transport.own.runs.1.qty"]);
  d.transport = RUNS(3, { weightT: "" });
  const p = R.planOperation(s, d, ctx(s));
  assert.ok(p.warnings.some(w => w.includes("Suma kursów 300 MP — do rozwiezienia pozostało 100 MP z 400 MP")));
  assert.ok(p.warnings.some(w => w.includes("Brak wagi rzeczywistej dla 3 z 3")));
  d.transport = RUNS(1, { qty: "" });
  assert.equal(R.planOperation(s, d, ctx(s)).norm.transport.totalQty, 400, "jeden kurs = cała ilość");
  d.transport = RUNS(2, { vehicleId: "ve_man" });
  assert.match(R.planOperation(s, d, ctx(s)).errors["transport.own.runs.0.vehicleId"], /przypisany do magazynu/);
  // 3.11: pojazd „W serwisie” / wycofany można wybrać — przy zatwierdzeniu wraca do pracy (ostrzeżenie, nie błąd)
  s.fleet.vehicles.find(v => v.id === "ve_man").whId = "";
  const pm = R.planOperation(s, d, ctx(s));
  assert.equal(pm.errors["transport.own.runs.0.vehicleId"], undefined);
  assert.ok(pm.warnings.some(w => /W serwisie.*wróci do pracy/.test(w)));
});
test("2.2 Kursy: dane z wersji 2.1 (jeden kurs bez listy) nadal liczą się poprawnie", () => {
  const s = fresh();
  const d = WZ(); d.transport = { mode: "own", place: "EC", own: { vehicleId: "ve_scania", km: "262", rate: "5", driverId: "" } };
  const t = R.planOperation(s, d, ctx(s)).norm.transport;
  assert.deepEqual([t.runCount, t.cost, t.reg, t.totalQty], [1, 1310, "SGL 4T821", 500]);
});

/* ============================ 2.3: dostawca wpisywany ręcznie ============================ */
test("2.3 Dostawca wpisany ręcznie: nowa firma i nowe nadleśnictwo dopisują się do kartoteki przy zatwierdzeniu", () => {
  const s = fresh(), n0 = s.partners.length;
  const f = draft({ purchase: { supplierKind: "firma", supplierId: "", supplierName: "  Tartak   Nowy Las sp. z o.o. ", basis: "KZR", productId: "pr_drewno", qty: "10", unit: "m3", price: "200" } });
  const p = R.planOperation(s, f, ctx(s));
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  assert.equal(s.partners.length, n0, "planowanie nie zmienia kartoteki");
  const op = commit(s, f);
  const np = s.partners.find(x => x.id === op.purchase.supplierId);
  assert.deepEqual([np.name, np.kind, np.role], ["Tartak Nowy Las sp. z o.o.", "firma", "supplier"]);
  assert.equal(op.documents.find(d => d.type === "PZ").partnerId, np.id);
  assert.equal(op.input.purchase.supplierId, np.id);
  assert.ok(s.audit.some(a => a.entity === "partner" && a.entityId === np.id));
  const d = NDL({ supplierId: "", supplierName: "Nadleśnictwo Kędzierzyn", lesnictwo: "Sławięcice" }); Object.assign(d.production, { enabled: true, type: "lesna", kwit: "KW 1/2026" });
  const op2 = commit(s, d);
  const nn = s.partners.find(x => x.id === op2.purchase.supplierId);
  assert.deepEqual([nn.kind, op2.production.ndl, op2.production.lesnictwo, op2.purchase.basis], ["nadlesnictwo", "Kędzierzyn", "Sławięcice", "DEKL"]);
});
test("2.3 Dostawca wpisany ręcznie: nazwa z kartoteki (inna wielkość liter) = istniejący; odbiorca odrzucony; pusta nazwa odrzucona", () => {
  const s = fresh(), n0 = s.partners.length;
  const op = commit(s, draft({ purchase: Object.assign({}, PURCHASE_A, { supplierKind: "firma", supplierId: "", supplierName: "lander agro" }) }));
  assert.equal(op.purchase.supplierId, "pa_lander");
  assert.equal(s.partners.length, n0);
  const e = x => R.planOperation(s, draft({ purchase: Object.assign({}, PURCHASE_A, { supplierKind: "firma", supplierId: "", supplierName: x }) }), ctx(s)).errors["purchase.supplierName"];
  assert.match(e("Elektrownia Łaziska"), /jako odbiorca/);
  assert.match(e(""), /Wpisz nazwę dostawcy/);
  assert.match(e("AB"), /co najmniej 3 znaki/);
  assert.match(e("Nadleśnictwo Rybnik"), /nie należy do grupy/);
});

/* ============================ 2.4: kursy transportu zewnętrznego ============================ */
const XRUNS = (n, over = {}, top = {}) => ({ mode: "external", place: "RiC Zabrze", external: Object.assign({ company: "ESI Logistics", includedInPrice: false, runCount: String(n), runs: Array.from({ length: n }, (_, i) => Object.assign({ reg: `ESI 1000${i}`, driver: "Jan Nowak", km: "45", rate: "", freight: "", kwit: `KW 2${i}/09/2026`, kwitM3: "", qty: "100", weightT: "33" }, over)) }, top) });
test("2.4 Zewnętrzny: 4 kursy × 100 MP = 400 MP, 132 t, koszt km × stawka domyślna (4 × 45 × 5 = 900 zł)", () => {
  const s = fresh();
  const d = NDL(); Object.assign(d.production, { enabled: true, type: "lesna", kwit: "KW 0700/09/2026" }); d.transport = XRUNS(4);
  const p = R.planOperation(s, d, ctx(s));
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  const t = p.norm.transport;
  assert.deepEqual([t.company, t.runCount, t.totalQty, t.qtyUnit, t.totalWeightT, t.km, t.cost], ["ESI Logistics", 4, 400, "MP", 132, 180, 900]);
  assert.equal(t.reg.split(", ").length, 4);
});
test("2.4 Zewnętrzny: fracht kursu z faktury zastępuje km × stawka; „wliczony w cenę” = 0 zł; wymagany nr rej. i ilość", () => {
  const s = fresh();
  const d = NDL(); Object.assign(d.production, { enabled: true, type: "lesna", kwit: "KW 0701/09/2026" });
  d.transport = XRUNS(2, { qty: "200", freight: "650" });
  assert.equal(R.planOperation(s, d, ctx(s)).norm.transport.cost, 1300);
  d.transport = XRUNS(2, { qty: "200" }, { includedInPrice: true });
  assert.equal(R.planOperation(s, d, ctx(s)).norm.transport.cost, 0);
  d.transport = XRUNS(2, { reg: "", qty: "" });
  const e = R.planOperation(s, d, ctx(s)).errors;
  assert.ok(e["transport.external.runs.0.reg"] && e["transport.external.runs.1.qty"]);
  d.transport = XRUNS(2, { km: "", qty: "200" });
  assert.ok(R.planOperation(s, d, ctx(s)).errors["transport.external.runs.0.km"], "bez frachtu km wymagane");
});
test("2.4 Zewnętrzny: dane z wersji ≤ 2.3 (reg, km, freight bez listy kursów) liczą się jak dotąd", () => {
  const s = fresh();
  const d = WZ(); d.transport = { mode: "external", place: "EC", external: { company: "DAP", reg: "SZA 7K901", km: "35", freight: "650", includedInPrice: false } };
  const t = R.planOperation(s, d, ctx(s)).norm.transport;
  assert.deepEqual([t.runCount, t.cost, t.reg, t.km], [1, 650, "SZA 7K901", 35]);
});

/* ============================ 2.5: transport własny + zewnętrzny w jednej operacji ============================ */
test("2.5 Mieszany: 3 kursy flotą własną + 2 kursy firmą zewnętrzną do jednej produkcji — suma kursów, ilości, ton i kosztu", () => {
  const s = fresh();
  const d = NDL(); Object.assign(d.production, { enabled: true, type: "lesna", kwit: "KW 0900/09/2026" });
  d.transport = { mode: "mixed", place: "RiC Zabrze", own: RUNS(3, { qty: "80" }).own, external: XRUNS(2, { qty: "80" }).external };
  const p = R.planOperation(s, d, ctx(s));
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  const t = p.norm.transport;
  assert.deepEqual([t.mode, t.runCount, t.own.runs.length, t.external.runs.length], ["mixed", 5, 3, 2]);
  assert.deepEqual([t.totalQty, t.totalWeightT, t.km, t.cost], [400, 165, 225, 3 * 225 + 2 * 225]);
  assert.deepEqual(t.runs.map(r => [r.no, r.kind]), [[1, "own"], [2, "own"], [3, "own"], [4, "external"], [5, "external"]]);
  assert.ok(!p.warnings.some(w => w.includes("Suma kursów")), "5 × 80 = 400 MP = produkcja");
  const op = commit(s, d);
  assert.equal(op.documents.filter(x => x.type === "TR").length, 1);
  const rep = R.Reports.business(s, { mode: "month", from: "2026-09-01", to: "2026-09-30", whId: "wh_zab" });
  assert.ok(rep.transport.carriers.some(c => c.name === "ESI Logistics" && c.count >= 2));
});
test("2.5 Mieszany: błędy w obu częściach raportowane osobno; suma różna od ilości = ostrzeżenie", () => {
  const s = fresh();
  const d = NDL(); Object.assign(d.production, { enabled: true, type: "lesna", kwit: "KW 0901/09/2026" });
  d.transport = { mode: "mixed", place: "RiC Zabrze", own: RUNS(3, { qty: "" }).own, external: XRUNS(2, { reg: "" }).external };
  const e = R.planOperation(s, d, ctx(s)).errors;
  assert.ok(e["transport.own.runs.0.qty"] && e["transport.external.runs.1.reg"]);
  d.transport = { mode: "mixed", place: "RiC Zabrze", own: RUNS(3).own, external: XRUNS(2).external };
  assert.match(R.planOperation(s, d, ctx(s)).errors["transport.runs"], /Suma kursów 500 MP przekracza ilość z produkcji 400 MP \(o 100 MP\)/);
});
test("2.5 Dane przykładowe: zakup 03.09 — 3 kursy własne + 2 zewnętrzne (5 × 16 MP = 80 MP)", () => {
  const s = fresh();
  const op = s.operations.find(o => o.transport.mode === "mixed");
  assert.deepEqual([op.transport.own.runs.length, op.transport.external.runs.length, op.transport.totalQty], [3, 2, 80]);
});

/* ============================ 2.6: kwity wywozowe w kursach ============================ */
const FOREST = () => { const d = NDL(); Object.assign(d.production, { enabled: true, type: "lesna", kwit: "" }); return d; };
test("2.6 Kwit wywozowy: w produkcji leśnej z kursami numer kwitu wymagany w każdym kursie (nie przy produkcji)", () => {
  const s = fresh();
  const d = FOREST(); d.transport = RUNS(4, { kwit: "" });
  const e = R.planOperation(s, d, ctx(s)).errors;
  assert.ok(e["transport.own.runs.0.kwit"] && e["transport.own.runs.3.kwit"]);
  assert.ok(!e["production.kwit"], "przy kursach kwit nie jest wymagany w sekcji produkcji");
  d.transport = RUNS(4);
  const p = R.planOperation(s, d, ctx(s));
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  assert.equal(p.norm.production.kwit, "KW 10/09/2026, KW 11/09/2026, KW 12/09/2026, KW 13/09/2026");
  assert.equal(p.documents.find(x => x.type === "PW").meta.kwit, p.norm.production.kwit);
});
test("2.6 Kwit: m³ z kwitu × 4 = MP na aucie; suma kursów nie przekracza produkcji ani zużytego drewna", () => {
  const s = fresh();
  const d = FOREST(); d.transport = RUNS(4, { qty: "", kwitM3: "25" });
  const p = R.planOperation(s, d, ctx(s));
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  assert.deepEqual([p.norm.transport.runs[0].qty, p.norm.transport.totalQty, p.norm.transport.totalM3, p.norm.transport.remainingQty], [100, 400, 100, 0]);
  d.transport = RUNS(4, { qty: "", kwitM3: "26" });
  const e = R.planOperation(s, d, ctx(s)).errors["transport.runs"];
  assert.match(e, /przekracza ilość z produkcji 400 MP/);
  d.transport = RUNS(4, { qty: "100", kwitM3: "26" });
  assert.match(R.planOperation(s, d, ctx(s)).errors["transport.runs"], /Suma m³ z kwitów 104 m³ przekracza drewno zużyte w produkcji 100 m³/);
});
test("2.6 Kwit: bez kursów (brak transportu) kwit wpisuje się przy produkcji; firma drzewna (KZR, inwestycyjna) kwitu nie wymaga", () => {
  const s = fresh();
  const d = FOREST();
  assert.ok(R.planOperation(s, d, ctx(s)).errors["production.kwit"]);
  d.production.kwit = "KW 99/09/2026";
  assert.equal(R.planOperation(s, d, ctx(s)).ok, true);
  const f = draft({ purchase: Object.assign({}, PURCHASE_A, { productId: "pr_drewno_inw" }), production: { enabled: true, type: "inwestycyjna", investSite: "Obwodnica" }, transport: RUNS(2, { kwit: "", qty: "40" }) });
  assert.equal(R.planOperation(s, f, ctx(s)).ok, true, JSON.stringify(R.planOperation(s, f, ctx(s)).errors));
});
