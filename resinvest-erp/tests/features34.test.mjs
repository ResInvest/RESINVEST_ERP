/* Testy funkcji wersji 3.4:  node --test tests/features34.test.mjs
   §13–§14 operacje dodatkowe i kartoteka, §15 rębaki firm zewnętrznych, §8 tonaż AUTO/RĘCZNY,
   §10 ręczne numery PZ/WZ i data dokumentu, §11 usuwanie dokumentu (soft delete), §12 eksport XLSX/DOCX,
   §16 zestawienie miesięczne operacji dodatkowych (kafel pulpitu). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const require = createRequire(import.meta.url);
globalThis.RIW_CONFIG = JSON.parse(readFileSync(new URL("../config/app.config.json", import.meta.url), "utf8"));
// testy numeracji według rodzaju dokumentu (PZ, WZ, RW, KOR…) — tryb config.docNumbering = "types"; jedna seria WZ: features38.test.mjs
globalThis.RIW_CONFIG.docNumbering = "types";
require("../app/src/i18n.js");
const R = require("../app/src/engine.js");
require("../app/src/seed.js");
const Office = require("../app/src/office.js");

const TODAY = "2026-09-23";
const fresh = () => R.Seed.build(TODAY);
const U = (s, id) => s.users.find(u => u.id === id);
const ctx = (s, uid = "u_kier", today = TODAY) => ({ user: U(s, uid), today, source: "test" });
const draft = over => R.Seed.draftOf(over.date || TODAY, Object.assign({ transport: { mode: "none", place: "RiC Zabrze" } }, over));
const bal = (s, pid, wh = "wh_zab") => R.Stock.balance(s, wh, pid);
const commit = (s, d, c) => { const r = R.commitOperation(s, d, c || ctx(s)); assert.equal(r.ok, true, r.error); return r.op; };
const PROD = (over = {}, extras) => {
  const d = draft(Object.assign({ type: "PRODUKCJA", production: { rawProductId: "pr_drewno", outProductId: "pr_zr_lesna", outQty: "100" } }, extras ? { extras: extras.items } : {}, over));
  if (extras) d.extras.enabled = extras.enabled;
  return d;
};
const WZ = (sale = {}, over = {}) => draft(Object.assign({ type: "SPRZEDAZ", sale: Object.assign({ productId: "pr_zr_lesna", qty: "60", unit: "MP", buyerId: "pa_ec_zab", price: "90" }, sale) }, over));
const PZ = (over = {}) => draft(Object.assign({ purchase: { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: "20", unit: "m3", price: "230", weightMode: "auto" } }, over));
const docOf = (op, type) => op.documents.find(d => d.type === type);

/* ------------------------------ §13–§14 operacje dodatkowe ------------------------------ */
test("§14: kartoteka „Dodatkowe operacje” jest w bazie (nie w kodzie) — domyślne rodzaje, pola, edycja i dezaktywacja", () => {
  const s = fresh();
  assert.ok(Array.isArray(s.extraTypes) && s.extraTypes.length >= 5);
  const x = s.extraTypes.find(e => e.id === "xt_holowanie");
  for (const f of ["id", "name", "desc", "active", "unit", "rate", "createdAt", "updatedAt"]) assert.ok(f in x, `pole ${f}`);
  const add = R.Master.save(s, "extraTypes", { name: "Ważenie kontrolne", desc: "Dodatkowe ważenie", unit: "", rate: "120", active: true }, ctx(s));
  assert.equal(add.ok, true, add.error);
  assert.equal(add.rec.rate, 120);
  assert.ok(add.rec.createdAt && add.rec.updatedAt);
  assert.equal(R.Master.save(s, "extraTypes", { name: "X", rate: "-5" }, ctx(s)).ok, false, "ujemna stawka odrzucona");
  assert.match(R.Master.save(s, "extraTypes", { name: "Y" }, ctx(s, "u_mag")).error, /Kierownik lub Administrator/);
  const off = R.Master.save(s, "extraTypes", { id: add.rec.id, active: false }, ctx(s));
  assert.equal(off.ok, true, off.error);
  assert.equal(off.rec.active, false);
});

