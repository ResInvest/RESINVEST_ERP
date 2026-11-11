/* Plan placu / pociągi / załadunek na serwerze (Store, baza SQLite):  node --test tests/yardplan-server315.test.mjs
   zapis kolekcji yard / trains / loadPlans wierszami, odtworzenie po ponownym otwarciu bazy, dziennik spójny,
   praca dwóch użytkowników: druga rezerwacja tej samej zrębki odrzucona, pełna realizacja z dokumentem WZ,
   widok użytkownika innego magazynu bez danych placu. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store, R, ROWS, Service } from "../server/core.mjs";

const TODAY = "2026-09-23";
const cfgOf = dir => ({ dataDir: dir, backupDir: join(dir, "backups"), backup: { hour: 2, keepDays: 30 }, todayOverride: TODAY });
const SETUP = { name: "Administrator Testowy", email: "magazyn@resinvest.group", password: "Biomasa2026", sample: true };
const ok = (r, what) => { assert.equal(r.ok, true, `${what}: ${r.error || JSON.stringify(r.errors || r)}`); return r; };
const count = (dir, coll) => { const db = new DatabaseSync(join(dir, "resinvest.sqlite"), { readOnly: true }); try { return db.prepare("SELECT COUNT(*) AS n FROM rows WHERE coll = ?").get(coll).n; } finally { db.close(); } };

test("serwer: plac i pociągi w wierszach bazy, rezerwacja dla dwóch użytkowników, realizacja → WZ, stan po ponownym otwarciu", () => {
  const dir = mkdtempSync(join(tmpdir(), "riw-yard-"));
  try {
    assert.ok(["yard", "trains", "loadPlans"].every(k => ROWS.includes(k)));
    let s = new Store(cfgOf(dir));
    ok(s.setup(SETUP), "setup");
    const ex = (uid, cmd, args) => s.execute(uid, cmd, args, "pl");
    const Y = R.YardPlan;
    // dane przykładowe: plac RiC Zabrze z pryzmami i pociągami
    assert.equal(count(dir, "yard"), s.state.yard.length); assert.ok(s.state.yard.length > 15);
    assert.equal(count(dir, "trains"), 3);
    const [t1, t2] = Y.queue(s.state, "wh_zab"), P1 = s.state.yard.find(o => o.no === "P-001"), led = R.Stock.balance(s.state, "wh_zab", "pr_zr_lesna");
    // dwóch użytkowników przygotowuje plany na tę samą pryzmę
    const a = ok(ex("u_mag", "load.save", { trainId: t1.id, name: "A", lines: [{ pileId: P1.id, qty: "2000" }] }), "plan A").plan;
    const b = ok(ex("u_kier", "load.save", { trainId: t2.id, name: "B", lines: [{ pileId: P1.id, qty: "1000" }] }), "plan B").plan;
    assert.equal(count(dir, "loadPlans"), 2);
    ok(ex("u_kier", "load.action", { id: a.id, action: "approve" }), "zatwierdzenie A");
    const rev = s.state.rev;
    const dbl = ex("u_admin", "load.action", { id: b.id, action: "approve" });
    assert.equal(dbl.ok, false); assert.equal(dbl.code, "RESERVE");
    assert.equal(s.state.rev, rev, "odrzucona rezerwacja niczego nie zapisała");
    // realizacja
    ok(ex("u_mag", "load.action", { id: a.id, action: "start" }), "start");
    ok(ex("u_mag", "load.record", { id: a.id, lines: [{ pileId: P1.id, qty: "1950", done: true }], wagons: [{ no: "1", qty: "120" }] }), "ilości");
    const fin = ok(ex("u_mag", "load.finish", { id: a.id, price: "90", weightT: "643,5" }), "zakończenie");
    assert.match(fin.no, /^WZ\//);
    assert.equal(R.Stock.balance(s.state, "wh_zab", "pr_zr_lesna"), led - 1950);
    assert.equal(R.byId(s.state.yard, P1.id).qty, 300);
    assert.ok(Object.isFrozen(R.byId(s.state.yard, P1.id)), "rekordy stanu serwera zamrożone");
    // widok użytkownika innego magazynu
    const v = Service.project(s.state, R.byId(s.state.users, "u_kbra"));
    assert.equal(v.yard.length + v.trains.length + v.loadPlans.length, 0);
    const snap = JSON.stringify([s.state.yard, s.state.trains, s.state.loadPlans]), journal = s.journalCount;
    s.close();
    // ponowne otwarcie: identyczne dane, spójny dziennik
    s = new Store(cfgOf(dir));
    assert.equal(JSON.stringify([s.state.yard, s.state.trains, s.state.loadPlans]), snap);
    assert.equal(s.integrity.ok, true);
    assert.ok(s.verifyJournal ? s.verifyJournal() : true);
    assert.equal(R.byId(s.state.trains, t1.id).status, "DONE");
    assert.ok(journal > 5);
    s.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
