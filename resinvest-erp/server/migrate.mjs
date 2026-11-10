/* =========================================================================
   ResInvest ERP Serwer — migracja SQLite → PostgreSQL, kontrola zgodności, przywracanie i wycofanie.

   Zasady bezpieczeństwa:
   * oryginalny plik SQLite nie jest zmieniany ani usuwany: narzędzie liczy jego skrót SHA-256 przed i po,
     a pracuje wyłącznie na kopiach roboczych w folderze <dane>\migracja,
   * import do PostgreSQL to jedna transakcja; zgodność danych (liczba wierszy i skrót każdej tabeli)
     sprawdzana jest PRZED zatwierdzeniem — niezgodność = wycofanie, baza docelowa bez zmian,
   * po imporcie obie bazy otwiera ten sam rdzeń serwera (Store): rewizja, stan, łańcuch dziennika
     i sumy kontrolne muszą być identyczne,
   * baza docelowa z danymi nie jest nadpisywana bez jawnej zgody (replace) — i wtedy najpierw powstaje jej kopia,
   * wycofanie: baza PostgreSQL zapisywana jest do pliku .sqlite w formacie serwera (z kontrolą zgodności).
   ========================================================================= */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join, resolve } from "node:path";
import { Store, ROWS, R, sha256 } from "./core.mjs";
import { PgDb, SqliteDb } from "./db/index.mjs";
import { importSqliteIntoPg, exportPgToSqlite, fingerprintSqlite, fingerprintPg, diffFingerprints, pgCounts } from "./db/transfer.mjs";
import { TABLES } from "./db/schema.mjs";

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
export function fileSha256(file) {
  const h = createHash("sha256"), fd = openSync(file, "r"), buf = Buffer.allocUnsafe(1 << 20);
  try { for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n)); } finally { closeSync(fd); }
  return h.digest("hex");
}
/** Skróty pliku bazy i plików towarzyszących WAL (-wal, -shm), jeśli istnieją. */
export function sourceHashes(file) {
  const out = {};
  for (const x of ["", "-wal", "-shm"]) if (existsSync(file + x)) out[x || "db"] = { size: statSync(file + x).size, sha256: fileSha256(file + x) };
  return out;
}
/** Kopia robocza bazy SQLite (z plikami WAL) w nowym folderze — oryginał tylko czytany. */
export function workCopy(file, dir) {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, "resinvest.sqlite");
  for (const x of ["", "-wal", "-shm"]) if (existsSync(file + x)) copyFileSync(file + x, target + x);
  return target;
}

/** Podsumowanie bazy widzianej przez rdzeń serwera — to samo dla SQLite i PostgreSQL. */
export function storeSummary(store) {
  const s = store.state;
  return {
    integrity: store.integrity.ok, notes: store.integrity.notes.slice(),
    rev: s ? s.rev : null, schema: s ? s.schema : null,
    stateSha: store.stateSha || "", journalHead: store.journalHead || "", journalCount: store.journalCount || 0,
    fullState: s ? sha256(JSON.stringify(s)) : "",
    collections: Object.fromEntries(ROWS.map(k => [k, s && Array.isArray(s[k]) ? s[k].length : 0])),
    users: s ? s.users.length : 0, warehouses: s && s.warehouses ? s.warehouses.length : 0,
    accounts: store.db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n
  };
}
export function diffSummaries(a, b) {
  const diff = [];
  for (const k of ["integrity", "rev", "schema", "stateSha", "journalHead", "journalCount", "fullState", "users", "warehouses", "accounts"]) if (a[k] !== b[k]) diff.push({ field: k, source: a[k], target: b[k] });
  for (const k of ROWS) if (a.collections[k] !== b.collections[k]) diff.push({ field: "collections." + k, source: a.collections[k], target: b.collections[k] });
  return diff;
}
const quiet = () => {};
function storeCfg(cfg, dataDir, database) {
  return Object.assign({}, cfg, { dataDir, backupDir: join(dataDir, "backups"), scansDir: null, scansBackupDir: join(dataDir, "backups", "skany"), database, backup: Object.assign({}, cfg.backup, { copyTo: [] }) });
}
/** Otwiera kopię bazy SQLite rdzeniem serwera i zwraca podsumowanie (kopia jest jednorazowa — rdzeń może ją zaktualizować). */
function summarizeSqliteCopy(cfg, file, dir) {
  const copy = workCopy(file, dir);
  const st = new Store(storeCfg(cfg, dir, { driver: "sqlite" }), quiet);
  try { return storeSummary(st); } finally { st.close(); void copy; }
}

