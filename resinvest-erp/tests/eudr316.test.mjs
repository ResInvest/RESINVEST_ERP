/* Testy modułu EUDR — drewno surowe (silnik):  node --test tests/eudr316.test.mjs
   obowiązki według roli w transakcji, partia z dokumentu przyjęcia bez podwójnego wpisu, blokady i ostrzeżenia wydania,
   należyta staranność (decyzja człowieka), rozdzielenie ACCEPTANCE / PRODUCTION, numery symulowane, podział / łączenie /
   przetwarzanie z zachowaniem pochodzenia, GeoJSON, dokumenty z wersjami, audyt 13 obszarów, szkolenia, uprawnienia,
   izolacja magazynów, dziennik audytu. */
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
const E = R.Eudr;

const BEFORE = "2026-11-10", AFTER = "2027-01-15";
const ctxOf = (s, uid, today = BEFORE) => ({ user: R.byId(s.users, uid), today, now: today + "T08:00:00.000Z" });
function run(s, uid, cmd, args, today) { const r = Service.run(s, cmd, args, ctxOf(s, uid, today)); return { s: r.state || s, res: r.res }; }
const must = (s, uid, cmd, args, today) => { const r = run(s, uid, cmd, args, today); assert.equal(r.res.ok, true, `${cmd}: ${r.res.error} ${JSON.stringify(r.res.errors || r.res.missing || "")}`); return r; };
const base = () => R.Seed.build(BEFORE);
const pzOf = s => s.operations.find(o => o.type === "ZAKUP" && o.whId === "wh_zab" && !s.eudrLots.some(l => l.receipt && l.receipt.opId === o.id));
const lotArgs = (over = {}) => Object.assign({ whId: "wh_zab", productId: "pr_drewno", qty: "50", m3: "50", t: "47", partnerId: "pa_ndl_rr", acq: "own_harvest",
  wood: { species: "Sosna zwyczajna", speciesLatin: "Pinus sylvestris", cn: "4401", country: "PL", harvestFrom: "2026-05-01" },
  origin: { owner: "PRZYKŁAD", country: "PL", riskCountry: "low", lat: "50.1", lon: "18.2", areaHa: "2" } }, over);
const docFile = n => ({ key: `SKANY LISTOPAD 2026/EUDR_test_${n}.pdf`, name: `dok${n}.pdf`, type: "application/pdf", size: 1000, sha: "x" });
function fullDocs(s, lotId) {
  for (const [i, type] of ["purchase", "transport", "legality", "harvest_right", "gps", "invoice"].entries()) s = must(s, "u_kier", "eudr.doc.save", { type, lotIds: [lotId], file: docFile(i) }).s;
  return s;
}
function ddAll(s, lotId, uid = "u_aud") {
  const items = Object.fromEntries(Object.keys(E.DD1_ITEMS).map(k => [k, { ok: true }]));
  s = must(s, uid, "eudr.dd.stage", { id: lotId, stage: 1, items, done: true, confirm: true }).s;
  const criteria = Object.fromEntries(Object.keys(E.DD2_CRITERIA).map(k => [k, { level: "low" }]));
  s = must(s, uid, "eudr.dd.stage", { id: lotId, stage: 2, criteria, result: "NEGLIGIBLE", justification: "Kraj niskiego ryzyka, komplet dokumentów legalności.", done: true }).s;
  return s;
}

test("dane przykładowe: kolekcje EUDR, partie fikcyjne oznaczone, profil w trybie ACCEPTANCE", () => {
  const s = base();
  for (const k of E.COLLS) assert.ok(Array.isArray(s[k]), k);
  assert.ok(s.eudrLots.length >= 3 && s.eudrLots.every(l => l.demo && /FIKCYJNE/.test(l.notes)));
  assert.equal(E.envOf(s), "ACCEPTANCE");
  assert.ok(s.eudrDds.every(d => d.env === "ACCEPTANCE" && d.kind === "SIMULATED" && /^SYM-/.test(d.referenceNumber)));
  assert.equal(R.validateStateShape ? R.validateStateShape(s).ok !== false : true, true);
});

