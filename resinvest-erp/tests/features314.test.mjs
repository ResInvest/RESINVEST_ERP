/* Testy funkcji wersji 3.14 (silnik):  node --test tests/features314.test.mjs
   * sprzedaż koleją: operacja dodatkowa „za tonę” z ilością = tony załadowane do wagonów,
   * listy z wpisywaniem: nowy odbiorca, nowy rodzaj operacji dodatkowej, pojazd opisowo — kartoteki uzupełniane przy zatwierdzeniu,
   * skany dokumentów: folder „SKANY <MIESIĄC> <ROK>”, nazwy plików, sygnatury plików, dołączanie i usuwanie, uprawnienia, izolacja magazynów,
   * motywy: wycofane Office 98 / 2003 → Office 2007, gradient z dwóch kolorów, rozdzielczość robocza, migracja ról. */
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
const commit = (s, d, uid) => { const r = R.commitOperation(s, d, ctx(s, uid)); assert.equal(r.ok, true, r.error); return r.op; };
const TRAIN_SALE = (extras, sale = {}) => draft({ type: "SPRZEDAZ",
  sale: Object.assign({ productId: "pr_zr_lesna", qty: "300", unit: "MP", buyerId: "pa_ec_zab", price: "80" }, sale),
  transport: { mode: "train", place: "EC Zabrze", train: { carrier: "PKP Cargo", wagonCount: "3", tonMode: "each", wagonT: ["58,4", "60,1", "59,7"], price: "25", priceUnit: "t" } },
  extras: extras.length ? extras : undefined });

test("pociąg: operacja dodatkowa „Załadunek wagonów (za tonę)” — ilość = 178,2 t załadowane, koszt = tony × stawka", () => {
  const s = fresh();
  const wagon = s.extraTypes.find(x => x.id === "xt_wagony");
  assert.ok(wagon && wagon.unit === "t", "rodzaj dopisany do kartoteki (migracja / dane przykładowe)");
  const op = commit(s, TRAIN_SALE([{ typeId: "xt_wagony", qtySource: "train", rate: "12,5" }]));
  assert.equal(op.transport.totalT, 178.2);
  assert.deepEqual([op.extras[0].qty, op.extras[0].rate, op.extras[0].cost, op.extras[0].qtySource, op.extras[0].unit], [178.2, 12.5, 2227.5, "train", "t"]);
  assert.equal(op.totals.extraCost, 2227.5);
});

test("pociąg: ilość z pociągu bez transportu kolejowego albo bez stawki — błąd przy polu", () => {
  const s = fresh();
  const p1 = R.planOperation(s, draft({ type: "SPRZEDAZ", sale: { productId: "pr_zr_lesna", qty: "10", unit: "MP", buyerId: "pa_ec_zab", price: "80" }, extras: [{ typeId: "xt_wagony", qtySource: "train", rate: "10" }] }), ctx(s));
  assert.match(p1.errors["extras.items.0.qty"], /Pociąg/);
  const p2 = R.planOperation(s, TRAIN_SALE([{ typeId: "xt_wagony", qtySource: "train" }]), ctx(s));
  assert.match(p2.errors["extras.items.0.rate"], /stawkę za tonę/);
  const p3 = R.planOperation(s, TRAIN_SALE([{ typeId: "xt_wagony", qtySource: "train", rate: "10", cost: "500" }]), ctx(s));
  assert.ok(p3.errors["extras.items.0.cost"], "kwota ręczna wyklucza ilość z pociągu");
});

