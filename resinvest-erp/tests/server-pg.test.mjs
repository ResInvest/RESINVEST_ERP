/* Serwer HTTP na PostgreSQL: integracja (te same ścieżki API co interfejs), wielu użytkowników, odporność na zerwanie
   połączenia z bazą, jeden serwer zapisujący, bezpieczeństwo. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pgAvailable, createDb, dropAll, tmp, runNode, startServer, client, adminQuery, killConnections } from "./support/helpers.mjs";
import { R } from "../server/core.mjs";

const HAVE_PG = await pgAvailable();
const skip = HAVE_PG ? false : "brak RIW_TEST_PG_URL — testy PostgreSQL pominięte";
const ADMIN = ["magazyn@resinvest.group", "Test-Admin#2026"], USERPW = "Test-User#2026", TODAY = "2026-11-09";
let db, dir, srv, pgEnv;
const purchase = (qty, note) => R.Seed.draftOf(TODAY, { purchase: { supplierId: "pa_drwal", basis: "DEKL", productId: "pr_zr_tow", qty: String(qty), unit: "MP", price: "56" }, transport: { mode: "none", place: "RiC Zabrze" }, notes: note || "" });
const q = async (sql, p) => (await adminQuery(sql, p, db.name)).rows;
const login = async (who, pw) => { const c = client(srv.base); const r = await c.login(who, pw); assert.equal(r.status, 200, JSON.stringify(r.data)); return c; };

before(async () => {
  if (!HAVE_PG) return;
  db = await createDb("srv"); dir = tmp("srv"); pgEnv = { DB_DRIVER: "postgres", DATABASE_URL: db.url };
  const s = runNode(["tests/support/seed-db.mjs", dir, "postgres", db.url]); assert.equal(s.code, 0, s.err);
  srv = await startServer(dir, pgEnv); assert.equal(srv.up, true, srv.logs());
});
after(async () => { if (srv) await srv.stop(); await dropAll(); });

test("health: tryb serwera, silnik bazy postgres, spójność", { skip }, async () => {
  const r = await client(srv.base).get("/api/health");
  assert.equal(r.status, 200); assert.equal(r.data.db, "postgres"); assert.equal(r.data.integrity, true); assert.equal(r.data.setup, false);
  assert.match(srv.logs(), /Baza danych: PostgreSQL \d+/);
});

test("logowanie, stan, komenda, synchronizacja drugiego użytkownika (delta od rewizji)", { skip }, async () => {
  const a = await login(...ADMIN), b = await login("anna.gorska@resinvest.group", USERPW);
  const s0 = (await b.get("/api/state")).data; assert.equal(s0.ok, true);
  const r = await a.cmd("op.commit", { draft: purchase(11, "integracja") }, s0.rev);
  assert.equal(r.status, 200); assert.equal(r.data.res.ok, true, JSON.stringify(r.data.res).slice(0, 300)); assert.match(r.data.res.op.no, /^\w+\/\d+\/11\/2026$/);
  const s1 = (await b.get("/api/state?since=" + s0.rev)).data;
  assert.equal(s1.rev, s0.rev + 1);
  const ops = (s1.state && s1.state.operations) || (s1.delta && s1.delta.up && s1.delta.up.operations) || [];
  assert.ok(JSON.stringify(s1).includes(r.data.res.op.id), "drugi użytkownik widzi nową operację");
  assert.ok(Array.isArray(ops));
  // dane są w PostgreSQL: wiersz operacji, wpis dziennika, rewizja
  assert.equal((await q("SELECT COUNT(*) AS n FROM rows WHERE coll = 'operations' AND id = $1", [r.data.res.op.id]))[0].n, "1");
  const j = (await q("SELECT cmd, user_login, rev_after FROM journal ORDER BY seq DESC LIMIT 1"))[0];
  assert.deepEqual([j.cmd, j.user_login, Number(j.rev_after)], ["op.commit", ADMIN[0], s1.rev]);
  assert.equal(Number((await q("SELECT rev FROM state WHERE id = 1"))[0].rev), s1.rev);
});

test("sesje i konta w PostgreSQL: wylogowanie unieważnia sesję; w bazie tylko skrót tokenu", { skip }, async () => {
  const c = await login(...ADMIN);
  const token = c.cookie().split("=")[1];
  assert.equal((await q("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = $1", [token]))[0].n, "0", "token nie jest zapisany jawnie");
  assert.equal((await c.get("/api/auth/me")).status, 200);
  await c.post("/api/auth/logout");
  assert.equal((await c.get("/api/state")).status, 401);
  const acc = (await q("SELECT algo, length(hash) AS n FROM accounts WHERE user_id = 'u_admin'"))[0];
  assert.deepEqual([acc.algo, acc.n], ["scrypt", 64]);
});

test("kopie zapasowe przez API i z wiersza poleceń przy działającym serwerze; kontrola spójności", { skip }, async () => {
  const c = await login(...ADMIN);
  const r = await c.post("/api/backups"); assert.equal(r.status, 200); assert.match(r.data.name, /^resinvest-\d{8}-\d{6}-manual\.sqlite$/);
  const list = (await c.get("/api/backups")).data; assert.ok(list.backups.some(b => b.name === r.data.name)); assert.ok(list.last);
  const dl = await fetch(srv.base + "/api/backups/" + r.data.name, { headers: { cookie: c.cookie() } });
  assert.equal(dl.status, 200); const buf = Buffer.from(await dl.arrayBuffer()); assert.equal(buf.subarray(0, 15).toString(), "SQLite format 3");
  // kopia jest pełną bazą w formacie serwera: te same liczby rekordów co w PostgreSQL
  const lite = new DatabaseSync(join(dir, "backups", r.data.name), { readOnly: true });
  assert.equal(String(lite.prepare("SELECT COUNT(*) AS n FROM rows").get().n), (await q("SELECT COUNT(*) AS n FROM rows"))[0].n);
  assert.equal(String(lite.prepare("SELECT COUNT(*) AS n FROM journal").get().n), (await q("SELECT COUNT(*) AS n FROM journal"))[0].n);
  assert.equal(lite.prepare("PRAGMA integrity_check").get().integrity_check, "ok"); lite.close();
  const chk = runNode(["server/riw-server.mjs", "--check"], { env: Object.assign({ RIW_DATA: dir }, pgEnv) }); assert.equal(chk.code, 0, chk.err + chk.out);
  const cli = runNode(["server/riw-server.mjs", "--backup-now"], { env: Object.assign({ RIW_DATA: dir }, pgEnv) }); assert.equal(cli.code, 0, cli.err);
  assert.equal((await client(srv.base).get("/api/health")).data.ok, true, "serwer pracuje dalej");
});

test("jeden serwer zapisujący: druga instancja na tej samej bazie nie startuje", { skip }, async () => {
  const second = await startServer(tmp("second"), pgEnv);
  const code = await second.exited;
  assert.equal(second.up, false); assert.equal(code, 2); assert.match(second.logs(), /obsługuje już inny serwer ResInvest ERP/);
  assert.equal((await client(srv.base).get("/api/health")).data.ok, true);
});

test("zerwane połączenie z bazą (restart PostgreSQL / sieć): serwer łączy się ponownie, dane bez strat", { skip }, async () => {
  const c = await login(...ADMIN);
  const before = (await c.get("/api/state")).data.rev;
  await killConnections(db.name);
  const r1 = await c.cmd("op.commit", { draft: purchase(5, "po zerwaniu 1") }, before);
  assert.equal(r1.status, 200); assert.equal(r1.data.res.ok, true, JSON.stringify(r1.data.res).slice(0, 300));
  await killConnections(db.name);
  assert.equal((await c.get("/api/auth/me")).status, 200, "odczyt sesji po zerwaniu");
  await killConnections(db.name);
  const r2 = await c.cmd("op.commit", { draft: purchase(6, "po zerwaniu 2") }, before + 1);
  assert.equal(r2.data.res.ok, true);
  assert.equal((await c.get("/api/state")).data.rev, before + 2);
  assert.equal(Number((await q("SELECT rev FROM state WHERE id = 1"))[0].rev), before + 2);
  assert.match(srv.logs(), /Połączenie z bazą PostgreSQL odzyskane/);
  // blokada serwera zapisującego odzyskana po ponownym połączeniu
  const second = await startServer(tmp("second2"), pgEnv); assert.equal(await second.exited, 2);
  const chk = runNode(["server/riw-server.mjs", "--check"], { env: Object.assign({ RIW_DATA: dir }, pgEnv) }); assert.equal(chk.code, 0, chk.out);
});

test("zmiana danych przez inny proces: zapis odrzucony (ochrona przed nadpisaniem), nic nie utracone", { skip }, async () => {
  const c = await login(...ADMIN);
  const rev = (await c.get("/api/state")).data.rev;
  await q("UPDATE state SET rev = rev + 100 WHERE id = 1");                       // symulacja: inny proces zapisał nowszą rewizję
  const ops = (await q("SELECT COUNT(*) AS n FROM rows WHERE coll = 'operations'"))[0].n, jn = (await q("SELECT COUNT(*) AS n FROM journal"))[0].n;
  const r = await c.cmd("op.commit", { draft: purchase(7, "konflikt") }, rev);
  assert.equal(r.data.res.ok, false); assert.equal(r.data.res.code, "DB"); assert.match(r.data.res.error, /nic nie zapisano/);
  assert.equal((await q("SELECT COUNT(*) AS n FROM rows WHERE coll = 'operations'"))[0].n, ops, "żaden wiersz nie został zapisany");
  assert.equal((await q("SELECT COUNT(*) AS n FROM journal"))[0].n, jn);
  assert.equal((await c.get("/api/state")).data.rev, rev, "stan serwera bez zmian");
  await q("UPDATE state SET rev = rev - 100 WHERE id = 1");
  assert.equal((await c.cmd("op.commit", { draft: purchase(7, "po konflikcie") }, rev)).data.res.ok, true);
});

test("bezpieczeństwo: brak sesji 401, brak nagłówka aplikacji 403, role i izolacja uprawnień", { skip }, async () => {
  const anon = client(srv.base);
  assert.equal((await anon.get("/api/state")).status, 401);
  assert.equal((await anon.cmd("op.commit", { draft: purchase(1) })).status, 401);
  const admin = await login(...ADMIN);
  const noHdr = await fetch(srv.base + "/api/cmd", { method: "POST", headers: { "content-type": "application/json", cookie: admin.cookie() }, body: JSON.stringify({ cmd: "me.prefs", args: {} }) });
  assert.equal(noHdr.status, 403);
  const cross = await fetch(srv.base + "/api/cmd", { method: "POST", headers: { "content-type": "application/json", "x-riw": "1", origin: "http://zly.example", cookie: admin.cookie() }, body: JSON.stringify({ cmd: "me.prefs", args: {} }) });
  assert.equal(cross.status, 403);
  const viewer = await login("beata.nowak@resinvest.group", USERPW);
  const rv = await viewer.cmd("op.commit", { draft: purchase(1) }); assert.equal(rv.status, 403); assert.equal(rv.data.res.code, "FORBIDDEN");
  assert.equal((await viewer.post("/api/backups")).status, 403);
  assert.equal((await viewer.get("/api/auth/log")).status, 403);
  // stan wysyłany do przeglądarki nie zawiera skrótów haseł ani danych połączenia z bazą
  const st = JSON.stringify((await admin.get("/api/state")).data);
  for (const secret of ["scrypt", "token_hash", "riw_test_app", "DATABASE_URL", new URL(db.url).password]) assert.ok(!st.includes(secret), secret);
  assert.ok(!srv.logs().includes(new URL(db.url).password), "hasło bazy nie trafia do dziennika serwera");
});

test("bezpieczeństwo: wstrzyknięcie SQL w loginie i w danych komend jest nieskuteczne (parametry wiązane)", { skip }, async () => {
  const evil = ["' OR '1'='1", "x'; DROP TABLE journal; --", "magazyn@resinvest.group' --", "\\'; DELETE FROM accounts; --", "a@b.c\u0000x"];
  for (const e of evil) { const r = await client(srv.base).login(e, e); assert.equal(r.status, 401, e); }
  const c = await login(...ADMIN);
  const note = "Uwaga'); DROP TABLE rows; -- \" \\ $1 ?; SELECT pg_sleep(10) 🌲";
  const r = await c.cmd("op.commit", { draft: purchase(3, note) }); assert.equal(r.data.res.ok, true, JSON.stringify(r.data.res).slice(0, 200));
  const stored = JSON.parse((await q("SELECT json FROM rows WHERE coll = 'operations' AND id = $1", [r.data.res.op.id]))[0].json);
  assert.equal(stored.notes, note, "tekst zapisany dosłownie");
  const bad = await c.cmd("op.cancel", { opId: "x' OR '1'='1", reason: "'; DROP TABLE state; --", ack: true }); assert.equal(bad.data.res.ok, false);
  for (const t of ["journal", "rows", "accounts", "state"]) assert.ok(Number((await q(`SELECT COUNT(*) AS n FROM ${t}`))[0].n) > 0, t);
  assert.ok(Number((await q("SELECT COUNT(*) AS n FROM login_log WHERE ok = 0"))[0].n) >= 4, "nieudane próby zapisane w dzienniku logowań");
});

test("bezpieczeństwo: blokada konta po nieudanych próbach jest trwała w bazie; odblokowanie przez administratora", { skip }, async () => {
  const who = "adrian.wojciechowski@resinvest.group";
  for (let i = 0; i < 5; i++) assert.equal((await client(srv.base).login(who, "zle-haslo-" + i)).status, 401);
  const acc = (await q("SELECT failed, locked_until FROM accounts WHERE user_id = 'u_mag'"))[0];
  assert.ok(acc.locked_until && Date.parse(acc.locked_until) > Date.now());
  const r = await client(srv.base).login(who, USERPW); assert.equal(r.status, 401); assert.equal(r.data.code, "LOCKED");
  const admin = await login(...ADMIN);
  assert.equal((await admin.post("/api/users/unlock", { userId: "u_mag" })).status, 200);
  assert.equal((await client(srv.base).login(who, USERPW)).status, 200);
});

test("bezpieczeństwo: ręczna zmiana rekordu albo dziennika w bazie jest wykrywana przy kontroli", { skip }, async () => {
  const d2 = await createDb("tamper"), dir2 = tmp("tamper"), env = { RIW_DATA: dir2, DB_DRIVER: "postgres", DATABASE_URL: d2.url };
  assert.equal(runNode(["tests/support/seed-db.mjs", dir2, "postgres", d2.url]).code, 0);
  assert.equal(runNode(["server/riw-server.mjs", "--check"], { env }).code, 0);
  await adminQuery("UPDATE rows SET json = replace(json, '\"qty\":', '\"qty\": ') WHERE (coll, id) IN (SELECT coll, id FROM rows WHERE coll = 'ledger' LIMIT 1)", [], d2.name);
  const r = runNode(["server/riw-server.mjs", "--check"], { env }); assert.equal(r.code, 2); assert.match(r.out, /row checksum mismatch/);
  await assert.rejects(adminQuery("UPDATE journal SET args = '{}'", [], d2.name), /append-only/);
  await assert.rejects(adminQuery("DELETE FROM journal", [], d2.name), /append-only/);
});

test("błędne dane połączenia: serwer nie startuje, czytelny komunikat, hasło nieujawnione", { skip }, async () => {
  const u = new URL(db.url); u.password = "zle-haslo-XYZ";
  const bad = await startServer(tmp("badpw"), { DB_DRIVER: "postgres", DATABASE_URL: u.toString() });
  assert.equal(await bad.exited, 3); assert.match(bad.logs(), /Baza PostgreSQL niedostępna/); assert.ok(!bad.logs().includes("zle-haslo-XYZ"));
  const cfgErr = await startServer(tmp("badcfg"), { DB_DRIVER: "postgres", DATABASE_URL: "", DB_NAME: "", DB_USER: "" });
  assert.equal(await cfgErr.exited, 1); assert.match(cfgErr.logs(), /Konfiguracja bazy danych/);
});

test("ponowne uruchomienie serwera: stan, sesje i numeracja dokumentów zachowane", { skip }, async () => {
  const c = await login(...ADMIN);
  const before = (await c.get("/api/state")).data, r0 = await c.cmd("op.commit", { draft: purchase(2, "przed restartem") }, before.rev);
  const no0 = r0.data.res.op.no;
  await srv.stop();
  assert.equal(readdirSync(dir).includes("resinvest.sqlite"), false, "w trybie PostgreSQL nie powstaje lokalny plik bazy");
  srv = await startServer(dir, pgEnv); assert.equal(srv.up, true, srv.logs());
  c.setCookie(c.cookie());
  const c2 = client(srv.base); c2.setCookie(c.cookie());
  const after = (await c2.get("/api/state")).data;
  assert.equal(after.rev, before.rev + 1, "sesja i rewizja zachowane po restarcie");
  const r1 = await c2.cmd("op.commit", { draft: purchase(2, "po restarcie") }, after.rev);
  const n = s => Number(/\/(\d+)\//.exec(s)[1]);
  assert.equal(n(r1.data.res.op.no), n(no0) + 1, "numeracja dokumentów ciągła");
});
