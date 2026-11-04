/* Testy funkcji wersji 3.12:  node --test tests/features312.test.mjs
   Przeliczniki miesiąca: po zamknięciu miesiąca w inwentaryzacji decyzja na kolejny miesiąc — zostaw obecne albo wpisz
   inne (jedna decyzja na miesiąc, uprawnienie factors.edit, walidacja, audyt, historia, migracja ról i danych). */
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
const ctx = (s, uid = "u_kier", today = TODAY) => ({ user: U(s, uid), today, source: "test" });
const run = (s, cmd, args, uid = "u_kier", today = TODAY) => Service.run(s, cmd, args, ctx(s, uid, today));
/** Zamknięcie sierpnia w magazynie kierownika (spis = stan księgowy). */
function closeAugust(s) {
  for (const [cmd, args] of [["inv.open", { ym: "2026-08" }], ["inv.generate", { ym: "2026-08" }]]) assert.ok(Service.exec(s, cmd, args, ctx(s)).ok, cmd);
  const p = R.Inventory.find(s, "wh_zab", "2026-08");
  for (const l of p.lines) assert.ok(Service.exec(s, "inv.setCount", { ym: "2026-08", productId: l.productId, text: String(l.bookQty) }, ctx(s)).ok);
  const r = Service.exec(s, "inv.close", { ym: "2026-08" }, ctx(s));
  assert.ok(r.ok, r.error);
}

test("bez zamkniętego miesiąca nie ma decyzji do podjęcia; komenda odrzucona bez zmiany danych", () => {
  const s = fresh();
  assert.equal(R.Factors.pending(s, TODAY), null);
  const r = run(s, "factors.decide", { keep: true });
  assert.equal(r.res.ok, false); assert.equal(r.state, null);
});

test("po zamknięciu sierpnia decyzja na wrzesień: „zostaw obecne” — przeliczniki bez zmian, historia, audyt, jedna decyzja na miesiąc", () => {
  const s = fresh(); closeAugust(s);
  assert.deepEqual(R.Factors.pending(s, TODAY), { ym: "2026-09", closedYm: "2026-08" });
  const before = R.Factors.current(s);
  const r = run(s, "factors.decide", { ym: "2026-09", keep: true, note: "bez zmian wilgotności" });
  assert.ok(r.res.ok, r.res.error);
  const n = r.state;
  assert.deepEqual(R.Factors.current(n), before);
  assert.equal(R.Factors.history(n).length, 1);
  assert.equal(R.Factors.history(n)[0].decision, "keep");
  assert.equal(R.Factors.history(n)[0].by, "Anna Górska");
  assert.equal(n.audit.at(-1).code, "FACTORS_KEPT");
  assert.equal(R.Factors.pending(n, TODAY), null);
  assert.equal(Service.run(n, "factors.decide", { keep: true }, ctx(n)).res.ok, false, "druga decyzja na ten sam miesiąc");
});

test("„zapisz nowe” zmienia przeliczniki od decyzji; zapisane operacje zachowują tonaż z chwili zapisu", () => {
  const s = fresh(); closeAugust(s);
  const tBefore = s.ledger.map(l => l.t);
  const r = run(s, "factors.decide", { keep: false, values: { m3_mp: "3,5", mp_t: "0.31", woodTPerM3: "", t_gj: "8,5" } });
  assert.ok(r.res.ok, r.res.error);
  const n = r.state, e = R.Factors.history(n)[0];
  assert.equal(e.decision, "change");
  assert.deepEqual(e.changed.sort(), ["m3_mp", "mp_t"]);
  assert.equal(n.config.m3_mp, 3.5); assert.equal(n.config.mp_t, 0.31); assert.equal(n.config.woodTPerM3, s.config.woodTPerM3);
  assert.equal(e.prev.m3_mp, 4);
  assert.deepEqual(n.ledger.map(l => l.t), tBefore, "księga bez zmian");
  const audit = n.audit.at(-1);
  assert.equal(audit.code, "FACTORS_CHANGED"); assert.deepEqual(audit.before, { m3_mp: 4, mp_t: 0.33 }); assert.deepEqual(audit.after, { m3_mp: 3.5, mp_t: 0.31 });
  // produkt bez własnego przelicznika liczy masę z nowej wartości
  const zr = n.products.find(p => p.id === "pr_zr_lesna");
  assert.equal(R.Units.mass(100, zr, n.config), 31);
});