test("§13: produkcja z operacjami dodatkowymi — osobne rekordy powiązane z operacją, koszt obniża wynik, stan bez zmian", () => {
  const s = fresh(), m3 = bal(s, "pr_drewno"), mp = bal(s, "pr_zr_lesna");
  const op = commit(s, PROD({}, { enabled: true, items: [
    { typeId: "xt_holowanie", vehicleId: "ve_scania", qty: "", rate: "", cost: "500", desc: "Holowanie rębaka" },
    { typeId: "xt_ladowarka", vehicleId: "", qty: "2", rate: "", cost: "", desc: "" }
  ] }));
  assert.equal(op.extras.length, 2);
  for (const x of op.extras) { assert.equal(x.opId, op.id); assert.match(x.id, /^xo_/); }
  const tow = op.extras.find(x => x.typeId === "xt_holowanie"), load = op.extras.find(x => x.typeId === "xt_ladowarka");
  assert.equal(tow.cost, 500);
  assert.ok(tow.vehicleName, "pojazd z floty zapisany opisowo");
  assert.equal(load.cost, 320, "2 h × stawka domyślna 160 zł");
  assert.equal(op.totals.extraCost, 820);
  assert.equal(bal(s, "pr_drewno"), m3 - 25, "zużycie liczone jak bez operacji dodatkowych");
  assert.equal(bal(s, "pr_zr_lesna"), mp + 100);
  const plain = R.planOperation(fresh(), PROD(), ctx(s)).totals;
  assert.equal(R.round(plain.result - op.totals.result, 2), 820, "wynik niższy o koszt operacji dodatkowych");
});

test("§13: walidacja operacji dodatkowych — rodzaj wymagany, koszt albo ilość × stawka, rodzaj nieaktywny, limit pozycji", () => {
  const s = fresh();
  const err = items => R.planOperation(s, PROD({}, { enabled: true, items }), ctx(s)).errors;
  assert.ok(Object.keys(err([{ typeId: "", cost: "100" }])).some(k => k.startsWith("extras")));
  assert.ok(Object.keys(err([{ typeId: "xt_holowanie", cost: "" }])).some(k => k.startsWith("extras")), "holowanie bez stawki — trzeba podać kwotę");
  assert.ok(Object.keys(err([{ typeId: "xt_holowanie", cost: "-1" }])).some(k => k.startsWith("extras")));
  R.Master.save(s, "extraTypes", { id: "xt_plac", active: false }, ctx(s));
  assert.ok(Object.values(err([{ typeId: "xt_plac", cost: "100" }])).some(v => /nieaktywny/.test(v)));
  const many = Array.from({ length: R.MAX_EXTRAS + 1 }, () => ({ typeId: "xt_holowanie", cost: "1" }));
  assert.ok(Object.values(err(many)).some(v => /Maksymalnie/.test(v)));
  const sale = R.planOperation(s, WZ({}, { extras: [{ typeId: "xt_holowanie", cost: "10" }] }), ctx(s));
  assert.deepEqual(sale.errors, {}, "operacje dodatkowe dozwolone także w sprzedaży z magazynu");
  const off = R.planOperation(s, PROD({}, { enabled: false, items: [{ typeId: "", cost: "" }] }), ctx(s));
  assert.deepEqual(off.errors, {}, "odznaczony checkbox — pozycje ignorowane");
});

test("§13–§14: rodzaju użytego w dokumencie nie da się usunąć z kartoteki; korekta zmienia koszt (BYŁO/JEST)", () => {
  const s = fresh();
  const op = commit(s, PROD({}, { enabled: true, items: [{ typeId: "xt_holowanie", cost: "500" }] }));
  assert.match(R.Master.remove(s, "extraTypes", "xt_holowanie", ctx(s)).error, /nieaktywny/);
  const next = R.clone(op.input); next.extras.items[0].cost = "650";
  const r = R.correctOperation(s, op.id, next, "faktura za holowanie — błąd kwoty", ctx(s));
  assert.equal(r.ok, true, r.error);
  assert.equal(op.totals.extraCost, 650);
  const c = op.corrections[op.corrections.length - 1];
  assert.ok(c.changes.some(ch => /extras/.test(ch.field)), "zmiana operacji dodatkowych widoczna w korekcie");
});

