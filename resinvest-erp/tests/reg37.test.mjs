/* Testy 3.7 w trybie FIRMOWYM: czysta baza z kontem startowym administratora (initialAdmin w konfiguracji),
   rejestracja z potwierdzeniem adresu e-mail, powiadomienie administratorów, zatwierdzenie z rolą i magazynem,
   e-mail o zatwierdzeniu, ochrona przed samodzielnym nadaniem roli.
   Uruchomienie:  node --test tests/reg37.test.mjs  (Node ≥ 22.13) */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as netServer } from "node:net";
import { createServer as httpServer } from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
globalThis.RIW_CONFIG = {};
require("../app/src/i18n.js");
const R = require("../app/src/engine.js");
require("../app/src/seed.js");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "server", "riw-server.mjs");
const TODAY = "2026-09-23";
const ADMIN = "magazyn@resinvest.group", ADMIN_PW = "Biomasa2026", DEMO = "demo1234";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(res => { const s = netServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });

async function startServer(env, extra) {
  const dir = mkdtempSync(join(tmpdir(), "riw-reg37-"));
  const port = await freePort();
  const cfgFile = join(dir, "server.config.json");
  writeFileSync(cfgFile, JSON.stringify(Object.assign({ port, host: "127.0.0.1", dataDir: join(dir, "data"), security: { maxFailed: 5, lockMinutes: 15, ipAttemptsPer15Min: 1000 } }, extra || {})));
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(RESEND_|AGENTMAIL_|EMAIL_|SMTP_|APP_URL|RIW_)/.test(k)));
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", SERVER], { env: Object.assign(clean, { RIW_CONFIG: cfgFile, RIW_TODAY: TODAY, APP_URL: "https://erp.resinvest.test" }, env), stdio: "pipe" });
  let out = ""; proc.stdout.on("data", d => { out += d; }); proc.stderr.on("data", d => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch (e) {} await sleep(100); }
  const srv = { dir, data: join(dir, "data"), base, proc, log: () => out, client: () => client(base),
    stop: () => new Promise(res => { if (proc.exitCode !== null) return res(); proc.once("exit", res); proc.kill("SIGTERM"); }) };
  if (!(extra && extra.initialAdmin)) { const s = await srv.client().post("/api/setup", { name: "Mateusz Roesner", email: ADMIN, password: ADMIN_PW, sample: true }); assert.equal(s.status, 200, JSON.stringify(s.json)); }
  return srv;
}
function client(base) {
  let cookie = "";
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: Object.assign({ "Content-Type": "application/json", "X-RIW": "1", "Accept-Language": "pl" }, cookie ? { Cookie: cookie } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0].endsWith("=") ? "" : sc.split(";")[0];
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
    return { status: r.status, json };
  };
  return { get: p => call("GET", p), post: (p, b) => call("POST", p, b), cmd: (cmd, args) => call("POST", "/api/cmd", { cmd, args }), login: (login, password) => call("POST", "/api/auth/login", { login, password }) };
}
/** Logowanie; konto demonstracyjne przy pierwszym logowaniu zmienia hasło startowe (zapamiętane dla kolejnych testów). */
async function user(srv, login, pw) {
  srv.pw = srv.pw || {};
  const c = srv.client();
  const l = await c.login(login, pw || srv.pw[login] || DEMO);
  assert.equal(l.status, 200, JSON.stringify(l.json));
  if (l.json.mustChange) { assert.equal((await c.post("/api/auth/password", { old: DEMO, new: "Praca2026x" })).status, 200); srv.pw[login] = "Praca2026x"; }
  return c;
}


const INIT = { initialAdmin: { email: "magazyn@resinvest.group", name: "Administrator", password: "Admin1234" } };
const emls = (srv, kind) => { const d = join(srv.data, "mail-outbox"); return existsSync(d) ? readdirSync(d).filter(f => f.includes(`-${kind}-`)).sort().map(f => readFileSync(join(d, f), "utf8")) : []; };
const textOf = raw => { const m = /Content-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/.exec(raw); return m ? Buffer.from(m[1].replace(/\s+/g, ""), "base64").toString("utf8") : ""; };
const tokenOf = raw => (/token=([A-Za-z0-9_-]+)/.exec(textOf(raw)) || [])[1];

let S;
before(async () => { S = await startServer({ EMAIL_TRANSPORT: "file" }, INIT); });
after(async () => { if (S) { await S.stop(); rmSync(S.dir, { recursive: true, force: true }); } });

test("czysta baza: konto startowe administratora z konfiguracji, hasło startowe wymaga zmiany; brak danych przykładowych", async () => {
  const h = await (await fetch(S.base + "/api/health")).json();
  assert.equal(h.setup, false, "bez ekranu pierwszej konfiguracji");
  assert.equal(h.selfRegistration, true, "rejestracja włączona");
  const c = S.client();
  const l = await c.login("magazyn@resinvest.group", "Admin1234");
  assert.equal(l.status, 200, JSON.stringify(l.json));
  assert.equal(l.json.mustChange, true);
  assert.equal((await c.post("/api/auth/password", { old: "Admin1234", new: "Biomasa2027" })).status, 200);
  const st = (await c.get("/api/state")).json.state;
  assert.deepEqual(st.users.map(u => u.login), ["magazyn@resinvest.group"]);
  assert.equal(st.operations.length, 0); assert.equal(st.partners.length, 0); assert.equal(st.warehouses.length, 3);
  assert.equal(st.config.startup, undefined);
  // drugie uruchomienie nie nadpisuje hasła
  const again = await S.client().login("magazyn@resinvest.group", "Admin1234");
  assert.equal(again.status, 401);
  S.adminPw = "Biomasa2027";
});

