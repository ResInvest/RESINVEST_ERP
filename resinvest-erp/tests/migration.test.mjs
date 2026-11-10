/* Migracja SQLite → PostgreSQL: zgodność danych, nienaruszalność źródła, odmowy, wycofanie, przywracanie, starsze bazy. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { copyFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pgAvailable, createDb, dropAll, tmp, scenario, runNode, adminQuery, readJson } from "./support/helpers.mjs";
import { sourceHashes, fileSha256 } from "../server/migrate.mjs";
import { PgDb } from "../server/db/postgres.mjs";
import { importSqliteIntoPg, fingerprintSqlite, fingerprintPg, pgCounts } from "../server/db/transfer.mjs";
import { SqliteDb } from "../server/db/sqlite.mjs";

const HAVE_PG = await pgAvailable();
const skip = HAVE_PG ? false : "brak RIW_TEST_PG_URL — testy PostgreSQL pominięte";
let srcDir, src, base, hashes;
const tool = (args, db, extra = {}) => runNode(["tools/db-migrate.mjs", ...args, "--json"], { env: Object.assign({ DB_DRIVER: "sqlite", DATABASE_URL: db ? db.url : "" }, extra) });
const count = async (db, table) => Number((await adminQuery(`SELECT COUNT(*) AS n FROM ${table}`, [], db.name)).rows[0].n);

before(async () => {
  if (!HAVE_PG) return;
  srcDir = tmp("src"); base = scenario(srcDir, "sqlite"); src = join(srcDir, "resinvest.sqlite");
  // dane „z życia”: sesje, dziennik logowań, tokeny, kolejka poczty (także wiadomość z treścią i znakami specjalnymi)
  const db = new DatabaseSync(src);
  db.prepare("INSERT INTO sessions(token_hash, user_id, created_at, last_seen, expires_at, ip, ua) VALUES (?, ?, ?, ?, ?, ?, ?)").run("a".repeat(64), "u_admin", "2026-11-09T07:00:00.000Z", "2026-11-09T07:05:00.000Z", "2099-01-01T00:00:00.000Z", "10.0.0.7", "Mozilla/5.0 (Zażółć)");
  for (let i = 0; i < 25; i++) db.prepare("INSERT INTO login_log(ts, login, user_id, ok, reason, ip) VALUES (?, ?, ?, ?, ?, ?)").run(`2026-11-09T07:${String(i).padStart(2, "0")}:00.000Z`, "magazyn@resinvest.group", i % 3 ? "u_admin" : null, i % 3 ? 1 : 0, i % 3 ? "" : "błędne hasło", "10.0.0." + i);
  db.prepare("INSERT INTO tokens(token_hash, user_id, kind, email, created_at, expires_at, used_at, created_by) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)").run("b".repeat(64), "u_mag", "reset", "x@resinvest.group", "2026-11-09T07:00:00.000Z", "2026-11-09T08:00:00.000Z", "u_admin");
  for (let i = 0; i < 12; i++) db.prepare("INSERT INTO outbox(ts, template, to_addr, user_id, status, error, provider_id, transport, kind, subject, body, attempts, next_at, notice_id, sent_at, updated_at) VALUES (?, 'notice', ?, ?, ?, ?, ?, 'smtp', 'notice', ?, ?, ?, ?, ?, ?, ?)")
    .run("2026-11-09T07:10:00.000Z", `odbiorca${i}@resinvest.group`, "u_kier", i % 4 === 0 ? "FAILED" : "SENT", i % 4 === 0 ? "550 odrzucono 'x'" : null, i % 4 ? "id-" + i : null, "Temat ąęś 🌲 " + i, i % 4 === 0 ? JSON.stringify({ html: "<p>'\"\\ ; --</p>", n: i }) : null, i % 4 === 0 ? 2 : 1, i % 4 === 0 ? "2026-11-09T08:10:00.000Z" : null, "nt_" + i, i % 4 ? "2026-11-09T07:10:05.000Z" : null, "2026-11-09T07:10:05.000Z");
  db.prepare("DELETE FROM outbox WHERE id IN (11, 12)").run();       // luka w numeracji: licznik AUTOINCREMENT (12) > najwyższy identyfikator (10)
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); db.close();
  hashes = sourceHashes(src);
});
after(dropAll);

test("plan: tylko odczyt — źródło i cel bez zmian", { skip }, async () => {
  const db = await createDb("plan");
  const r = tool(["plan", "--data", srcDir], db); assert.equal(r.code, 0, r.err + r.out);
  const j = JSON.parse(r.out);
  assert.equal(j.source.summary.integrity, true); assert.equal(j.source.summary.rev, base.summary.rev);
  assert.equal(j.source.tables.journal.count, base.counts.journal); assert.equal(j.source.tables.login_log.count, 25);
  assert.equal(j.target.empty, true); assert.equal(j.sourceUnchanged, true);
  assert.deepEqual(sourceHashes(src), hashes);
  assert.equal((await adminQuery("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = 'public'", [], db.name)).rows[0].n, "0", "plan nie tworzy tabel w bazie docelowej");
});

test("migrate wymaga --confirm", { skip }, async () => {
  const db = await createDb("noconf");
  const r = tool(["migrate", "--data", srcDir], db);
  assert.equal(r.code, 2); assert.match(r.err, /--confirm/);
});

test("migracja: wszystkie tabele identyczne, stan i dziennik identyczne, plik SQLite nietknięty", { skip }, async () => {
  const db = await createDb("mig");
  const r = tool(["migrate", "--data", srcDir, "--confirm"], db); assert.equal(r.code, 0, r.err + r.out);
  const j = JSON.parse(r.out);
  assert.equal(j.ok, true); assert.equal(j.sourceUnchanged, true); assert.deepEqual(j.summaryDiff, []);
  for (const t of Object.keys(j.source.tables)) assert.deepEqual(j.target.tables[t], j.source.tables[t], t);
  assert.deepEqual(j.target.summary, j.source.summary);
  assert.equal(j.target.summary.fullState, base.summary.fullState); assert.equal(j.target.summary.journalHead, base.summary.journalHead);
  assert.deepEqual(sourceHashes(src), hashes, "plik źródłowy bez zmian (SHA-256)");
  assert.ok(existsSync(j.reportFile)); assert.equal(readJson(j.reportFile).ok, true);
  assert.equal(readdirSync(join(srcDir, "migracja")).filter(f => f.startsWith("robocze")).length, 0, "kopie robocze usunięte");
  // identyfikatory zachowane, numeracja kontynuowana od licznika SQLite
  assert.equal(await count(db, "journal"), base.counts.journal);
  assert.equal((await adminQuery("SELECT MAX(id) AS m FROM outbox", [], db.name)).rows[0].m, "10");
  assert.equal((await adminQuery("SELECT last_value FROM outbox_id_seq", [], db.name)).rows[0].last_value, "12", "następny numer wiadomości = 13, jak w SQLite");
  assert.equal((await adminQuery("SELECT last_value FROM journal_seq_seq", [], db.name)).rows[0].last_value, String(base.counts.journal));
  // niezależna kontrola
  const v = tool(["verify", "--data", srcDir], db); assert.equal(v.code, 0, v.out); assert.equal(JSON.parse(v.out).ok, true);
  // serwer na PostgreSQL widzi te same dane i przechodzi kontrolę spójności
  const chk = runNode(["server/riw-server.mjs", "--check"], { env: { RIW_DATA: tmp("chk"), DB_DRIVER: "postgres", DATABASE_URL: db.url } });
  assert.equal(chk.code, 0, chk.err); const cj = JSON.parse(chk.out.slice(chk.out.indexOf("{")));
  assert.deepEqual([cj.ok, cj.rev, cj.journal], [true, base.summary.rev, base.summary.journalCount]);
});

test("baza docelowa z danymi: odmowa bez --replace (nic nie zmienione); z --replace kopia poprzednich danych", { skip }, async () => {
  const db = await createDb("repl"), work = tmp("work");
  copyFileSync(src, join(work, "resinvest.sqlite"));
  assert.equal(tool(["migrate", "--data", work, "--confirm"], db).code, 0);
  await adminQuery("INSERT INTO meta(key, value) VALUES ('znacznik', 'przed')", [], db.name);
  const r = tool(["migrate", "--data", work, "--confirm"], db);
  assert.equal(r.code, 1); assert.match(JSON.parse(r.out).error, /zawiera już dane/);
  assert.equal(await count(db, "meta WHERE key = 'znacznik'"), 1, "odmowa nie zmienia bazy docelowej");
  const r2 = tool(["migrate", "--data", work, "--confirm", "--replace"], db); assert.equal(r2.code, 0, r2.out);
  const j = JSON.parse(r2.out);
  assert.ok(existsSync(j.target.previousDataBackup), "kopia dotychczasowych danych PostgreSQL");
  const keep = new DatabaseSync(j.target.previousDataBackup, { readOnly: true });
  assert.equal(keep.prepare("SELECT value FROM meta WHERE key = 'znacznik'").get().value, "przed"); keep.close();
  assert.equal(await count(db, "meta WHERE key = 'znacznik'"), 0);
});

test("uszkodzone źródło: zmieniony rekord albo naruszony dziennik → migracja odmawia, cel pusty", { skip }, async () => {
  for (const tamper of ["row", "journal"]) {
    const db = await createDb("bad"), work = tmp("bad");
    copyFileSync(src, join(work, "resinvest.sqlite"));
    const x = new DatabaseSync(join(work, "resinvest.sqlite"));
    if (tamper === "row") x.exec("UPDATE rows SET json = replace(json, '\"qty\":', '\"qty\": ') WHERE coll = 'ledger' AND id = (SELECT id FROM rows WHERE coll = 'ledger' LIMIT 1)");
    else { x.exec("DROP TRIGGER journal_no_update"); x.exec("UPDATE journal SET args = '{}' WHERE seq = 3"); }
    x.close();
    const r = tool(["migrate", "--data", work, "--confirm"], db);
    assert.equal(r.code, 1, tamper); assert.match(JSON.parse(r.out).error, /kontroli spójności/);
    assert.equal((await adminQuery("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = 'public'", [], db.name)).rows[0].n, "0", "cel bez zmian");
  }
});

test("import jest atomowy: niezgodność wykryta przed zatwierdzeniem wycofuje całość", { skip }, async () => {
  const db = await createDb("atom"), pg = new PgDb(db.cfg);
  try {
    pg.ensureSchema(); pg.prepare("INSERT INTO meta(key, value) VALUES (?, ?)").run("znacznik", "zostaje");
    const lite = new SqliteDb(src, { readOnly: true }); const fp = fingerprintSqlite(lite); lite.close();
    const bad = JSON.parse(JSON.stringify(fp)); bad.tables.rows.sha256 = "0".repeat(64);
    assert.throws(() => importSqliteIntoPg(pg, src, { replace: true, verify: bad }), /import wycofany/);
    const c = pgCounts(pg);
    assert.equal(c.meta, 1); assert.equal(c.rows, 0); assert.equal(c.journal, 0);
    assert.equal(pg.prepare("SELECT value FROM meta WHERE key = ?").get("znacznik").value, "zostaje");
    // poprawny odcisk → import przechodzi, a odcisk celu równa się odciskowi źródła
    importSqliteIntoPg(pg, src, { replace: true, verify: fp });
    assert.deepEqual(fingerprintPg(pg).tables, fp.tables);
  } finally { pg.close(); }
});

test("wycofanie: PostgreSQL → plik .sqlite (zgodny), powrót serwera na SQLite z danymi wprowadzonymi w PostgreSQL", { skip }, async () => {
  const db = await createDb("back"), work = tmp("back");
  copyFileSync(src, join(work, "resinvest.sqlite"));
  assert.equal(tool(["migrate", "--data", work, "--confirm"], db).code, 0);
  // praca na PostgreSQL po migracji: kopia + wpis w dzienniku (nowa rewizja)
  const pgEnv = { RIW_DATA: work, DB_DRIVER: "postgres", DATABASE_URL: db.url };
  assert.equal(runNode(["server/riw-server.mjs", "--reset-password", "magazyn@resinvest.group"], { env: pgEnv }).code, 0);
  const out = join(work, "powrot.sqlite");
  const r = tool(["rollback", "--data", work, "--to", out], db); assert.equal(r.code, 0, r.err + r.out);
  const j = JSON.parse(r.out);
  assert.equal(j.ok, true); assert.deepEqual(j.diff, []); assert.equal(j.summary.integrity, true); assert.equal(j.sha256, fileSha256(out));
  assert.equal(tool(["rollback", "--data", work, "--to", out], db).code, 1, "istniejący plik nie jest nadpisywany");
  // powrót: DB_DRIVER=sqlite + --restore; dotychczasowy plik zachowany jako pre-restore
  const liteEnv = { RIW_DATA: work, DB_DRIVER: "sqlite" };
  const rs = runNode(["server/riw-server.mjs", "--restore", out], { env: liteEnv }); assert.equal(rs.code, 0, rs.err + rs.out);
  assert.ok(readdirSync(join(work, "backups")).some(f => /pre-restore\.sqlite$/.test(f)));
  const chk = runNode(["server/riw-server.mjs", "--check"], { env: liteEnv }); assert.equal(chk.code, 0, chk.out);
  const lite = new DatabaseSync(join(work, "resinvest.sqlite"), { readOnly: true });
  assert.equal(lite.prepare("SELECT COUNT(*) AS n FROM login_log WHERE reason LIKE 'reset hasła%'").get().n, 1, "zmiana wykonana na PostgreSQL jest w pliku SQLite");
  assert.equal(lite.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'outbox'").get().seq, 12, "licznik numeracji zachowany w obie strony"); lite.close();
});

test("przywracanie kopii do PostgreSQL (--restore): kontrola pliku, kopia pre-restore, dane zastąpione", { skip }, async () => {
  const db = await createDb("rest"), work = tmp("rest"), env = { RIW_DATA: work, DB_DRIVER: "postgres", DATABASE_URL: db.url };
  copyFileSync(src, join(work, "resinvest.sqlite"));
  assert.equal(tool(["migrate", "--data", work, "--confirm"], db).code, 0);
  const bk = runNode(["server/riw-server.mjs", "--backup-now"], { env }); assert.equal(bk.code, 0, bk.err);
  const file = bk.out.trim().split("\n").pop(); assert.ok(existsSync(file), file);
  assert.equal(runNode(["server/riw-server.mjs", "--reset-password", "magazyn@resinvest.group"], { env }).code, 0);   // zmiana po kopii
  assert.equal(await count(db, "login_log"), 26);
  const r = runNode(["server/riw-server.mjs", "--restore", file], { env }); assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /Poprzednia baza zachowana: .*pre-restore\.sqlite/); assert.match(r.out, /Przywrócono: rewizja \d+/);
  assert.equal(await count(db, "login_log"), 25, "stan z kopii");
  // plik niebędący kopią / uszkodzony → odmowa, baza bez zmian
  const junk = join(work, "smiec.sqlite"); const jdb = new DatabaseSync(junk); jdb.exec("CREATE TABLE x(a)"); jdb.close();
  const bad = runNode(["server/riw-server.mjs", "--restore", junk], { env }); assert.equal(bad.code, 1); assert.match(bad.err, /baza bez zmian/);
  assert.equal(await count(db, "login_log"), 25);
  assert.equal(runNode(["server/riw-server.mjs", "--check"], { env }).code, 0);
});

test("starsza baza (kolejka poczty sprzed 3.5, bez kolumn kind/subject/…) i znak NUL w tekście", { skip }, async () => {
  const db = await createDb("old"), work = tmp("old"), f = join(work, "resinvest.sqlite");
  copyFileSync(src, f);
  const x = new DatabaseSync(f);
  x.exec("DROP INDEX outbox_due; CREATE TABLE o2(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, template TEXT NOT NULL, to_addr TEXT NOT NULL, user_id TEXT, status TEXT NOT NULL, error TEXT, provider_id TEXT, transport TEXT); INSERT INTO o2 SELECT id, ts, template, to_addr, user_id, status, error, provider_id, transport FROM outbox; DROP TABLE outbox; ALTER TABLE o2 RENAME TO outbox;");
  x.exec("UPDATE sessions SET ua = 'Agent' || char(0) || 'Zero' WHERE user_id = 'u_admin'");
  x.close();
  const r = tool(["migrate", "--data", work, "--confirm"], db); assert.equal(r.code, 0, r.out);
  const j = JSON.parse(r.out);
  assert.equal(j.nulCharactersRemoved, 1);
  // node:sqlite zwraca tekst do znaku NUL — serwer na SQLite widzi „Agent”; ta sama wartość trafia do PostgreSQL
  assert.equal((await adminQuery("SELECT ua FROM sessions", [], db.name)).rows[0].ua, "Agent");
  const o = (await adminQuery("SELECT kind, attempts, subject FROM outbox WHERE id = 1", [], db.name)).rows[0];
  assert.deepEqual([o.kind, o.attempts, o.subject], ["auth", 0, null], "wartości domyślne jak po ALTER TABLE w SQLite");
});
