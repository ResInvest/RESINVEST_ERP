/* Testy funkcji wersji 3.5:  node --test tests/features35.test.mjs
   Planer zakupów (plan dnia, wykonanie z operacji, tony, realizacja do dziś, wersja, uprawnienia, audyt),
   powiadomienia (zgody administratora, ustawienia użytkownika, odbiorcy, autor bez powiadomienia,
   obieg zatwierdzania, korekta / anulowanie / usunięcie, izolacja magazynów), migracja 8 → 9. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";

const require = createRequire(import.meta.url);
globalThis.RIW_CONFIG = JSON.parse(readFileSync(new URL("../config/app.config.json", import.meta.url), "utf8"));
// testy numeracji według rodzaju dokumentu (PZ, WZ, RW, KOR…) — tryb config.docNumbering = "types"; jedna seria WZ: features38.test.mjs
globalThis.RIW_CONFIG.docNumbering = "types";
require("../app/src/i18n.js");
for (const f of readdirSync(new URL("../app/src/", import.meta.url)).filter(f => /^i18n\.d\d+\.js$/.test(f)).sort()) require("../app/src/" + f);
const R = require("../app/src/engine.js");
const Service = require("../app/src/service.js");
require("../app/src/seed.js");
const P = R.Planner, N = R.Notify;

const TODAY = "2026-09-23";
const fresh = () => R.Seed.build(TODAY);
const U = (s, id) => s.users.find(u => u.id === id);
const run = (s, uid, cmd, args) => { const r = Service.run(s, cmd, args, { user: { id: uid }, today: TODAY }); return { res: r.res, s: r.state || s }; };
const draft = over => R.Seed.draftOf(over.date || TODAY, Object.assign({ transport: { mode: "none", place: "RiC Zabrze" } }, over));
const PZ_MP = (qty = "40", date = TODAY) => Object.assign(draft({ date, purchase: { supplierId: "pa_drwal", basis: "DEKL", productId: "pr_zr_tow", qty, unit: "MP", price: "50" } }), { idemKey: "k" + Math.random() });
const mine = (s, uid) => s.notices.filter(n => n.userId === uid);

/* ================================ planer ================================ */
test("planer: wykonanie z operacji zakupu MP (zakup z produkcją, produkcja w lesie, zakup zrębki); inne operacje pominięte", () => {
  const s = fresh();
  const aug = P.totals(P.days(s, ["wh_zab"], "2026-08-01", "2026-08-31", TODAY));
  assert.equal(aug.act, 320, "120 MP (zakup + produkcja) + 100 MP (zrębka) + 100 MP (wycinka inwestycyjna)");
  const sep = P.totals(P.days(s, ["wh_zab"], "2026-09-01", "2026-09-30", TODAY));
  assert.equal(sep.act, 680, "80 MP (zakup + produkcja + sprzedaż) + 600 MP (produkcja w lesie)");
  // Brąszewice: zakup drewna bez produkcji, produkcja ze stanu, sprzedaż z magazynu, MM — poza planerem
  assert.equal(P.totals(P.days(s, ["wh_bra"], "2026-08-01", "2026-09-30", TODAY)).act, 0);
  // anulowana operacja nie liczy się
  const op = s.operations.find(o => o.type === "ZAKUP" && o.date === "2026-08-12");
  assert.ok(P.plannerOp(s, op));
  assert.equal(P.plannerOp(s, Object.assign({}, op, { status: "CANCELLED" })), null);
  assert.equal(P.plannerOp(s, Object.assign({}, op, { deleted: true })), null);
});

test("planer: tony = waga zważonych kursów + niezważona reszta × przelicznik; realizacja wobec planu DO DZIŚ", () => {
  const s = fresh();
  const d = P.days(s, ["wh_zab"], "2026-08-05", "2026-08-05", TODAY)[0];
  assert.equal(d.act, 120);
  assert.equal(d.tWeighed, 39.4, "3 kursy zważone: 13,4 + 12,9 + 13,1 t");
  assert.equal(d.tAuto, 0, "cała ilość w zważonych kursach");
  // produkcja w lesie bez kursów (pociąg) — tony z przelicznika
  const f = P.days(s, ["wh_zab"], "2026-09-15", "2026-09-15", TODAY)[0];
  assert.equal(f.tAuto, R.rq(600 * s.config.mp_t));
  // przyszłe dni nie zaniżają realizacji
  const T = P.totals(P.days(s, ["wh_zab"], "2026-09-01", "2026-09-30", TODAY));
  assert.ok(T.plan > T.planToDate);
  assert.equal(T.realization, R.round(T.act / T.planToDate * 100, 1));
  const months = P.months(P.days(s, ["wh_zab"], "2026-01-01", "2026-12-31", TODAY), 2026);
  assert.equal(months.length, 12);
  assert.equal(months[8].act, 680);
});

