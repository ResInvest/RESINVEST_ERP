/* Testy funkcji wersji 3.15 (silnik):  node --test tests/features315.test.mjs
   * stany początkowe magazynów (R.Opening, komenda „stock.opening”): dokument BO z różnicami, edycja przyrostowa,
     uprawnienia i dostęp do magazynu, zamknięty okres, data w przyszłości, ujemny stan, liczby w zapisie polskim,
     wpis audytu z wartościami przed → po, numeracja w jednej serii WZ, raporty i stany liczone z nowych wpisów,
   * rozdzielność danych wersji demonstracyjnej (klucze przeglądarki tylko przy storageNs). */
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

const TODAY = "2026-11-10";
const ctxOf = (s, uid) => ({ user: R.byId(s.users, uid), today: TODAY, now: TODAY + "T08:00:00.000Z" });
const run = (s, uid, args) => Service.run(s, "stock.opening", args, ctxOf(s, uid));
const clean = () => R.Seed.minimal({ email: "magazyn@resinvest.group", name: "Administrator", today: TODAY });

test("czysta baza (jak po przeniesieniu danych): trzy magazyny RiC, arkusz z produktami i zerowym stanem", () => {
  const s = clean();
  assert.deepEqual(s.warehouses.map(w => w.name), ["RiC Zabrze", "RiC Brąszewice", "RiC Rokitki"]);
  const sh = R.Opening.sheet(s, "wh_zab");
  assert.ok(sh.length >= 5);
  assert.ok(sh.every(r => r.opening === 0 && r.current === 0));
});

test("zapis: dokument BO z wpisanymi ilościami, stany magazynowe i rewizja", () => {
  const s = clean();
  const r = run(s, "u_admin", { whId: "wh_zab", date: "2026-11-01", lines: [{ productId: "pr_drewno", qty: "817" }, { productId: "pr_zr_lesna", qty: "8 173,5" }, { productId: "pr_pks", qty: "" }] });
  assert.equal(r.res.ok, true, r.res.error);
  assert.match(r.res.no, /^WZ\/001\/11\/2026$/, "numer z jednej serii WZ (numeracja programu)");
  const n = r.state;
  assert.equal(n.rev, s.rev + 1);
  assert.equal(R.Stock.balance(n, "wh_zab", "pr_drewno"), 817);
  assert.equal(R.Stock.balance(n, "wh_zab", "pr_zr_lesna"), 8173.5);
  assert.equal(R.Stock.balance(n, "wh_zab", "pr_pks"), 0, "puste pole = bez zmiany");
  assert.equal(R.Stock.balance(n, "wh_bra", "pr_drewno"), 0, "inne magazyny bez zmian");
  const led = n.ledger.filter(l => l.docNo === r.res.no);
  assert.deepEqual(led.map(l => [l.kind, l.cat, l.whId, l.date]), [["BO", "BO", "wh_zab", "2026-11-01"], ["BO", "BO", "wh_zab", "2026-11-01"]]);
  assert.deepEqual(R.validateStateShape(n), []);
  assert.equal(s.ledger.length, 0, "stan wejściowy nie został zmieniony (kopia robocza)");
});

test("edycja przyrostowa: drugi dokument z różnicą, wcześniejszy zostaje; 0 usuwa stan początkowy", () => {
  let s = clean();
  s = run(s, "u_admin", { whId: "wh_rok", date: "2026-11-01", lines: [{ productId: "pr_zr_tow", qty: "120,25" }, { productId: "pr_lupina", qty: 4.5 }] }).state;
  const r = run(s, "u_admin", { whId: "wh_rok", date: "2026-11-02", lines: [{ productId: "pr_zr_tow", qty: "100" }, { productId: "pr_lupina", qty: "0" }] });
  assert.equal(r.res.ok, true, r.res.error);
  assert.deepEqual(r.res.changes.map(c => [c.productId, c.before, c.after, c.delta]), [["pr_zr_tow", 120.25, 100, -20.25], ["pr_lupina", 4.5, 0, -4.5]]);
  const n = r.state;
  assert.deepEqual([...R.Opening.totals(n, "wh_rok")].sort(), [["pr_lupina", 0], ["pr_zr_tow", 100]]);
  assert.equal(R.Opening.documents(n, "wh_rok").length, 2, "oba dokumenty w historii");
  assert.equal(R.Stock.balance(n, "wh_rok", "pr_zr_tow"), 100);
  const a = n.audit[n.audit.length - 1];
  assert.equal(a.source, "Edytor stanów początkowych");
  assert.deepEqual(a.after.zmiany.map(z => [z.przed, z.po]), [[120.25, 100], [4.5, 0]]);
  // bez zmian → odmowa, nic nie zapisano
  const same = run(n, "u_admin", { whId: "wh_rok", date: "2026-11-02", lines: [{ productId: "pr_zr_tow", qty: "100,000" }] });
  assert.equal(same.res.ok, false); assert.equal(same.res.code, "NOCHANGE"); assert.equal(same.state, null);
});