test("walidacja: zakres, liczba, zły miesiąc — nic nie zapisano", () => {
  const s = fresh(); closeAugust(s);
  for (const args of [{ values: { m3_mp: "40" } }, { values: { mp_t: "abc" } }, { values: { t_gj: "0" } }, { ym: "2026-10", keep: true }]) {
    const r = run(s, "factors.decide", args);
    assert.equal(r.res.ok, false, JSON.stringify(args)); assert.equal(r.state, null);
  }
  const r = run(s, "factors.decide", { values: { m3_mp: "40" } });
  assert.equal(r.res.field, "m3_mp");
});

test("uprawnienia: magazynier i obserwator nie decydują; kierownik i administrator tak", () => {
  const s = fresh(); closeAugust(s);
  assert.equal(run(s, "factors.decide", { keep: true }, "u_mag").res.code, "FORBIDDEN");
  assert.equal(run(s, "factors.decide", { keep: true }, "u_view").res.code, "FORBIDDEN");
  assert.ok(run(s, "factors.decide", { keep: true }, "u_admin").res.ok);
  assert.ok(R.can(U(s, "u_kier"), "factors.edit"));
});

test("miesiąc z przyszłości nie czeka na decyzję (zamknięcie września oglądane we wrześniu)", () => {
  const s = fresh(); closeAugust(s);
  const n = run(s, "factors.decide", { keep: true }).state;
  assert.ok(n, "decyzja na wrzesień zapisana");
  assert.equal(R.Factors.pending(n, "2026-09-30"), null);
  // ten sam stan oglądany w październiku: po zamknięciu września decyzja na październik
  n.inventory.push({ id: "inv_x", whId: "wh_bra", ym: "2026-09", status: "ZAMKNIETA", lines: [] });
  assert.equal(R.Factors.pending(n, "2026-09-30"), null);
  assert.deepEqual(R.Factors.pending(n, "2026-10-02"), { ym: "2026-10", closedYm: "2026-09" });
});

test("migracja: starsze dane dostają pustą historię, zmienione role z zamykaniem okresów — factors.edit", () => {
  const s = fresh();
  delete s.config.factorHistory;
  s.rolePerms = { kierownik: ["inv.close", "report.view"], magazynier: ["report.view"] };
  const m = R.migrate(JSON.parse(JSON.stringify(s)));
  assert.ok(!m.error);
  assert.deepEqual(m.state.config.factorHistory, []);
  assert.ok(m.state.rolePerms.kierownik.includes("factors.edit"));
  assert.ok(!m.state.rolePerms.magazynier.includes("factors.edit"));
});

test("menu: grupa „Ustawienia” (wygląd i język, użytkownicy, role, audyt) przed „System” (profil, administracja, poczta, powiadomienia)", () => {
  const src = readFileSync(new URL("../app/src/core.js", import.meta.url), "utf8");
  const nav = src.slice(src.indexOf("const NAV = ["), src.indexOf("];", src.indexOf("const NAV = [")));
  const items = [...nav.matchAll(/group: N_\("([^"]+)"\)|id: "([a-z]+)"/g)].map(m => m[1] ? "#" + m[1] : m[2]);
  const from = items.indexOf("#Ustawienia");
  assert.deepEqual(items.slice(from), ["#Ustawienia", "wyglad", "uzytkownicy", "role", "audyt", "#System", "profil", "administracja", "poczta", "powiadomienia"]);
});
