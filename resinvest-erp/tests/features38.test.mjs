/* Testy funkcji wersji 3.8:  node --test tests/features38.test.mjs
   Kilka firm transportu zewnętrznego w jednej operacji (firma w każdym kursie, lista 1–10),
   jedna seria numeracji WZ dla wszystkich dokumentów magazynowych (jedna transakcja = jeden numer WZ). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";

const require = createRequire(import.meta.url);
globalThis.RIW_CONFIG = JSON.parse(readFileSync(new URL("../config/app.config.json", import.meta.url), "utf8"));
require("../app/src/i18n.js");
for (const f of readdirSync(new URL("../app/src/", import.meta.url)).filter(f => /^i18n\.d\d+\.js$/.test(f)).sort()) require("../app/src/" + f);
const R = require("../app/src/engine.js");
require("../app/src/service.js");
require("../app/src/seed.js");

const TODAY = "2026-09-23";
const fresh = () => R.Seed.build(TODAY);
const U = (s, id) => s.users.find(u => u.id === id);
const ctx = (s, uid = "u_kier") => ({ user: U(s, uid), today: TODAY, source: "test" });
const draft = over => R.Seed.draftOf(over.date || TODAY, Object.assign({ transport: { mode: "none", place: "RiC Zabrze" } }, over));
const commit = (s, d, c) => { const r = R.commitOperation(s, d, c || ctx(s)); assert.equal(r.ok, true, r.error); return r.op; };
const PURCHASE = { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: "30", unit: "m3", price: "230", weightMode: "auto" };
const LESNA = { enabled: true, type: "lesna", ndl: "Rudy Raciborskie", lesnictwo: "Stanica", kwit: "KW 0300/09/2026" };
const ext = (external, over = {}) => draft(Object.assign({ purchase: PURCHASE, transport: { mode: "external", place: "RiC Zabrze", external } }, over));
const RUNS3 = [
  { company: "ESI Logistics", reg: "ESI 1", km: "10", qty: "10" },
  { company: "DAP Trans", reg: "DAP 2", km: "20", qty: "10" },
  { company: "esi logistics", reg: "ESI 3", km: "30", qty: "10" }
];
const WZ_NO = /^WZ\/\d{3}\/09\/2026$/;

/* ============================ kilka firm transportu zewnętrznego ============================ */
test("transport zewnętrzny: dwie firmy w kursach — firma per kurs, podsumowanie per firma, koszt bez zmian", () => {
  const s = fresh();
  const plan = R.planOperation(s, ext({ companyCount: "2", runCount: "3", runs: RUNS3 }), ctx(s));
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  const T = plan.norm.transport;
  assert.deepEqual(T.runs.map(r => r.company), ["ESI Logistics", "DAP Trans", "ESI Logistics"], "pisownia nazwy ujednolicona do pierwszego wystąpienia");
  assert.equal(T.company, "ESI Logistics, DAP Trans");
  assert.equal(T.companyCount, 2);
  assert.deepEqual(T.companies.map(c => [c.company, c.runs, c.km, c.qty, c.cost]), [["ESI Logistics", 2, 40, 20, 200], ["DAP Trans", 1, 20, 10, 100]]);
  assert.equal(T.cost, 300);
});

test("transport zewnętrzny: kilka firm — brak firmy w kursie, więcej firm niż zadeklarowano, limit 10", () => {
  const s = fresh();
  const noCo = R.planOperation(s, ext({ companyCount: "2", runCount: "2", runs: [RUNS3[0], Object.assign({}, RUNS3[1], { company: "" })] }), ctx(s));
  assert.equal(noCo.ok, false);
  assert.ok(noCo.errors["transport.external.runs.1.company"], JSON.stringify(noCo.errors));
  const tooMany = R.planOperation(s, ext({ companyCount: "2", runCount: "3", runs: [RUNS3[0], RUNS3[1], Object.assign({}, RUNS3[2], { company: "Trans-Bud" })] }), ctx(s));
  assert.ok(tooMany.errors["transport.external.companyCount"], JSON.stringify(tooMany.errors));
  const over = R.planOperation(s, ext({ companyCount: "11", runCount: "1", runs: [RUNS3[0]] }), ctx(s));
  assert.ok(over.errors["transport.external.companyCount"]);
  const fewer = R.planOperation(s, ext({ companyCount: "3", runCount: "2", runs: [RUNS3[0], RUNS3[2]] }), ctx(s));
  assert.equal(fewer.ok, true, JSON.stringify(fewer.errors));
  assert.ok(fewer.warnings.some(w => /Zadeklarowano 3 firm/.test(w)), fewer.warnings.join(" | "));
});