test("obowiązki według sposobu nabycia, kodu CN i daty stosowania", () => {
  const s = base();
  const ob = (acq, cn = "4401", today = BEFORE) => E.obligations(s, { acq, wood: { cn } }, { today });
  assert.equal(ob("own_harvest").role, "OPERATOR");
  assert.equal(ob("from_operator").role, "DOWNSTREAM_FIRST");
  assert.equal(ob("from_operator").refRequired, "DDS");
  assert.equal(ob("from_sme_primary").refRequired, "SD");
  assert.equal(ob("from_trader").role, "DOWNSTREAM");
  assert.equal(ob("own_harvest", "2701").role, "NONE", "węgiel kamienny poza załącznikiem I");
  assert.equal(ob("own_harvest").inForce, false);
  assert.equal(ob("own_harvest", "4401", AFTER).inForce, true);
  // małe przedsiębiorstwo — 30.06.2027; reguły nadpisane w konfiguracji bez przebudowy programu
  let x = must(s, "u_admin", "eudr.config.save", { profile: { size: "small", company: "Test" } }).s;
  assert.equal(E.applyDate(x), "2027-06-30");
  x = must(x, "u_admin", "eudr.config.save", { rules: JSON.stringify({ version: "test-1", dates: { small: "2027-09-01" } }) }).s;
  assert.equal(E.applyDate(x), "2027-09-01");
  assert.equal(E.rules(x).dates.large, "2026-12-30");
  assert.equal(run(x, "u_admin", "eudr.config.save", { rules: "{\"zle\":1}" }).res.ok, false);
});

test("partia z dokumentu przyjęcia: dane z PZ, bez podwójnego wprowadzenia", () => {
  let s = base();
  const pz = pzOf(s);
  const q = E.opQty(s, pz);
  const r = must(s, "u_mag", "eudr.lot.fromOp", { opId: pz.id });
  s = r.s;
  const lot = r.res.lot;
  assert.equal(lot.receipt.opId, pz.id); assert.equal(lot.qty, q); assert.equal(lot.whId, pz.whId);
  assert.equal(lot.partnerId, pz.input.purchase.supplierId);
  assert.match(lot.no, /^EUDR\/2026\/\d{4}$/);
  const again = run(s, "u_mag", "eudr.lot.fromOp", { opId: pz.id });
  assert.equal(again.res.ok, false, "drugi raz z tego samego dokumentu");
  assert.ok(!E.unassignedReceipts(s, null).some(x => x.op.id === pz.id));
  assert.ok(s.audit.some(a => a.entity === "eudr" && a.entityId === lot.id));
  // magazynier innego magazynu
  const b2 = base();
  assert.equal(run(b2, "u_bra", "eudr.lot.fromOp", { opId: pzOf(b2).id }).res.code, "FORBIDDEN");
});

test("wydanie: operator bez DDS — blokada po dacie stosowania, ostrzeżenie przed; podmiot niższego szczebla — ostrzeżenie", () => {
  let s = base();
  const r = must(s, "u_kier", "eudr.lot.save", lotArgs({ submit: true })); s = r.s;
  const lot = r.res.lot, wz = s.operations.find(o => o.type === "SPRZEDAZ" && o.whId === "wh_zab");
  const blocked = run(s, "u_mag", "eudr.lot.link", { lotId: lot.id, kind: "WZ", opId: wz.id, qty: "5" }, AFTER);
  assert.equal(blocked.res.ok, false); assert.equal(blocked.res.code, "EUDR_BLOCK");
  assert.ok(blocked.res.blocks.some(b => /DDS/.test(b)));
  // obejście tylko administrator z uzasadnieniem
  assert.equal(run(s, "u_kier", "eudr.lot.link", { lotId: lot.id, kind: "WZ", opId: wz.id, qty: "5", force: true, reason: "x".repeat(30) }, AFTER).res.code, "FORBIDDEN");
  const before = must(s, "u_mag", "eudr.lot.link", { lotId: lot.id, kind: "WZ", opId: wz.id, qty: "5" }, BEFORE);
  assert.ok(before.res.warnings.length > 0);
  assert.equal(E.balance(R.byId(before.s.eudrLots, lot.id)), 45);
  // ta sama WZ drugi raz — odmowa (brak podwójnego wpisu)
  assert.equal(run(before.s, "u_mag", "eudr.lot.link", { lotId: lot.id, kind: "WZ", opId: wz.id, qty: "1" }).res.ok, false);
  // podmiot niższego szczebla bez numeru dostawcy: wydanie z ostrzeżeniem (brak DDS nie blokuje automatycznie)
  const d = must(s, "u_kier", "eudr.lot.save", lotArgs({ acq: "from_operator", partnerId: "pa_drwal", submit: true }));
  const ok = must(d.s, "u_mag", "eudr.lot.link", { lotId: d.res.lot.id, kind: "WZ", opId: wz.id, qty: "5" }, AFTER);
  assert.ok(ok.res.warnings.some(w => /numeru referencyjnego/.test(w)));
  // tryb „ostrzegaj” w konfiguracji zdejmuje blokadę
  const warn = must(s, "u_admin", "eudr.config.save", { releaseMode: "warn" }).s;
  assert.equal(run(warn, "u_mag", "eudr.lot.link", { lotId: lot.id, kind: "WZ", opId: wz.id, qty: "5" }, AFTER).res.ok, true);
});