test("3.4.1: operacje dodatkowe w każdej operacji — zakup (PZ), sprzedaż (WZ), MM; zestawienie wskazuje dokument główny", () => {
  const s = fresh();
  const X = [{ typeId: "xt_holowanie", cost: "200", desc: "rozładunek" }];
  const pz = commit(s, PZ({ extras: X }));
  const wz = commit(s, WZ({}, { extras: X }));
  const mm = commit(s, draft({ type: "MM", mm: { productId: "pr_zr_lesna", qty: "30", unit: "MP", toWhId: "wh_bra" }, transport: { mode: "none", place: "RiC Brąszewice" }, extras: X }));
  for (const op of [pz, wz, mm]) { assert.equal(op.extras.length, 1, op.type); assert.equal(op.totals.extraCost, 200); assert.equal(op.extras[0].opId, op.id); }
  const rep = R.Reports.extras(s, "2026-09-01", "2026-09-30", "wh_zab");
  assert.equal(rep.rows.find(r => r.opId === pz.id).docNo, docOf(pz, "PZ").no);
  assert.equal(rep.rows.find(r => r.opId === wz.id).docNo, docOf(wz, "WZ").no);
  assert.equal(rep.rows.find(r => r.opId === mm.id).docNo, docOf(mm, "MM").no);
});

test("3.4.1: numeracja z listy — automatyczna ignoruje wpisany numer; ręczna wymaga numeru; MM z numerem ręcznym", () => {
  const s = fresh();
  const auto = PZ({ docNos: { PZ: "PZ/500" } }); auto.docNoMode.PZ = "auto";
  const a = commit(s, auto);
  assert.notEqual(docOf(a, "PZ").no, "PZ/500", "tryb automatyczny — numer z licznika");
  assert.ok(!docOf(a, "PZ").manualNo);
  const man = PZ(); man.docNoMode.PZ = "manual";
  assert.ok(R.planOperation(s, man, ctx(s)).errors["docNos.PZ"], "tryb ręczny bez numeru — błąd");
  const bad = PZ(); bad.docNoMode.PZ = "xyz";
  assert.ok(R.planOperation(s, bad, ctx(s)).errors["docNoMode.PZ"]);
  const MMd = no => { const d = draft({ type: "MM", mm: { productId: "pr_zr_lesna", qty: "10", unit: "MP", toWhId: "wh_bra" }, transport: { mode: "none", place: "RiC Brąszewice" }, docNos: { MM: no } }); return d; };
  const m = commit(s, MMd("MM/5/2026"));
  assert.equal(docOf(m, "MM").no, "MM/5/2026");
  assert.equal(docOf(m, "MM").manualNo, "MM/5/2026");
  assert.ok(Object.values(R.planOperation(s, MMd("mm/5/2026"), ctx(s)).errors).some(v => /już użyty/.test(v)), "duplikat numeru MM w magazynie źródłowym");
  assert.equal(R.docNoModeOf({ docNos: { WZ: "WZ/1" } }, "WZ"), "manual", "starsze szkice: wpisany numer = ręczny");
  assert.equal(R.docNoModeOf({ docNos: { WZ: "" } }, "WZ"), "auto");
});