test("planer: kierowcy i kursy — grupowanie po kierowcy i pojeździe, liczba kursów na dzień", () => {
  const s = fresh();
  const list = P.drivers(s, ["wh_zab"], "2026-08-01", "2026-09-30");
  const nowak = list.find(x => x.driver === "Piotr Nowak");
  assert.equal(nowak.trips, 3);
  assert.equal(nowak.perDay["2026-09-03"], 2);
  assert.ok(list.some(x => x.company === "ESI Logistics"), "kursy zewnętrzne z firmą");
});

test("planer: zapis planu — walidacja, wersja (ochrona przed nadpisaniem), audyt PLAN_UPDATED, usunięcie zerem", () => {
  let s = fresh();
  let r = run(s, "u_kier", "plan.set", { whId: "wh_zab", date: "2026-10-01", planMP: "120,5", version: 0 });
  assert.equal(r.res.ok, true, r.res.error); s = r.s;
  const p = s.plans.find(x => x.whId === "wh_zab" && x.date === "2026-10-01");
  assert.equal(p.planMP, 120.5); assert.equal(p.version, 1);
  const a = s.audit.at(-1);
  assert.equal(a.code, "PLAN_UPDATED"); assert.equal(a.entity, "plan"); assert.deepEqual(a.after, { plan: 120.5, uwagi: "" });
  // nieaktualna wersja — odmowa
  r = run(s, "u_kier", "plan.set", { whId: "wh_zab", date: "2026-10-01", planMP: "90", version: 0 });
  assert.equal(r.res.code, "CONFLICT");
  // walidacja
  for (const bad of ["-5", "abc", "1,234", "200000"]) assert.equal(run(s, "u_kier", "plan.set", { whId: "wh_zab", date: "2026-10-02", planMP: bad }).res.ok, false, bad);
  assert.equal(run(s, "u_kier", "plan.set", { whId: "wh_zab", date: "2026-13-01", planMP: "5" }).res.ok, false);
  // zero bez uwag usuwa wpis
  r = run(s, "u_kier", "plan.set", { whId: "wh_zab", date: "2026-10-01", planMP: "0", version: 1 });
  assert.equal(r.res.ok, true); s = r.s;
  assert.equal(s.plans.some(x => x.date === "2026-10-01"), false);
});

test("planer: uprawnienia — magazynier i obserwator bez edycji, kierownik tylko w swoich magazynach", () => {
  const s = fresh();
  assert.equal(run(s, "u_mag", "plan.set", { whId: "wh_zab", date: "2026-10-01", planMP: "10" }).res.code, "FORBIDDEN");
  assert.equal(run(s, "u_view", "plan.set", { whId: "wh_zab", date: "2026-10-01", planMP: "10" }).res.code, "FORBIDDEN");
  assert.equal(run(s, "u_kier", "plan.set", { whId: "wh_rok", date: "2026-10-01", planMP: "10" }).res.code, "FORBIDDEN", "Rokitki poza przydziałem");
  assert.equal(run(s, "u_admin", "plan.set", { whId: "wh_rok", date: "2026-10-01", planMP: "10" }).res.ok, true);
  // zakres „wszystkie” = magazyny dostępne użytkownikowi
  assert.deepEqual(P.scopeWarehouses(s, U(s, "u_kier"), "ALL").sort(), ["wh_bra", "wh_zab"]);
  assert.deepEqual(P.scopeWarehouses(s, U(s, "u_kier"), "wh_rok"), []);
});

