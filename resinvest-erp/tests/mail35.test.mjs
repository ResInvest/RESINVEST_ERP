/* Testy 3.5 w trybie FIRMOWYM (serwer HTTP + SQLite): powiadomienia e-mail z kolejką i ponawianiem,
   „Poczta” (dziennik, test, ponowienie, uprawnienia), plan zakupów przez API z izolacją magazynów.
   Awaria poczty: atrapa API Resend (lokalny serwer HTTP) zwraca najpierw błąd 500, potem 200 —
   operacja zostaje zapisana, wiadomość ma status FAILED z terminem kolejnej próby, ponowienie → SENT.
   Uruchomienie:  node --test tests/mail35.test.mjs  (Node ≥ 22.13) */
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

async function startServer(env) {
  const dir = mkdtempSync(join(tmpdir(), "riw-mail35-"));
  const port = await freePort();
  const cfgFile = join(dir, "server.config.json");
  writeFileSync(cfgFile, JSON.stringify({ port, host: "127.0.0.1", dataDir: join(dir, "data"), security: { maxFailed: 5, lockMinutes: 15, ipAttemptsPer15Min: 1000 } }));
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(RESEND_|AGENTMAIL_|EMAIL_|SMTP_|APP_URL|RIW_)/.test(k)));
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", SERVER], { env: Object.assign(clean, { RIW_CONFIG: cfgFile, RIW_TODAY: TODAY, APP_URL: "https://erp.resinvest.test" }, env), stdio: "pipe" });
  let out = ""; proc.stdout.on("data", d => { out += d; }); proc.stderr.on("data", d => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch (e) {} await sleep(100); }
  const srv = { dir, data: join(dir, "data"), base, proc, log: () => out, client: () => client(base),
    stop: () => new Promise(res => { if (proc.exitCode !== null) return res(); proc.once("exit", res); proc.kill("SIGTERM"); }) };
  const s = await srv.client().post("/api/setup", { name: "Mateusz Roesner", email: ADMIN, password: ADMIN_PW, sample: true });
  assert.equal(s.status, 200, JSON.stringify(s.json));
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
/** PZ zrębki w magazynie roboczym użytkownika (Brąszewice dla magazyniera Paweł Kaczmarek). */
const PZ = (qty, place = "RiC Brąszewice") => Object.assign(R.Seed.draftOf(TODAY, { purchase: { supplierId: "pa_drwal", basis: "DEKL", productId: "pr_zr_tow", qty: String(qty), unit: "MP", price: "50" }, transport: { mode: "none", place } }), { idemKey: "pz-" + qty + "-" + Math.random() });
async function waitStatus(admin, pred, ms = 8000) {
  const end = Date.now() + ms; let o;
  while (Date.now() < end) { o = (await admin.get("/api/mail/outbox")).json; if (o && o.rows && pred(o.rows)) return o; await sleep(150); }
  return o;
}

let F, X, mock, mockHits = 0, mockFail = true;
before(async () => {
  F = await startServer({ EMAIL_TRANSPORT: "file" });
  // atrapa API Resend: błąd, dopóki test nie przełączy na sukces
  mock = httpServer((req, res) => { let b = ""; req.on("data", d => b += d); req.on("end", () => { mockHits++; if (mockFail) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ message: "awaria testowa" })); } else { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "re_test_" + mockHits })); } }); });
  await new Promise(r => mock.listen(0, "127.0.0.1", r));
  X = await startServer({ EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_test_key", RESEND_API_URL: `http://127.0.0.1:${mock.address().port}/emails` });
});
after(async () => { for (const s of [F, X]) if (s) { await s.stop(); rmSync(s.dir, { recursive: true, force: true }); } if (mock) mock.close(); });

test("powiadomienie e-mail: operacja magazyniera → kolejka → wysłane do kierownika (plik .eml z tematem, treścią i linkiem do operacji)", async () => {
  const admin = await user(F, ADMIN, ADMIN_PW);
  const mag = await user(F, "pawel.kaczmarek@resinvest.group");
  const r = await mag.cmd("op.commit", { draft: PZ(20) });
  assert.equal(r.json.res.ok, true, JSON.stringify(r.json.res));
  assert.equal(r.json.res.notices, undefined, "lista powiadomień nie wraca do przeglądarki");
  const op = r.json.res.op;
  const o = await waitStatus(admin, rows => rows.some(m => m.template === "notice" && m.status === "SENT"));
  const sent = o.rows.filter(m => m.template === "notice" && m.status === "SENT");
  assert.deepEqual(sent.map(m => m.to).sort(), ["anna.gorska@resinvest.group", "tomasz.zajac@resinvest.group"]);
  assert.ok(sent.every(m => m.attempts === 1 && !m.retryable), "treść usunięta po wysłaniu");
  const files = readdirSync(join(F.data, "mail-outbox")).filter(f => f.includes("-notice-"));
  assert.ok(files.length >= 2);
  const raw = readFileSync(join(F.data, "mail-outbox", files[0]), "utf8");
  const text = Buffer.from((/Content-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/.exec(raw) || [])[1].replace(/\s+/g, ""), "base64").toString("utf8");
  assert.match(text, new RegExp(`Nowa operacja: Zakup ${op.no.replace(/\//g, "\\/")}`));
  assert.match(text, /Wprowadził: Paweł Kaczmarek/);
  assert.match(text, new RegExp(`https://erp\\.resinvest\\.test/#/operacje\\?op=${op.id}`));
  // skrzynka w programie: kierownik widzi powiadomienie, magazynier (autor) — nie
  const mgr = await user(F, "anna.gorska@resinvest.group");
  const st = (await mgr.get("/api/state")).json.state;
  assert.ok(st.notices.some(n => n.opId === op.id && !n.read));
  assert.ok(st.notices.every(n => n.userId === st.users.find(u => u.login === "anna.gorska@resinvest.group").id), "tylko własna skrzynka");
  const own = (await mag.get("/api/state")).json.state.notices;
  assert.ok(!own.some(n => n.opId === op.id));
});