test("uprawnienia: tylko administrator (warehouses.edit); kierownik i magazynier — odmowa", () => {
  const s = R.Seed.build(TODAY);
  for (const uid of ["u_kier", "u_mag", "u_view", "u_aud"]) {
    const r = run(s, uid, { whId: "wh_zab", date: "2026-11-01", lines: [{ productId: "pr_drewno", qty: "1" }] });
    assert.equal(r.res.ok, false, uid); assert.equal(r.res.code, "FORBIDDEN", uid); assert.equal(r.state, null, uid);
  }
  assert.equal(R.Opening.save(s, { whId: "wh_zab", date: "2026-11-01", lines: [] }, ctxOf(s, "u_kier")).code, "FORBIDDEN", "kontrola także w silniku");
});

test("walidacja: data w przyszłości, brak daty, nieznany magazyn, ujemna i błędna ilość, nieznany i powtórzony produkt", () => {
  const s = clean(), L = [{ productId: "pr_drewno", qty: "1" }];
  assert.equal(run(s, "u_admin", { whId: "wh_zab", date: "2026-11-11", lines: L }).res.errors.date !== undefined, true);
  assert.equal(run(s, "u_admin", { whId: "wh_zab", date: "", lines: L }).res.errors.date !== undefined, true);
  assert.equal(run(s, "u_admin", { whId: "wh_xxx", date: "2026-11-01", lines: L }).res.errors.whId !== undefined, true);
  const r = run(s, "u_admin", { whId: "wh_zab", date: "2026-11-01", lines: [{ productId: "pr_drewno", qty: "-1" }, { productId: "pr_pks", qty: "abc" }, { productId: "nie_ma", qty: "1" }, { productId: "pr_lupina", qty: "1e12" }] });
  assert.equal(r.res.ok, false);
  assert.deepEqual(Object.keys(r.res.errors).sort(), ["p:nie_ma", "p:pr_drewno", "p:pr_lupina", "p:pr_pks"]);
  const d = run(s, "u_admin", { whId: "wh_zab", date: "2026-11-01", lines: [{ productId: "pr_pks", qty: "1" }, { productId: "pr_pks", qty: "2" }] });
  assert.match(d.res.errors["p:pr_pks"], /powtórzony/);
  assert.equal(r.state, null);
});

test("ujemny stan: zmniejszenie stanu początkowego poniżej tego, co już wydano — odmowa", () => {
  let s = clean();
  s = run(s, "u_admin", { whId: "wh_zab", date: "2026-11-01", lines: [{ productId: "pr_zr_lesna", qty: "100" }] }).state;
  const pa = Service.run(s, "master.save", { kind: "partners", rec: { name: "Elektrociepłownia Testowa", nip: "5261040828", kind: "firma", role: "buyer", city: "Zabrze" } }, ctxOf(s, "u_admin"));
  assert.equal(pa.res.ok, true, pa.res.error); s = pa.state;
  const sale = R.Seed.draftOf("2026-11-05", { type: "SPRZEDAZ", sale: { productId: "pr_zr_lesna", qty: "60", unit: "MP", buyerId: pa.res.rec.id, price: "85", weightMode: "manual", weightManual: "20" }, transport: { mode: "none", place: "x" } });
  const c = Service.run(s, "op.commit", { draft: sale }, ctxOf(s, "u_admin"));
  assert.equal(c.res.ok, true, c.res.error); s = c.state;
  assert.equal(R.Stock.balance(s, "wh_zab", "pr_zr_lesna"), 40);
  const r = run(s, "u_admin", { whId: "wh_zab", date: "2026-11-01", lines: [{ productId: "pr_zr_lesna", qty: "50" }] });
  assert.equal(r.res.ok, false); assert.match(r.res.errors["p:pr_zr_lesna"], /ujemny/); assert.equal(r.state, null);
  const ok = run(s, "u_admin", { whId: "wh_zab", date: "2026-11-01", lines: [{ productId: "pr_zr_lesna", qty: "60" }] });
  assert.equal(ok.res.ok, true, "do zera — dozwolone");
  assert.equal(R.Stock.balance(ok.state, "wh_zab", "pr_zr_lesna"), 0);
});

