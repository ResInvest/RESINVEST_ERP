/* Testy logowania, kont, ról i izolacji magazynów (tryb FIRMOWY: serwer HTTP + SQLite).
   Odpowiadają listom z wymagań: §34 (20 przypadków) i §35 (testy bezpieczeństwa 1–5).
   Poczta: transport „file” — wiadomości .eml zapisywane w katalogu danych, linki odczytywane z treści.
   Rzeczywista wysyłka przez Resend NIE jest tu sprawdzana (wymaga klucza API i zweryfikowanej domeny).
   Uruchomienie:  node --test tests/auth.test.mjs  (Node ≥ 22.13) */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
globalThis.RIW_CONFIG = {};
require("../app/src/i18n.js");
const R = require("../app/src/engine.js");
require("../app/src/seed.js");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "server", "riw-server.mjs");
const TODAY = "2026-09-23";
const ADMIN = "magazyn@resinvest.group", ADMIN_PW = "Biomasa2026", DEMO = "demo1234";

const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
/** Serwer testowy: własny katalog danych, własny plik konfiguracji, zmienne poczty. */
async function startServer({ env = {}, session } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "riw-auth-"));
  const port = await freePort();
  const cfgFile = join(dir, "server.config.json");
  writeFileSync(cfgFile, JSON.stringify({ port, host: "127.0.0.1", dataDir: join(dir, "data"), session: session || { idleMinutes: 30, absoluteHours: 12 }, security: { maxFailed: 5, lockMinutes: 15, ipAttemptsPer15Min: 1000 } }));
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(RESEND_|AGENTMAIL_|EMAIL_|SMTP_|APP_URL|RIW_)/.test(k)));
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", SERVER], { env: Object.assign(clean, { RIW_CONFIG: cfgFile, RIW_TODAY: TODAY, APP_URL: "https://erp.resinvest.test" }, env), stdio: "pipe" });
  let out = ""; proc.stdout.on("data", d => { out += d; }); proc.stderr.on("data", d => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { const r = await fetch(base + "/api/health"); if (r.ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 100)); }
  const srv = { dir, data: join(dir, "data"), base, proc, log: () => out,
    client: () => client(base),
    stop: () => new Promise(res => { if (proc.exitCode !== null) return res(); proc.once("exit", res); proc.kill("SIGTERM"); }),
    /** Wiadomości e-mail zapisane przez transport „file” (nowe od ostatniego wywołania). */
    seen: new Set(),
    mails() {
      const dirM = join(this.data, "mail-outbox");
      if (!existsSync(dirM)) return [];
      const out = [];
      for (const f of readdirSync(dirM).sort()) { if (this.seen.has(f)) continue; this.seen.add(f); out.push(parseEml(readFileSync(join(dirM, f), "utf8"))); }
      return out;
    }
  };
  const a = srv.client();
  const s = await a.post("/api/setup", { name: "Mateusz Roesner", email: ADMIN, password: ADMIN_PW, sample: true });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  return srv;
}
/** Minimalny odczyt .eml: nagłówki To/Subject + część tekstowa (base64). */
function parseEml(raw) {
  const head = raw.split("\r\n\r\n")[0];
  const to = (/^To: (.*)$/m.exec(head) || [])[1];
  const subjRaw = (/^Subject: (.*)$/m.exec(head) || [])[1] || "";
  const subject = subjRaw.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => Buffer.from(b, "base64").toString("utf8"));
  const m = /Content-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/.exec(raw);
  const text = m ? Buffer.from(m[1].replace(/\s+/g, ""), "base64").toString("utf8") : "";
  const link = (/(https:\/\/erp\.resinvest\.test\/#\/[^\s]+)/.exec(text) || [])[1] || "";
  const token = (/token=([A-Za-z0-9_-]+)/.exec(link) || [])[1] || "";
  const html = /text\/html/.test(raw);
  return { to, subject, text, link, token, html };
}
function client(base) {
  let cookie = "";
  const call = async (method, path, body, headers = {}) => {
    const h = Object.assign({ "Content-Type": "application/json", "X-RIW": "1", "Accept-Language": "pl", "User-Agent": "riw-test/1.0" }, cookie ? { Cookie: cookie } : {}, headers);
    const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0].endsWith("=") ? "" : sc.split(";")[0];
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
    return { status: r.status, json, headers: r.headers };
  };
  const c = { get: (p, h) => call("GET", p, undefined, h), post: (p, b, h) => call("POST", p, b, h), get cookie() { return cookie; } };
  c.login = async (login, password) => { const r = await c.post("/api/auth/login", { login, password }); return r; };
  c.cmd = (cmd, args) => c.post("/api/cmd", { cmd, args });
  c.state = async () => (await c.get("/api/state")).json.state;
  return c;
}
/** Konto demonstracyjne po pierwszym logowaniu (hasło startowe wymaga zmiany). */
async function demoUser(srv, login, pw = "Praca2026x") {
  const c = srv.client();
  const l = await c.login(login, DEMO);
  assert.equal(l.status, 200, JSON.stringify(l.json));
  if (l.json.mustChange) assert.equal((await c.post("/api/auth/password", { old: DEMO, new: pw })).status, 200);
  return c;
}
const WZ = (qty, place = "RiC Zabrze") => R.Seed.draftOf(TODAY, { type: "SPRZEDAZ", sale: { productId: "pr_zr_lesna", qty: String(qty), unit: "MP", buyerId: "pa_ec_zab", price: "90" }, transport: { mode: "none", place } });

