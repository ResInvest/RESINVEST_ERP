/* Testy silnika (bez przeglądarki): zestawienia pulpitu (TradeStats) i moduł EUDR — na kodzie z ZBUDOWANEGO pliku demo.
   Uruchomienie: node --test tests/  (wymaga wcześniej: node tools/build.mjs) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, sample, ctxOf } from "./harness.mjs";

const ctx = loadEngine();
const R = ctx.RIW, TS = R.TradeStats, E = R.EUDR;
const fresh = () => sample(ctx, "2026-10-28");
const S0 = fresh();
// wyniki z kontekstu vm mają prototypy z innego „realm” — porównanie po serializacji
const same = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, msg);
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const opByNo = (s, no) => s.operations.find(o => o.no === no);
const findOp = (s, pred) => s.operations.find(o => TS.isLive(o) && pred(o));
const exec = (s, cmd, args, uid) => R.Service.run(s, cmd, args, ctxOf(s, uid));

/* ---------------- zestawienia pulpitu ---------------- */
test("przeliczenia: drewno m³ → MP i t; zrębka MP → ekwiwalent m³; PKS bez MP i m³", () => {
  const cfg = S0.config;
  const w = TS.measures(S0, "pr_drewno", 10, "m3");
  close(w.mp, 10 * cfg.m3_mp); close(w.m3, 10); close(w.t, 10 * cfg.woodTPerM3);
  const c = TS.measures(S0, "pr_zr_lesna", 100, "MP");
  close(c.m3, 100 / cfg.m3_mp); close(c.t, 100 * cfg.mp_t);
  const p = TS.measures(S0, "pr_pks", 24, "t");
  assert.equal(p.mp, null); assert.equal(p.m3, null); close(p.t, 24);
});

test("sumy: miara bez przelicznika oznacza sumę jako niepełną, nie jako zero", () => {
  const s = TS.totals([{ m3: 1, mp: 4, t: 0.5, value: 10 }, { m3: null, mp: null, t: 24, value: 5 }]);
  close(s.mp, 4); close(s.t, 24.5); assert.equal(s.partial.mp, true); assert.equal(s.partial.t, false); close(s.value, 15);
});

test("pulpit października: grupy sumują się do całości; lasy = tylko nadleśnictwa; firmy bez nadleśnictw", () => {
  const d = TS.dashboard(S0, "2026-10", { whIds: ["wh_zab"] });
  for (const k of ["firms", "forest", "sales"]) {
    const g = d[k].groups.reduce((a, x) => ({ c: a.c + x.sum.count, t: a.t + x.sum.t }), { c: 0, t: 0 });
    assert.equal(g.c, d[k].sum.count, k); close(g.t, d[k].sum.t, 1e-4);
  }
  assert.ok(d.forest.rows.length >= 5 && d.forest.rows.every(r => r.kind === "nadlesnictwo"));
  assert.ok(d.firms.rows.every(r => r.kind !== "nadlesnictwo"));
  const rr = d.forest.groups.find(g => g.label === "Nadleśnictwo Rudy Raciborskie");
  same(rr.groups.map(x => x.label).sort(), ["Kuźnia", "Stanica"]);
  assert.equal(d.register.length, 6); assert.equal(d.register[5].ym, "2026-10");
  assert.equal(d.register[5].sales.count, d.sales.sum.count);
});

test("sprzedaż: waga z kwitu ma pierwszeństwo, miejsce dostawy i rodzaj transakcji", () => {
  const rows = TS.sales(S0, { from: "2026-10-01", to: "2026-10-31" });
  const ec = rows.find(r => r.buyerName === "Elektrociepłownia Zabrze S.A." && r.date === "2026-10-05");
  assert.equal(ec.tSource, "waga"); close(ec.t, 57.4); assert.equal(ec.mode, "WZ"); assert.match(ec.place, /Zabrze/);
  const chain = rows.find(r => r.mode === "LANCUCH");
  assert.ok(chain, "łańcuch zakup → produkcja → odbiorca"); assert.equal(chain.tSource, "waga"); close(chain.t, 31.8 + 32.9, 1e-6);
  const auto = rows.find(r => r.buyerName === "Ciepłownia Gliwice" && r.mode === "WZ");
  assert.equal(auto.tSource, "przelicznik");
});