test("należyta staranność: dopuszczenie wyłącznie decyzją osoby uprawnionej, nie automatycznie", () => {
  let s = base();
  const r = must(s, "u_kier", "eudr.lot.save", lotArgs({ submit: true })); s = r.s; const id = r.res.lot.id;
  assert.equal(run(s, "u_kier", "eudr.lot.status", { id, status: "VERIFIED" }).res.ok, false, "status ręczny");
  assert.equal(run(s, "u_kier", "eudr.dd.approve", { id, result: "ACCEPTED", confirm: true, justification: "Wszystko sprawdzone osobiście." }).res.ok, false, "bez etapów");
  s = fullDocs(s, id);
  // etap 1 bez potwierdzenia człowieka
  const items = Object.fromEntries(Object.keys(E.DD1_ITEMS).map(k => [k, { ok: true }]));
  assert.equal(run(s, "u_aud", "eudr.dd.stage", { id, stage: 1, items, done: true }).res.ok, false);
  assert.equal(run(s, "u_aud", "eudr.dd.stage", { id, stage: 2, criteria: {}, done: true }).res.ok, false, "etap 2 przed 1");
  s = ddAll(s, id);
  // wysokie ryzyko nie może dać wyniku „znikome”
  const crit = Object.fromEntries(Object.keys(E.DD2_CRITERIA).map(k => [k, { level: k === "corruption" ? "high" : "low" }]));
  assert.equal(run(s, "u_aud", "eudr.dd.stage", { id, stage: 2, criteria: crit, result: "NEGLIGIBLE", justification: "x".repeat(25), done: true }).res.ok, false);
  assert.equal(run(s, "u_mag", "eudr.dd.approve", { id, result: "ACCEPTED", confirm: true, justification: "x".repeat(25) }).res.code, "FORBIDDEN");
  assert.equal(run(s, "u_aud", "eudr.dd.approve", { id, result: "ACCEPTED", confirm: true, justification: "x".repeat(25) }).res.code, "FORBIDDEN", "kontroler nie zatwierdza");
  assert.equal(run(s, "u_kier", "eudr.dd.approve", { id, result: "ACCEPTED", justification: "x".repeat(25) }).res.ok, false, "bez potwierdzenia");
  s = must(s, "u_kier", "eudr.dd.approve", { id, result: "ACCEPTED", confirm: true, justification: "Sprawdziłam dokumenty i geolokalizację osobiście." }).s;
  const lot = R.byId(s.eudrLots, id);
  assert.equal(lot.status, "VERIFIED"); assert.equal(lot.dd.approval.manual, true); assert.equal(lot.dd.approval.fourEyes, true);
  assert.ok(s.audit.some(a => a.entityId === id && /zatwierdzenie kontroli/.test(a.action)));
  // zmiana danych partii dopuszczonej → ponowna weryfikacja
  const ed = must(s, "u_kier", "eudr.lot.save", { id, qty: "51" }).res.lot;
  assert.equal(ed.status, "PENDING"); assert.equal(ed.dd.approval, null);
});