/**
 * Plan migracji (bez żadnych zmian w bazach): stan źródła, stan celu, lista kroków.
 * @param pgCfg konfiguracja PostgreSQL (databaseConfig) albo null — wtedy tylko analiza źródła.
 */
export function planMigration(cfg, sqliteFile, pgCfg) {
  const src = resolve(sqliteFile);
  if (!existsSync(src)) return { ok: false, error: "Brak pliku bazy SQLite: " + src };
  const work = join(cfg.dataDir, "migracja", "plan-" + stamp() + "-" + randomBytes(3).toString("hex"));
  const before = sourceHashes(src);
  try {
    const copy = workCopy(src, join(work, "a"));
    const db = new SqliteDb(copy, { readOnly: true });
    let fp, quick;
    try { quick = Object.values(db.prepare("PRAGMA quick_check").get() || {})[0]; fp = fingerprintSqlite(db); } finally { db.close(); }
    const summary = summarizeSqliteCopy(cfg, src, join(work, "b"));
    const out = { ok: true, source: { file: src, files: before, quickCheck: quick, tables: fp.tables, nulCharacters: fp.nul, summary }, target: null, appVersion: R.VERSION };
    if (pgCfg) {
      const pg = new PgDb(pgCfg, quiet);
      try { const counts = pgCounts(pg); out.target = { database: pg.describe(), counts, empty: Object.values(counts).every(n => n === 0) }; } finally { pg.close(); }
    }
    out.sourceUnchanged = JSON.stringify(before) === JSON.stringify(sourceHashes(src));
    return out;
  } catch (e) { return { ok: false, error: e.message }; }
  finally { rmSync(work, { recursive: true, force: true }); }
}

/**
 * Migracja SQLite → PostgreSQL. Serwer musi być zatrzymany (pliki źródła nie mogą się zmieniać w trakcie kopiowania).
 * @returns raport: { ok, steps[], source, target, tables, summary, sourceUnchanged, reportFile }
 */