/* ----------------------------------- §16 kafel / raport ----------------------------------- */
test("§16: zestawienie miesięczne operacji dodatkowych — koszt łączny, liczba, lista z datą, rodzajem, pojazdem, magazynem, dokumentem", () => {
  const s = fresh();
  const base = R.Reports.extras(s, "2026-09-01", "2026-09-30", "wh_zab");
  const op = commit(s, PROD({}, { enabled: true, items: [{ typeId: "xt_holowanie", vehicleId: "ve_scania", cost: "300" }] }));
  const rep = R.Reports.extras(s, "2026-09-01", "2026-09-30", "wh_zab");
  assert.equal(rep.count, base.count + 1);
  assert.equal(R.round(rep.cost - base.cost, 2), 300);
  const row = rep.rows.find(r => r.opId === op.id);
  for (const f of ["date", "typeName", "vehicleName", "whName", "docNo", "cost"]) assert.ok(row[f] !== undefined && row[f] !== "", `kolumna ${f}`);
  assert.equal(row.docNo, docOf(op, "PW").no, "powiązany dokument produkcji");
  assert.equal(R.Reports.extras(s, "2026-08-01", "2026-08-31", "wh_zab").rows.some(r => r.opId === op.id), false, "inny miesiąc — bez tej pozycji");
  const biz = R.Reports.business(s, { mode: "month", from: "2026-09-01", to: "2026-09-30", whId: "wh_zab" });
  assert.equal(biz.extras.cost, rep.cost, "raport miesięczny = kafel pulpitu");
  R.cancelOperation(s, op.id, ctx(s), "pomyłka");
  assert.equal(R.Reports.extras(s, "2026-09-01", "2026-09-30", "wh_zab").cost, base.cost, "anulowana operacja nie liczy się do kosztów");
});

/* ------------------------------ §15 rębaki firm zewnętrznych ------------------------------ */
test("§15: rębak firmy zewnętrznej — kartoteka (firma, nr rej., operator opisowo) i produkcja bez operatora z floty", () => {
  const s = fresh();
  const bad = R.Fleet.save(s, "chippers", { name: "Jensen", owner: "external", company: "", status: "aktywny" }, ctx(s));
  assert.equal(bad.ok, false);
  const ok = R.Fleet.save(s, "chippers", { name: "Jenz HEM 583", owner: "external", company: "Usługi Rębakowe Las", reg: "sk 12345", operatorName: "Jan Las", status: "aktywny", operatorId: "op_mazur" }, ctx(s));
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.rec.reg, "SK 12345");
  assert.equal(ok.rec.operatorId, "", "rębak zewnętrzny nie ma operatora z floty");
  const op = commit(s, PROD({ production: { rawProductId: "pr_drewno", outProductId: "pr_zr_lesna", outQty: "50", chipperId: ok.rec.id, chipRate: "12" } }));
  assert.equal(op.production.chipperOwner || (s.fleet.chippers.find(c => c.id === op.production.chipperId) || {}).owner, "external");
  assert.match(JSON.stringify(op.production), /Jan Las/, "operator firmy zewnętrznej zapisany na dokumencie");
  assert.equal(op.totals.chippingCost, 600);
});

/* --------------------------------- §8 tonaż AUTO / RĘCZNY --------------------------------- */
test("§8: sprzedaż — tonaż AUTO z przelicznika albo RĘCZNY z wagi, źródło zapisane na WZ i w raporcie", () => {
  const s = fresh();
  const auto = commit(s, WZ());
  assert.equal(auto.sale.weightMode, "auto");
  assert.equal(auto.sale.weightT, R.round(60 * s.config.mp_t, 3));
  const man = commit(s, WZ({ weightMode: "manual", weightManual: "20,35" }));
  assert.equal(man.sale.weightMode, "manual");
  assert.equal(man.sale.weightT, 20.35);
  assert.equal(man.sale.revenue, R.round(60 * 90, 2), "sprzedaż z magazynu: cena za jednostkę ilości (MP) — tonaż ręczny nie zmienia przychodu");
  const direct = R.planOperation(s, draft({ type: "SPRZEDAZ", production: { type: "lesna", ndl: "Rudy Raciborskie", lesnictwo: "Kuźnia", kwit: "KW 9/09/2026", rawProductId: "pr_drewno", outProductId: "pr_zr_lesna", outQty: "60" }, sale: { direct: true, buyerId: "pa_elektrownia", price: "300", priceUnit: "t", weightMode: "manual", weightManual: "20,35" } }), ctx(s));
  assert.deepEqual(direct.errors, {});
  assert.equal(direct.totals.revenue, R.round(20.35 * 300, 2), "sprzedaż bezpośrednia z ceną za tonę liczona z tonażu ręcznego");
  assert.equal(docOf(man, "WZ").weightMode, "manual");
  assert.equal(R.WEIGHT_SOURCES.manual, "RĘCZNY");
  assert.ok(R.planOperation(s, WZ({ weightMode: "manual", weightManual: "" }), ctx(s)).errors["sale.weightManual"], "tryb ręczny wymaga tonażu");
  const next = R.clone(man.input); next.sale.weightManual = "21";
  assert.equal(R.correctOperation(s, man.id, next, "kwit wagowy — poprawiony tonaż", ctx(s)).ok, true);
  assert.equal(man.sale.weightT, 21);
  assert.equal(man.sale.weightMode, "manual", "korekta nie przełącza na AUTO");
});