let S, S2;
let admin, mgr, mag, view, aud;
before(async () => {
  S = await startServer({ env: { EMAIL_TRANSPORT: "file" } });
  admin = S.client(); assert.equal((await admin.login(ADMIN, ADMIN_PW)).status, 200);
  mgr = await demoUser(S, "anna.gorska@resinvest.group");            // MANAGER: Zabrze + Brąszewice
  mag = await demoUser(S, "pawel.kaczmarek@resinvest.group");        // MAGAZYNIER: Brąszewice
  view = await demoUser(S, "beata.nowak@resinvest.group");           // OBSERWATOR: Zabrze
  aud = await demoUser(S, "ewa.krawczyk@resinvest.group");           // AUDYTOR: wszystkie (odczyt)
});
after(async () => { for (const s of [S, S2]) if (s) { await s.stop(); rmSync(s.dir, { recursive: true, force: true }); } });

/* ============================ §34 ============================ */
test("§34.1 logowanie poprawnym kontem (e-mail bez rozróżniania wielkości liter)", async () => {
  const c = S.client();
  const r = await c.login("  Magazyn@ResInvest.Group ", ADMIN_PW);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.headers.get("set-cookie"), /HttpOnly/i);
  const me = await c.get("/api/auth/me");
  assert.equal(me.json.user.login, ADMIN);
});
test("§34.2 błędne hasło — ogólny komunikat, wpis w dzienniku logowań", async () => {
  const r = await S.client().login(ADMIN, "Zle-haslo-1");
  assert.equal(r.status, 401);
  assert.equal(r.json.error, "Nieprawidłowy e-mail lub hasło.");
  const unknown = await S.client().login("nikt@resinvest.group", "Zle-haslo-1");
  assert.equal(unknown.json.error, r.json.error, "ten sam komunikat dla nieistniejącego konta");
  const log = (await admin.get("/api/auth/log")).json.log;
  assert.ok(log.some(x => x.login === ADMIN && !x.ok && x.reason === "błędne hasło"));
});
test("§34.3 niepotwierdzony e-mail — konto zaproszone (INVITED) nie loguje się", async () => {
  // konto z danych przykładowych: zaproszenie wysłane, link nieużyty
  const r = await S.client().login("jan.mazur@resinvest.group", "Cokolwiek2026");
  assert.equal(r.status, 401);
  assert.equal(r.json.code, "INVITED");
  assert.equal(r.json.error, "Twoje konto nie zostało jeszcze aktywowane.");
});
test("§34.4 domena spoza @resinvest.group — odrzucona po stronie serwera (logowanie, zaproszenie, reset)", async () => {
  const l = await S.client().login("jan@gmail.com", "Cokolwiek2026");
  assert.equal(l.status, 401); assert.equal(l.json.code, "DOMAIN");
  for (const email of ["jan@resinvest.group.pl", "jan@evil-resinvest.group", "jan@sub.resinvest.group"]) {
    const inv = await admin.post("/api/users/invite", { rec: { firstName: "Jan", lastName: "Obcy", email, role: "magazynier", whId: "wh_zab" } });
    assert.equal(inv.json.res.ok, false, email);
    assert.ok(inv.json.res.errors.email, email);
  }
  const f = await S.client().post("/api/auth/forgot", { email: "jan@gmail.com" });
  assert.equal(f.status, 400);
});
test("§34.5 zaproszenie użytkownika — konto INVITED, e-mail z linkiem, wpis audytu; bez duplikatów", async () => {
  S.mails();
  const inv = await admin.post("/api/users/invite", { rec: { firstName: "Karol", lastName: "Nowy", email: "Karol.Nowy@resinvest.group", role: "magazynier", whId: "wh_rok", warehouseIds: ["wh_rok"] } });
  assert.equal(inv.json.res.ok, true, JSON.stringify(inv.json.res));
  assert.equal(inv.json.mail.ok, true);
  const u = inv.json.state.users.find(x => x.email === "karol.nowy@resinvest.group");
  assert.equal(u.status, "INVITED"); assert.equal(u.active, false);
  const codes = inv.json.state.audit.filter(a => a.entityId === u.id).map(a => a.code);
  assert.ok(codes.includes("USER_INVITED") && codes.includes("INVITE_SENT"), codes.join(","));
  const inviteAudit = inv.json.state.audit.find(a => a.entityId === u.id && a.code === "USER_INVITED");
  assert.equal(inviteAudit.ua, "riw-test/1.0"); assert.ok(inviteAudit.ip, "IP w dzienniku audytu");
  const m = S.mails();
  assert.equal(m.length, 1);
  assert.equal(m[0].to, "karol.nowy@resinvest.group");
  assert.equal(m[0].subject, "Zaproszenie do ResInvest ERP");
  assert.ok(m[0].html && /ResInvest ERP/.test(m[0].text));
  assert.match(m[0].link, /^https:\/\/erp\.resinvest\.test\/#\/invite\/accept\?token=/);
  const dup = await admin.post("/api/users/invite", { rec: { firstName: "Karol", lastName: "Drugi", email: "karol.nowy@resinvest.group", role: "magazynier", whId: "wh_rok" } });
  assert.equal(dup.json.res.ok, false, "drugi raz ten sam adres — brak duplikatu");
  // ponowne wysłanie: nowy link, poprzedni traci ważność
  const re = await admin.post("/api/users/resend", { userId: u.id });
  assert.equal(re.json.mail.ok, true);
  const m2 = S.mails()[0];
  assert.notEqual(m2.token, m[0].token);
  const old = await S.client().post("/api/auth/token", { kind: "invite", token: m[0].token });
  assert.equal(old.json.code, "USED");
  S.inviteToken = m2.token; S.invitedId = u.id;
});
test("§34.6 aktywacja zaproszenia — hasło wg polityki, konto ACTIVE, link jednorazowy", async () => {
  const anon = S.client();
  const info = await anon.post("/api/auth/token", { kind: "invite", token: S.inviteToken });
  assert.equal(info.json.ok, true); assert.equal(info.json.email, "karol.nowy@resinvest.group");
  assert.equal((await anon.post("/api/invite/accept", { token: S.inviteToken, password: "krotkie" })).json.field, "password");
  assert.equal((await anon.post("/api/invite/accept", { token: S.inviteToken, password: "Magazyn2026k", password2: "Inne2026kk" })).json.field, "password2");
  const ok = await anon.post("/api/invite/accept", { token: S.inviteToken, password: "Magazyn2026k", password2: "Magazyn2026k" });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await anon.post("/api/invite/accept", { token: S.inviteToken, password: "Magazyn2026k" })).json.code, "USED");
  const k = S.client();
  assert.equal((await k.login("karol.nowy@resinvest.group", "Magazyn2026k")).status, 200);
  const st = await k.state();
  const me = st.users.find(x => x.id === S.invitedId);
  assert.equal(me.status, "ACTIVE"); assert.ok(me.emailVerifiedAt);
  assert.ok((await admin.state()).audit.some(a => a.entityId === S.invitedId && a.code === "USER_ACTIVATED"));
  // link przeterminowany
  const inv = await admin.post("/api/users/invite", { rec: { firstName: "Olga", lastName: "Termin", email: "olga.termin@resinvest.group", role: "obserwator", whId: "wh_zab" } });
  const tok = S.mails().at(-1).token;
  const db = new DatabaseSync(join(S.data, "resinvest.sqlite"));
  db.prepare("UPDATE tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = ?").run(inv.json.res.rec.id); db.close();
  const exp = await S.client().post("/api/invite/accept", { token: tok, password: "Terminowo2026" });
  assert.equal(exp.json.code, "EXPIRED");
  assert.equal((await S.client().post("/api/invite/accept", { token: "x".repeat(43), password: "Terminowo2026" })).json.code, "BAD");
});
test("§34.7 reset hasła — ta sama odpowiedź dla każdego adresu, link 1 h, stare hasło nieważne, sesje wylogowane", async () => {
  const k = S.client(); await k.login("karol.nowy@resinvest.group", "Magazyn2026k");
  S.mails();
  const anon = S.client();
  const unknown = await anon.post("/api/auth/forgot", { email: "nie.istnieje@resinvest.group" });
  const known = await anon.post("/api/auth/forgot", { email: "Karol.Nowy@resinvest.group" });
  assert.equal(unknown.status, 200); assert.equal(known.status, 200);
  assert.equal(unknown.json.message, known.json.message, "brak ujawnienia, czy konto istnieje");
  const m = S.mails();
  assert.equal(m.length, 1); assert.equal(m[0].subject, "Reset hasła — ResInvest ERP");
  assert.match(m[0].link, /#\/reset-password\?token=/);
  assert.equal((await anon.post("/api/auth/reset", { token: m[0].token, password: "Nowe2026haslo" })).status, 200);
  assert.equal((await k.get("/api/state")).status, 401, "sesje wylogowane po resecie");
  assert.equal((await S.client().login("karol.nowy@resinvest.group", "Magazyn2026k")).status, 401);
  assert.equal((await S.client().login("karol.nowy@resinvest.group", "Nowe2026haslo")).status, 200);
  assert.equal((await anon.post("/api/auth/reset", { token: m[0].token, password: "Inne2026haslo" })).json.code, "USED");
  const after = S.mails();
  assert.ok(after.some(x => x.subject === "Hasło zostało zmienione — ResInvest ERP"));
  const audit = (await admin.state()).audit.filter(a => a.entityId === S.invitedId).map(a => a.code);
  assert.ok(audit.includes("PASSWORD_RESET_REQUESTED") && audit.includes("PASSWORD_RESET_COMPLETED"), audit.join(","));
});
test("§34.8 ADMINISTRATOR — użytkownicy, role, uprawnienia, konfiguracja, wszystkie magazyny", async () => {
  const st = await admin.state();
  assert.equal(st.projected, undefined, "administrator widzi całość");
  assert.deepEqual(new Set(st.operations.map(o => o.whId)), new Set(["wh_zab", "wh_bra"]));
  assert.equal((await admin.get("/api/users/accounts")).status, 200);
  const rp = await admin.cmd("roles.save", { role: "obserwator", perms: ["report.view", "history.read", "reports.export"] });
  assert.equal(rp.json.res.ok, true, rp.json.res.error);
  assert.equal(rp.json.state.audit.at(-1).code, "ROLE_PERMISSIONS_CHANGED");
  assert.equal((await admin.cmd("roles.save", { role: "admin", perms: [] })).json.res.ok, false, "ADMINISTRATOR zawsze pełny");
  assert.equal((await admin.cmd("roles.reset", { role: "obserwator" })).json.res.ok, true);
  const pw = await admin.post("/api/users/password", { userId: "u_rok", password: "Tymczas2026r" });
  assert.equal(pw.status, 200);
  assert.ok((await admin.state()).audit.some(x => x.code === "PASSWORD_SET_BY_ADMIN" && x.entityId === "u_rok"), "hasło nadane przez administratora w audycie");
  // administrator nadaje innemu użytkownikowi rolę ADMINISTRATOR i odbiera ją
  const st2 = await admin.state(), k = st2.users.find(u => u.id === S.invitedId);
  const up = await admin.cmd("user.save", { rec: Object.assign({}, k, { role: "admin" }) });
  assert.equal(up.json.res.ok, true, up.json.res.error);
  assert.ok(up.json.state.audit.some(a => a.code === "ROLE_CHANGED" && a.entityId === k.id));
  const down = await admin.cmd("user.save", { rec: Object.assign({}, R.byId(up.json.state.users, k.id), { role: "magazynier" }) });
  assert.equal(down.json.res.ok, true, down.json.res.error);
});
test("§34.9 MANAGER — operacje i korekty w przydzielonych magazynach, bez zarządzania kontami", async () => {
  const st = await mgr.state();
  assert.equal(st.projected, true);
  assert.ok(st.operations.every(o => ["wh_zab", "wh_bra"].includes(o.whId) || ["wh_zab", "wh_bra"].includes(o.toWhId)));
  const c = await mgr.cmd("op.commit", { draft: WZ(3) });
  assert.equal(c.json.res.ok, true, c.json.res.error);
  assert.equal((await mgr.get("/api/users/accounts")).status, 200, "podgląd kont (users.read)");
  assert.equal((await mgr.post("/api/users/invite", { rec: { firstName: "Ala", lastName: "Kot", email: "ala.kot@resinvest.group", role: "magazynier", whId: "wh_zab" } })).status, 403);
  assert.equal((await mgr.cmd("roles.save", { role: "magazynier", perms: [] })).status, 403);
  // przełączenie magazynu roboczego na przydzielony
  const sw = await mgr.cmd("me.warehouse", { whId: "wh_bra" });
  assert.equal(sw.json.res.ok, true);
  assert.equal((await mgr.cmd("me.warehouse", { whId: "wh_rok" })).status, 403, "nieprzydzielony magazyn");
  await mgr.cmd("me.warehouse", { whId: "wh_zab" });
});
test("§34.10 MAGAZYNIER — wprowadza operacje w swoim magazynie; bez korekt, anulowań i administracji", async () => {
  const c = await mag.cmd("op.commit", { draft: WZ(2, "RiC Brąszewice") });
  assert.equal(c.json.res.ok, true, c.json.res.error);
  const op = c.json.state.operations.at(-1);
  assert.equal(op.whId, "wh_bra");
  assert.equal((await mag.cmd("op.cancel", { opId: op.id, reason: "test" })).status, 403);
  assert.equal((await mag.cmd("master.save", { kind: "products", rec: { name: "X", code: "X-1", cat: "zrebka", unit: "MP" } })).status, 403);
  assert.equal((await mag.get("/api/backups")).status, 403);
});
test("§34.11 OBSERWATOR — tylko odczyt", async () => {
  const st = await view.state();
  assert.ok(st.operations.length > 0);
  assert.equal((await view.cmd("op.commit", { draft: WZ(1) })).status, 403);
  assert.equal((await view.cmd("draft.save", { draft: WZ(1) })).status, 403);
  assert.equal((await view.get("/api/users/accounts")).status, 403);
});
test("§34.12 AUDYTOR — odczyt wszystkich magazynów i audytu, bez zmian", async () => {
  const st = await aud.state();
  assert.equal(st.projected, undefined, "rola globalna — wszystkie magazyny");
  assert.ok(st.audit.some(a => a.code === "USER_INVITED"), "pełny dziennik audytu");
  const extra = await aud.get("/api/audit/extra");
  assert.equal(extra.status, 200); assert.ok(Array.isArray(extra.json.log) && Array.isArray(extra.json.mail));
  assert.equal((await aud.cmd("op.commit", { draft: WZ(1) })).status, 403);
  assert.equal((await aud.post("/api/users/invite", { rec: {} })).status, 403);
  assert.equal((await aud.cmd("settings.save", { settings: { requireApproval: true } })).status, 403);
});
test("§34.13 dostęp do właściwego magazynu — dane widoczne wyłącznie z przydzielonych magazynów", async () => {
  const st = await mag.state();
  assert.equal(st.projected, true);
  assert.ok(st.operations.length > 0);
  assert.ok(st.operations.every(o => o.whId === "wh_bra" || o.toWhId === "wh_bra"), "operacje: tylko Brąszewice (w tym MM przychodzące)");
  assert.ok(st.ledger.every(l => l.whId === "wh_bra" || st.operations.some(o => o.id === l.opId)));
  assert.ok(st.inventory.every(p => p.whId === "wh_bra"));
  assert.ok(st.fleet.vehicles.every(v => !v.whId || v.whId === "wh_bra"));
  assert.ok(!st.audit.some(a => a.entity === "user" && a.userId !== st.users.find(u => u.login === "pawel.kaczmarek@resinvest.group").id), "bez audytu kont innych osób");
  assert.ok(!st.users.some(u => u.login === "karolina.wisniewska@resinvest.group"), "bez kont z innych magazynów");
});
test("§34.14 / §35.4 próba dostępu do obcego magazynu — dokument z innego magazynu niedostępny", async () => {
  const full = await admin.state();
  const zab = full.operations.find(o => o.whId === "wh_zab" && o.status === "POSTED" && !o.toWhId);
  const st = await mag.state();
  assert.equal(st.operations.some(o => o.id === zab.id), false, "dokument Zabrza nie trafia do przeglądarki magazyniera Brąszewic");
  const kbra = await demoUser(S, "tomasz.zajac@resinvest.group");   // MANAGER Brąszewic
  const cancel = await kbra.cmd("op.cancel", { opId: zab.id, reason: "próba" });
  assert.equal(cancel.status, 403); assert.equal(cancel.json.res.code, "FORBIDDEN");
  const corr = await kbra.cmd("op.correct", { opId: zab.id, draft: zab.input, reason: "próba" });
  assert.equal(corr.status, 403);
});
test("§34.15 / §35.2 próba nadania sobie ADMINISTRATOR — 403, bez zmian", async () => {
  const st = await mag.state(), me = st.users.find(u => u.login === "pawel.kaczmarek@resinvest.group");
  const r = await mag.cmd("user.save", { rec: Object.assign({}, me, { role: "admin" }) });
  assert.equal(r.status, 403);
  const forged = await mag.post("/api/cmd", { cmd: "me.prefs", args: { lang: "pl", role: "admin", user: { id: "u_admin", role: "admin" } } });
  assert.equal(forged.json.res.ok, true);
  assert.equal((await admin.state()).users.find(u => u.id === me.id).role, "magazynier", "rola z żądania ignorowana");
  // administrator nie zmienia własnej roli (brak samodzielnej degradacji)
  const a = (await admin.state()).users.find(u => u.login === ADMIN);
  assert.equal((await admin.cmd("user.save", { rec: Object.assign({}, a, { role: "kierownik" }) })).json.res.ok, false);
});
test("§34.16 / §35.1 MAGAZYNIER wywołuje endpointy administracyjne — 403", async () => {
  const st = await admin.state(), other = st.users.find(u => u.login === "karolina.wisniewska@resinvest.group");
  for (const [path, body] of [["/api/users/invite", { rec: { firstName: "Ala", lastName: "Kot", email: "ala.kot@resinvest.group", role: "admin", whId: "wh_zab" } }],
    ["/api/users", { rec: { firstName: "Ala", lastName: "Kot", email: "ala.kot@resinvest.group", role: "admin", whId: "wh_zab" }, password: "Tymczas2026" }],
    ["/api/users/password", { userId: other.id, password: "Przejete2026" }], ["/api/users/resend", { userId: other.id }], ["/api/users/reset-link", { userId: other.id }], ["/api/users/unlock", { userId: other.id }]])
    assert.equal((await mag.post(path, body)).status, 403, path);
  for (const path of ["/api/users/accounts", "/api/auth/log", "/api/audit/extra", "/api/backups"]) assert.equal((await mag.get(path)).status, 403, path);
  const ch = await mag.cmd("user.save", { rec: Object.assign({}, other, { role: "obserwator" }) });
  assert.equal(ch.status, 403, "zmiana roli innej osoby");
  for (const cmd of ["roles.save", "settings.save", "data.import", "data.clean", "user.remove"]) assert.equal((await mag.cmd(cmd, { role: "magazynier", perms: ["*"] })).status, 403, cmd);
});
test("§34.17 / §35.5 ostatni aktywny administrator — nie można zdegradować, zawiesić, dezaktywować ani usunąć", async () => {
  const st = await admin.state(), me = st.users.find(u => u.login === ADMIN);
  assert.equal(st.users.filter(u => u.role === "admin" && u.status === "ACTIVE").length, 1);
  for (const change of [{ role: "kierownik" }, { status: "SUSPENDED" }, { status: "DISABLED" }]) {
    const r = await admin.cmd("user.save", { rec: Object.assign({}, me, change) });
    assert.equal(r.json.res.ok, false, JSON.stringify(change));
  }
  assert.equal((await admin.cmd("user.remove", { id: me.id })).json.res.ok, false);
  // drugi administrator może zostać zdegradowany dopiero, gdy pozostaje inny aktywny
  const inv = await admin.post("/api/users", { rec: { firstName: "Zofia", lastName: "Admin", email: "zofia.admin@resinvest.group", role: "admin", whId: "wh_zab" }, password: "Tymczas2026" });
  assert.equal(inv.json.res.ok, true, JSON.stringify(inv.json.res));
  const z = S.client(); await z.login("zofia.admin@resinvest.group", "Tymczas2026"); await z.post("/api/auth/password", { old: "Tymczas2026", new: "Zofia2026adm" });
  const zst = await z.state(), meFromZ = zst.users.find(u => u.login === ADMIN);
  const demote = await z.cmd("user.save", { rec: Object.assign({}, meFromZ, { role: "kierownik" }) });
  assert.equal(demote.json.res.ok, true, "przy dwóch administratorach degradacja drugiego jest dozwolona");
  const zRec = (await z.state()).users.find(u => u.login === "zofia.admin@resinvest.group");
  assert.equal((await z.cmd("user.save", { rec: Object.assign({}, zRec, { status: "DISABLED" }) })).json.res.ok, false, "teraz Zofia jest ostatnia");
  const back = await z.cmd("user.save", { rec: Object.assign({}, (await z.state()).users.find(u => u.login === ADMIN), { role: "admin" }) });
  assert.equal(back.json.res.ok, true);
});
test("§34.18 brak sesji — dane niedostępne (401)", async () => {
  const anon = S.client();
  for (const p of ["/api/state", "/api/users/accounts", "/api/backups"]) assert.equal((await anon.get(p)).status, 401, p);
  assert.equal((await anon.post("/api/cmd", { cmd: "op.commit", args: { draft: WZ(1) } })).status, 401);
  const forgedCookie = await S.client().get("/api/state", { Cookie: "riw_sid=" + "A".repeat(43) });
  assert.equal(forgedCookie.status, 401);
});
test("§34.19 wygasła sesja — po czasie bezczynności wymagane ponowne logowanie", async () => {
  S2 = await startServer({ env: { EMAIL_TRANSPORT: "resend" }, session: { idleMinutes: 0.02, absoluteHours: 12 } });
  const c = S2.client();
  assert.equal((await c.login(ADMIN, ADMIN_PW)).status, 200);
  assert.equal((await c.get("/api/state")).status, 200);
  await new Promise(r => setTimeout(r, 1600));
  assert.equal((await c.get("/api/state")).status, 401);
});
test("§34.20 równoczesna praca — jednoczesne komendy: unikalne numery, stan bez ujemnych wartości", async () => {
  const st = await admin.state();
  const have = R.Stock.balance(st, "wh_zab", "pr_zr_tow");
  const qty = Math.floor(have / 2) + 1;   // dwie takie sprzedaże razem przekraczają stan
  const d = () => R.Seed.draftOf(TODAY, { type: "SPRZEDAZ", sale: { productId: "pr_zr_tow", qty: String(qty), unit: "MP", buyerId: "pa_ec_zab", price: "90" }, transport: { mode: "none", place: "RiC Zabrze" } });
  const res = await Promise.all([mgr.cmd("op.commit", { draft: d() }), admin.cmd("op.commit", { draft: d() })]);
  const ok = res.filter(r => r.json.res.ok);
  assert.equal(ok.length, 1, "druga operacja odrzucona — brak stanu");
  const after = await admin.state();
  assert.ok(R.Stock.balance(after, "wh_zab", "pr_zr_tow") >= 0);
  const nums = after.operations.map(o => o.no);
  assert.equal(new Set(nums).size, nums.length, "numery dokumentów unikalne");
  const many = await Promise.all(Array.from({ length: 6 }, (_, i) => (i % 2 ? mgr : admin).cmd("op.commit", { draft: WZ(1) })));
  assert.ok(many.every(r => r.json.res.ok), "sześć równoczesnych operacji zapisanych");
  const fin = await admin.state();
  assert.equal(new Set(fin.operations.map(o => o.no)).size, fin.operations.length);
});

/* ============================ §35.3 i obsługa błędów ============================ */
test("§35.3 manipulacja warehouse_id w żądaniu — serwer ignoruje / odrzuca", async () => {
  const d = Object.assign(WZ(1, "RiC Brąszewice"), { whId: "wh_zab", warehouseId: "wh_zab" });
  const r = await mag.post("/api/cmd", { cmd: "op.commit", args: { draft: d, whId: "wh_zab", warehouse_id: "wh_zab" } });
  assert.equal(r.json.res.ok, true, r.json.res.error);
  assert.equal(r.json.state.operations.at(-1).whId, "wh_bra", "magazyn z profilu, nie z żądania");
  assert.equal((await mag.cmd("me.warehouse", { whId: "wh_zab" })).status, 403);
  const st = await mag.state(), me = st.users.find(u => u.login === "pawel.kaczmarek@resinvest.group");
  assert.equal((await mag.cmd("user.save", { rec: Object.assign({}, me, { warehouseIds: ["wh_bra", "wh_zab"] }) })).status, 403, "własny dostęp do magazynów");
});
test("MM dwuetapowe przez serwer — wybór magazynu źródłowego, W DRODZE u odbiorcy, przyjęcie tylko przez magazyn docelowy", async () => {
  const mm = R.Seed.draftOf(TODAY, { type: "MM", mm: { fromWhId: "wh_zab", productId: "pr_zr_lesna", qty: "40", unit: "MP", toWhId: "wh_bra", weightMode: "manual", weightManual: "13,1" }, transport: { mode: "none", place: "RiC Brąszewice" } });
  // magazynier Brąszewic nie może wysłać towaru z Zabrza (fromWhId z przeglądarki nie daje dostępu)
  const forged = await mag.cmd("op.commit", { draft: Object.assign({}, mm, { idemKey: "idem_forged_mm" }) });
  assert.equal(forged.json.res.ok, false);
  assert.equal(forged.json.res.plan.errorCodes["mm.fromWhId"], "FORBIDDEN");
  const sent = await mgr.cmd("op.commit", { draft: mm });
  assert.equal(sent.json.res.ok, true, sent.json.res.error);
  const op = sent.json.res.op;
  assert.equal(op.whId, "wh_zab"); assert.equal(op.mm.twoStage, true); assert.equal(op.mm.weightT, 13.1);
  const st = await mag.state();
  const seen = st.operations.find(o => o.id === op.id);
  assert.ok(seen, "odbiorca widzi MM w drodze");
  assert.equal(R.mmState(seen), "W_DRODZE");
  const before = R.Stock.balance(st, "wh_bra", "pr_zr_lesna");
  assert.equal((await view.cmd("mm.receive", { opId: op.id, receipt: { qty: "40" } })).status, 403, "obserwator bez uprawnienia");
  const rc = await mag.cmd("mm.receive", { opId: op.id, receipt: { qty: "39", unit: "MP", reason: "ubytek", note: "kwit BR 77", key: "rcv_srv_1" } });
  assert.equal(rc.json.res.ok, true, rc.json.res.error);
  const st2 = await mag.state();
  assert.equal(R.Stock.balance(st2, "wh_bra", "pr_zr_lesna"), before + 39);
  assert.equal(R.mmState(st2.operations.find(o => o.id === op.id)), "PRZYJETE");
  const again = await mag.cmd("mm.receive", { opId: op.id, receipt: { qty: "39", key: "rcv_srv_2" } });
  assert.equal(again.json.res.ok, false, "drugie przyjęcie odrzucone");
});
test("Błąd wysyłki zaproszenia — konto pozostaje INVITED, błąd dla administratora, audyt, możliwe ponowienie", async () => {
  const a = S2.client(); await a.login(ADMIN, ADMIN_PW);
  const inv = await a.post("/api/users/invite", { rec: { firstName: "Piotr", lastName: "Bezpoczty", email: "piotr.bezpoczty@resinvest.group", role: "magazynier", whId: "wh_zab" } });
  assert.equal(inv.json.res.ok, true);
  assert.equal(inv.json.mail.ok, false);
  assert.doesNotMatch(inv.json.mail.error, /RESEND|api\.resend|HTTP/i, "bez szczegółów technicznych dla użytkownika");
  const u = inv.json.state.users.find(x => x.email === "piotr.bezpoczty@resinvest.group");
  assert.equal(u.status, "INVITED");
  assert.ok(inv.json.state.audit.some(x => x.entityId === u.id && x.code === "INVITE_EMAIL_FAILED"));
  const again = await a.post("/api/users/resend", { userId: u.id });
  assert.equal(again.json.mail.ok, false, "ponowienie możliwe (tu nadal bez klucza)");
  assert.equal((await a.state()).users.filter(x => x.email === "piotr.bezpoczty@resinvest.group").length, 1, "bez duplikatów");
  assert.match(S2.log(), /brak klucza RESEND_API_KEY/, "szczegół techniczny w dzienniku serwera");
});
test("Dezaktywacja — wylogowanie, komunikat „konto nieaktywne”, e-mail; historia zachowana", async () => {
  const st = await admin.state(), u = st.users.find(x => x.login === "karol.nowy@resinvest.group");
  const k = S.client(); assert.equal((await k.login(u.login, "Nowe2026haslo")).status, 200);
  S.mails();
  const r = await admin.cmd("user.save", { rec: Object.assign({}, u, { status: "DISABLED" }) });
  assert.equal(r.json.res.ok, true, r.json.res.error);
  assert.ok(r.json.state.audit.some(a => a.entityId === u.id && a.code === "USER_DISABLED"));
  assert.equal((await k.get("/api/state")).status, 401, "sesja zakończona");
  const l = await S.client().login(u.login, "Nowe2026haslo");
  assert.equal(l.json.error, "Twoje konto jest nieaktywne.");
  assert.ok(S.mails().some(m => m.subject === "Konto dezaktywowane — ResInvest ERP"));
  assert.ok((await admin.state()).users.some(x => x.id === u.id), "konto nie jest usuwane fizycznie");
});
test("Zmiana adresu e-mail — potwierdzenie nowego adresu, powiadomienie na stary", async () => {
  const st = await admin.state(), u = st.users.find(x => x.login === "michal.lewandowski@resinvest.group");
  const c = await demoUser(S, u.login, "Rokitki2026m");
  S.mails();
  const r = await admin.cmd("user.save", { rec: Object.assign({}, u, { email: "m.lewandowski@resinvest.group" }) });
  assert.equal(r.json.res.ok, true, r.json.res.error);
  assert.ok(r.json.state.audit.some(a => a.code === "EMAIL_CHANGED" && a.entityId === u.id));
  assert.equal((await c.get("/api/state")).status, 401);
  const blocked = await S.client().login("m.lewandowski@resinvest.group", "Rokitki2026m");
  assert.equal(blocked.json.code, "UNVERIFIED");
  const mails = S.mails();
  const conf = mails.find(m => m.to === "m.lewandowski@resinvest.group"), note = mails.find(m => m.to === "michal.lewandowski@resinvest.group");
  assert.equal(conf.subject, "Potwierdź adres e-mail — ResInvest ERP");
  assert.equal(note.subject, "Zmiana adresu e-mail konta — ResInvest ERP");
  assert.equal((await S.client().post("/api/auth/confirm", { token: conf.token })).status, 200);
  assert.equal((await S.client().login("m.lewandowski@resinvest.group", "Rokitki2026m")).status, 200);
});
test("Sekrety — frontend i odpowiedzi API nie zawierają kluczy ani skrótów haseł", async () => {
  const html = await (await fetch(S.base + "/")).text();
  assert.doesNotMatch(html, /re_[A-Za-z0-9]{16,}|RESEND_API_KEY=\S|SUPABASE_SECRET/);
  const st = JSON.stringify(await admin.state());
  assert.doesNotMatch(st, /scrypt|token_hash|"salt"/);
  const acc = JSON.stringify((await admin.get("/api/users/accounts")).json);
  assert.doesNotMatch(acc, /"hash"|"salt"|token/i);
});
