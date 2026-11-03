/* Testy aktualizacji programu na istniejącej bazie (3.9.1): kopia bazy przed zmianami, zapis wersji,
   brak kopii przy zwykłym ponownym uruchomieniu, ostrzeżenie przy bazie z nowszej wersji, dane bez zmian.
   Uruchomienie:  node --test tests/update.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store, R } from "../server/core.mjs";

const cfgOf = dir => ({ dataDir: dir, backupDir: join(dir, "backups"), backup: { hour: 2, keepDays: 30 }, todayOverride: "2026-09-23" });
const INIT = { email: "magazyn@resinvest.group", name: "Administrator", password: "Biomasa2026" };
const backups = dir => readdirSync(join(dir, "backups")).filter(f => f.endsWith(".sqlite"));
const setVersion = (dir, v) => { const db = new DatabaseSync(join(dir, "resinvest.sqlite")); db.prepare("UPDATE meta SET value = ? WHERE key = 'app_version'").run(v); db.close(); };

test("nowa baza: zapis wersji programu, bez kopii „przed aktualizacją”", () => {
  const dir = mkdtempSync(join(tmpdir(), "riw-upd-"));
  try {
    const s = new Store(cfgOf(dir));
    assert.equal(s.bootstrap(INIT).ok, true);
    assert.equal(s.updateBackup, null);
    assert.equal(s.db.prepare("SELECT value FROM meta WHERE key = 'app_version'").get().value, R.VERSION);
    s.close();
    assert.deepEqual(backups(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("aktualizacja 3.8.0 → bieżąca: kopia bazy przed zmianami, dane i dziennik bez zmian, kolejne uruchomienie bez kopii", () => {
  const dir = mkdtempSync(join(tmpdir(), "riw-upd-"));
  try {
    const s1 = new Store(cfgOf(dir)); s1.bootstrap(INIT);
    const rev = s1.state.rev, users = s1.state.users.length; s1.close();
    setVersion(dir, "3.8.0");
    const logs = [];
    const s2 = new Store(cfgOf(dir), (lvl, msg) => logs.push(`${lvl} ${msg}`));
    assert.ok(s2.updateBackup && s2.updateBackup.ok, "kopia przed aktualizacją");
    assert.match(s2.updateBackup.name, /^resinvest-\d{8}-\d{6}-przed-aktualizacja-3_8_0\.sqlite$/);
    assert.deepEqual([s2.updateBackup.from, s2.updateBackup.to], ["3.8.0", R.VERSION]);
    assert.ok(logs.some(l => l.includes(`Aktualizacja 3.8.0 → ${R.VERSION}`)));
    assert.equal(s2.state.rev, rev); assert.equal(s2.state.users.length, users);
    assert.equal(s2.integrity.ok, true);
    s2.close();
    // kopia jest pełną, otwieralną bazą z danymi
    const copy = new DatabaseSync(join(dir, "backups", backups(dir)[0]), { readOnly: true });
    assert.equal(copy.prepare("SELECT rev FROM state WHERE id = 1").get().rev, rev);
    assert.equal(copy.prepare("SELECT value FROM meta WHERE key = 'app_version'").get().value, "3.8.0");
    copy.close();
    const s3 = new Store(cfgOf(dir)); assert.equal(s3.updateBackup, null); s3.close();
    assert.equal(backups(dir).length, 1, "zwykłe ponowne uruchomienie nie tworzy kopii");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("baza sprzed zapisu wersji (≤ 3.9.0) też dostaje kopię przed aktualizacją", () => {
  const dir = mkdtempSync(join(tmpdir(), "riw-upd-"));
  try {
    const s1 = new Store(cfgOf(dir)); s1.bootstrap(INIT); s1.close();
    const db = new DatabaseSync(join(dir, "resinvest.sqlite")); db.prepare("DELETE FROM meta WHERE key = 'app_version'").run(); db.close();
    const s2 = new Store(cfgOf(dir));
    assert.match(s2.updateBackup.name, /przed-aktualizacja-starsza\.sqlite$/);
    s2.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("baza z nowszej wersji programu: ostrzeżenie w dzienniku i kopia (powrót do starszej wersji)", () => {
  const dir = mkdtempSync(join(tmpdir(), "riw-upd-"));
  try {
    const s1 = new Store(cfgOf(dir)); s1.bootstrap(INIT); s1.close();
    setVersion(dir, "9.0.0");
    const logs = [];
    const s2 = new Store(cfgOf(dir), (lvl, msg) => logs.push(`${lvl} ${msg}`));
    assert.ok(logs.some(l => l.startsWith("WARN") && l.includes("nowszą wersję 9.0.0")));
    assert.ok(s2.updateBackup.ok);
    s2.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