/* ---------------------------- §10 numery ręczne i data dokumentu ---------------------------- */
test("§10: ręczny numer PZ/WZ — unikalny dla typu + magazynu + roku; podpowiedź pomija numery zajęte; osobna data dokumentu", () => {
  const s = fresh();
  const sug = R.suggestDocNo(s, "PZ", "wh_zab", TODAY);
  assert.ok(sug && !R.docNoTaken(s, "PZ", "wh_zab", "2026", sug));
  const op = commit(s, PZ({ docNos: { PZ: "PZ/77/2026" }, docDate: "2026-09-20" }));
  const pz = docOf(op, "PZ");
  assert.equal(pz.no, "PZ/77/2026");
  assert.equal(pz.manualNo, "PZ/77/2026", "numer oznaczony jako wpisany ręcznie");
  assert.equal(pz.docDate, "2026-09-20");
  assert.equal(op.date, TODAY, "data przyjęcia = data operacji");
  assert.ok(op.createdAt, "data i godzina utworzenia zapisane przez system");
  const dup = R.planOperation(s, PZ({ docNos: { PZ: "pz/77/2026" } }), ctx(s));
  assert.ok(Object.values(dup.errors).some(v => /już użyty/.test(v)), "duplikat (bez względu na wielkość liter) odrzucony");
  assert.deepEqual(R.planOperation(s, PZ({ docNos: { PZ: "PZ/77/2026" }, transport: { mode: "none", place: "RiC Brąszewice" } }), ctx(s, "u_bra")).errors, {}, "ten sam numer w innym magazynie dozwolony");
  assert.ok(Object.keys(R.planOperation(s, PZ({ docNos: { PZ: "<script>" } }), ctx(s)).errors).length, "niedozwolone znaki");
  assert.ok(Object.keys(R.planOperation(s, PZ({ docDate: "2026-12-31" }), ctx(s)).errors).length, "data dokumentu z przyszłości");
  const auto = commit(s, PZ());
  assert.notEqual(docOf(auto, "PZ").no, "PZ/77/2026");
  assert.ok(!docOf(auto, "PZ").manualNo);
});

/* --------------------------------- §11 usuwanie dokumentu --------------------------------- */
test("§11: „Usuń” = soft delete — ruchy odwrócone, dokument zostaje w historii i audycie; reguły i uprawnienia", () => {
  const s = fresh(), m3 = bal(s, "pr_drewno");
  const op = commit(s, PZ());
  assert.equal(bal(s, "pr_drewno"), m3 + 20);
  assert.match(R.deleteOperation(s, op.id, ctx(s, "u_mag"), "x").error, /documents\.delete/);
  assert.equal(R.deleteOperation(s, op.id, ctx(s), "").ok, false, "powód wymagany");
  const r = R.deleteOperation(s, op.id, ctx(s), "dokument wprowadzony podwójnie");
  assert.equal(r.ok, true, r.error);
  assert.equal(bal(s, "pr_drewno"), m3, "stan przywrócony");
  assert.ok(s.operations.includes(op), "rekord nie jest fizycznie usuwany");
  assert.ok(op.deleted && op.deleted.reason && op.deleted.userName && op.deleted.ts && op.deleted.reversalNo);
  assert.ok(s.audit.some(a => a.entityId === op.id && /cancel|delete/.test(a.event)), "wpis w audycie");
  assert.equal(R.deleteOperation(s, op.id, ctx(s), "ponownie").ok, false, "drugie usunięcie zablokowane");
  // dokument z zależnościami (towar już wydany) nie może zostać usunięty
  const s2 = fresh();
  const buy = commit(s2, draft({ purchase: { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: "20", unit: "m3", price: "230", weightMode: "auto" }, transport: { mode: "none", place: "RiC Brąszewice" } }), ctx(s2, "u_bra"));
  commit(s2, draft({ type: "PRODUKCJA", production: { rawProductId: "pr_drewno", outProductId: "pr_zr_lesna", outQty: String((R.Stock.balance(s2, "wh_bra", "pr_drewno")) * 4).replace(".", ","), chipperId: "ch_biber", chipRate: "10" }, transport: { mode: "none", place: "RiC Brąszewice" } }), ctx(s2, "u_bra"));
  const blocked = R.deleteOperation(s2, buy.id, ctx(s2, "u_admin"), "test");
  assert.equal(blocked.ok, false, "zakup zużyty w produkcji — usunięcie zablokowane");
});