test("anulowanie dokumentu usuwa transakcję z zestawień i z rejestru EUDR", () => {
  const s = fresh(), op = findOp(s, o => o.type === "SPRZEDAZ" && !o.direct && o.date === "2026-10-16");
  const before = TS.sales(s, { from: "2026-10-01", to: "2026-10-31" }).length;
  const r = R.cancelOperation(s, op.id, ctxOf(s, "u_admin"), "test anulowania", { ack: true });
  assert.ok(r.ok, r.error);
  assert.equal(TS.sales(s, { from: "2026-10-01", to: "2026-10-31" }).length, before - 1);
  assert.ok(!E.register(s, { from: "2026-10-01", to: "2026-10-31" }).some(x => x.opId === op.id));
});

/* ---------------- EUDR: ocena ---------------- */
test("rola ResInvest: nadleśnictwo → pierwszy handlowiec / podmiot dalszy; wycinka → operator; firma → dalszy", () => {
  const reg = E.register(S0, { from: "2026-10-01", to: "2026-10-31", side: "IN" });
  const by = n => reg.find(r => r.partnerName.startsWith(n));
  assert.equal(by("Nadleśnictwo Gliwice").role, "FIRST_TRADER");
  assert.equal(by("Nadleśnictwo Brynek").role, "FIRST_DOWNSTREAM");      // zakup z rąbaniem
  assert.equal(by("Zarząd Dróg").role, "OPERATOR");
  assert.equal(by("Eko-Las").role, "DOWNSTREAM");
  assert.equal(by("Eko-Las").status, "UWAGI");
  assert.equal(by("Nadleśnictwo Kędzierzyn").status, "BRAKI");
  assert.equal(by("Gospodarstwo Leśne").status, "OK");                   // identyfikator deklaracji uproszczonej w profilu
  assert.equal(by("Biomass Trading").status, "POZA");                     // PKS — do weryfikacji kodu CN
  assert.ok(by("Biomass Trading").checks.some(c => c.code === "CN"));
});

test("operator: wymagane własne DDS, gatunek, okres, działki, dokumenty legalności", () => {
  const s = fresh(), ev = E.register(s, { from: "2026-10-01", to: "2026-10-31", side: "IN" }).find(r => r.role === "OPERATOR");
  same(ev.checks.filter(c => c.lvl === "err").map(c => c.code).sort(), ["LEGAL", "OWN_DDS"]);
  const rec = Object.assign({}, E.record(s, ev.opId), { docs: ["Decyzja — zezwolenie"], ownDds: { ref: "26PLRIC0000099", status: "SUBMITTED" } });
  delete rec.history;
  const r = exec(s, "eudr.record.save", { opId: ev.opId, rec }, "u_kier");
  assert.ok(r.res.ok, r.res.error);
  assert.equal(E.evaluateInput(r.state, opByNo(r.state, ev.no)).status, "OK");
  const dds = E.ddsDraft(r.state, ev.opId);
  assert.equal(dds.commodities[0].producers[0].geometryGeojson.features[0].geometry.type, "Polygon");
});

test("sprzedaż ze stanu: numery z puli magazynu; uzupełnienie numeru u źródła trafia do sprzedaży", () => {
  const s = fresh();
  const sale = findOp(s, o => o.type === "SPRZEDAZ" && !o.direct && !o.purchase && o.date === "2026-10-26");
  const ev = E.evaluateSale(s, sale);
  assert.equal(ev.trace.method, "POOL"); assert.ok(ev.refs.length >= 1);
  assert.ok(ev.trace.sources.every(x => x.date <= sale.date));
  const direct = findOp(s, o => o.type === "SPRZEDAZ" && o.direct);
  const evd = E.evaluateSale(s, direct);
  assert.equal(evd.trace.method, "OP"); assert.equal(evd.status, "OK");
});

