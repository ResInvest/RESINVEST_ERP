/* Instalator → strona „Baza danych” → riw-server.mjs --db-setup: konto i baza programu, zapis server.env,
   migracja z SQLite przy aktualizacji, ponowna instalacja, odmowy bez utraty danych. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { pgAvailable, adminQuery, tmp, runNode, dropAll, startServer, client } from "./support/helpers.mjs";
import { sourceHashes } from "../server/migrate.mjs";
import { parseEnv } from "../server/core.mjs";

const HAVE_PG = await pgAvailable();
const skip = HAVE_PG ? false : "brak RIW_TEST_PG_URL — testy PostgreSQL pominięte";
const A = HAVE_PG ? new URL(process.env.RIW_TEST_PG_URL) : null;
const made = { dbs: [], roles: [] };
after(async () => {
  for (const d of made.dbs) await adminQuery(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`).catch(() => {});
  for (const r of made.roles) await adminQuery(`DROP ROLE IF EXISTS ${r}`).catch(() => {});
  await dropAll();
});
const names = () => { const id = randomBytes(3).toString("hex"); const n = { database: "riw_s_" + id, user: "riw_s_app_" + id }; made.dbs.push(n.database); made.roles.push(n.user); return n; };
function setup(dir, body) {
  const f = join(dir, "db-setup.json"), res = join(dir, "db-setup.txt");
  writeFileSync(f, "﻿" + JSON.stringify(Object.assign({ mode: "postgres", host: A.hostname, port: A.port || 5432, resultFile: res }, body)));
  const r = runNode(["server/riw-server.mjs", "--data", dir, "--db-setup", f], { env: { DB_DRIVER: null, DATABASE_URL: null } });
  return Object.assign(r, { result: existsSync(res) ? readFileSync(res, "utf8").replace(/^﻿/, "") : "" });
}
const envOf = dir => existsSync(join(dir, "server.env")) ? parseEnv(readFileSync(join(dir, "server.env"), "utf8")) : {};
const admin = () => ({ adminUser: decodeURIComponent(A.username), adminPassword: decodeURIComponent(A.password) });
const check = dir => runNode(["server/riw-server.mjs", "--data", dir, "--check"], { env: { DB_DRIVER: null, DATABASE_URL: null } });

test("nowa instalacja: konto i baza tworzone kontem administratora, hasło losowe, serwer startuje na PostgreSQL", { skip }, async () => {
  const dir = tmp("dbs-new"), n = names();
  const r = setup(dir, Object.assign({}, n, admin()));
  assert.equal(r.code, 0, r.out + r.err); assert.match(r.result, /konto riw_s_app_\w+: utworzone/); assert.match(r.result, /Nowa baza PostgreSQL/);
  const e = envOf(dir);
  assert.equal(e.DB_DRIVER, "postgres"); assert.equal(e.DB_USER, n.user); assert.equal(e.DB_NAME, n.database); assert.match(e.DB_PASSWORD, /^Riw-[\w-]{32}$/);
  assert.ok(!r.out.includes(e.DB_PASSWORD) && !r.result.includes(e.DB_PASSWORD) && !r.out.includes(admin().adminPassword), "hasła nie trafiają do wyniku");
  const role = (await adminQuery("SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = $1", [n.user])).rows[0];
  assert.deepEqual(role, { rolsuper: false, rolcreatedb: false, rolcreaterole: false }, "konto programu bez uprawnień administratora");
  // serwer z tym server.env: PostgreSQL, konto startowe (initialAdmin), logowanie
  const srv = await startServer(dir, { DB_DRIVER: null, DATABASE_URL: null }, { initialAdmin: { email: "magazyn@resinvest.group", name: "Administrator", password: "Admin-Start#2026" } });
  try {
    assert.equal(srv.up, true, srv.logs());
    assert.equal((await client(srv.base).get("/api/health")).data.db, "postgres");
    assert.equal((await client(srv.base).login("magazyn@resinvest.group", "Admin-Start#2026")).status, 200);
  } finally { await srv.stop(); }
  assert.equal(existsSync(join(dir, "resinvest.sqlite")), false, "nowa instalacja nie tworzy pliku SQLite");
});

test("aktualizacja: dane z SQLite przeniesione do PostgreSQL, plik SQLite nietknięty, kontrola spójności", { skip }, async () => {
  const dir = tmp("dbs-upg"), n = names();
  assert.equal(runNode(["tests/support/seed-db.mjs", dir, "sqlite"]).code, 0);
  const lc = check(dir), lite = JSON.parse(lc.out.slice(lc.out.indexOf("{")));
  const before = sourceHashes(join(dir, "resinvest.sqlite"));
  const r = setup(dir, Object.assign({}, n, admin()));
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.result, /Migracja zakończona: \d+ wierszy, rewizja \d+/); assert.match(r.result, /DB_DRIVER=postgres/);
  assert.deepEqual(sourceHashes(join(dir, "resinvest.sqlite")), before, "plik SQLite bez zmian");
  assert.equal(envOf(dir).DB_DRIVER, "postgres");
  const c = check(dir); assert.equal(c.code, 0, c.out);
  const pg = JSON.parse(c.out.slice(c.out.indexOf("{")));
  assert.deepEqual([pg.ok, pg.rev, pg.journal], [true, lite.rev, lite.journal], "ta sama rewizja i dziennik co w SQLite");
  assert.ok(readFileSync(join(dir, "logs", (await import("node:fs")).readdirSync(join(dir, "logs"))[0]), "utf8").includes("Baza danych z instalatora"));
  // starsza wersja danych → kopia „przed-aktualizacja” z PostgreSQL w folderze kopii (nie w folderze roboczym migracji)
  // (dane z seed-db mają bieżącą wersję — sprawdzane w osobnym teście z danymi 3.14)
  // ponowna instalacja (aktualizacja na PostgreSQL): bez zmian
  const r2 = setup(dir, Object.assign({}, n, admin()));
  assert.equal(r2.code, 0, r2.out); assert.match(r2.result, /już pracował na PostgreSQL/);
  assert.equal(JSON.parse(check(dir).out.slice(check(dir).out.indexOf("{"))).rev, lite.rev);
});

test("PostgreSQL z innymi danymi: nic nie nadpisane, serwer zostaje na SQLite (kod 4)", { skip }, async () => {
  const n = names(), d1 = tmp("dbs-a"), d2 = tmp("dbs-b");
  assert.equal(setup(d1, Object.assign({}, n, admin())).code, 0);
  assert.equal(runNode(["tests/support/seed-db.mjs", d1, "postgres", `postgres://${n.user}:${encodeURIComponent(envOf(d1).DB_PASSWORD)}@${A.host}/${n.database}`]).code, 0);
  assert.equal(runNode(["tests/support/seed-db.mjs", d2, "sqlite"]).code, 0);   // inna baza SQLite (inne identyfikatory)
  const rev = (await adminQuery("SELECT rev FROM state", [], n.database)).rows[0].rev;
  const r = setup(d2, Object.assign({}, n, admin()));
  assert.equal(r.code, 4, r.out); assert.match(r.result, /INNE dane/);
  assert.notEqual(envOf(d2).DB_DRIVER, "postgres");
  assert.equal((await adminQuery("SELECT rev FROM state", [], n.database)).rows[0].rev, rev, "baza PostgreSQL bez zmian");
  assert.equal(check(d2).code, 0, "serwer działa dalej na SQLite");
});

test("błędne hasło administratora / brak haseł / konto administratora jako konto programu: odmowa, server.env bez zmian", { skip }, async () => {
  const dir = tmp("dbs-bad"), n = names();
  writeFileSync(join(dir, "server.env"), "SMTP_HOST=smtp.example.com\r\n");
  let r = setup(dir, Object.assign({}, n, { adminUser: admin().adminUser, adminPassword: "zle-haslo" }));
  assert.equal(r.code, 2); assert.match(r.result, /Błąd przygotowania bazy/); assert.ok(!r.result.includes("zle-haslo"));
  r = setup(dir, n); assert.equal(r.code, 2); assert.match(r.result, /wpisz hasło konta programu albo hasło administratora/);
  r = setup(dir, Object.assign({}, n, admin(), { user: admin().adminUser }));
  assert.equal(r.code, 2); assert.match(r.result, /uprawnienia administratora PostgreSQL/);
  r = setup(dir, Object.assign({}, n, admin(), { database: "Zla; Nazwa" })); assert.equal(r.code, 2);
  assert.deepEqual(envOf(dir), { SMTP_HOST: "smtp.example.com" }, "server.env nietknięty");
});

test("konto i baza istnieją (bez hasła administratora), hasło ze znakami specjalnymi zapisane poprawnie", { skip }, async () => {
  const dir = tmp("dbs-own"), n = names(), pw = `P@ss "#;$ x'1`.replace("'", "");
  await adminQuery(`CREATE ROLE ${n.user} LOGIN PASSWORD '${pw.replace(/'/g, "''")}'`);
  await adminQuery(`CREATE DATABASE ${n.database} OWNER ${n.user}`);
  const r = setup(dir, Object.assign({}, n, { password: pw }));
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(envOf(dir).DB_PASSWORD, pw); assert.equal(envOf(dir).DB_DRIVER, "postgres");
  assert.equal(check(dir).code, 0);
});

test("tryb SQLite (wybór w kreatorze): DB_DRIVER=sqlite", { skip }, () => {
  const dir = tmp("dbs-lite");
  const r = setup(dir, { mode: "sqlite" });
  assert.equal(r.code, 0); assert.equal(envOf(dir).DB_DRIVER, "sqlite");
});

test("aktualizacja danych starszej wersji: kopia „przed-aktualizacja” w folderze kopii", { skip }, async () => {
  const dir = tmp("dbs-old"), n = names();
  assert.equal(runNode(["tests/support/seed-db.mjs", dir, "sqlite"]).code, 0);
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(dir, "resinvest.sqlite")); db.prepare("UPDATE meta SET value = '3.14.0' WHERE key = 'app_version'").run(); db.close();
  const r = setup(dir, Object.assign({}, n, admin()));
  assert.equal(r.code, 0, r.out + r.err);
  const { readdirSync } = await import("node:fs");
  const files = readdirSync(join(dir, "backups"));
  assert.ok(files.some(f => /^resinvest-.*-przed-aktualizacja-3_14_0\.sqlite$/.test(f)), files.join(", "));
  const kept = new DatabaseSync(join(dir, "backups", files.find(f => /przed-aktualizacja/.test(f))), { readOnly: true });
  assert.equal(kept.prepare("SELECT value FROM meta WHERE key = 'app_version'").get().value, "3.14.0", "kopia sprzed zmiany wersji"); kept.close();
});