test("zamknięty okres: data w zamkniętym miesiącu odrzucona (LOCKED), po zamknięciu — dozwolona", () => {
  let s = clean();
  s = run(s, "u_admin", { whId: "wh_zab", date: "2026-09-01", lines: [{ productId: "pr_drewno", qty: "10" }] }).state;   // stan do spisu
  s = Service.run(s, "inv.open", { ym: "2026-10" }, ctxOf(s, "u_admin")).state || s;
  const gen = Service.run(s, "inv.generate", { ym: "2026-10" }, ctxOf(s, "u_admin")); if (gen.state) s = gen.state;
  const per = s.inventory.find(p => p.ym === "2026-10" && p.whId === "wh_zab");
  for (const l of (per && per.lines) || []) { const x = Service.run(s, "inv.setCount", { ym: "2026-10", productId: l.productId, text: String(l.bookQty != null ? l.bookQty : 10) }, ctxOf(s, "u_admin")); if (x.state) s = x.state; }
  const cl = Service.run(s, "inv.close", { ym: "2026-10" }, ctxOf(s, "u_admin"));
  assert.equal(cl.res.ok, true, cl.res.error + " " + JSON.stringify(per && per.lines.length)); s = cl.state;
  assert.equal(R.lockedMonth(s, "wh_zab"), "2026-10");
  const r = run(s, "u_admin", { whId: "wh_zab", date: "2026-10-31", lines: [{ productId: "pr_drewno", qty: "5" }] });
  assert.equal(r.res.ok, false); assert.equal(r.res.code, "LOCKED");
  assert.equal(run(s, "u_admin", { whId: "wh_zab", date: "2026-11-01", lines: [{ productId: "pr_drewno", qty: "5" }] }).res.ok, true);
});

test("raporty liczą stan początkowy z edytora jak bilans otwarcia", () => {
  let s = clean();
  s = run(s, "u_admin", { whId: "wh_bra", date: "2026-11-01", lines: [{ productId: "pr_drewno", qty: "30" }] }).state;
  const hist = R.Stock.history ? R.Stock.history(s, "wh_bra", "pr_drewno") : null;
  if (hist) assert.ok(hist.some(h => h.kind === "BO" || h.docNo));
  assert.equal(R.Stock.byProduct(s, "wh_bra").get("pr_drewno"), 30);
  assert.equal(R.Stock.balance(s, "wh_bra", "pr_drewno", "2026-10-31"), 0, "przed datą stanu początkowego — zero");
});

test("wersja demonstracyjna: osobne klucze przeglądarki tylko przy storageNs (program firmowy bez zmian)", () => {
  const src = readFileSync(new URL("../app/src/core.js", import.meta.url), "utf8") + readFileSync(new URL("../app/src/auth.js", import.meta.url), "utf8");
  assert.match(src, /const KEY = nsKey\("riw\.v3\.state"\)/);
  assert.match(src, /const AUTH_KEY = nsKey\("riw\.v3\.auth"\)/);
  const nsKey = (cfg, k) => cfg && cfg.storageNs ? k.replace(/^riw\./, cfg.storageNs + ".") : k;
  assert.equal(nsKey({}, "riw.v3.state"), "riw.v3.state");
  assert.equal(nsKey({ storageNs: "riw.demo315" }, "riw.v3.state"), "riw.demo315.v3.state");
});