export function migrateToPostgres(cfg, sqliteFile, pgCfg, { replace = false, log = quiet } = {}) {
  const src = resolve(sqliteFile), id = stamp();
  const dir = join(cfg.dataDir, "migracja"), work = join(dir, "robocze-" + id + "-" + randomBytes(3).toString("hex"));
  const rep = { ok: false, started: new Date().toISOString(), appVersion: R.VERSION, source: { file: src }, steps: [] };
  const step = (name, info) => { rep.steps.push(Object.assign({ step: name, at: new Date().toISOString() }, info || {})); log("INFO", `${name}${info && info.note ? ": " + info.note : ""}`); };
  let pg = null;
  try {
    if (!existsSync(src)) throw new Error("Brak pliku bazy SQLite: " + src);
    mkdirSync(dir, { recursive: true });
    // 1. źródło: skróty plików, kopia robocza, kontrola spójności, odcisk danych
    rep.source.files = sourceHashes(src);
    step("Źródło: skróty plików", { note: `${rep.source.files.db.size} B, SHA-256 ${rep.source.files.db.sha256.slice(0, 16)}…` });
    const copyA = workCopy(src, join(work, "a"));
    if (JSON.stringify(rep.source.files) !== JSON.stringify(sourceHashes(src))) throw new Error("Plik bazy SQLite zmienił się w trakcie kopiowania — zatrzymaj serwer ResInvest ERP i uruchom migrację ponownie.");
    const a = new SqliteDb(copyA);                       // kopia robocza: scalenie WAL do jednego pliku
    let fpSrc;
    try {
      a.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      const quick = Object.values(a.prepare("PRAGMA integrity_check").get() || {})[0];
      if (quick !== "ok") throw new Error("Kontrola spójności pliku SQLite nieudana: " + quick);
      fpSrc = fingerprintSqlite(a);
    } finally { a.close(); }
    rep.source.tables = fpSrc.tables; rep.source.nulCharacters = fpSrc.nul;
    step("Źródło: kontrola spójności i odcisk danych", { note: TABLES.map(t => `${t.name} ${fpSrc.tables[t.name].count}`).join(", ") });
    const sumSrc = summarizeSqliteCopy(cfg, copyA, join(work, "b"));
    if (!sumSrc.integrity) throw new Error("Baza źródłowa nie przechodzi kontroli spójności serwera: " + sumSrc.notes.join("; "));
    rep.source.summary = sumSrc;
    step("Źródło: kontrola rdzeniem serwera", { note: `rewizja ${sumSrc.rev}, dziennik ${sumSrc.journalCount}, operacje ${sumSrc.collections.operations}` });

    // 2. cel: połączenie, kopia istniejących danych (tylko przy --replace)
    pg = new PgDb(pgCfg, log);
    rep.target = { database: pg.describe() };
    const counts = pgCounts(pg), used = Object.entries(counts).filter(([, n]) => n > 0);
    if (used.length && !replace) throw new Error(`Baza PostgreSQL zawiera już dane (${used.map(([k, n]) => `${k}: ${n}`).join(", ")}) — migracja przerwana, nic nie zmieniono. Zastąpienie wymaga opcji --replace.`);
    if (used.length) {
      mkdirSync(cfg.backupDir, { recursive: true });
      const keep = join(cfg.backupDir, `resinvest-${id}-pre-migracja.sqlite`);
      exportPgToSqlite(pg, keep); rep.target.previousDataBackup = keep;
      step("Cel: kopia dotychczasowych danych PostgreSQL", { note: keep });
    }

    // 3. import w jednej transakcji z kontrolą zgodności przed zatwierdzeniem
    const imp = importSqliteIntoPg(pg, copyA, { replace, log, verify: fpSrc });
    rep.target.tables = imp.verified.tables; rep.target.importMs = imp.ms; rep.nulCharactersRemoved = fpSrc.nul;
    step("Import do PostgreSQL (jedna transakcja) i kontrola zgodności tabel", { note: `${Object.values(imp.tables).reduce((x, y) => x + y, 0)} wierszy w ${imp.ms} ms, różnice: 0` });

    // 4. kontrola rdzeniem serwera na PostgreSQL (ten sam kod co przy starcie serwera)
    pg.close(); pg = null;
    const st = new Store(storeCfg(cfg, join(work, "pg"), pgCfg), quiet);
    let sumDst;
    try { sumDst = storeSummary(st); } finally { st.close(); }
    rep.target.summary = sumDst;
    rep.summaryDiff = diffSummaries(sumSrc, sumDst);
    if (rep.summaryDiff.length) throw new Error("Kontrola rdzeniem serwera wykazała różnice: " + JSON.stringify(rep.summaryDiff));
    step("Cel: kontrola rdzeniem serwera", { note: `rewizja ${sumDst.rev}, dziennik ${sumDst.journalCount}, stan identyczny (SHA-256 ${sumDst.fullState.slice(0, 16)}…)` });

    // 5. oryginał nietknięty
    rep.sourceUnchanged = JSON.stringify(rep.source.files) === JSON.stringify(sourceHashes(src));
    if (!rep.sourceUnchanged) throw new Error("Plik źródłowy SQLite zmienił się w trakcie migracji — sprawdź, czy serwer był zatrzymany.");
    step("Źródło: plik oryginalny bez zmian (SHA-256 zgodny)");
    rep.ok = true;
  } catch (e) { rep.ok = false; rep.error = e.message; step("BŁĄD", { note: e.message }); }
  finally {
    if (pg) { try { pg.close(); } catch (e) { /* połączenie już zamknięte */ } }
    rmSync(work, { recursive: true, force: true });
    rep.finished = new Date().toISOString();
    try { mkdirSync(dir, { recursive: true }); rep.reportFile = join(dir, `raport-migracji-${id}.json`); writeFileSync(rep.reportFile, JSON.stringify(rep, null, 1)); } catch (e) { /* raport tylko na ekranie */ }
  }
  return rep;
}