test("awaria poczty nie cofa operacji: FAILED z terminem kolejnej próby; ponowienie przez administratora → SENT; audyt MAIL_RETRIED", async () => {
  const admin = await user(X, ADMIN, ADMIN_PW);
  const mag = await user(X, "pawel.kaczmarek@resinvest.group");
  const r = await mag.cmd("op.commit", { draft: PZ(15) });
  assert.equal(r.json.res.ok, true, "operacja zapisana mimo awarii poczty");
  const o = await waitStatus(admin, rows => rows.filter(m => m.template === "notice").length >= 2 && rows.filter(m => m.template === "notice").every(m => m.status === "FAILED"));
  const failed = o.rows.filter(m => m.template === "notice");
  assert.ok(failed.length >= 2 && failed.every(m => m.status === "FAILED"), JSON.stringify(failed));
  for (const m of failed) {
    assert.equal(m.attempts, 1); assert.match(m.error, /Resend HTTP 500/); assert.equal(m.retryable, true);
    const wait = Date.parse(m.nextAt) - Date.now();
    assert.ok(wait > 30000 && wait <= 61000, "kolejna próba po ok. 1 min");
  }
  const st = (await mag.get("/api/state")).json.state;
  assert.ok(st.operations.some(x => x.id === r.json.res.op.id), "operacja jest w danych");
  mockFail = false;
  const rt = await admin.post("/api/mail/retry", { id: failed[0].id });
  assert.equal(rt.status, 200, JSON.stringify(rt.json));
  const after = (await admin.get("/api/mail/outbox")).json.rows.find(m => m.id === failed[0].id);
  assert.equal(after.status, "SENT"); assert.equal(after.retryable, false);
  assert.equal((await admin.post("/api/mail/retry", { id: failed[0].id })).status, 400, "wysłanej nie ponawia się");
  const audit = (await admin.get("/api/state")).json.state.audit;
  assert.ok(audit.some(a => a.code === "MAIL_RETRIED"));
});

test("Poczta: tylko administrator (notifications.manage); wiadomość testowa do siebie; statystyka i kanał bez sekretów", async () => {
  const admin = await user(F, ADMIN, ADMIN_PW);
  const mgr = await user(F, "anna.gorska@resinvest.group");
  assert.equal((await mgr.get("/api/mail/outbox")).status, 403);
  assert.equal((await mgr.post("/api/mail/test", {})).status, 403);
  const t = await admin.post("/api/mail/test", {});
  assert.equal(t.status, 200, JSON.stringify(t.json));
  const o = (await admin.get("/api/mail/outbox")).json;
  assert.ok(o.rows.some(m => m.template === "test" && m.status === "SENT" && m.to === ADMIN));
  assert.ok(o.stats.SENT >= 1);
  assert.equal(o.mail.transport, "file");
  assert.equal(JSON.stringify(o).includes("re_test_key"), false);
  assert.ok((await admin.get("/api/state")).json.state.audit.some(a => a.code === "MAIL_TEST"));
});

test("planer przez API: plan dnia zapisany na serwerze; magazynier bez edycji; izolacja planów magazynów", async () => {
  const mgr = await user(F, "anna.gorska@resinvest.group");
  const mag = await user(F, "pawel.kaczmarek@resinvest.group");
  const r = await mgr.cmd("plan.set", { whId: "wh_bra", date: "2026-09-24", planMP: "75", version: 0 });
  assert.equal(r.json.res.ok, true, JSON.stringify(r.json.res));
  assert.ok(r.json.state.plans.some(p => p.whId === "wh_bra" && p.date === "2026-09-24" && p.planMP === 75));
  const denied = await mag.cmd("plan.set", { whId: "wh_bra", date: "2026-09-24", planMP: "1" });
  assert.equal(denied.status, 403); assert.equal(denied.json.res.code, "FORBIDDEN");
  const st = (await mag.get("/api/state")).json.state;
  assert.ok(st.plans.length && st.plans.every(p => p.whId === "wh_bra"), "magazynier Brąszewic nie widzi planów Zabrza");
});