test("transport zewnętrzny: jedna firma (także dane sprzed 3.8 bez liczby firm) — firma z pola ogólnego dla wszystkich kursów", () => {
  const s = fresh();
  const one = R.planOperation(s, ext({ company: "ESI Logistics", runCount: "2", runs: [{ reg: "A 1", km: "5", qty: "15" }, { reg: "A 2", km: "5", qty: "15", company: "zignorowana" }] }), ctx(s));
  assert.equal(one.ok, true, JSON.stringify(one.errors));
  assert.deepEqual(one.norm.transport.runs.map(r => r.company), ["ESI Logistics", "ESI Logistics"]);
  assert.equal(one.norm.transport.companyCount, 1);
  const noCompany = R.planOperation(s, ext({ companyCount: "1", company: "", runCount: "1", runs: [{ reg: "A 1", km: "5" }] }), ctx(s));
  assert.ok(noCompany.errors["transport.external.company"]);
});

test("transport zewnętrzny: nowe firmy z kursów trafiają do listy przewoźników; raport transportu liczy koszt per firma", () => {
  const s = fresh();
  const before = s.carriers.length;
  commit(s, ext({ companyCount: "2", runCount: "2", runs: [Object.assign({}, RUNS3[0]), { company: "Nowy Przewoźnik", reg: "NP 1", km: "50", qty: "10" }] }));
  assert.ok(s.carriers.includes("Nowy Przewoźnik"));
  assert.equal(s.carriers.length, before + 1, "istniejąca firma nie jest dublowana");
  const rep = R.Reports.business(s, { mode: "month", from: "2026-09-01", to: "2026-09-30" });
  const np = rep.transport.carriers.find(c => c.name === "Nowy Przewoźnik");
  assert.ok(np && np.cost === 250 && np.count === 1, JSON.stringify(np));
});

test("transport mieszany: kursy floty własnej i kilku firm zewnętrznych w jednej operacji", () => {
  const s = fresh();
  const plan = R.planOperation(s, draft({ purchase: PURCHASE, transport: { mode: "mixed", place: "RiC Zabrze",
    own: { runCount: "1", runs: [{ vehicleId: "ve_scania", driverId: "dr_kowalski", km: "10", qty: "10" }] },
    external: { companyCount: "2", runCount: "2", runs: [RUNS3[0], RUNS3[1]] } } }), ctx(s));
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.deepEqual(plan.norm.transport.runs.map(r => [r.kind, r.kind === "external" ? r.company : ""]), [["own", ""], ["external", "ESI Logistics"], ["external", "DAP Trans"]]);
  assert.equal(plan.norm.transport.external.company, "ESI Logistics, DAP Trans");
});

/* ================================ jedna seria numeracji WZ ================================ */
test("numeracja WZ: zakup z produkcją — PZ, RW, PW, TR dostają jeden wspólny numer WZ transakcji", () => {
  const s = fresh();
  assert.equal(R.unifiedNumbering(s), true, "domyślnie jedna seria WZ");
  const op = commit(s, ext({ company: "ESI Logistics", runCount: "1", runs: [{ reg: "A 1", km: "5", kwit: "KW 1/09", kwitM3: "20" }] }, { production: LESNA }));
  const nos = [...new Set(op.documents.map(d => d.no))];
  assert.equal(nos.length, 1, JSON.stringify(op.documents.map(d => [d.type, d.no])));
  assert.match(nos[0], WZ_NO);
  assert.equal(op.no, nos[0]);
  assert.ok(op.documents.length >= 3 && op.documents.every(d => d.series === "WZ"));
  assert.ok(s.ledger.filter(l => l.opId === op.id).every(l => l.docNo === nos[0]), "księga wskazuje numer WZ");
  const next = commit(s, draft({ purchase: Object.assign({}, PURCHASE, { qty: "5" }) }));
  const n = x => +x.split("/")[1];
  assert.equal(n(next.no), n(op.no) + 1, "kolejna transakcja — kolejny numer serii");
});