/** Porównanie pliku SQLite z bazą PostgreSQL (tabela po tabeli) — bez zmian w obu bazach. */
export function verifyAgainstPostgres(cfg, sqliteFile, pgCfg) {
  const src = resolve(sqliteFile), work = join(cfg.dataDir, "migracja", "kontrola-" + stamp() + "-" + randomBytes(3).toString("hex"));
  let pg = null;
  try {
    const copy = workCopy(src, work), db = new SqliteDb(copy, { readOnly: true });
    let a; try { a = fingerprintSqlite(db); } finally { db.close(); }
    pg = new PgDb(pgCfg, quiet);
    const b = fingerprintPg(pg), diff = diffFingerprints(a, b);
    return { ok: diff.length === 0, source: a.tables, target: b.tables, diff, database: pg.describe() };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { if (pg) pg.close(); rmSync(work, { recursive: true, force: true }); }
}

/**
 * Wycofanie migracji / eksport: baza PostgreSQL → plik .sqlite w formacie serwera, z kontrolą zgodności
 * (odcisk PostgreSQL = odcisk pliku) i kontrolą rdzeniem serwera. Baza PostgreSQL nie jest zmieniana.
 */
export function exportToSqlite(cfg, pgCfg, outFile, { log = quiet } = {}) {
  const out = resolve(outFile), work = join(cfg.dataDir, "migracja", "eksport-" + stamp() + "-" + randomBytes(3).toString("hex"));
  let pg = null;
  try {
    if (existsSync(out)) throw new Error("Plik już istnieje (nie nadpisuję): " + out);
    pg = new PgDb(pgCfg, log);
    const database = pg.describe();
    const exp = exportPgToSqlite(pg, out);
    const db = new SqliteDb(out, { readOnly: true });
    let a; try { a = fingerprintSqlite(db); } finally { db.close(); }
    const b = fingerprintPg(pg), diff = diffFingerprints(b, a);
    pg.close(); pg = null;
    const summary = summarizeSqliteCopy(cfg, out, work);
    const ok = diff.length === 0 && summary.integrity;
    return { ok, file: out, sha256: fileSha256(out), tables: exp.tables, diff, summary, database, error: ok ? undefined : (diff.length ? "Plik różni się od bazy PostgreSQL (baza zmieniana w trakcie eksportu? zatrzymaj serwer i powtórz)" : summary.notes.join("; ")) };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { if (pg) { try { pg.close(); } catch (e) { /* zamknięte */ } } rmSync(work, { recursive: true, force: true }); }
}

/**
 * Przywrócenie kopii (.sqlite) do bazy PostgreSQL: kontrola pliku rdzeniem serwera → kopia bieżącej bazy („pre-restore”)
 * → zastąpienie danych w jednej transakcji z kontrolą zgodności → kontrola spójności po przywróceniu.
 */
export function restoreToPostgres(cfg, backupFile, log = quiet) {
  const src = resolve(backupFile), id = stamp(), work = join(cfg.dataDir, ".restore-check-" + id + "-" + randomBytes(3).toString("hex"));
  let pg = null;
  try {
    if (!existsSync(src)) return { ok: false, error: "Brak pliku: " + src };
    const copy = workCopy(src, join(work, "a")), db = new SqliteDb(copy);
    let fp;
    try {
      const chk = Object.values(db.prepare("PRAGMA integrity_check").get() || {})[0];
      if (chk !== "ok") return { ok: false, error: "Plik kopii uszkodzony: " + chk };
      if (!db.hasTable("state") || !db.prepare("SELECT 1 FROM state WHERE id = 1").get()) return { ok: false, error: "Plik nie zawiera danych ResInvest ERP" };
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      fp = fingerprintSqlite(db);
    } finally { db.close(); }
    const sum = summarizeSqliteCopy(cfg, copy, join(work, "b"));
    if (!sum.integrity) return { ok: false, error: "Kopia nie przechodzi kontroli spójności: " + sum.notes.join("; ") };
    log("INFO", `Kopia sprawdzona: rewizja ${sum.rev}, dziennik ${sum.journalCount}`);
    pg = new PgDb(cfg.database, log);
    const lock = pg.acquireWriterLock();
    if (!lock.ok) return { ok: false, error: `Serwer ResInvest ERP pracuje na tej bazie${lock.holder ? ` (${lock.holder})` : ""} — zatrzymaj go przed przywracaniem.` };
    let kept = null;
    if (Object.values(pgCounts(pg)).some(n => n > 0)) {
      mkdirSync(cfg.backupDir, { recursive: true });
      kept = join(cfg.backupDir, `resinvest-${id}-pre-restore.sqlite`);
      exportPgToSqlite(pg, kept);
    }
    importSqliteIntoPg(pg, copy, { replace: true, log, verify: fp });
    pg.close(); pg = null;
    const st = new Store(cfg, log);
    try { return { ok: true, kept, rev: st.state ? st.state.rev : null, integrity: { ok: st.integrity.ok, notes: st.integrity.notes } }; } finally { st.close(); }
  } catch (e) { return { ok: false, error: e.message }; }
  finally { if (pg) { try { pg.close(); } catch (e) { /* zamknięte */ } } rmSync(work, { recursive: true, force: true }); }
}
