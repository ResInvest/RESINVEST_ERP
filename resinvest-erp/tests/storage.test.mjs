/* Testy zapisu przyrostowego (3.10): rekordy kolekcji w osobnych wierszach, zapis tylko zmienionych rekordów,
   szybka ścieżka bez kopiowania całej bazy (bez ścieżki zapasowej), wierne odtworzenie stanu po ponownym otwarciu
   (z kolejnością), konwersja bazy sprzed 3.10, sumy kontrolne wierszy, historia zmian dla synchronizacji przeglądarek.
   Uruchomienie:  node --test tests/storage.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { Store, R, ROWS } from "../server/core.mjs";

const TODAY = "2026-09-23";
const cfgOf = dir => ({ dataDir: dir, backupDir: join(dir, "backups"), backup: { hour: 2, keepDays: 30 }, todayOverride: TODAY });
const SETUP = { name: "Administrator Testowy", email: "magazyn@resinvest.group", password: "Biomasa2026", sample: true };
const withDir = fn => { const dir = mkdtempSync(join(tmpdir(), "riw-rows-")); try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
const draft = over => R.Seed.draftOf(over.date || TODAY, Object.assign({ transport: { mode: "none", place: "RiC Zabrze" } }, over));
let n = 0;
const PZ = (qty = "40") => Object.assign(draft({ purchase: { supplierId: "pa_drwal", basis: "DEKL", productId: "pr_zr_tow", qty, unit: "MP", price: "50" } }), { idemKey: "st-" + (++n) });
const ok = (r, what) => { assert.equal(r.ok, true, `${what}: ${r.error || JSON.stringify(r)}`); return r; };
const rowCount = (dir, coll) => { const db = new DatabaseSync(join(dir, "resinvest.sqlite"), { readOnly: true }); try { return db.prepare("SELECT COUNT(*) AS n FROM rows WHERE coll = ?").get(coll).n; } finally { db.close(); } };

test("pełny scenariusz pracy: każda komenda na szybkiej ścieżce, stan po ponownym otwarciu identyczny (z kolejnością)", () => withDir(dir => {
  const s = new Store(cfgOf(dir));
  ok(s.setup(SETUP), "setup");
  const ex = (uid, cmd, args) => s.execute(uid, cmd, args, "pl");
  const ops0 = s.state.operations.length;

  // zakup, korekta, cofnięcie korekty, anulowanie, usunięcie
  const pz = ok(ex("u_mag", "op.commit", { draft: PZ("30") }), "PZ").op;
  const cd = R.clone(pz.input); cd.purchase.qty = "25";
  const k1 = ok(ex("u_admin", "op.correct", { opId: pz.id, draft: cd, reason: "błędnie wpisana ilość" }), "korekta");
  const corrNo = (R.byId(s.state.operations, pz.id).corrections || []).at(-1).no;
  ok(ex("u_admin", "op.reverseCorrection", { opId: pz.id, corrNo, reason: "korekta niepotrzebna" }), "cofnięcie korekty");
  const pz2 = ok(ex("u_mag", "op.commit", { draft: PZ("12") }), "PZ 2").op;
  ok(ex("u_kier", "op.cancel", { opId: pz2.id, reason: "pomyłka", ack: true }), "anulowanie");
  const pz3 = ok(ex("u_mag", "op.commit", { draft: PZ("8") }), "PZ 3").op;
  ok(ex("u_admin", "op.delete", { opId: pz3.id, reason: "dokument wprowadzony podwójnie" }), "usunięcie");
  assert.ok(k1);

  // MM dwuetapowe: wydanie z Zabrza, przyjęcie w Brąszewicach
  const mmd = Object.assign(draft({ type: "MM", mm: { fromWhId: "wh_zab", productId: "pr_zr_tow", qty: "10", unit: "MP", toWhId: "wh_bra" } }), { idemKey: "st-mm" });
  const mm = ok(ex("u_kier", "op.commit", { draft: mmd }), "MM").op;
  ok(ex("u_bra", "mm.receive", { opId: mm.id, receipt: { qty: "10", unit: "MP", date: TODAY, key: "st-rcv" } }), "przyjęcie MM");

  // wersje robocze
  const dr = ok(ex("u_mag", "draft.save", { draft: PZ("5") }), "wersja robocza");
  ok(ex("u_mag", "draft.save", { draft: Object.assign(PZ("6"), { draftId: dr.id }) }), "aktualizacja wersji roboczej");
  const dr2 = ok(ex("u_mag", "draft.save", { draft: PZ("7") }), "wersja robocza 2");
  ok(ex("u_mag", "draft.delete", { id: dr2.id }), "usunięcie wersji roboczej");

  // obieg zatwierdzania
  ok(ex("u_admin", "settings.save", { settings: { requireApproval: true } }), "włączenie obiegu");
  const sub = ok(ex("u_mag", "op.submit", { draft: PZ("12") }), "przekazanie");
  ok(ex("u_kier", "op.approve", { id: sub.id }), "zatwierdzenie");
  const sub2 = ok(ex("u_mag", "op.submit", { draft: PZ("7") }), "przekazanie 2");
  ok(ex("u_kier", "op.reject", { id: sub2.id, reason: "brak kwitu wagowego" }), "odrzucenie");
  ok(ex("u_admin", "settings.save", { settings: { requireApproval: false } }), "wyłączenie obiegu");

  // planer, powiadomienia, wydruk
  ok(ex("u_kier", "plan.set", { whId: "wh_zab", date: "2026-10-01", planMP: "120", version: 0 }), "plan");
  ok(ex("u_kier", "plan.set", { whId: "wh_zab", date: "2026-10-01", planMP: "90", version: 1 }), "zmiana planu");
  ok(ex("u_kier", "plan.set", { whId: "wh_zab", date: "2026-10-02", planMP: "60", version: 0 }), "plan 2");
  ok(ex("u_kier", "plan.set", { whId: "wh_zab", date: "2026-10-02", planMP: "0", version: 1 }), "usunięcie planu");
  ok(ex("u_kier", "notice.read", { ids: "all" }), "przeczytane");
  ok(ex("u_kier", "print.register", { kind: "report", title: "Raport miesięczny", range: "2026-09", wh: "wh_zab", format: "pdf" }), "wydruk");

  // inwentaryzacja miesiąca: otwarcie, lista, spis każdej pozycji, zamknięcie (różnica → dokument IN w księdze)
  ok(ex("u_kier", "inv.open", { ym: "2026-09" }), "otwarcie okresu");
  const per = ok(ex("u_kier", "inv.generate", { ym: "2026-09" }), "lista spisowa").period;
  assert.ok(per.lines.length > 0);
  per.lines.forEach((l, i) => ok(ex("u_kier", "inv.setCount", { ym: "2026-09", productId: l.productId, text: String(i === 0 ? Math.max(0, l.bookQty - 1) : l.bookQty).replace(".", ",") }), "spis " + l.productId));
  const cl = ok(ex("u_kier", "inv.close", { ym: "2026-09" }), "zamknięcie okresu");
  assert.ok(cl.docNo, "różnica spisu → dokument IN");

  // kartoteki i użytkownik (rdzeń stanu)
  ok(ex("u_admin", "me.prefs", { lang: "pl" }), "preferencje");

  assert.equal(s.fallbacks || 0, 0, "żadna komenda nie wymagała pełnej kopii bazy");
  assert.equal(s.state.operations.length, ops0 + 5, "PZ ×3 (w tym anulowana i usunięta), MM, zatwierdzona");
  for (const k of ROWS) assert.equal(rowCount(dir, k), s.state[k].length, `wiersze ${k}`);
  const mem = JSON.stringify(s.state), rev = s.state.rev;
  s.close();

  const s2 = new Store(cfgOf(dir));
  assert.equal(s2.integrity.ok, true, s2.integrity.notes.join("; "));
  assert.equal(s2.state.rev, rev);
  assert.equal(JSON.stringify(s2.state), mem, "stan z bazy = stan w pamięci (rekordy i kolejność)");
  // rekordy w pamięci są zamrożone (współdzielone między wersjami stanu)
  assert.ok(Object.isFrozen(s2.state.operations[0]) && Object.isFrozen(s2.state.ledger.at(-1)));
  s2.close();
}));

test("zapis przyrostowy: komenda zapisuje tylko nowe / zmienione rekordy, niezmienione wiersze bez zapisu", () => withDir(dir => {
  const s = new Store(cfgOf(dir));
  ok(s.setup(SETUP), "setup");
  const shaOf = () => { const m = new Map(); for (const r of s.db.prepare("SELECT coll, id, sha FROM rows").iterate()) m.set(r.coll + "/" + r.id, r.sha); return m; };
  const before = shaOf();
  const r = ok(s.execute("u_mag", "op.commit", { draft: PZ("15") }, "pl"), "PZ");
  const after = shaOf();
  const changed = [...after].filter(([k, v]) => before.get(k) !== v).map(([k]) => k.split("/")[0]);
  assert.ok(changed.includes("operations") && changed.includes("ledger") && changed.includes("audit"));
  assert.equal(changed.filter(c => c === "operations").length, 1, "jedna nowa operacja");
  assert.ok(changed.length < 20, `zapisane wiersze: ${changed.length}`);
  assert.equal([...before.keys()].filter(k => !after.has(k)).length, 0, "nic nie zniknęło");
  // dziennik: wpis z łańcuchem skrótów
  const j = s.db.prepare("SELECT cmd, rev_after, state_sha FROM journal ORDER BY seq DESC LIMIT 1").get();
  assert.equal(j.cmd, "op.commit"); assert.equal(j.rev_after, s.state.rev); assert.match(j.state_sha, /^[0-9a-f]{64}$/);
  assert.ok(r.op.id);
  s.close();
}));

test("historia zmian dla przeglądarek: nowe i zmienione rekordy od rewizji; pełny stan po zmianie kont / uprawnień", () => withDir(dir => {
  const s = new Store(cfgOf(dir));
  ok(s.setup(SETUP), "setup");
  const rev0 = s.state.rev;
  assert.deepEqual(s.changesSince(rev0), { up: {}, del: {} });
  const op = ok(s.execute("u_mag", "op.commit", { draft: PZ("11") }, "pl"), "PZ").op;
  let ch = s.changesSince(rev0);
  assert.ok(ch.up.operations.has(op.id));
  assert.ok(ch.up.ledger.size >= 1 && ch.up.audit.size >= 1);
  const dr = ok(s.execute("u_mag", "draft.save", { draft: PZ("3") }, "pl"), "wersja robocza");
  ok(s.execute("u_mag", "draft.delete", { id: dr.id }, "pl"), "usunięcie");
  ch = s.changesSince(rev0);
  assert.ok(ch.del.drafts.has(dr.id) && !(ch.up.drafts && ch.up.drafts.has(dr.id)), "usunięta wersja robocza tylko w „del”");
  assert.equal(s.changesSince(s.state.rev + 1), null, "rewizja z przyszłości");
  assert.equal(s.changesSince(rev0 - 1 < s.deltaBase ? s.deltaBase - 1 : -1), null, "sprzed startu serwera");
  const rev1 = s.state.rev;
  const u = R.byId(s.state.users, "u_mag");
  ok(s.execute("u_admin", "user.save", { rec: Object.assign({}, u, { phone: "600 000 222" }) }, "pl"), "profil");
  assert.equal(s.changesSince(rev1), null, "zmiana kont → pełne odświeżenie");
  s.close();
  // po ponownym uruchomieniu brak historii sprzed startu
  const s2 = new Store(cfgOf(dir));
  assert.equal(s2.changesSince(rev0), null);
  assert.deepEqual(s2.changesSince(s2.state.rev), { up: {}, del: {} });
  s2.close();
}));

test("baza sprzed 3.10 (jeden dokument JSON): konwersja do wierszy, kopia przed aktualizacją, dane bez zmian", () => withDir(dir => {
  const s = new Store(cfgOf(dir));
  ok(s.setup(SETUP), "setup");
  ok(s.execute("u_mag", "op.commit", { draft: PZ("21") }, "pl"), "PZ");
  const mem = JSON.stringify(s.state), rev = s.state.rev;
  s.close();
  // symulacja starej bazy: pełny stan w tabeli state, brak wierszy i znacznika zapisu
  const db = new DatabaseSync(join(dir, "resinvest.sqlite"));
  const json = mem, sha = createHash("sha256").update(json).digest("hex");
  db.exec("DELETE FROM rows; DELETE FROM meta WHERE key IN ('storage', 'state_sha')");
  db.prepare("UPDATE state SET json = ?, sha256 = ? WHERE id = 1").run(json, sha);
  db.prepare("UPDATE meta SET value = '3.9.0' WHERE key = 'app_version'").run();
  db.close();
  const logs = [];
  const s2 = new Store(cfgOf(dir), (l, m) => logs.push(`${l} ${m}`));
  assert.ok(s2.updateBackup && s2.updateBackup.ok, "kopia przed aktualizacją");
  assert.ok(logs.some(l => l.includes("Zapis przyrostowy: dane przeniesione do wierszy")), logs.join("\n"));
  assert.equal(s2.integrity.ok, true, s2.integrity.notes.join("; "));
  assert.equal(s2.state.rev, rev);
  assert.equal(JSON.stringify(s2.state), mem);
  assert.equal(s2.db.prepare("SELECT cmd FROM journal ORDER BY seq DESC LIMIT 1").get().cmd, "system.storage");
  for (const k of ROWS) assert.equal(rowCount(dir, k), s2.state[k].length, `wiersze ${k}`);
  // stan w tabeli state to już tylko rdzeń (kolekcje w wierszach)
  const core = JSON.parse(s2.db.prepare("SELECT json FROM state WHERE id = 1").get().json);
  for (const k of ROWS) assert.equal(core[k], null, `rdzeń bez ${k}`);
  s2.close();
  const s3 = new Store(cfgOf(dir));
  assert.equal(JSON.stringify(s3.state), mem); assert.equal(s3.integrity.ok, true);
  s3.close();
  assert.equal(readdirSync(join(dir, "backups")).filter(f => f.includes("przed-aktualizacja")).length, 1);
}));

test("sumy kontrolne wierszy: zmieniony ręcznie rekord wykryty przy starcie (Kontrola spójności)", () => withDir(dir => {
  const s = new Store(cfgOf(dir));
  ok(s.setup(SETUP), "setup");
  s.close();
  const db = new DatabaseSync(join(dir, "resinvest.sqlite"));
  const r = db.prepare("SELECT id, json FROM rows WHERE coll = 'operations' LIMIT 1").get();
  db.prepare("UPDATE rows SET json = ? WHERE coll = 'operations' AND id = ?").run(r.json.replace(/"date":"\d{4}/, '"date":"1999'), r.id);
  db.close();
  const s2 = new Store(cfgOf(dir), () => {});
  assert.equal(s2.integrity.ok, false);
  assert.ok(s2.integrity.notes.some(x => x.includes(`row checksum mismatch operations/${r.id}`)));
  s2.close();
}));

test("komenda zmieniająca istniejący rekord w miejscu: ścieżka zapasowa (pełna kopia) — wynik poprawny, zapis tylko zmian", () => withDir(dir => {
  const s = new Store(cfgOf(dir), () => {});
  ok(s.setup(SETUP), "setup");
  const id = s.state.operations[0].id, before = JSON.stringify(s.state.operations[1]);
  const r = s.applyChange("test.inplace", st => { const op = st.operations.find(o => o.id === id); op.note = "zmiana w miejscu"; st.rev += 1; return { ok: true }; }, { id });
  ok(r, "zmiana w miejscu");
  assert.equal(s.fallbacks, 1, "wykonane na pełnej kopii");
  assert.equal(R.byId(s.state.operations, id).note, "zmiana w miejscu");
  assert.equal(JSON.stringify(s.state.operations[1]), before);
  const d = s.deltas.at(-1);
  assert.deepEqual(d.up.operations, [id], "zapisany tylko zmieniony rekord");
  const mem = JSON.stringify(s.state);
  s.close();
  const s2 = new Store(cfgOf(dir));
  assert.equal(JSON.stringify(s2.state), mem);
  s2.close();
}));

test("nieudana komenda nie zmienia stanu ani bazy (wszystko albo nic)", () => withDir(dir => {
  const s = new Store(cfgOf(dir));
  ok(s.setup(SETUP), "setup");
  const mem = JSON.stringify(s.state), j = s.journalCount;
  const r = s.execute("u_mag", "op.commit", { draft: PZ("-5") }, "pl");
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(s.state), mem);
  assert.equal(s.journalCount, j);
  // błąd zapisu w bazie (wyzwalacz) → stan w pamięci bez zmian
  s.db.exec("CREATE TEMP TRIGGER fail_rows BEFORE INSERT ON rows BEGIN SELECT RAISE(ABORT, 'awaria dysku (test)'); END;");
  const r2 = s.execute("u_mag", "op.commit", { draft: PZ("9") }, "pl");
  assert.equal(r2.ok, false); assert.equal(r2.code, "DB");
  assert.equal(JSON.stringify(s.state), mem);
  s.db.exec("DROP TRIGGER fail_rows");
  ok(s.execute("u_mag", "op.commit", { draft: PZ("9") }, "pl"), "po usunięciu awarii");
  const mem2 = JSON.stringify(s.state);
  s.close();
  const s2 = new Store(cfgOf(dir));
  assert.equal(JSON.stringify(s2.state), mem2); assert.equal(s2.integrity.ok, true);
  s2.close();
}));
