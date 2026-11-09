/* Testy 3.6 w trybie FIRMOWYM: wysyłka dokumentów i raportów e-mailem z PDF w załączniku.
   Walidacja po stronie serwera (adresy, temat, PDF, rozmiar, domeny), uprawnienie reports.export, audyt,
   załącznik w .eml (transport „file”) i w API Resend (atrapa), usunięcie załącznika z kolejki po wysyłce.
   Uruchomienie:  node --test tests/mail36.test.mjs  (Node ≥ 22.13) */
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
  const dir = mkdtempSync(join(tmpdir(), "riw-mail36-"));
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

const PDF_B64 = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n").toString("base64");
const DOC = over => Object.assign({ to: "biuro@odbiorca.pl", subject: "Raport miesiąca — 09.2026", message: "Dzień dobry,\nw załączniku raport.", filename: "raport_2026-09-01_2026-09-30_RAP-1.pdf", pdf: PDF_B64, kind: "RAP", title: "Raport miesiąca", range: "01.09.2026 – 30.09.2026", warehouse: "RiC Zabrze" }, over);

let F, X, D, mock, lastBody = null;
before(async () => {
  F = await startServer({ EMAIL_TRANSPORT: "file" });
  mock = httpServer((req, res) => { let b = ""; req.on("data", d => b += d); req.on("end", () => { lastBody = JSON.parse(b); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "re_doc_1" })); }); });
  await new Promise(r => mock.listen(0, "127.0.0.1", r));
  X = await startServer({ EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_test_key", RESEND_API_URL: `http://127.0.0.1:${mock.address().port}/emails` });
  D = await startServer({ EMAIL_TRANSPORT: "file" }, { mail: { documentDomains: ["resinvest.group"] } });
});
after(async () => { for (const s of [F, X, D]) if (s) { await s.stop(); rmSync(s.dir, { recursive: true, force: true }); } if (mock) mock.close(); });

test("wysyłka dokumentu: PDF w załączniku .eml, temat, treść, odpowiedź do nadawcy, wpis w audycie, załącznik usunięty z kolejki", async () => {
  const kier = await user(F, "anna.gorska@resinvest.group");
  const r = await kier.post("/api/mail-document", DOC({ to: "biuro@odbiorca.pl; Ksiegowosc@Odbiorca.pl" }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.sent, 2);
  const files = readdirSync(join(F.data, "mail-outbox")).filter(f => f.includes("-document-"));
  assert.equal(files.length, 2);
  const eml = readFileSync(join(F.data, "mail-outbox", files[0]), "utf8");
  assert.match(eml, /Content-Type: multipart\/mixed/);
  assert.match(eml, /Content-Type: application\/pdf; name="raport_2026-09-01_2026-09-30_RAP-1\.pdf"/);
  assert.match(eml, /Content-Disposition: attachment/);
  assert.match(eml, /Reply-To: anna\.gorska@resinvest\.group/);
  assert.ok(eml.includes(PDF_B64.slice(0, 40)), "treść PDF w załączniku");
  const admin = await user(F, ADMIN, ADMIN_PW);
  const o = (await admin.get("/api/mail/outbox")).json;
  const docs = o.rows.filter(x => x.kind === "document");
  assert.equal(docs.length, 2);
  assert.ok(docs.every(x => x.status === "SENT" && !x.retryable), "po wysyłce treść i załącznik usunięte z kolejki");
  assert.deepEqual(docs.map(x => x.to).sort(), ["biuro@odbiorca.pl", "ksiegowosc@odbiorca.pl"]);
  const audit = (await admin.get("/api/state")).json.state.audit.filter(a => a.code === "MAIL_DOCUMENT");
  assert.equal(audit.length, 1);
});

test("wysyłka dokumentu przez API Resend: załącznik w polu attachments, reply_to = nadawca", async () => {
  const kier = await user(X, "anna.gorska@resinvest.group");
  const r = await kier.post("/api/mail-document", DOC({}));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.sent, 1);
  assert.deepEqual(lastBody.to, ["biuro@odbiorca.pl"]);
  assert.equal(lastBody.reply_to, "anna.gorska@resinvest.group");
  assert.equal(lastBody.attachments.length, 1);
  assert.equal(lastBody.attachments[0].filename, "raport_2026-09-01_2026-09-30_RAP-1.pdf");
  assert.equal(lastBody.attachments[0].content, PDF_B64);
  assert.match(lastBody.subject, /Raport miesiąca/);
  assert.match(lastBody.html, /w załączniku raport/);
});