test("numeracja WZ: korekta i anulowanie dostają kolejne numery z tej samej serii; numery wcześniejszych dokumentów bez zmian", () => {
  const s = fresh();
  const oldNos = s.operations.map(o => o.documents.map(d => d.no).join(","));
  const op = commit(s, draft({ purchase: Object.assign({}, PURCHASE, { qty: "5" }) }));
  const k = R.correctOperation(s, op.id, draft({ purchase: Object.assign({}, PURCHASE, { qty: "6" }) }), "błędnie wpisana ilość", ctx(s));
  assert.equal(k.ok, true, k.error);
  assert.match(k.no, WZ_NO);
  assert.notEqual(k.no, op.no);
  assert.equal(op.documents[0].no, op.no, "korekta nie zmienia numeru dokumentu");
  const a = R.cancelOperation(s, op.id, ctx(s), "pomyłka");
  assert.equal(a.ok, true, a.error);
  assert.match(a.no, WZ_NO);
  assert.equal(new Set([op.no, k.no, a.no]).size, 3);
  assert.deepEqual(s.operations.slice(0, oldNos.length).map(o => o.documents.map(d => d.no).join(",")), oldNos);
});

test("numeracja WZ: numer ręczny dla całej transakcji — unikalny w magazynie i roku (także wobec numerów korekt)", () => {
  const s = fresh();
  const d = draft({ purchase: PURCHASE, production: LESNA });
  d.docNoMode = { WZ: "manual" }; d.docNos = { WZ: "WZ/77/2026" };
  const op = commit(s, d);
  assert.ok(op.documents.every(x => x.no === "WZ/77/2026" && x.manualNo === "WZ/77/2026"));
  const dup = draft({ purchase: Object.assign({}, PURCHASE, { qty: "2" }) }); dup.docNoMode = { WZ: "manual" }; dup.docNos = { WZ: "wz/77/2026" };
  assert.equal(R.planOperation(s, dup, ctx(s)).errorCodes["docNos.WZ"], "DOC_NO");
  const k = R.correctOperation(s, op.id, Object.assign(draft({ purchase: Object.assign({}, PURCHASE, { price: "231" }), production: LESNA })), "błędna cena", ctx(s));
  assert.equal(k.ok, true, k.error);
  const dupK = draft({ purchase: Object.assign({}, PURCHASE, { qty: "2" }) }); dupK.docNoMode = { WZ: "manual" }; dupK.docNos = { WZ: k.no };
  assert.ok(R.planOperation(s, dupK, ctx(s)).errors["docNos.WZ"], "numer korekty z tej samej serii jest zajęty");
  const auto = draft({ purchase: Object.assign({}, PURCHASE, { qty: "2" }) }); auto.docNoMode = { WZ: "manual" }; auto.docNos = { WZ: "" };
  assert.ok(R.planOperation(s, auto, ctx(s)).errors["docNos.WZ"], "tryb ręczny bez numeru — błąd");
  assert.equal(R.suggestDocNo(s, "WZ", "wh_zab", TODAY).slice(0, 3), "WZ/");
});

test("numeracja WZ: szkic sprzed 3.8 z ręcznym numerem PZ — numer przechodzi na całą transakcję", () => {
  assert.deepEqual(R.seriesNoOf({ docNos: { PZ: "PZ/12" }, docNoMode: { PZ: "manual" } }), { mode: "manual", no: "PZ/12" });
  assert.deepEqual(R.seriesNoOf({ docNos: { PZ: "", WZ: "", MM: "" }, docNoMode: { PZ: "auto", WZ: "auto", MM: "auto" } }), { mode: "auto", no: "" });
  assert.deepEqual(R.seriesNoOf({ docNos: { WZ: "WZ/5" }, docNoMode: { WZ: "manual" } }), { mode: "manual", no: "WZ/5" });
});