test("łańcuch zakup → sprzedaż w jednej transakcji nie zasila puli magazynu", () => {
  const chain = findOp(S0, o => o.purchase && o.sale && !o.direct && o.date === "2026-10-14");
  const later = findOp(S0, o => o.type === "SPRZEDAZ" && !o.purchase && o.date === "2026-10-16");
  const P = E.poolSources(S0, later.whId, later.sale.productId, later.date, 90);
  assert.ok(!P.src.has(chain.id));
});

/* ---------------- EUDR: komendy, walidacja, uprawnienia ---------------- */
test("walidacja numerów i dat: błędny znak, okres po dacie transakcji, nieznana działka — nic nie zapisano", () => {
  const s = fresh(), op = findOp(s, o => o.purchase && o.purchase.supplierId === "pa_ndl_kk" && o.date >= "2026-10-01");
  const rev = s.rev;
  for (const rec of [{ refs: [{ ref: "ZŁY NR!" }] }, { refs: [{ ref: "26PLAB12345678" }], harvestTo: "2027-01-01" }, { plotIds: ["brak"] }, { geojson: '{"type":"Polygon","coordinates":[[[1,1],[2,2],[3,3]]]}' }]) {
    const r = exec(s, "eudr.record.save", { opId: op.id, rec }, "u_kier");
    assert.equal(r.res.ok, false); assert.equal(r.state, null);
  }
  assert.equal(s.rev, rev);
  const ok = exec(s, "eudr.record.save", { opId: op.id, rec: { refs: [{ ref: " 26plkk 0000 1234 ", ver: "kx4p" }, { ref: "26PLKK00001234" }] } }, "u_mag");
  assert.ok(ok.res.ok, ok.res.error);
  same(ok.res.rec.refs.map(x => x.ref), ["26PLKK00001234"]);           // normalizacja i bez duplikatów
  assert.equal(E.evaluateInput(ok.state, opByNo(ok.state, op.no)).status, "UWAGI"); // tylko: profil niezweryfikowany
  assert.ok(ok.state.audit.some(a => a.entity === "eudr" && a.opNo === op.no));
});

test("uprawnienia: obserwator nie zapisuje; magazynier — numery tak, profile dostawców nie", () => {
  const s = fresh(), op = findOp(s, o => o.purchase && o.whId === "wh_zab" && o.date >= "2026-10-01");
  assert.equal(exec(s, "eudr.record.save", { opId: op.id, rec: {} }, "u_view").res.code, "FORBIDDEN");
  assert.ok(exec(s, "eudr.record.save", { opId: op.id, rec: {} }, "u_mag").res.ok);
  assert.equal(exec(s, "eudr.supplier.save", { partnerId: "pa_drwal", rec: { role: "DOWNSTREAM", country: "PL" } }, "u_mag").res.code, "FORBIDDEN");
  assert.equal(exec(s, "eudr.settings.save", { settings: { lookbackDays: 30 } }, "u_mag").res.code, "FORBIDDEN");
  assert.ok(exec(s, "eudr.settings.save", { settings: { lookbackDays: 30 } }, "u_kier").res.ok);
});

test("izolacja magazynów: użytkownik Brąszewic nie zmienia i nie widzi danych EUDR Zabrza", () => {
  const s = fresh(), op = findOp(s, o => o.purchase && o.whId === "wh_zab" && E.record(s, o.id));
  const r = exec(s, "eudr.record.save", { opId: op.id, rec: {} }, "u_bra");
  assert.equal(r.res.ok, false); assert.equal(r.res.code, "FORBIDDEN");
  const view = R.Service.project(s, s.users.find(u => u.id === "u_bra"));
  assert.ok(!view.eudr.records[op.id]);
  assert.ok(Object.keys(view.eudr.records).every(id => view.operations.some(o => o.id === id)));
});