test("wysyłka dokumentu: walidacja po stronie serwera i uprawnienie reports.export", async () => {
  const kier = await user(F, "anna.gorska@resinvest.group");
  const bad = async (over, field) => { const r = await kier.post("/api/mail-document", DOC(over)); assert.equal(r.status, 400, JSON.stringify(r.json)); assert.equal(r.json.field, field); };
  await bad({ to: "" }, "to");
  await bad({ to: "nie-adres" }, "to");
  await bad({ to: Array.from({ length: 11 }, (_, i) => `a${i}@x.pl`).join(",") }, "to");
  await bad({ subject: "  " }, "subject");
  await bad({ pdf: "" }, "pdf");
  await bad({ pdf: Buffer.from("<html>nie pdf</html>").toString("base64") }, "pdf");
  // magazynier bez uprawnienia eksportu
  const mag = await user(F, "pawel.kaczmarek@resinvest.group");
  const f = await mag.post("/api/mail-document", DOC({}));
  assert.equal(f.status, 403);
  // bez sesji
  const anon = await F.client().post("/api/mail-document", DOC({}));
  assert.equal(anon.status, 401);
});

test("wysyłka dokumentu: lista dozwolonych domen w konfiguracji serwera", async () => {
  const kier = await user(D, "anna.gorska@resinvest.group");
  const out = await kier.post("/api/mail-document", DOC({ to: "biuro@odbiorca.pl" }));
  assert.equal(out.status, 400); assert.match(out.json.error, /spoza dozwolonych domen/);
  const ok = await kier.post("/api/mail-document", DOC({ to: "zarzad@resinvest.group" }));
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

test("wysyłka dokumentu: limit 40 wiadomości z dokumentami na godzinę na użytkownika (licznik w bazie)", async () => {
  const s = await startServer({ EMAIL_TRANSPORT: "file" });
  try {
    const kier = await user(s, "anna.gorska@resinvest.group");
    const ten = n => Array.from({ length: n }, (_, i) => `odbiorca${i}@firma.pl`).join(", ");
    for (let i = 0; i < 4; i++) assert.equal((await kier.post("/api/mail-document", DOC({ to: ten(10) }))).status, 200);
    const over = await kier.post("/api/mail-document", DOC({ to: ten(1) }));
    assert.equal(over.status, 429); assert.match(over.json.error, /Limit wysyłki/);
  } finally { await s.stop(); rmSync(s.dir, { recursive: true, force: true }); }
});

test("kanał AgentMail: wysyłka ze skrzynki AGENTMAIL_INBOX, klucz tylko w nagłówku serwera, PDF w attachments, reply_to = nadawca", async () => {
  let hit = null;
  const am = httpServer((req, res) => { let b = ""; req.on("data", d => b += d); req.on("end", () => { hit = { url: req.url, auth: req.headers.authorization, body: JSON.parse(b) }; res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ message_id: "msg_test_1", thread_id: "thr_1" })); }); });
  await new Promise(r => am.listen(0, "127.0.0.1", r));
  const s = await startServer({ EMAIL_TRANSPORT: "", AGENTMAIL_API_KEY: "am_test_key", AGENTMAIL_INBOX: "resinvest-erp@agentmail.to", AGENTMAIL_API_URL: `http://127.0.0.1:${am.address().port}` });
  try {
    const admin = await user(s, ADMIN, ADMIN_PW);
    const o = (await admin.get("/api/mail/outbox")).json;
    assert.equal(o.mail.transport, "agentmail", "AgentMail wybrany automatycznie przy samym kluczu AgentMail");
    assert.equal(o.mail.from, "resinvest-erp@agentmail.to"); assert.equal(o.mail.configured, true);
    assert.ok(!JSON.stringify(o).includes("am_test_key"), "klucz nie trafia do przeglądarki");
    const kier = await user(s, "anna.gorska@resinvest.group");
    const r = await kier.post("/api/mail-document", DOC({ to: "biuro@odbiorca.pl" }));
    assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.sent, 1);
    assert.equal(hit.url, "/v0/inboxes/resinvest-erp%40agentmail.to/messages/send");
    assert.equal(hit.auth, "Bearer am_test_key");
    assert.deepEqual(hit.body.to, ["biuro@odbiorca.pl"]);
    assert.deepEqual(hit.body.reply_to, ["anna.gorska@resinvest.group"]);
    assert.equal(hit.body.attachments[0].content_type, "application/pdf");
    assert.equal(hit.body.attachments[0].content, PDF_B64);
    assert.match(hit.body.subject, /Raport miesiąca/); assert.ok(hit.body.text && hit.body.html);
    const sent = (await admin.get("/api/mail/outbox")).json.rows.find(x => x.kind === "document");
    assert.equal(sent.status, "SENT"); assert.equal(sent.transport, "agentmail");
  } finally { await s.stop(); rmSync(s.dir, { recursive: true, force: true }); am.close(); }
});