test("numeracja: administrator przełącza tryb (WZ ↔ osobne serie) — zmiana w audycie, wartości spoza listy odrzucone", () => {
  const s = fresh(), c = ctx(s, "u_admin");
  assert.equal(R.Settings.save(s, { docNumbering: "xyz" }, c).ok, false);
  assert.equal(R.Settings.save(s, { docNumbering: "types" }, ctx(s, "u_kier")).ok, false, "tylko z uprawnieniem settings.edit");
  assert.equal(R.Settings.save(s, { docNumbering: "types" }, c).ok, true);
  assert.equal(R.unifiedNumbering(s), false);
  assert.ok(s.audit.some(a => a.code === "SETTINGS_CHANGED" && a.after && a.after.docNumbering === "types"));
  const op = commit(s, draft({ purchase: Object.assign({}, PURCHASE, { qty: "3" }) }));
  assert.match(op.documents.find(d => d.type === "PZ").no, /^PZ\//);
  assert.equal(R.Settings.save(s, { docNumbering: "wz" }, c).ok, true);
  assert.match(commit(s, draft({ purchase: Object.assign({}, PURCHASE, { qty: "3" }) })).no, WZ_NO);
});

/* ============================ ewidencja obrotu (CSV) + dane planera ============================ */
require("../app/src/planner.js");
const Trade = require("../app/src/trade.js");
const col = name => { const i = Trade.COLUMNS.indexOf(name); assert.ok(i >= 0, name); return i; };
const pick = (row, ...names) => names.map(n => row[col(n)]);

test("ewidencja CSV: kolumny zestawienia firmy w ustalonej kolejności, koszt transportu = raporty, bez anulowanych", () => {
  const s = fresh(), rows = Trade.rows(s, {});
  assert.deepEqual(Trade.COLUMNS.slice(0, 6), ["Data załadunku do klienta końcowego", "Miejsce załadunku", "Data operacji", "Dostawca", "Zakup/Sprzedaż", "Nr. WZ"]);
  assert.ok(["Wolumen_MP", "Wolumen_t", "Wolumen_GJ", "Ruch_magazyn_MP", "Ruch_magazyn_t", "Wartość_zakupu_zł_calc", "Wartość_sprzedaży_zł_calc", "Typ_transportu_heurystyka", "Koszt_rąbania_total", "Miesiąc_tekst", "Rok", "Plan_dnia_MP", "Plan_miesiąca_MP"].every(c => Trade.COLUMNS.includes(c)));
  assert.ok(rows.length > 0 && rows.every(r => r.length === Trade.COLUMNS.length));
  const live = s.operations.filter(o => !o.deleted && o.status !== "CANCELLED");
  const sum = rows.reduce((a, r) => a + (Number(r[col("Koszt transportu")]) || 0), 0);
  assert.equal(Math.round(sum * 100), Math.round(live.reduce((a, o) => a + (o.totals.transportCost || 0), 0) * 100));
  const cancelled = s.operations.find(o => o.status === "CANCELLED");
  assert.ok(cancelled && !rows.some(r => r[col("Nr. WZ")] === cancelled.no), "anulowana transakcja pominięta");
});

test("ewidencja CSV: zakup z produkcją i sprzedażą bezpośrednią — trzy wiersze jednego WZ, magazynowanie NIE, rąbanie wynajęte", () => {
  const s = fresh();
  const op = commit(s, draft({ purchase: PURCHASE, production: Object.assign({}, LESNA, { chipperId: "ch_ext_drwal" }), sale: { enabled: true, direct: true, buyerId: "pa_ec_zab", price: "90", priceUnit: "MP" },
    transport: { mode: "external", place: "EC Zabrze", external: { companyCount: "2", runCount: "2", runs: [{ company: "ESI Logistics", reg: "ESI 1", km: "10", qty: "60", kwit: "KW 1", kwitM3: "15" }, { company: "DAP Trans", reg: "DAP 2", km: "20", qty: "60", kwit: "KW 2", kwitM3: "15" }] } } }));
  const rows = Trade.rows(s, { opIds: [op.id] });
  assert.deepEqual(rows.map(r => r[col("Zakup/Sprzedaż")]), ["Zakup", "Produkcja", "Sprzedaż"]);
  assert.ok(rows.every(r => r[col("Nr. WZ")] === op.no));
  assert.deepEqual(rows.map(r => r[col("Czy magazynowane (TAK / NIE)")]), ["NIE", "NIE", "NIE"]);
  assert.deepEqual(rows.map(r => r[col("Ruch_magazyn_MP")]), [0, 0, 0]);
  const [zak, prod, sale] = rows;
  assert.deepEqual(pick(zak, "Dostawca", "Deklaracja/KZR", "Volumen", "Jednostka miary", "Cena zakupu/produkcji (zł/mp;zł/tona)", "Wartość", "Wolumen_MP"), ["Lander Agro", "KZR", 30, "m³", 230, 6900, 120]);
  assert.match(prod[col("Rąbanie własne/wynajęte (kto)")], /^wynajęte — /);
  assert.equal(prod[col("Koszt rąbania usługa")], op.production.chippingCost);
  assert.equal(prod[col("Rodzaj zrębki a/b")], "a");
  assert.deepEqual(pick(sale, "Volumen", "Cena sprzedaży (zł/mp;zł/tona)", "Wartość_sprzedaży_zł_calc", "Odbiorca"), [120, 90, 10800, s.partners.find(p => p.id === "pa_ec_zab").name]);
  assert.equal(sale[col("Transport: Firma")], "ESI Logistics, DAP Trans");
  assert.equal(sale[col("Nr. Rejestracyjny")], "ESI 1, DAP 2");
  assert.deepEqual(pick(sale, "Odległość km", "Koszt transportu"), [30, 150]);
  assert.equal(zak[col("Koszt transportu")], "", "transport tylko przy ostatnim ruchu transakcji");
  assert.match(sale[col("Typ_transportu_heurystyka")], /zewnętrzny \(2 firmy\)/);
  assert.deepEqual(pick(sale, "Miesiąc_tekst", "Rok", "Data załadunku do klienta końcowego"), ["wrzesień", 2026, TODAY]);
  assert.equal(sale[col("Miejsce pochodzenia")], "Nadleśnictwo Rudy Raciborskie · Stanica");
});

test("ewidencja CSV: zakup na magazyn i sprzedaż ze stanu — ruch magazynu w MP i t, ceny z jednostką", () => {
  const s = fresh();
  const buy = commit(s, draft({ purchase: { supplierId: "pa_drwal", basis: "DEKL", productId: "pr_zr_tow", qty: "50", unit: "MP", price: "55", weightMode: "auto" } }));
  const [b] = Trade.rows(s, { opIds: [buy.id] });
  assert.deepEqual(pick(b, "Zakup/Sprzedaż", "Czy magazynowane (TAK / NIE)", "Deklaracja/KZR", "Ruch_magazyn_MP", "Ruch_magazyn_t", "Jednostka_ceny_zakupu"), ["Zakup", "TAK", "Deklaracja", 50, 16.5, "zł/MP"]);
  const sale = commit(s, draft({ type: "SPRZEDAZ", sale: { productId: "pr_zr_tow", qty: "20", unit: "MP", buyerId: "pa_ec_zab", price: "80", priceUnit: "MP", weightMode: "auto" }, transport: { mode: "none", place: "EC Zabrze" } }));
  const [x] = Trade.rows(s, { opIds: [sale.id] });
  assert.deepEqual(pick(x, "Zakup/Sprzedaż", "Czy magazynowane (TAK / NIE)", "Ruch_magazyn_MP", "Wartość", "Miejsce załadunku", "Typ_transportu_heurystyka"), ["Sprzedaż", "TAK", -20, 1600, "RiC Zabrze", "brak transportu"]);
});

test("ewidencja CSV: kolumny planera — plan dnia magazynu, plan i wykonanie miesiąca, udział transakcji w wykonaniu", () => {
  const s = fresh();
  const op = commit(s, draft({ purchase: PURCHASE, production: LESNA }));
  R.Planner.setPlan(s, { whId: "wh_zab", date: TODAY, planMP: "200", note: "Rudy — Stanica" }, ctx(s));
  const rows = Trade.rows(s, { opIds: [op.id] });
  assert.deepEqual(pick(rows[0], "Plan_dnia_MP", "Uwagi_planu", "Wykonanie_planera_MP"), [200, "Rudy — Stanica", 120]);
  const days = R.Planner.days(s, ["wh_zab"], "2026-09-01", "2026-09-30", "9999-12-31"), tot = R.Planner.totals(days);
  assert.deepEqual(pick(rows[1], "Plan_miesiąca_MP", "Wykonanie_miesiąca_MP"), [tot.plan, tot.act]);
  assert.equal(rows[1][col("Plan_dnia_MP")], "", "plan dnia tylko w pierwszym wierszu transakcji");
  const filtered = Trade.rows(s, { from: TODAY, to: TODAY, whIds: ["wh_bra"] });
  assert.ok(!filtered.some(r => r[col("Nr. WZ")] === op.no), "filtr magazynu i okresu");
});
