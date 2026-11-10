/* Wspólne narzędzia testów PostgreSQL: bazy jednorazowe, katalogi tymczasowe, serwer w procesie potomnym, klient HTTP.
   Adres administracyjny klastra testowego: RIW_TEST_PG_URL (np. postgres://postgres:haslo@127.0.0.1:5432/postgres).
   Testy tworzą i usuwają własne bazy „riw_t_…”; nie dotykają żadnej innej bazy. */
import pg from "pg";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ADMIN_URL = process.env.RIW_TEST_PG_URL || "";
export const NODE_FLAGS = ["--disable-warning=ExperimentalWarning"];
// rola testowa bez uprawnień administratora; hasło stałe (pliki testów działają równolegle w osobnych procesach)
const APP_ROLE = "riw_test_app", APP_PASS = process.env.RIW_TEST_APP_PASSWORD || "Riw-test#2026";
const created = [], dirs = [];

export async function pgAvailable() {
  if (!ADMIN_URL) return false;
  const c = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 3000 });
  try { await c.connect(); await c.end(); return true; } catch (e) { return false; }
}
export async function adminQuery(sql, params, database) {
  const u = new URL(ADMIN_URL); if (database) u.pathname = "/" + database;
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  try { return await c.query(sql, params); } finally { await c.end(); }
}
/** Nowa, pusta baza testowa należąca do roli aplikacji BEZ uprawnień administratora (jak w produkcji). */
export async function createDb(label = "t") {
  const name = `riw_t_${label}_${randomBytes(4).toString("hex")}`;
  try { await adminQuery(`CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${APP_PASS}'`); }
  catch (e) { if (e.code !== "42710" && e.code !== "23505") throw e; }      // rola już istnieje (inny plik testów)
  await adminQuery(`CREATE DATABASE ${name} OWNER ${APP_ROLE} ENCODING 'UTF8' TEMPLATE template0`);
  created.push(name);
  const u = new URL(ADMIN_URL); u.username = APP_ROLE; u.password = APP_PASS; u.pathname = "/" + name;
  return { name, url: u.toString(), cfg: { driver: "postgres", client: { connectionString: u.toString(), application_name: "riw-test" }, statementTimeoutMs: 60000, reconnectSeconds: 10 } };
}
export async function dropAll() {
  for (const name of created.splice(0)) { try { await adminQuery(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); } catch (e) { /* baza już usunięta */ } }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}
export function tmp(label = "riw") { const d = mkdtempSync(join(tmpdir(), `riw-${label}-`)); dirs.push(d); return d; }
/** Zakończenie wszystkich połączeń aplikacji z bazą (symulacja zerwania sieci / restartu bazy). */
export const killConnections = db => adminQuery("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [db]);

export function runNode(args, { env = {}, input } = {}) {
  const r = spawnSync(process.execPath, [...NODE_FLAGS, ...args], { cwd: ROOT, env: Object.assign({}, process.env, { BACKUP_COPY_TO: "" }, env), encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024 });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}
export function scenario(dataDir, driver, url) {
  const r = runNode(["tests/support/run-scenario.mjs", dataDir, driver, url || ""]);
  if (r.code !== 0) throw new Error("Scenariusz nieudany: " + r.err.slice(-2000));
  return JSON.parse(r.out);
}
/** Konfiguracja testowa serwera (bez konta startowego, wysoki limit prób z jednego adresu dla testów obciążeniowych). */
export function serverConfig(dir, over = {}) {
  const file = join(dir, "server.config.test.json");
  writeFileSync(file, JSON.stringify(Object.assign({ port: 0, host: "127.0.0.1", dataDir: dir, todayOverride: "2026-11-09", security: { maxFailed: 5, lockMinutes: 15, ipAttemptsPer15Min: 100000 }, backup: { hour: 2, keepDays: 30, dir: "" }, initialAdmin: { email: "" } }, over)));
  return file;
}
let nextPort = 18200 + Math.floor(Math.random() * 400);
/** Serwer ResInvest ERP w procesie potomnym. dbEnv: {} = SQLite, { DB_DRIVER: "postgres", DATABASE_URL } = PostgreSQL. */
export async function startServer(dir, dbEnv = {}, cfgOver = {}) {
  const port = nextPort++, cfgFile = serverConfig(dir, cfgOver);
  const env = Object.assign({}, process.env, { RIW_CONFIG: cfgFile, RIW_PORT: String(port), RIW_DATA: dir, RIW_HOST: "127.0.0.1", BACKUP_COPY_TO: "", EMAIL_TRANSPORT: "file", DB_DRIVER: "sqlite", DATABASE_URL: "" }, dbEnv);
  const proc = spawn(process.execPath, [...NODE_FLAGS, "server/riw-server.mjs"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let logs = ""; proc.stdout.on("data", d => { logs += d; }); proc.stderr.on("data", d => { logs += d; });
  const exited = new Promise(ok => proc.on("exit", code => ok(code)));
  const base = `http://127.0.0.1:${port}`;
  const t0 = Date.now(); let up = false;
  while (Date.now() - t0 < 20000) {
    if (proc.exitCode !== null) break;
    try { const r = await fetch(base + "/api/health"); if (r.ok) { up = true; break; } } catch (e) { /* jeszcze nie słucha */ }
    await new Promise(r => setTimeout(r, 100));
  }
  const srv = { proc, base, port, env, exited, up, logs: () => logs, exitCode: () => proc.exitCode,
    async stop(sig = "SIGTERM") { if (proc.exitCode === null) { proc.kill(sig); await exited; } return proc.exitCode; } };
  return srv;
}
/** Klient HTTP z sesją (ciasteczko) i nagłówkiem aplikacji. */
export function client(base) {
  let cookie = "";
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: Object.assign({ "x-riw": "1" }, body !== undefined ? { "content-type": "application/json" } : {}, cookie ? { cookie } : {}, headers), body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    let data = null; const text = await r.text(); try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: r.status, data };
  };
  return { get: (p, h) => call("GET", p, undefined, h), post: (p, b, h) => call("POST", p, b === undefined ? {} : b, h), cookie: () => cookie, setCookie: c => { cookie = c; },
    login: (login, password) => call("POST", "/api/auth/login", { login, password }),
    cmd: (cmd, args, haveRev) => call("POST", "/api/cmd", { cmd, args, haveRev }) };
}
export const readJson = f => JSON.parse(readFileSync(f, "utf8"));