test("DDS: rozdzielenie ACCEPTANCE / PRODUCTION, numery symulowane, przełączanie trybu z potwierdzeniem", () => {
  let s = base();
  const lot = s.eudrLots[0];
  s = must(s, "u_kier", "eudr.dds.save", { kind: "SUPPLIER", referenceNumber: "26PLTEST000001", verificationNumber: "ABCDE12345", status: "AVAILABLE", lotIds: [lot.id], partnerId: "pa_drwal" }).s;
  assert.equal(s.eudrDds.slice(-1)[0].env, "ACCEPTANCE");
  assert.match(s.eudrDds.slice(-1)[0].no, /^DDS-TEST\//);
  assert.equal(run(s, "u_kier", "eudr.env.set", { env: "PRODUCTION", confirm: "PRODUKCJA" }).res.code, "FORBIDDEN", "tylko administrator");
  assert.equal(run(s, "u_admin", "eudr.env.set", { env: "PRODUCTION", confirm: "tak" }).res.ok, false);
  s = must(s, "u_admin", "eudr.env.set", { env: "PRODUCTION", confirm: "PRODUKCJA" }).s;
  assert.equal(E.envOf(s), "PRODUCTION");
  const copy = run(s, "u_kier", "eudr.dds.save", { kind: "SUPPLIER", referenceNumber: "26PLTEST000001", status: "AVAILABLE", lotIds: [lot.id] });
  assert.equal(copy.res.ok, false); assert.match(copy.res.errors.referenceNumber, /testowej/);
  assert.equal(run(s, "u_kier", "eudr.dds.save", { kind: "SIMULATED", referenceNumber: "X1" }).res.ok, false, "symulacja w produkcji");
  assert.equal(run(s, "u_kier", "eudr.dds.save", { kind: "SUPPLIER", referenceNumber: "SYM-ABC12345", status: "AVAILABLE" }).res.ok, false);
  assert.equal(run(s, "u_kier", "eudr.dds.save", { kind: "SUPPLIER", referenceNumber: "abc", status: "AVAILABLE" }).res.ok, false, "format");
  const p = must(s, "u_kier", "eudr.dds.save", { kind: "OWN", status: "DRAFT", lotIds: [lot.id] });
  s = p.s;
  assert.equal(run(s, "u_kier", "eudr.dds.save", { id: p.res.dds.id, step: 3 }).res.ok, false, "kroki po kolei");
  s = must(s, "u_kier", "eudr.dds.save", { id: p.res.dds.id, step: 1 }).s;
  assert.ok(R.byId(s.eudrDds, p.res.dds.id).history.length === 2);
  // ocena partii nie uwzględnia DDS testowego
  assert.ok(E.evaluate(s, R.byId(s.eudrLots, lot.id), { today: BEFORE }).warnings.some(w => /testowe/.test(w)));
  const t = E.localTest(s, "separation");
  assert.equal(t.status, "OK");
});

test("podział, łączenie, przetworzenie, MM — pochodzenie zachowane, saldo partii", () => {
  let s = base();
  const a = must(s, "u_kier", "eudr.lot.save", lotArgs()); s = a.s;
  const b = must(s, "u_kier", "eudr.lot.save", lotArgs({ qty: "30", wood: { species: "Świerk", speciesLatin: "Picea abies", cn: "4401", country: "PL" }, origin: { owner: "INNY", country: "PL", lat: "50.3", lon: "18.4" } })); s = b.s;
  const sp = must(s, "u_mag", "eudr.lot.split", { id: a.res.lot.id, parts: [{ qty: "20" }, { qty: "10" }] }); s = sp.s;
  assert.equal(E.balance(R.byId(s.eudrLots, a.res.lot.id)), 20);
  assert.equal(run(s, "u_mag", "eudr.lot.split", { id: a.res.lot.id, parts: [{ qty: "25" }] }).res.ok, false);
  const m = must(s, "u_mag", "eudr.lot.merge", { ids: [sp.res.children[0].id, b.res.lot.id] }); s = m.s;
  assert.equal(m.res.lot.qty, 50);
  const org = E.origins(s, m.res.lot);
  assert.deepEqual(org.map(o => o.origin.owner).sort(), ["INNY", "PRZYKŁAD"]);
  const pr = must(s, "u_mag", "eudr.lot.process", { inputs: [{ lotId: m.res.lot.id, qty: "50" }], productId: "pr_zr_lesna", qty: "200" }); s = pr.s;
  const tr = E.trace(s, pr.res.lot.id);
  assert.equal(tr.origins.length, 2);
  assert.ok(tr.up.length >= 3);
  assert.equal(E.balance(R.byId(s.eudrLots, m.res.lot.id)), 0);
  // MM częściowe → partia pochodna w magazynie docelowym
  const mm = s.operations.find(o => o.type === "MM");
  const lk = must(s, "u_kier", "eudr.lot.link", { lotId: pr.res.lot.id, kind: "MM", opId: mm.id, qty: "50" }); s = lk.s;
  assert.ok(lk.res.child && lk.res.child.parents[0].lotId === pr.res.lot.id);
  assert.equal(E.origins(s, lk.res.child).length, 2);
  // wycofanie powiązania zostawia ślad
  const un = must(s, "u_kier", "eudr.lot.unlink", { lotId: pr.res.lot.id, linkId: lk.res.lot.links.slice(-1)[0].id, reason: "błędna ilość" }); s = un.s;
  assert.equal(E.balance(R.byId(s.eudrLots, pr.res.lot.id)), 200);
  assert.equal(R.byId(s.eudrLots, lk.res.child.id).status, "ARCHIVED");
});

test("GeoJSON: WGS84, 6 miejsc, wielokąt zamknięty bez otworów; działka > 4 ha wymaga wielokąta", () => {
  const ok = { type: "Polygon", coordinates: [[[18.1, 50.1], [18.2, 50.1], [18.2, 50.2], [18.1, 50.1]]] };
  assert.equal(E.checkGeo(ok).ok, true);
  assert.equal(E.checkGeo({ type: "Point", coordinates: [18.1234567, 50.1] }).ok, false);
  assert.equal(E.checkGeo({ type: "Point", coordinates: [50.1, 95] }).ok, false);
  assert.equal(E.checkGeo({ type: "LineString", coordinates: [[1, 2], [3, 4]] }).ok, false);
  assert.equal(E.checkGeo({ type: "Polygon", coordinates: [ok.coordinates[0], ok.coordinates[0]] }).ok, false, "otwór");
  assert.equal(E.checkGeo("{zly").ok, false);
  let s = base();
  const big = run(s, "u_kier", "eudr.lot.save", lotArgs({ origin: { lat: "50.1", lon: "18.2", areaHa: "6", country: "PL" }, submit: true }));
  assert.ok(E.evaluate(big.s, big.res.lot, { today: BEFORE }).missing.some(m => /wielokąt/.test(m)));
  assert.equal(run(s, "u_kier", "eudr.lot.save", lotArgs({ origin: { geojson: "{\"type\":\"Point\",\"coordinates\":[1,2,3.12345678]}" } })).res.ok, true, "trzecia współrzędna ignorowana");
  assert.equal(run(s, "u_kier", "eudr.lot.save", lotArgs({ origin: { geojson: "{\"type\":\"Point\"}" } })).res.ok, false);
});

test("dokumenty: rodzaje, wersje pliku, weryfikacja, archiwizacja; uprawnienia ról", () => {
  let s = base();
  const lot = s.eudrLots[0];
  assert.equal(run(s, "u_view", "eudr.doc.save", { type: "invoice", lotIds: [lot.id], file: docFile(1) }).res.code, "FORBIDDEN");
  assert.equal(run(s, "u_mag", "eudr.doc.save", { type: "invoice", lotIds: [lot.id], file: Object.assign(docFile(1), { type: "application/x-msdownload" }) }).res.ok, false);
  const d = must(s, "u_mag", "eudr.doc.save", { type: "invoice", lotIds: [lot.id], file: docFile(1), number: "FV/1" }); s = d.s;
  s = must(s, "u_aud", "eudr.doc.verify", { id: d.res.doc.id, status: "VERIFIED" }).s;
  const v2 = must(s, "u_mag", "eudr.doc.save", { id: d.res.doc.id, file: docFile(2) }); s = v2.s;
  assert.equal(v2.res.doc.versions.length, 2); assert.equal(v2.res.doc.status, "NEW", "nowa wersja wymaga ponownego sprawdzenia");
  assert.equal(run(s, "u_mag", "eudr.doc.verify", { id: d.res.doc.id, status: "VERIFIED" }).res.code, "FORBIDDEN");
  assert.equal(run(s, "u_aud", "eudr.doc.verify", { id: d.res.doc.id, status: "REJECTED" }).res.ok, false, "powód odrzucenia");
  s = must(s, "u_kier", "eudr.doc.verify", { id: d.res.doc.id, status: "ARCHIVED", note: "duplikat" }).s;
  assert.equal(E.docsOfLot(s, lot.id).length, 0);
  // dostawca: rozszerzenie kartoteki — nie można dodać dostawcy spoza kontrahentów
  assert.equal(run(s, "u_kier", "eudr.supplier.save", { partnerId: "brak" }).res.ok, false);
  assert.equal(run(s, "u_kier", "eudr.supplier.save", { partnerId: "pa_lander", status: "VERIFIED" }).res.ok, false, "opis weryfikacji");
  const sp = must(s, "u_kier", "eudr.supplier.save", { partnerId: "pa_lander", role: "trader", status: "VERIFIED", verifyNote: "Sprawdzono KRS i oświadczenie" });
  assert.equal(sp.s.eudrSuppliers.filter(x => x.partnerId === "pa_lander").length, 1);
});

test("archiwizacja zamiast usuwania; usunąć można tylko szkic bez powiązań; dziennik nietknięty", () => {
  let s = base();
  const a = must(s, "u_kier", "eudr.lot.save", lotArgs()); s = a.s;
  const audits = s.audit.length;
  assert.equal(run(s, "u_mag", "eudr.lot.archive", { id: a.res.lot.id, reason: "test" }).res.code, "FORBIDDEN");
  const linked = s.eudrLots.find(l => l.receipt);
  assert.equal(run(s, "u_kier", "eudr.lot.archive", { id: linked.id, action: "delete" }).res.ok, false);
  s = must(s, "u_kier", "eudr.lot.archive", { id: linked.id, reason: "koniec sezonu" }).s;
  assert.equal(R.byId(s.eudrLots, linked.id).status, "ARCHIVED");
  assert.equal(E.evaluate(s, R.byId(s.eudrLots, linked.id), {}).color, "grey");
  s = must(s, "u_kier", "eudr.lot.archive", { id: linked.id, action: "restore" }).s;
  s = must(s, "u_kier", "eudr.lot.archive", { id: a.res.lot.id, action: "delete" }).s;
  assert.ok(!R.byId(s.eudrLots, a.res.lot.id));
  assert.ok(s.audit.length >= audits + 3, "każda czynność w dzienniku");
});

test("audyt: 13 obszarów, wynik procentowy, zamknięcie wymaga ocen, zaleceń i terminu; zamkniętego się nie zmienia", () => {
  let s = base();
  assert.equal(E.AUDIT_AREAS.length, 13);
  const a = must(s, "u_aud", "eudr.audit.save", { date: BEFORE }); s = a.s;
  const id = a.res.audit.id;
  assert.equal(run(s, "u_aud", "eudr.audit.save", { id, close: true }).res.ok, false);
  const areas = E.AUDIT_AREAS.map((x, i) => ({ key: x.key, status: i === 0 ? "NC" : i === 1 ? "PARTIAL" : i === 2 ? "NA" : "OK" }));
  const noRec = run(s, "u_aud", "eudr.audit.save", { id, areas, nextDate: "2027-05-01", close: true });
  assert.equal(noRec.res.ok, false);
  areas[0].recs = "Ustalić rolę dla importu"; areas[0].due = "2026-12-01"; areas[1].recs = "Uzupełnić partie"; areas[1].due = "2026-12-15";
  const c = must(s, "u_aud", "eudr.audit.save", { id, areas, nextDate: "2027-05-01", close: true }); s = c.s;
  assert.equal(c.res.audit.status, "CLOSED");
  assert.equal(c.res.audit.score.pct, Math.round((10 + 0.5) / 12 * 100));
  assert.ok(c.res.audit.hints.training);
  assert.equal(run(s, "u_aud", "eudr.audit.save", { id, summary: "zmiana" }).res.ok, false);
  assert.equal(run(s, "u_mag", "eudr.audit.save", { date: BEFORE }).res.code, "FORBIDDEN");
});

test("szkolenia: przydział, lekcje, test oceniany przez silnik, potwierdzenie wewnętrzne, ćwiczenie bez wpisu DDS", () => {
  let s = base();
  const C = E.content();
  assert.equal(C.modules.length, 5); assert.equal(C.guides.length, 11); assert.equal(C.scenarios.length, 4);
  for (const m of C.modules) for (const q of m.quiz) assert.ok(q.a >= 0 && q.a < q.o.length);
  assert.equal(run(s, "u_mag", "eudr.train.assign", { userId: "u_mag", moduleKey: "basics" }).res.code, "FORBIDDEN");
  const a = must(s, "u_kier", "eudr.train.assign", { userId: "u_mag", moduleKey: "basics", due: "2026-12-01" }); s = a.s;
  const id = a.res.training.id, m = E.moduleOf("basics");
  assert.equal(run(s, "u_mag", "eudr.train.quiz", { id, answers: m.quiz.map(q => q.a) }).res.ok, false, "najpierw lekcje");
  for (let i = 0; i < m.lessons.length; i++) s = must(s, "u_mag", "eudr.train.lesson", { id, lesson: i }).s;
  const bad = must(s, "u_mag", "eudr.train.quiz", { id, answers: m.quiz.map(q => (q.a + 1) % q.o.length) });
  assert.equal(bad.res.passed, false); s = bad.s;
  assert.equal(run(s, "u_kier", "eudr.train.confirm", { id }).res.ok, false);
  const good = must(s, "u_mag", "eudr.train.quiz", { id, answers: m.quiz.map(q => q.a) }); s = good.s;
  assert.equal(good.res.score, 100);
  s = must(s, "u_kier", "eudr.train.confirm", { id }).s;
  assert.match(R.byId(s.eudrTraining, id).certNo, /^SZK-EUDR\//);
  // ćwiczenia w module praktycznym — wynik przy szkoleniu, numer SYM-, rejestr DDS bez zmian
  s = must(s, "u_kier", "eudr.train.assign", { userId: "u_mag", moduleKey: "practice" }).s;
  const dds = s.eudrDds.length;
  const ex = must(s, "u_mag", "eudr.train.exercise", { scenario: "upstream", answers: { role: "DOWNSTREAM_FIRST", ref: "DDS" } });
  assert.equal(ex.res.passed, true); assert.match(ex.res.simRef, /^SYM-/);
  assert.equal(ex.s.eudrDds.length, dds);
  // widok magazyniera: tylko własne szkolenia
  const v = Service.project(s, R.byId(s.users, "u_bra"));
  assert.ok(v.eudrTraining.every(x => x.userId === "u_bra"));
});

test("uprawnienia i izolacja: podgląd bez zmian, partie innego magazynu niewidoczne, role EUDR nadawane przez administratora", () => {
  let s = base();
  assert.equal(run(s, "u_view", "eudr.lot.save", lotArgs()).res.code, "FORBIDDEN");
  assert.equal(E.roleOf(s, R.byId(s.users, "u_view")), "viewer");
  assert.equal(run(s, "u_kier", "eudr.access.set", { userId: "u_view", role: "controller" }).res.code, "FORBIDDEN");
  s = must(s, "u_admin", "eudr.access.set", { userId: "u_view", role: "warehouse" }).s;
  assert.equal(run(s, "u_view", "eudr.lot.save", lotArgs()).res.ok, true);
  s = must(s, "u_admin", "eudr.access.set", { userId: "u_mag", role: "none" }).s;
  assert.equal(run(s, "u_mag", "eudr.lot.save", lotArgs()).res.code, "FORBIDDEN");
  const v = Service.project(s, R.byId(s.users, "u_bra"));
  assert.equal(v.eudrLots.filter(l => l.whId === "wh_zab").length, 0);
  assert.equal(run(s, "u_bra", "eudr.lot.save", lotArgs()).res.ok, false);
  const d = E.dashboard(s, R.byId(s.users, "u_kier"), { today: BEFORE });
  assert.ok(d.kpi.lots >= 3 && typeof d.kpi.withRef === "number" && Array.isArray(d.alerts));
});

test("zestaw danych DDS: komunikat SubmitDdsRequest bez danych dostępowych, GeoJSON zbiorczy", () => {
  let s = base();
  const a = must(s, "u_kier", "eudr.lot.save", lotArgs()); s = a.s;
  const ds = E.dataset(s, [a.res.lot.id], { now: "2026-11-10T08:00:00Z" });
  assert.deepEqual(ds.errors, []);
  assert.equal(ds.commodities[0].hsHeading, "4401"); assert.equal(ds.commodities[0].netWeightKg, 47000);
  const xml = E.submitXml(ds);
  assert.match(xml, /<dds:SubmitDdsRequest>.*<dds:scientificName>Pinus sylvestris<\/dds:scientificName>/);
  assert.match(xml, /<eudrCommon:supplementaryUnitQualifier>MTQ<\/eudrCommon:supplementaryUnitQualifier>/);
  assert.doesNotMatch(xml, /Security|Password|Username/);
  const geo = JSON.parse(Buffer.from(/<dds:geometryGeojson>([^<]+)</.exec(xml)[1], "base64").toString());
  assert.equal(geo.features[0].geometry.type, "Point");
  assert.equal(E.datasetGeo(ds).features.length, 1);
  assert.ok(E.dataset(s, [s.eudrLots.find(l => !l.wood.speciesLatin).id]).errors.length > 0);
});