test("import numerów: dopasowanie po numerze dokumentu, raport niedopasowanych, jedna zmiana", () => {
  const s = fresh(), op = findOp(s, o => o.purchase && o.purchase.supplierId === "pa_ekolas" && o.date >= "2026-10-01");
  const r = exec(s, "eudr.refs.import", { rows: [{ docNo: op.no.toLowerCase(), ref: "26PLEKOLAS0007", ver: "EK7Q" }, { docNo: "NIE/1", ref: "26PLXX00000000" }, { docNo: op.no, ref: "!!" }] }, "u_mag");
  assert.ok(r.res.ok, r.res.error);
  assert.equal(r.res.added, 1); same(r.res.unmatched, ["NIE/1"]); assert.equal(r.res.bad.length, 1);
  assert.equal(r.state.rev, s.rev + 1);
});

test("działki: wielokąt > 4 ha, ostrzeżenie dla punktu poza PL, blokada usunięcia działki użytej w transakcji", () => {
  const s = fresh();
  const big = exec(s, "eudr.plot.save", { rec: { address: "test", lat: "50,1", lon: "18,5", areaHa: "6" } }, "u_kier");
  assert.ok(big.res.ok); assert.ok(big.res.warnings.some(w => /4 ha/.test(w)));
  const far = exec(big.state, "eudr.plot.save", { rec: { address: "test2", lat: "18,5", lon: "50,1" } }, "u_kier");
  assert.ok(far.res.warnings.some(w => /poza Polską/.test(w)));
  const used = E.data(s).plots.find(p => p.lesnictwo === "Stanica");
  const rm = exec(s, "eudr.plot.remove", { id: used.id }, "u_kier");
  assert.equal(rm.res.ok, false); assert.match(rm.res.error, /wskazana w transakcjach/);
  assert.equal(E.checkGeometry('{"type":"Point","coordinates":[18.5,50.1]}'), "");
  assert.notEqual(E.checkGeometry("{zły json"), "");
});

test("profil dostawcy: deklaracja uproszczona wymaga identyfikatora; dostawca spoza UE nie może mieć kraju UE", () => {
  const s = fresh();
  assert.equal(exec(s, "eudr.supplier.save", { partnerId: "pa_lander", rec: { role: "MSPO", country: "PL" } }, "u_kier").res.ok, false);
  assert.equal(exec(s, "eudr.supplier.save", { partnerId: "pa_lander", rec: { role: "NON_EU", country: "DE" } }, "u_kier").res.ok, false);
  const r = exec(s, "eudr.supplier.save", { partnerId: "pa_lander", rec: { role: "NON_EU", country: "UA", verified: true } }, "u_kier");
  assert.ok(r.res.ok);
  const ev = E.register(r.state, { from: "2026-10-01", to: "2026-10-31", side: "IN" }).find(x => x.partnerName === "Lander Agro");
  assert.equal(ev.role, "OPERATOR");
});

test("CSV rejestru i GeoJSON działek", () => {
  const rows = E.csvRows(S0, { from: "2026-10-01", to: "2026-10-31" });
  assert.ok(rows.length > 10); assert.ok(rows.every(r => r.length === E.CSV_HEAD.length));
  const g = E.geojson(S0);
  assert.equal(g.type, "FeatureCollection"); assert.equal(g.features.length, E.data(S0).plots.length);
  assert.ok(g.features.every(f => f.geometry && ["Point", "Polygon"].includes(f.geometry.type)));
});

test("dane EUDR przechodzą migrację i kontrolę kształtu (kopia zapasowa / wczytanie)", () => {
  const m = R.migrate(JSON.parse(JSON.stringify(S0)));
  assert.ok(!m.error); same(R.validateStateShape(m.state), []);
  same(Object.keys(m.state.eudr.records).sort(), Object.keys(S0.eudr.records).sort());
});