/* ------------------------------------ §12 XLSX / DOCX ------------------------------------ */
const unzip = bytes => {
  const b = Buffer.from(bytes), out = {};
  let p = 0;
  while (b.readUInt32LE(p) === 0x04034b50) {
    const method = b.readUInt16LE(p + 8), crc = b.readUInt32LE(p + 14), size = b.readUInt32LE(p + 18), nlen = b.readUInt16LE(p + 26), xlen = b.readUInt16LE(p + 28);
    const name = b.slice(p + 30, p + 30 + nlen).toString("utf8"), data = b.slice(p + 30 + nlen + xlen, p + 30 + nlen + xlen + size);
    const raw = method === 8 ? inflateRawSync(data) : data;
    assert.equal(Office.crc32(raw) >>> 0, crc >>> 0, `CRC ${name}`);
    out[name] = raw.toString("utf8");
    p += 30 + nlen + xlen + size;
  }
  return out;
};
test("§12: eksport XLSX — poprawny pakiet OOXML, liczby jako liczby, polskie znaki, nagłówek", () => {
  const bytes = Office.xlsx([{ name: "Dokumenty", columns: ["Nr", "Data", "Ilość", "Koszt"], rows: [["PZ/11", "2026-09-02", 20.35, 4600], ["WZ/27 & <test>", "2026-09-12", 60, 5400]] }], { title: "Rejestr dokumentów — wrzesień" });
  const z = unzip(bytes);
  for (const f of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/styles.xml"]) assert.ok(z[f], `brak ${f}`);
  const sh = z["xl/worksheets/sheet1.xml"];
  assert.match(sh, /<v>20\.35<\/v>/, "liczba zapisana jako liczba");
  assert.match(sh, /Ilość/);
  assert.match(sh, /WZ\/27 &amp; &lt;test&gt;/, "znaki XML zakodowane");
});
test("§12: eksport DOCX — dokument Word z treścią modelu dokumentu", () => {
  const model = { title: "PZ PZ/11", blocks: [{ type: "kv", rows: [["Dostawca", "Lander"], ["Data dokumentu", "02.09.2026"]] }, { type: "table", columns: ["Produkt", "Ilość"], rows: [["Drewno", "20 m³"]] }] };
  const z = unzip(Office.docx(model));
  for (const f of ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]) assert.ok(z[f], `brak ${f}`);
  assert.match(z["word/document.xml"], /PZ\/11/);
  assert.match(z["word/document.xml"], /Drewno/);
});

/* --------------------------------- migracja schematu 7 → 8 --------------------------------- */
test("Migracja 7 → 8: kartoteka operacji dodatkowych, właściciel rębaków, uprawnienie documents.delete", () => {
  const s = fresh();
  const old = R.clone(s);
  old.schema = 7; delete old.extraTypes;
  for (const c of old.fleet.chippers) delete c.owner;
  if (old.rolePerms) for (const k of Object.keys(old.rolePerms)) old.rolePerms[k] = (old.rolePerms[k] || []).filter(p => p !== "documents.delete");
  const m = R.migrate(old);
  const st = m.state || old;
  assert.equal(st.schema, R.SCHEMA);
  assert.ok(st.extraTypes.length >= 5);
  assert.ok(st.fleet.chippers.every(c => c.owner === "own"));
  assert.deepEqual(R.validateStateShape(st), []);
});