test("lista z wpisywaniem: nowy odbiorca wpisany ręcznie trafia do kartoteki przy zatwierdzeniu (z audytem), istniejący — po nazwie", () => {
  const s = fresh(), n0 = s.partners.length;
  const plan = R.planOperation(s, TRAIN_SALE([], { buyerId: "", buyerName: "Ciepłownia Nowa Sp. z o.o." }), ctx(s));
  assert.deepEqual(plan.errors, {});
  assert.equal(s.partners.length, n0, "podgląd nie zmienia kartoteki");
  const op = commit(s, TRAIN_SALE([], { buyerId: "", buyerName: "Ciepłownia Nowa Sp. z o.o." }));
  const nb = s.partners.find(p => p.name === "Ciepłownia Nowa Sp. z o.o.");
  assert.ok(nb && nb.role === "buyer" && nb.active);
  assert.equal(op.sale.buyerId, nb.id);
  assert.ok(op.documents.filter(d => d.type === "WZ").every(d => d.partnerId === nb.id && d.partner === nb.name));
  assert.ok(s.audit.some(a => a.entityId === nb.id && a.event === "partner"));
  // ta sama nazwa (inna wielkość liter) — istniejący odbiorca, bez duplikatu
  const op2 = commit(s, TRAIN_SALE([], { buyerId: "", buyerName: "ciepłownia nowa sp. z o.o." }));
  assert.equal(op2.sale.buyerId, nb.id);
  assert.equal(s.partners.filter(p => p.name.toLowerCase() === "ciepłownia nowa sp. z o.o.").length, 1);
  // dostawca wpisany jako odbiorca — czytelny błąd
  const sup = s.partners.find(p => p.role === "supplier");
  assert.match(R.planOperation(s, TRAIN_SALE([], { buyerId: "", buyerName: sup.name }), ctx(s)).errors["sale.buyerId"], /dostawca/);
  assert.match(R.planOperation(s, TRAIN_SALE([], { buyerId: "", buyerName: "" }), ctx(s)).errors["sale.buyerId"], /Wpisz nazwę odbiorcy/);
});

test("lista z wpisywaniem: nowy rodzaj operacji dodatkowej i pojazd opisowo (bez Floty)", () => {
  const s = fresh(), n0 = s.extraTypes.length, v0 = s.fleet.vehicles.length;
  const op = commit(s, TRAIN_SALE([{ typeName: "Ważenie na wadze kolejowej", qtySource: "train", rate: "2", vehicleName: "Lokomotywa SM42-1234" }]));
  const ty = s.extraTypes.find(x => x.name === "Ważenie na wadze kolejowej");
  assert.ok(ty && ty.unit === "t", "nowy rodzaj z jednostką „t” (ilość z pociągu)");
  assert.equal(s.extraTypes.length, n0 + 1);
  assert.deepEqual([op.extras[0].typeId, op.extras[0].typeName, op.extras[0].vehicleId, op.extras[0].vehicleName], [ty.id, ty.name, "", "Lokomotywa SM42-1234"]);
  assert.equal(s.fleet.vehicles.length, v0, "pojazd opisowy nie trafia do Floty");
  assert.ok(s.audit.some(a => a.entityId === ty.id));
  // pojazd z Floty po numerze rejestracyjnym
  const v = s.fleet.vehicles.find(x => x.status === "aktywny");
  const op2 = commit(s, TRAIN_SALE([{ typeId: "xt_wagony", qtySource: "train", rate: "1", vehicleName: v.reg }]));
  assert.equal(op2.extras[0].vehicleId, v.id);
});

test("skany: folder miesiąca, nazwa pliku, sygnatury plików", () => {
  assert.equal(R.scanFolder("2026-05-14"), "SKANY MAJ 2026");
  assert.equal(R.scanFolder("2026-10-01"), "SKANY PAŹDZIERNIK 2026");
  assert.equal(R.scanFileName({ no: "WZ/003/08/2026" }, "KWIT", "sc_abc123def456", "jpg"), "WZ-003-08-2026_KWIT_abc123def4.jpg".replace("abc123def4", "c123def456"));
  const b = arr => Uint8Array.from(arr.concat(Array(16).fill(0)));
  assert.equal(R.scanSniff(b([0x25, 0x50, 0x44, 0x46, 0x2D])), "application/pdf");
  assert.equal(R.scanSniff(b([0xFF, 0xD8, 0xFF, 0xE0])), "image/jpeg");
  assert.equal(R.scanSniff(b([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])), "image/png");
  assert.equal(R.scanSniff(b([0x3C, 0x68, 0x74, 0x6D, 0x6C])), null, "HTML nie jest skanem");
  assert.equal(R.scanSniff(b([0x4D, 0x5A, 0x90, 0x00])), null, "plik EXE odrzucony");
});