test("rejestracja: domena sprawdzana na serwerze, link potwierdzający, logowanie i zatwierdzenie dopiero po potwierdzeniu", async () => {
  const anon = S.client();
  const bad = await anon.post("/api/auth/register", { rec: { name: "Jan Kowalski", email: "jan@gmail.com", role: "admin" }, password: "Magazyn2026" });
  assert.equal(bad.status, 400);
  const r = await anon.post("/api/auth/register", { rec: { name: "Jan Kowalski", email: "Jan.Kowalski@resinvest.group", role: "admin", whId: "wh_rok", status: "ACTIVE" }, password: "Magazyn2026" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.confirm, true); assert.equal(r.json.mail.ok, true);
  const dup = await anon.post("/api/auth/register", { rec: { name: "Jan Kowalski", email: "jan.kowalski@resinvest.group" }, password: "Magazyn2026" });
  assert.equal(dup.status, 400, "drugi raz ten sam adres");
  const mails = emls(S, "confirm");
  assert.equal(mails.length, 1);
  assert.match(mails[0], /^To: jan\.kowalski@resinvest\.group$/m);
  const lg = await S.client().login("jan.kowalski@resinvest.group", "Magazyn2026");
  assert.equal(lg.status, 401); assert.equal(lg.json.code, "UNVERIFIED");
  // administrator: zgłoszenie widoczne, ale bez potwierdzenia adresu nie da się go zatwierdzić; rola z rejestracji zignorowana
  const admin = S.client(); assert.equal((await admin.login("magazyn@resinvest.group", S.adminPw)).status, 200);
  let st = (await admin.get("/api/state")).json.state;
  const u = st.users.find(x => x.login === "jan.kowalski@resinvest.group");
  assert.equal(u.role, "obserwator"); assert.equal(u.status, "INVITED"); assert.equal(u.emailUnverified, true);
  assert.equal((st.notices || []).filter(n => n.kind === "registration").length, 0, "powiadomienie dopiero po potwierdzeniu adresu");
  const early = await admin.cmd("user.save", { rec: Object.assign({}, u, { role: "magazynier", whId: "wh_bra", warehouseIds: ["wh_bra"], status: "ACTIVE" }) });
  const er = early.json.res || early.json;
  assert.equal(er.ok, false, JSON.stringify(early.json)); assert.match(er.error, /potwierdzenie adresu/);
  // potwierdzenie linkiem z e-maila
  const conf = await anon.post("/api/auth/confirm", { token: tokenOf(mails[0]) });
  assert.equal(conf.status, 200, JSON.stringify(conf.json)); assert.equal(conf.json.pending, true);
  assert.equal((await anon.post("/api/auth/confirm", { token: tokenOf(mails[0]) })).status, 400, "link jednorazowy");
  st = (await admin.get("/api/state")).json.state;
  const nts = (st.notices || []).filter(n => n.kind === "registration");
  assert.equal(nts.length, 1, "powiadomienie administratora po potwierdzeniu");
  const lg2 = await S.client().login("jan.kowalski@resinvest.group", "Magazyn2026");
  assert.equal(lg2.status, 401); assert.equal(lg2.json.code, "INVITED");
  // zatwierdzenie: rola i magazyn nadaje administrator; e-mail o zatwierdzeniu
  const u2 = st.users.find(x => x.login === "jan.kowalski@resinvest.group");
  const ok = await admin.cmd("user.save", { rec: Object.assign({}, u2, { role: "magazynier", whId: "wh_bra", warehouseIds: ["wh_bra"], status: "ACTIVE" }) });
  assert.equal((ok.json.res || ok.json).ok, true, JSON.stringify(ok.json));
  const ap = emls(S, "approved");
  assert.equal(ap.length, 1); assert.match(textOf(ap[0]), /Rola: MAGAZYNIER/); assert.match(textOf(ap[0]), /RiC Brąszewice/);
  const lg3 = await S.client().login("jan.kowalski@resinvest.group", "Magazyn2026");
  assert.equal(lg3.status, 200, JSON.stringify(lg3.json));
  const au = (await admin.get("/api/state")).json.state.audit.map(a => a.code);
  for (const c of ["USER_REGISTERED", "EMAIL_CONFIRMATION_SENT", "EMAIL_CONFIRMED", "REGISTRATION_APPROVED_SENT"]) assert.ok(au.includes(c), c);
});

test("rejestracja: limit prób dla jednego adresu", async () => {
  const anon = S.client();
  let last;
  for (let i = 0; i < 4; i++) last = await anon.post("/api/auth/register", { rec: { name: "Ewa Nowak", email: "ewa.limit@resinvest.group" }, password: "x" });
  assert.equal(last.status, 429);
});