/* ================================ powiadomienia ================================ */
test("powiadomienia: nowa operacja → odbiorcy z dostępem, zgodą i włączonym zdarzeniem; autor bez powiadomienia; jedna wiadomość na odbiorcę", () => {
  let s = fresh();
  const before = s.notices.length;
  const r = run(s, "u_mag", "op.commit", { draft: PZ_MP() });
  assert.equal(r.res.ok, true, r.res.error); s = r.s;
  const added = s.notices.slice(before);
  assert.deepEqual(added.map(n => n.userId).sort(), ["u_kier"], "kierownik Zabrza (PZ włączone); admin nie ma włączonego PZ; Brąszewice bez dostępu");
  assert.equal(added[0].events.join(), "PZ");
  assert.equal(added[0].read, false);
  assert.equal(added[0].email, true);
  assert.deepEqual(r.res.notices, added.map(n => n.id));
  assert.match(R.I18N.tr(added[0].title), /^Nowa operacja: Zakup PZ\//);
  assert.ok(added[0].lines.some(l => R.I18N.tr(l).includes("Data operacji: 23.09.2026")));
  assert.equal(mine(s, "u_mag").filter(n => n.opId === r.res.op.id).length, 0, "autor nie dostaje powiadomienia o własnej zmianie");
});

test("powiadomienia: zgody administratora — użytkownik nie włączy zdarzenia bez zgody; odebranie zgody wyłącza zdarzenie; audyt", () => {
  let s = fresh();
  assert.equal(run(s, "u_mag", "notify.prefs", { events: ["PZ"] }).res.code, "FORBIDDEN");
  assert.equal(run(s, "u_mag", "notify.allow", { userId: "u_mag", events: ["PZ"] }).res.code, "FORBIDDEN", "zgody nadaje administrator");
  let r = run(s, "u_admin", "notify.allow", { userId: "u_mag", events: ["PZ", "MM", "DECISION"] }); s = r.s;
  assert.equal(s.audit.at(-1).code, "NOTIFICATIONS_ALLOWED");
  r = run(s, "u_mag", "notify.prefs", { events: ["PZ", "MM"], email: false }); s = r.s;
  assert.equal(r.res.ok, true);
  assert.deepEqual(N.enabledFor(U(s, "u_mag")), ["PZ", "MM"]);
  assert.equal(N.wantsEmail(U(s, "u_mag")), false);
  assert.equal(s.audit.at(-1).code, "NOTIFICATIONS_CHANGED");
  r = run(s, "u_admin", "notify.allow", { userId: "u_mag", events: ["MM"] }); s = r.s;
  assert.deepEqual(N.enabledFor(U(s, "u_mag")), ["MM"], "PZ wyłączone razem z odebraniem zgody");
  // zapis profilu przez administratora nie kasuje ustawień powiadomień
  const u = U(s, "u_mag");
  r = run(s, "u_admin", "user.save", { rec: Object.assign({}, u, { phone: "600 000 111" }) }); s = r.s;
  assert.equal(r.res.ok, true, r.res.error);
  assert.deepEqual(U(s, "u_mag").notifyAllowed, ["MM"]);
});

test("powiadomienia: MM — magazyn źródłowy i docelowy; przyjęcie MM osobnym powiadomieniem", () => {
  let s = fresh();
  const before = s.notices.length;
  const d = Object.assign(draft({ type: "MM", mm: { fromWhId: "wh_zab", productId: "pr_zr_tow", qty: "10", unit: "MP", toWhId: "wh_bra" } }), { idemKey: "mm-test" });
  let r = run(s, "u_kier", "op.commit", { draft: d }); s = r.s;
  assert.equal(r.res.ok, true, r.res.error);
  const sent = s.notices.slice(before).map(n => n.userId).sort();
  assert.deepEqual(sent, ["u_admin", "u_bra", "u_kbra", "u_mag"]);
  r = run(s, "u_bra", "mm.receive", { opId: r.res.op.id, receipt: { qty: "10", unit: "MP", date: TODAY, key: "rcv1" } }); s = r.s;
  assert.equal(r.res.ok, true, r.res.error);
  const rec = s.notices.filter(n => n.kind === "mm-received" && n.opId === r.res.op.id).map(n => n.userId).sort();
  assert.deepEqual(rec, ["u_admin", "u_kbra", "u_kier", "u_mag"], "odbierający (u_bra) bez powiadomienia");
});

test("powiadomienia: obieg zatwierdzania — przekazanie do zatwierdzających, decyzja do autora (zatwierdzenie i odrzucenie)", () => {
  let s = fresh();
  s.config.requireApproval = true;
  let r = run(s, "u_mag", "op.submit", { draft: PZ_MP("12") }); s = r.s;
  assert.equal(r.res.ok, true, r.res.error);
  const ap = s.notices.filter(n => n.kind === "approval");
  assert.deepEqual(ap.map(n => n.userId), ["u_kier"], "kierownik Zabrza z włączonym APPROVAL");
  r = run(s, "u_kier", "op.approve", { id: r.res.id }); s = r.s;
  assert.equal(r.res.ok, true, r.res.error);
  const ok = s.notices.find(n => n.kind === "approved");
  assert.equal(ok.userId, "u_mag"); assert.equal(ok.opNo, r.res.op.no);
  r = run(s, "u_mag", "op.submit", { draft: PZ_MP("7") }); s = r.s;
  r = run(s, "u_kier", "op.reject", { id: r.res.id, reason: "brak kwitu wagowego" }); s = r.s;
  const no = s.notices.find(n => n.kind === "rejected");
  assert.equal(no.userId, "u_mag");
  assert.ok(no.lines.some(l => R.I18N.tr(l) === "Powód: brak kwitu wagowego"));
});

test("powiadomienia: korekta (BYŁO → JEST), anulowanie i usunięcie z powodem", () => {
  let s = fresh();
  let r = run(s, "u_mag", "op.commit", { draft: PZ_MP("30") }); s = r.s;
  const op = r.res.op, cd = R.clone(op.input); cd.purchase.qty = "25";
  r = run(s, "u_admin", "op.correct", { opId: op.id, draft: cd, reason: "błędnie wpisana ilość" }); s = r.s;
  assert.equal(r.res.ok, true, r.res.error);
  const k = s.notices.filter(n => n.kind === "correction" && n.opId === op.id);
  assert.deepEqual(k.map(n => n.userId), ["u_kier"]);
  assert.ok(k[0].lines.some(l => /30 MP → 25 MP/.test(R.I18N.tr(l))), JSON.stringify(k[0].lines.map(l => R.I18N.tr(l))));
  r = run(s, "u_admin", "op.delete", { opId: op.id, reason: "dokument wprowadzony podwójnie" }); s = r.s;
  assert.equal(r.res.ok, true, r.res.error);
  assert.ok(s.notices.some(n => n.kind === "delete" && n.opId === op.id && n.lines.some(l => R.I18N.tr(l).includes("dokument wprowadzony podwójnie"))));
});

test("powiadomienia: oznaczanie jako przeczytane — tylko własne; izolacja: użytkownik widzi wyłącznie swoją skrzynkę", () => {
  let s = fresh();
  const unread = mine(s, "u_kier").filter(n => !n.read).length;
  assert.ok(unread > 0);
  let r = run(s, "u_kier", "notice.read", { ids: "all" }); s = r.s;
  assert.equal(r.res.count, unread);
  assert.equal(mine(s, "u_kier").filter(n => !n.read).length, 0);
  assert.ok(mine(s, "u_kbra").some(n => !n.read), "cudze powiadomienia bez zmian");
  const other = mine(s, "u_kbra").find(n => !n.read);
  assert.equal(run(s, "u_kier", "notice.read", { ids: [other.id] }).res.unchanged, true);
  const view = Service.project(s, { id: "u_mag" });
  assert.ok(view.notices.every(n => n.userId === "u_mag"));
  assert.ok(view.plans.every(p => p.whId === "wh_zab"));
  const aud = Service.project(s, { id: "u_aud" });
  assert.ok(aud.notices.every(n => n.userId === "u_aud"), "audytor (rola globalna) — tylko własne powiadomienia");
});

test("powiadomienia: treść e-maila po polsku (temat i linie) niezależnie od języka interfejsu", () => {
  const s = fresh();
  const n = s.notices.find(x => x.kind === "correction");
  R.I18N.setLang("en");
  try {
    assert.match(R.I18N.tr(n.title), /^Correction /);
    const m = N.mailContent(n);
    assert.match(m.subject, /^Korekta KOR\//);
    assert.ok(m.lines.some(l => l.startsWith("Powód:")));
  } finally { R.I18N.setLang("pl"); }
});

/* ================================ migracja ================================ */
test("migracja 8 → 9: plany i skrzynka, ustawienia powiadomień kont, planner.edit dla ról z edycją kartotek", () => {
  const s = fresh();
  const old = R.clone(s);
  old.schema = 8; delete old.plans; delete old.notices;
  for (const u of old.users) { delete u.notify; delete u.notifyAllowed; }
  old.rolePerms = { kierownik: ["receipts.create", "master.edit", "report.view"], magazynier: ["receipts.create", "report.view"] };
  const m = R.migrate(old);
  assert.equal(m.error, undefined);
  assert.equal(m.state.schema, 9);
  assert.deepEqual(m.state.plans, []); assert.deepEqual(m.state.notices, []);
  assert.ok(m.state.users.every(u => Array.isArray(u.notifyAllowed) && u.notify && u.notify.email === true));
  assert.ok(m.state.rolePerms.kierownik.includes("planner.edit"));
  assert.ok(!m.state.rolePerms.magazynier.includes("planner.edit"));
  assert.deepEqual(R.validateStateShape(m.state), []);
});