test("skany: dołączenie i usunięcie (ślad w audycie), uprawnienia, izolacja magazynów, walidacja ścieżki", () => {
  const s = fresh();
  const op = s.operations.find(o => o.whId === "wh_zab" && o.status !== "CANCELLED");
  const scan = { id: "sc_test0001", kind: "WAGA", name: "waga 1.jpg", file: `${R.scanFolder(op.date)}/${R.scanFileName(op, "WAGA", "sc_test0001", "jpg")}`, type: "image/jpeg", size: 120000, sha: "" };
  const r = Service.run(s, "scan.attach", { opId: op.id, scan }, ctx(s, "u_mag"));
  assert.ok(r.res.ok, r.res.error);
  const after = r.state.operations.find(o => o.id === op.id);
  assert.equal(R.Scans.live(after).length, 1);
  assert.equal(after.scans[0].folder, R.scanFolder(op.date));
  assert.ok(r.state.audit.some(a => a.entityId === op.id && a.event === "scan"));
  // magazynier nie usuwa skanów (brak scans.delete); kierownik — tak, plik zostaje (miękkie usunięcie)
  assert.equal(Service.run(r.state, "scan.remove", { opId: op.id, scanId: "sc_test0001" }, ctx(r.state, "u_mag")).res.ok, false);
  const d = Service.run(r.state, "scan.remove", { opId: op.id, scanId: "sc_test0001", reason: "zły plik" }, ctx(r.state, "u_kier"));
  assert.ok(d.res.ok, d.res.error);
  const after2 = d.state.operations.find(o => o.id === op.id);
  assert.equal(R.Scans.live(after2).length, 0);
  assert.ok(after2.scans[0].deletedAt && after2.scans[0].deleteReason === "zły plik");
  // ścieżka spoza folderu skanów / zły rodzaj / zły typ — odrzucone
  for (const bad of [{ file: "../../Windows/win.ini" }, { file: "SKANY MAJ 2026/../../x.jpg" }, { kind: "XXX" }, { type: "text/html" }, { size: 0 }, { size: R.SCAN_MAX_BYTES + 1 }, { id: "../x" }]) {
    const x = Service.run(s, "scan.attach", { opId: op.id, scan: Object.assign({}, scan, { id: "sc_bad00001" }, bad) }, ctx(s, "u_kier"));
    assert.equal(x.res.ok, false, JSON.stringify(bad));
  }
  // użytkownik innego magazynu nie ma dostępu
  const other = s.users.find(u => u.role === "magazynier" && u.whId !== "wh_zab" && !(u.warehouseIds || []).includes("wh_zab"));
  if (other) assert.equal(Service.run(s, "scan.attach", { opId: op.id, scan: Object.assign({}, scan, { id: "sc_other001" }) }, ctx(s, other.id)).res.ok, false);
  // obserwator — brak uprawnienia
  const obs = s.users.find(u => u.role === "obserwator");
  if (obs) assert.equal(Service.run(s, "scan.attach", { opId: op.id, scan }, ctx(s, obs.id)).res.ok, false);
});

test("motywy: Office 98 / 2003 → Office 2007 (migracja i preferencje), gradient i rozdzielczość w profilu, uprawnienia skanów dla ról", () => {
  const s = fresh();
  U(s, "u_kier").theme = "office98";
  s.rolePerms = { magazynier: ["receipts.create", "report.view"], kierownik: ["receipts.create", "documents.delete"] };
  const m = R.migrate(s);
  assert.ok(!m.error, m.error);
  assert.equal(U(m.state, "u_kier").theme, "office2007");
  assert.ok(m.state.rolePerms.magazynier.includes("scans.add") && !m.state.rolePerms.magazynier.includes("scans.delete"));
  assert.ok(m.state.rolePerms.kierownik.includes("scans.add") && m.state.rolePerms.kierownik.includes("scans.delete"));
  assert.ok(m.state.extraTypes.some(x => x.id === "xt_wagony"));
  const st = m.state;
  const r = Service.run(st, "me.prefs", { theme: "gradient", themeGradient: { from: "#fde68a", to: "#F472B6" }, uiRes: "1366x768" }, ctx(st, "u_kier"));
  assert.ok(r.res.ok, r.res.error);
  const u = U(r.state, "u_kier");
  assert.deepEqual([u.theme, u.themeGradient, u.uiRes], ["gradient", { from: "#FDE68A", to: "#F472B6" }, "1366x768"]);
  assert.equal(Service.run(r.state, "me.prefs", { uiRes: "999x1" }, ctx(r.state, "u_kier")).res.ok, false);
  assert.equal(Service.run(r.state, "me.prefs", { themeGradient: { from: "red", to: "#000000" } }, ctx(r.state, "u_kier")).res.ok, false);
  assert.equal(Service.run(r.state, "me.prefs", { theme: "office2003" }, ctx(r.state, "u_kier")).state.users.find(x => x.id === "u_kier").theme, "office2007");
  assert.equal(R.THEME_REGISTRY.length, 18);
});
