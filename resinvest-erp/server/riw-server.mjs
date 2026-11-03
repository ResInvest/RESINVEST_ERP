#!/usr/bin/env node
/* =========================================================================
   ResInvest ERP Serwer — praca wielostanowiskowa w sieci lokalnej.

   Uruchomienie:  node --disable-warning=ExperimentalWarning server/riw-server.mjs
   Opcje:         --port 8080  --data <katalog>  --open (otwórz przeglądarkę)
                  --backup-now                      (kopia i zakończenie)
                  --restore <plik.sqlite>           (przywrócenie kopii; serwer zatrzymany)
                  --reset-password <login>          (nowe hasło tymczasowe; serwer zatrzymany)
                  --check                           (kontrola spójności bazy i dziennika)
                  --mail-test <adres>               (wiadomość próbna — sprawdzenie poczty)
   Interfejs: ten sam plik ResInvest_ERP.html co w trybie lokalnym — wykrywa
   serwer (/api/health) i przełącza się na logowanie z sesją serwerową.
   ========================================================================= */
import { createServer as createHttp } from "node:http";
import { createServer as createHttps } from "node:https";
import { readFileSync, existsSync, copyFileSync, createReadStream, statSync, renameSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { ROOT, Store, ROWS, loadConfig, loadEnv, makeLogger, verifyPassword, I18N, R, AuthLib, Service } from "./core.mjs";
import { mailConfig, mailInfo, sendMail, compose, sendRaw } from "./mail.mjs";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) { console.error(`ResInvest ERP Serwer wymaga Node.js 22.13 lub nowszego (jest ${process.versions.node}).`); process.exit(1); }

const t = (s, p) => I18N.t(s, p);
const N_ = s => s;
const arg = (name, def) => { const i = process.argv.indexOf(name); return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true) : def; };
const cfg = loadConfig(Object.assign({}, arg("--port") ? { port: Number(arg("--port")) } : {}, arg("--data") ? { dataDir: arg("--data") } : {}));
const log = makeLogger(join(cfg.dataDir, "logs"));
const HTML_FILE = join(ROOT, "ResInvest_ERP.html");
const VERSION = R.VERSION;
const { env, files: envFiles } = loadEnv(cfg.dataDir);
const mailCfg = mailConfig(env, cfg.dataDir);
const HOURS = { invite: Number(env.INVITE_HOURS) || 72, reset: Number(env.RESET_HOURS) || 1, confirm: Number(env.CONFIRM_HOURS) || 48 };

/* ---------------- polecenia administracyjne (bez uruchamiania serwera) ---------------- */
if (arg("--restore")) {
  const src = String(arg("--restore"));
  if (!existsSync(src)) { console.error("Brak pliku: " + src); process.exit(1); }
  const probe = new Store(Object.assign({}, cfg, { dataDir: join(cfg.dataDir, ".restore-check"), backupDir: join(cfg.dataDir, ".restore-check") }), () => {});
  probe.close();
  const target = join(cfg.dataDir, "resinvest.sqlite");
  if (existsSync(target)) { const keep = join(cfg.backupDir, `resinvest-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-pre-restore.sqlite`); copyFileSync(target, keep); console.log("Poprzednia baza zachowana: " + keep); }
  for (const x of ["-wal", "-shm"]) if (existsSync(target + x)) renameSync(target + x, target + x + ".old");
  copyFileSync(src, target);
  const s = new Store(cfg, console.log.bind(console, "[restore]"));
  console.log(s.integrity.ok ? `Przywrócono: rewizja ${s.state ? s.state.rev : "—"}.` : "UWAGA: " + s.integrity.notes.join("; "));
  s.close(); process.exit(0);
}
const store = new Store(cfg, log);
if (arg("--check")) { console.log(JSON.stringify({ ok: store.integrity.ok, notes: store.integrity.notes, rev: store.state && store.state.rev, journal: store.journalCount }, null, 1)); store.close(); process.exit(store.integrity.ok ? 0 : 2); }
if (arg("--backup-now")) { const r = store.backup("manual"); console.log(r.file); store.close(); process.exit(0); }
if (arg("--reset-password")) {
  const login = String(arg("--reset-password")).toLowerCase(), u = store.state && store.state.users.find(x => x.login === login);
  if (!u) { console.error("Nie znaleziono loginu: " + login); process.exit(1); }
  const pw = "Riw-" + randomBytes(6).toString("base64url") + "7";
  store.setPassword(u.id, pw, true); store.dropUserSessions(u.id);
  store.logLogin(login, u.id, true, N_("reset hasła z konsoli serwera"), "console");
  console.log(`Hasło tymczasowe dla ${login}: ${pw}\nUżytkownik ustawi własne hasło przy logowaniu.`);
  store.close(); process.exit(0);
}

if (arg("--mail-test")) {
  const to = String(arg("--mail-test"));
  const r = await sendMail(mailCfg, "passwordChanged", to, { name: "Test", email: to }, log);
  console.log(r.ok ? `Wysłano (${mailCfg.transport})${r.file ? ": " + r.file : ""}` : "Błąd: " + r.error);
  store.close(); process.exit(r.ok ? 0 : 1);
}

/* ---------------- HTTP ---------------- */
const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
const tls = cfg.tls && cfg.tls.cert && cfg.tls.key && existsSync(cfg.tls.cert) && existsSync(cfg.tls.key);
const COOKIE = "riw_sid";
const clients = new Set();   // SSE
const ipHits = new Map();

function send(req, res, status, body, type = "application/json; charset=utf-8", extra = {}) {
  const view = body && typeof body === "object" && !Buffer.isBuffer(body) ? body[VIEW] : null;
  const wantGz = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
  let data;
  if (view) {
    const rest = JSON.stringify(Object.assign({}, body)).slice(1, -1);          // pola odpowiedzi poza stanem (ok, res, mail…)
    if (rest === '"ok":true' && wantGz) {                                          // odczyt stanu — gotowa, zapamiętana kompresja
      if (!view.gz) view.gz = gzipSync("{" + rest + "," + view.body + "}", { level: 1 });
      data = view.gz;
    } else data = "{" + (rest ? rest + "," : "") + view.body + "}";
  } else data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  const headers = Object.assign({ "Content-Type": type, "Cache-Control": "no-store" }, SEC_HEADERS, extra);
  if (data === (view && view.gz)) headers["Content-Encoding"] = "gzip";
  else if (data.length > 2048 && wantGz) { data = gzipSync(data, { level: 1 }); headers["Content-Encoding"] = "gzip"; }
  headers["Content-Length"] = Buffer.byteLength(data);
  res.writeHead(status, headers); res.end(data);
}
const json = (req, res, status, obj, extra) => send(req, res, status, obj, "application/json; charset=utf-8", extra);
function readBody(req, limit = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on("data", c => { n += c.length; if (n > limit) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
const cookies = req => Object.fromEntries(String(req.headers.cookie || "").split(";").map(x => x.trim().split("=")).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
const ipOf = req => (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
const langOf = (req, user) => (user && user.lang && I18N.has(user.lang)) ? user.lang : (String(req.headers["accept-language"] || "").slice(0, 2).toLowerCase().replace(/[^a-z]/g, "") || "pl");
const sessionCookie = token => `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/${tls ? "; Secure" : ""}`;
const clearCookie = `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${tls ? "; Secure" : ""}`;
function rateLimited(ip) {
  const now = Date.now(), win = 15 * 60000, arr = (ipHits.get(ip) || []).filter(x => now - x < win);
  arr.push(now); ipHits.set(ip, arr);
  return arr.length > cfg.security.ipAttemptsPer15Min;
}
function broadcast(rev, by) {
  const msg = `event: rev\ndata: ${JSON.stringify({ rev, by })}\n\n`;
  for (const c of clients) { try { c.write(msg); } catch (e) { clients.delete(c); } }
}
/**
 * Stan wysyłany do przeglądarki — WYŁĄCZNIE widok użytkownika (izolacja magazynów, Service.project).
 * Konta i hasła nie są częścią stanu.
 */
/**
 * Widok stanu dla użytkownika (tylko jego magazyny). Wynik jest zapamiętywany dla bieżącej rewizji: wielu pracowników
 * odczytujących ten sam stan nie powoduje ponownego liczenia, zamiany na JSON ani kompresji (test obciążeniowy 3.9.1; od 3.10 — także synchronizacja samymi zmianami).
 * Każda zmiana stanu (nowa rewizja) unieważnia pamięć.
 */
const viewCache = { rev: -1, today: "", map: new Map() };
function viewEntry(userId) {
  const rev = store.state.rev, today = store.today();
  if (viewCache.rev !== rev || viewCache.today !== today) { R.applyRoles(store.state); viewCache.rev = rev; viewCache.today = today; viewCache.map.clear(); }
  let v = viewCache.map.get(userId);
  if (!v) { v = { proj: Service.project(store.state, { id: userId }), body: null, gz: null }; viewCache.map.set(userId, v); }
  return v;
}
function stateView(userId) {
  const v = viewEntry(userId);
  if (v.body === null) v.body = JSON.stringify({ state: v.proj, today: viewCache.today, rev: viewCache.rev }).slice(1, -1);   // wnętrze obiektu — doklejane bez ponownej serializacji
  return v;
}
/**
 * Synchronizacja samymi zmianami (3.10): przeglądarka podaje rewizję, którą ma (`since`); serwer odsyła rdzeń widoku
 * (kartoteki, konfiguracja — kilkanaście kB) i w kolekcjach tylko rekordy nowe / zmienione z ich pozycją w widoku
 * oraz identyfikatory usuniętych lub już niewidocznych. `n` — liczba rekordów kolekcji (kontrola po stronie klienta).
 * Brak historii zmian, zmiana kont / uprawnień / kolejności → null (pełny stan).
 */
function deltaView(userId, since) {
  if (!Number.isInteger(since) || since < 0) return null;
  const ch = store.changesSince(since);
  if (!ch) return null;
  const v = viewEntry(userId), P = v.proj;
  if (!P) return null;
  const core = {}, colls = {};
  for (const k of Object.keys(P)) if (!ROWS.includes(k)) core[k] = P[k];
  for (const k of ROWS) {
    const up = ch.up[k], del = ch.del[k];
    if (!(up && up.size) && !(del && del.size)) continue;
    const arr = P[k] || [], ins = [], seen = new Set();
    if (up && up.size) for (let i = 0; i < arr.length; i++) { const id = String(arr[i].id); if (up.has(id)) { ins.push([i, arr[i]]); seen.add(id); } }
    const gone = del ? [...del] : [];
    if (up) for (const id of up) if (!seen.has(id)) gone.push(id);        // zmieniony, ale poza widokiem użytkownika
    colls[k] = { up: ins, del: gone, n: arr.length };
  }
  return { body: JSON.stringify({ delta: { since, core, colls }, today: viewCache.today, rev: viewCache.rev }).slice(1, -1), gz: null };
}
/** Znacznik: obiekt odpowiedzi z gotowym fragmentem stanu (pełny widok albo same zmiany od `since`) — patrz send(). */
const statePayload = (userId, since) => ({ [VIEW]: (since != null && deltaView(userId, since)) || stateView(userId) });
const sinceOf = v => { const n = Number(v); return v !== undefined && v !== null && v !== "" && Number.isInteger(n) && n >= 0 ? n : null; };
const VIEW = Symbol("stateView");
const metaOf = req => ({ ip: ipOf(req), ua: String(req.headers["user-agent"] || "").slice(0, 200) });
/** Adres programu w linkach e-mail: APP_URL; bez niego — adres wyznaczony przez serwer (nigdy z nagłówka Host). */
const appUrl = () => {
  if (env.APP_URL) return String(env.APP_URL).replace(/\/+$/, "");
  const ip = Object.values(networkInterfaces()).flat().find(n => n && n.family === "IPv4" && !n.internal);
  return `${tls ? "https" : "http"}://${cfg.host === "127.0.0.1" || !ip ? "localhost" : ip.address}:${cfg.port}`;
};
const mailHits = new Map();
function mailLimited(key, max, minutes) {
  const now = Date.now(), win = minutes * 60000, arr = (mailHits.get(key) || []).filter(x => now - x < win);
  arr.push(now); mailHits.set(key, arr);
  return arr.length > max;
}
const whName = id => (R.byId(store.state.warehouses, id) || {}).name || "";
/** Wysyłka z szablonu + zapis w kolejce `outbox`. Komunikat dla użytkownika bez szczegółów technicznych. */
async function mailTo(template, u, data, email) {
  const to = email || u.email || u.login;
  const r = await sendMail(mailCfg, template, to, Object.assign({ name: u.name, email: to }, data), log);
  store.logMail(template, to, u.id, r, mailCfg.transport);
  return r.ok ? { ok: true, transport: mailCfg.transport, file: r.file || "" } : { ok: false, error: t("Nie udało się wysłać wiadomości e-mail. Sprawdź konfigurację poczty (dziennik serwera) i spróbuj ponownie.") };
}
/** Zaproszenie: nowy token (poprzednie tracą ważność), e-mail, wpis audytu. Błąd wysyłki — konto zostaje INVITED. */
async function sendInvite(u, actor, meta) {
  const token = store.createToken(u.id, "invite", HOURS.invite, u.email, actor && actor.id);
  const m = await mailTo("invite", u, { link: `${appUrl()}/#/invite/accept?token=${token}`, hours: HOURS.invite, role: (R.ROLES[u.role] || {}).code, warehouse: whName(u.whId) });
  if (!m.ok) store.dropTokens(u.id, "invite");
  store.auditEvent({ entityId: u.id, opNo: u.login, code: m.ok ? "INVITE_SENT" : "INVITE_EMAIL_FAILED",
    act: R.Lx(m.ok ? N_("Wysłanie zaproszenia e-mail: {l}") : N_("Wysłanie zaproszenia nieudane: {l}"), { l: u.login }), before: null, after: { email: u.login, wysylka: m.ok ? mailCfg.transport : "błąd" }, source: N_("Administracja — użytkownicy") }, meta, actor);
  return m;
}
async function sendConfirm(u, actor, meta) {
  const token = store.createToken(u.id, "confirm", HOURS.confirm, u.email, actor && actor.id);
  const m = await mailTo("confirm", u, { link: `${appUrl()}/#/confirm-email?token=${token}`, hours: HOURS.confirm });
  if (!m.ok) store.dropTokens(u.id, "confirm");
  store.auditEvent({ entityId: u.id, opNo: u.login, code: m.ok ? "EMAIL_CONFIRMATION_SENT" : "EMAIL_CONFIRMATION_FAILED", act: R.Lx(N_("Wysłanie prośby o potwierdzenie adresu: {l}"), { l: u.login }), before: null, after: { wysylka: m.ok ? mailCfg.transport : "błąd" }, source: N_("Administracja — użytkownicy") }, meta, actor);
  return m;
}
async function sendReset(u, actor, meta) {
  const token = store.createToken(u.id, "reset", HOURS.reset, u.email, actor ? actor.id : u.id);
  const m = await mailTo("reset", u, { link: `${appUrl()}/#/reset-password?token=${token}`, hours: HOURS.reset });
  if (!m.ok) store.dropTokens(u.id, "reset");
  store.auditEvent({ entityId: u.id, opNo: u.login, code: "PASSWORD_RESET_REQUESTED", act: R.Lx(actor ? N_("Reset hasła wysłany przez administratora: {l}") : N_("Prośba o reset hasła: {l}"), { l: u.login }), before: null, after: { wysylka: m.ok ? mailCfg.transport : "błąd" }, source: actor ? N_("Administracja — użytkownicy") : N_("Ekran logowania") }, meta, actor || u);
  return m;
}
/* ---------------- powiadomienia e-mail: kolejka (zapis w bazie), wysyłka w tle, ponowienia ---------------- */
/** Po zatwierdzonej zmianie: powiadomienia z prośbą o e-mail → kolejka `outbox` (treść PL, link do operacji). */
function queueNotices(ids) {
  if (!ids || !ids.length) return 0;
  const want = new Set(ids);
  let n = 0;
  for (const x of store.state.notices || []) {
    if (!want.has(x.id) || !x.email) continue;
    const u = R.byId(store.state.users, x.userId);
    const to = u && (u.email || u.login);
    if (!to || R.statusOf(u) !== "ACTIVE") continue;
    const c = R.Notify.mailContent(x);
    const msg = compose("notice", to, { name: u.name, subject: c.subject, lines: c.lines, link: `${appUrl()}/#/${x.opId ? "operacje?op=" + encodeURIComponent(x.opId) : x.kind === "approval" || x.kind === "rejected" ? "operacje" : x.kind === "registration" ? "uzytkownicy" : "powiadomienia"}` });
    store.enqueueMail("notice", to, u.id, msg.subject, { html: msg.html, text: msg.text }, x.id);
    n++;
  }
  if (n) setTimeout(() => drainMail().catch(e => log("ERROR", "Kolejka poczty: " + e.message)), 50);
  return n;
}
/* ---------------- wysyłka dokumentów e-mailem: walidacja po stronie serwera ---------------- */
const MAIL_DOC = { maxMb: 8, maxBody: 12 * 1024 * 1024, maxTo: 10, perHour: 40 };
const EMAIL_RE = /^[^\s@<>(),;:"\[\]]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const clean1 = (s, n) => String(s == null ? "" : s).replace(/[\r\n\t]+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, n);
/** Dane wiadomości z przeglądarki → zweryfikowane pola (adresy, temat, treść, PDF). Domena odbiorców: opcjonalnie lista dozwolonych (konfiguracja serwera). */
function validateDocumentMail(b, user) {
  const to = [...new Set(String(b.to || "").split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean))];
  if (!to.length) return { field: "to", error: t("Podaj co najmniej jeden adres e-mail odbiorcy.") };
  if (to.length > MAIL_DOC.maxTo) return { field: "to", error: t("Maksymalnie {n} odbiorców w jednej wysyłce.", { n: MAIL_DOC.maxTo }) };
  const bad = to.find(x => x.length > 254 || !EMAIL_RE.test(x));
  if (bad) return { field: "to", error: t("Nieprawidłowy adres e-mail: {e}", { e: bad.slice(0, 80) }) };
  const domains = (cfg.mail && Array.isArray(cfg.mail.documentDomains) ? cfg.mail.documentDomains : []).map(d => String(d).trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  if (domains.length) { const out = to.find(x => !domains.includes(x.split("@")[1])); if (out) return { field: "to", error: t("Adres {e} jest spoza dozwolonych domen: {d}", { e: out, d: domains.join(", ") }) }; }
  const subject = clean1(b.subject, 200), title = clean1(b.title, 200) || subject;
  if (!subject) return { field: "subject", error: t("Podaj temat wiadomości.") };
  const message = String(b.message == null ? "" : b.message).replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, 4000);
  let filename = clean1(b.filename, 120).replace(/[\\/:*?"<>|]+/g, "_");
  if (!/\.pdf$/i.test(filename)) filename = (filename || "dokument") + ".pdf";
  const pdf = String(b.pdf || "").replace(/\s+/g, "");
  if (!pdf || !/^[A-Za-z0-9+/]+=*$/.test(pdf)) return { field: "pdf", error: t("Brak załącznika PDF.") };
  const buf = Buffer.from(pdf, "base64");
  if (buf.length > MAIL_DOC.maxMb * 1024 * 1024) return { field: "pdf", error: t("Załącznik jest za duży (maks. {n} MB).", { n: MAIL_DOC.maxMb }) };
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return { field: "pdf", error: t("Załącznik nie jest plikiem PDF.") };
  const kind = ["DOC", "KWIT", "RAP"].includes(b.kind) ? b.kind : "RAP";
  return { to, subject, title, message, filename, pdf, bytes: buf.length, kind, number: clean1(b.number, 60), range: clean1(b.range, 120), warehouse: clean1(b.warehouse, 120) };
}
let draining = null;
/** Wysyłka wiadomości z kolejki (jedna naraz w procesie serwera). Błąd poczty nie wpływa na dane. */
function drainMail() {
  if (draining) return draining;
  draining = (async () => {
    let sent = 0, failed = 0;
    for (let guard = 0; guard < 20; guard++) {
      const rows = store.claimDue(10);
      if (!rows.length) break;
      for (const row of rows) {
        let body = {}; try { body = JSON.parse(row.body || "{}"); } catch (e) {}
        const r = await sendRaw(mailCfg, { to: row.to_addr, template: row.template, subject: row.subject, html: body.html || "", text: body.text || "", attachments: body.attachments, replyTo: body.replyTo }, log);
        if (r.ok) { store.markSent(row.id, r, mailCfg.transport); sent++; }
        else { const f = store.markFailed(row.id, r.error, mailCfg.transport); failed++; if (f.dead) log("ERROR", `E-mail #${row.id} → ${row.to_addr} porzucony po ${f.attempts} próbach`); }
      }
    }
    return { sent, failed };
  })().finally(() => { draining = null; });
  return draining;
}

const TOKEN_ERR = { BAD: N_("Link jest nieprawidłowy."), USED: N_("Link został już wykorzystany."), EXPIRED: N_("Link wygasł — poproś administratora o nowy.") };
const tokenError = code => ({ ok: false, code, error: t(TOKEN_ERR[code] || TOKEN_ERR.BAD) });
/** Czynności po zapisie konta: dezaktywacja (wylogowanie + e-mail), zmiana adresu (potwierdzenie + powiadomienie). */
async function afterUserSave(r, actor, meta) {
  if (!r || !r.ok || !r.rec) return;
  const u = r.rec, before = r.before;
  if (R.statusOf(u) !== "ACTIVE") store.dropUserSessions(u.id);
  if (!before) return;
  if (R.statusOf(before) !== "DISABLED" && u.status === "DISABLED") { store.dropTokens(u.id); await mailTo("deactivated", u, {}); }
  // zatwierdzone zgłoszenie rejestracji → e-mail z informacją o roli i magazynie
  if (before.selfRegistered && R.statusOf(before) === "INVITED" && R.statusOf(u) === "ACTIVE") {
    const m = await mailTo("approved", u, { link: appUrl(), role: R.ROLES[u.role] ? R.ROLES[u.role].code : u.role, warehouse: whName(u.whId), by: actor ? actor.name : "" });
    store.auditEvent({ entityId: u.id, opNo: u.login, code: m.ok ? "REGISTRATION_APPROVED_SENT" : "REGISTRATION_APPROVED_EMAIL_FAILED", act: R.Lx(N_("Powiadomienie o zatwierdzeniu konta: {l}"), { l: u.login }), before: null, after: { wysylka: m.ok ? mailCfg.transport : "błąd" }, source: N_("Administracja — użytkownicy") }, meta, actor);
  }
  const oldEmail = before.email || before.login;
  if (oldEmail !== u.email) {
    store.dropTokens(u.id);
    if (R.statusOf(u) === "ACTIVE") {
      store.applyChange("user.emailUnverified", s => { const x = R.byId(s.users, u.id); x.emailUnverified = true; x.emailVerifiedAt = null; s.rev += 1; return { ok: true }; }, { userId: u.id }, actor);
      store.dropUserSessions(u.id);
      await sendConfirm(R.byId(store.state.users, u.id), actor, meta);
    }
    await mailTo("emailChanged", u, { oldEmail, newEmail: u.email, by: actor && actor.name }, oldEmail);
  }
}

async function handleApi(req, res, url) {
  const method = req.method, path = url.pathname;
  const sid = cookies(req)[COOKIE];
  const sess = store.state ? store.session(sid) : null;
  const L = langOf(req, sess && sess.user);
  I18N.setLang(L);
  if (method !== "GET") {
    // ochrona przed CSRF: własny nagłówek (wymusza preflight dla obcych stron) + zgodność Origin
    if (req.headers["x-riw"] !== "1") return json(req, res, 403, { ok: false, error: t("Żądanie odrzucone (brak nagłówka aplikacji)") });
    const origin = req.headers.origin;
    if (origin && origin !== `${tls ? "https" : "http"}://${req.headers.host}`) return json(req, res, 403, { ok: false, error: t("Żądanie odrzucone (inne pochodzenie)") });
  }
  if (path === "/api/health") return json(req, res, 200, { ok: true, app: "resinvest-erp", mode: "server", version: VERSION, setup: !store.hasAccounts(), integrity: store.integrity.ok, host: req.headers.host, selfRegistration: !!(store.state && store.state.config.allowSelfRegistration) });
  if (path === "/api/setup" && method === "POST") {
    if (store.hasAccounts()) return json(req, res, 409, { ok: false, error: t("Serwer jest już skonfigurowany") });
    const b = await readBody(req);
    const r = store.setup(b);
    return json(req, res, r.ok ? 200 : 400, r);
  }
  if (path === "/api/auth/login" && method === "POST") {
    const ip = ipOf(req);
    if (rateLimited(ip)) return json(req, res, 429, { ok: false, code: "RATE", error: t("Zbyt wiele prób logowania z tego adresu. Spróbuj za kilka minut.") });
    const b = await readBody(req);
    if (!store.state) return json(req, res, 503, { ok: false, error: t("Serwer nie jest skonfigurowany") });
    const r = store.login(b.login, b.password, ip);
    if (!r.ok) return json(req, res, 401, r);
    const token = store.createSession(r.user.id, ip, req.headers["user-agent"]);
    log("INFO", `Logowanie: ${r.user.login} (${ip})`);
    return json(req, res, 200, { ok: true, userId: r.user.id, mustChange: r.mustChange, user: { id: r.user.id, name: r.user.name, login: r.user.login, lang: r.user.lang, theme: r.user.theme } }, { "Set-Cookie": sessionCookie(token) });
  }
  if (path === "/api/auth/register" && method === "POST") {
    const ip = ipOf(req);
    if (rateLimited(ip)) return json(req, res, 429, { ok: false, code: "RATE", error: t("Zbyt wiele prób logowania z tego adresu. Spróbuj za kilka minut.") });
    if (!store.state) return json(req, res, 503, { ok: false, error: t("Serwer nie jest skonfigurowany") });
    const b = await readBody(req, 64 * 1024);
    // ten sam adres e-mail: najwyżej 3 wiadomości na godzinę (ochrona skrzynek przed zalewem)
    if (mailLimited("reg:" + String((b.rec && b.rec.email) || "").trim().toLowerCase(), 3, 60)) return json(req, res, 429, { ok: false, code: "RATE", error: t("Zbyt wiele prób rejestracji dla tego adresu. Spróbuj za godzinę.") });
    const r = store.register(b.rec || {}, b.password, L, metaOf(req));
    if (!r.ok) return json(req, res, 400, r);
    broadcast(store.state.rev, null);
    const u = R.byId(store.state.users, r.userId);
    const mail = u ? await sendConfirm(u, null, metaOf(req)) : { ok: false };
    return json(req, res, 200, { ok: true, confirm: true, mail: { ok: !!mail.ok, transport: mail.transport || "" } });
  }
  /* ---- linki z e-maili (bez sesji): zaproszenie, reset hasła, potwierdzenie adresu ---- */
  if (path === "/api/auth/token" && method === "POST") {
    if (!store.state) return json(req, res, 503, { ok: false, error: t("Serwer nie jest skonfigurowany") });
    if (rateLimited(ipOf(req))) return json(req, res, 429, { ok: false, code: "RATE", error: t("Zbyt wiele prób z tego adresu. Spróbuj za kilka minut.") });
    const b = await readBody(req, 64 * 1024);
    const kind = ["invite", "reset", "confirm"].includes(b.kind) ? b.kind : "";
    const p = kind ? store.peekToken(String(b.token || ""), kind) : { ok: false, code: "BAD" };
    if (!p.ok) return json(req, res, 400, tokenError(p.code));
    const u = R.byId(store.state.users, p.row.user_id);
    if (!u || (p.row.email && p.row.email !== u.email)) return json(req, res, 400, tokenError("BAD"));
    return json(req, res, 200, { ok: true, kind, email: u.email, name: u.name, firstName: u.firstName || "" });
  }
  if ((path === "/api/invite/accept" || path === "/api/auth/reset") && method === "POST") {
    if (!store.state) return json(req, res, 503, { ok: false, error: t("Serwer nie jest skonfigurowany") });
    const ip = ipOf(req);
    if (rateLimited(ip)) return json(req, res, 429, { ok: false, code: "RATE", error: t("Zbyt wiele prób z tego adresu. Spróbuj za kilka minut.") });
    const b = await readBody(req, 64 * 1024), kind = path === "/api/invite/accept" ? "invite" : "reset";
    const p = store.peekToken(String(b.token || ""), kind);
    if (!p.ok) return json(req, res, 400, tokenError(p.code));
    const u = R.byId(store.state.users, p.row.user_id);
    if (!u || (p.row.email && p.row.email !== u.email)) return json(req, res, 400, tokenError("BAD"));
    const st = R.statusOf(u);
    if (kind === "invite" && st !== "INVITED") return json(req, res, 400, st === "ACTIVE" ? tokenError("USED") : { ok: false, code: "INACTIVE", error: t("Twoje konto jest nieaktywne.") });
    if (kind === "reset" && st !== "ACTIVE") return json(req, res, 400, { ok: false, code: "INACTIVE", error: t("Twoje konto jest nieaktywne.") });
    const pe = AuthLib.passwordError(b.password, u.login); if (pe) return json(req, res, 400, { ok: false, field: "password", error: pe });
    if (b.password2 !== undefined && b.password2 !== b.password) return json(req, res, 400, { ok: false, field: "password2", error: t("Hasła nie są zgodne") });
    if (!store.useToken(String(b.token), kind).ok) return json(req, res, 400, tokenError("USED"));
    const meta = metaOf(req);
    if (kind === "invite") {
      const r = store.applyChange("auth.inviteAccept", s => R.Users.activate(s, u.id, Object.assign({ today: store.today() }, meta)), { userId: u.id }, u);
      if (!r.ok) return json(req, res, 400, { ok: false, error: r.error });
      store.setPassword(u.id, b.password, false);
      store.logLogin(u.login, u.id, true, N_("aktywacja konta z zaproszenia"), ip);
      broadcast(store.state.rev, u.id);
    } else {
      store.setPassword(u.id, b.password, false); store.dropUserSessions(u.id); store.dropTokens(u.id, "reset");
      store.logLogin(u.login, u.id, true, N_("reset hasła z linku e-mail"), ip);
      store.auditEvent({ entityId: u.id, opNo: u.login, code: "PASSWORD_RESET_COMPLETED", act: R.Lx(N_("Ustawienie nowego hasła z linku e-mail: {l}"), { l: u.login }), before: null, after: null, source: N_("Reset hasła") }, meta, u);
      await mailTo("passwordChanged", u, {});
      broadcast(store.state.rev, u.id);
    }
    return json(req, res, 200, { ok: true, email: u.email });
  }
  if (path === "/api/auth/confirm" && method === "POST") {
    if (!store.state) return json(req, res, 503, { ok: false, error: t("Serwer nie jest skonfigurowany") });
    if (rateLimited(ipOf(req))) return json(req, res, 429, { ok: false, code: "RATE", error: t("Zbyt wiele prób z tego adresu. Spróbuj za kilka minut.") });
    const b = await readBody(req, 64 * 1024);
    const p = store.peekToken(String(b.token || ""), "confirm");
    if (!p.ok) return json(req, res, 400, tokenError(p.code));
    const u = R.byId(store.state.users, p.row.user_id);
    if (!u || p.row.email !== u.email) return json(req, res, 400, tokenError("BAD"));
    if (!store.useToken(String(b.token), "confirm").ok) return json(req, res, 400, tokenError("USED"));
    let notices = [];
    store.applyChange("auth.emailConfirm", s => {
      const x = R.byId(s.users, u.id); delete x.emailUnverified; x.emailVerifiedAt = new Date().toISOString(); s.rev += 1;
      R.audit(s, Object.assign({ user: x }, metaOf(req)), { entity: "user", entityId: x.id, opNo: x.login, event: "user", code: "EMAIL_CONFIRMED", act: R.Lx(N_("Potwierdzenie adresu e-mail: {l}"), { l: x.login }), before: null, after: { email: x.login }, source: N_("Potwierdzenie adresu e-mail") });
      // zgłoszenie rejestracji z potwierdzonym adresem → powiadomienie administratorów (w programie i e-mailem)
      if (x.selfRegistered && R.statusOf(x) === "INVITED") { R.applyRoles(s); notices = R.Notify.forRegistration(s, x, { today: store.today(), source: N_("Rejestracja") }).map(n => n.id); }
      return { ok: true };
    }, { userId: u.id }, u);
    broadcast(store.state.rev, u.id);
    if (notices.length) queueNotices(notices);
    const pending = !!u.selfRegistered && R.statusOf(R.byId(store.state.users, u.id)) === "INVITED";
    return json(req, res, 200, { ok: true, email: u.email, pending });
  }
  /** „Nie pamiętam hasła” — zawsze ta sama odpowiedź (bez ujawniania, czy konto istnieje), limit prób. */
  if (path === "/api/auth/forgot" && method === "POST") {
    if (!store.state) return json(req, res, 503, { ok: false, error: t("Serwer nie jest skonfigurowany") });
    const ip = ipOf(req);
    if (rateLimited(ip) || mailLimited("ip:" + ip, 10, 60)) return json(req, res, 429, { ok: false, code: "RATE", error: t("Zbyt wiele prób z tego adresu. Spróbuj za kilka minut.") });
    const b = await readBody(req, 64 * 1024);
    const em = R.validateCompanyEmail(b.email, store.state.config.companyDomains);
    if (!em.ok) return json(req, res, 400, { ok: false, field: "email", error: em.error });
    const same = { ok: true, message: t("Jeśli konto z tym adresem istnieje i jest aktywne, wysłaliśmy wiadomość z linkiem do ustawienia nowego hasła.") };
    const u = store.state.users.find(x => R.normalizeEmail(x.email || x.login) === em.email);
    if (u && R.statusOf(u) === "ACTIVE" && store.account(u.id) && !mailLimited("em:" + em.email, 3, 60)) await sendReset(u, null, metaOf(req));
    else store.logLogin(em.email, u ? u.id : null, false, N_("reset hasła — bez wysyłki (brak aktywnego konta lub limit)"), ip);
    return json(req, res, 200, same);
  }
  if (path === "/api/auth/logout" && method === "POST") { if (sid) store.dropSession(sid); if (sess) store.logLogin(sess.user.login, sess.userId, true, N_("wylogowanie"), ipOf(req)); return json(req, res, 200, { ok: true }, { "Set-Cookie": clearCookie }); }

  /* ---- od tego miejsca wymagana sesja ---- */
  if (!sess && path === "/api/auth/me") return json(req, res, 200, { ok: false, code: "AUTH" });
  if (!sess) return json(req, res, 401, { ok: false, code: "AUTH", error: t("Sesja wygasła — zaloguj się ponownie.") }, { "Set-Cookie": clearCookie });
  const user = sess.user, acc = store.account(user.id);
  const must = acc && acc.must_change;
  if (path === "/api/auth/me") return json(req, res, 200, { ok: true, userId: user.id, mustChange: !!must, idleMinutes: cfg.session.idleMinutes, user: { id: user.id, name: user.name, login: user.login, lang: user.lang, theme: user.theme } });
  if (path === "/api/auth/password" && method === "POST") {
    const b = await readBody(req);
    if (!AuthLib || !store.account(user.id)) return json(req, res, 400, { ok: false, error: t("Nie znaleziono konta") });
    if (!verifyPassword(b.old, store.account(user.id))) { store.logLogin(user.login, user.id, false, N_("zmiana hasła — błędne obecne hasło"), ipOf(req)); return json(req, res, 400, { ok: false, field: "old", error: t("Obecne hasło jest nieprawidłowe") }); }
    const pe = AuthLib.passwordError(b.new, user.login); if (pe) return json(req, res, 400, { ok: false, field: "new", error: pe });
    if (verifyPassword(b.new, store.account(user.id))) return json(req, res, 400, { ok: false, field: "new", error: t("Nowe hasło musi być inne niż obecne") });
    store.setPassword(user.id, b.new, false); store.dropUserSessions(user.id, sid); store.dropTokens(user.id, "reset");
    store.logLogin(user.login, user.id, true, N_("zmiana hasła"), ipOf(req));
    store.auditEvent({ entityId: user.id, opNo: user.login, code: "PASSWORD_CHANGED", act: R.Lx(N_("Zmiana własnego hasła: {l}"), { l: user.login }), before: null, after: null, source: N_("Moje konto") }, metaOf(req), user);
    await mailTo("passwordChanged", user, {});
    return json(req, res, 200, { ok: true });
  }
  if (must) return json(req, res, 403, { ok: false, code: "MUST_CHANGE", error: t("Ustaw nowe hasło przed rozpoczęciem pracy") });

  if (path === "/api/state" && method === "GET") return json(req, res, 200, Object.assign({ ok: true }, statePayload(user.id, sinceOf(url.searchParams.get("since")))));
  if (path === "/api/events" && method === "GET") {
    res.writeHead(200, Object.assign({ "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" }, SEC_HEADERS));
    res.write(`event: rev\ndata: ${JSON.stringify({ rev: store.state.rev })}\n\n`);
    clients.add(res); req.on("close", () => clients.delete(res));
    return;
  }
  if (path === "/api/cmd" && method === "POST") {
    const b = await readBody(req);
    const cmd = String(b.cmd || ""), args = b.args || {};
    // nowe konto w trybie FIRMOWYM tylko przez zaproszenie (/api/users/invite) albo z hasłem tymczasowym (/api/users)
    if (cmd === "user.save" && !(args.rec && args.rec.id)) return json(req, res, 403, { ok: true, res: { ok: false, code: "FORBIDDEN", error: t("Nowe konto dodaje się przez zaproszenie e-mail") }, today: store.today() });
    const r = store.execute(user.id, cmd, args, L, metaOf(req));
    const changed = !!r.__changed; delete r.__changed;
    if (changed) {
      if (r.notices) { queueNotices(r.notices); delete r.notices; }
      if (cmd === "user.save") await afterUserSave(r, user, metaOf(req));
      if (cmd === "user.remove" && r.ok) { store.dropAccount(String(args.id)); store.dropTokens(String(args.id)); }
      broadcast(store.state.rev, user.id);
    }
    const out = Object.assign({}, r); delete out.before;
    // odmowa z powodu uprawnień / dostępu do magazynu — HTTP 403 (treść jak zwykle w `res`)
    return json(req, res, out.code === "FORBIDDEN" ? 403 : 200, Object.assign({ ok: true, res: out }, changed ? statePayload(user.id, sinceOf(b.haveRev)) : { today: store.today() }));
  }
  /* ---- użytkownicy i hasła (administrator) ---- */
  if (path.startsWith("/api/users")) {
    R.applyRoles(store.state);
    if (path === "/api/users/accounts" && method === "GET" && R.can(user, "users.read") && !R.can(user, "users.manage")) {
      const out = {};
      for (const u of Service.project(store.state, user).users) { const a = store.account(u.id); out[u.id] = a ? { hasPassword: true, lastLogin: a.last_login } : { hasPassword: false }; }
      return json(req, res, 200, { ok: true, accounts: out });
    }
    if (!R.can(user, "users.manage")) return json(req, res, 403, { ok: false, code: "FORBIDDEN", error: t("Nie masz uprawnień do wykonania tej operacji.") });
    if (path === "/api/users/accounts" && method === "GET") {
      const out = {};
      for (const u of store.state.users) {
        const a = store.account(u.id), tk = store.tokenInfo(u.id).find(x => x.kind === "invite");
        const invite = tk ? { sentAt: tk.createdAt, expiresAt: tk.expiresAt, used: !!tk.usedAt, expired: !tk.usedAt && Date.parse(tk.expiresAt) < Date.now() } : null;
        out[u.id] = Object.assign(a ? { hasPassword: true, mustChange: !!a.must_change, failed: a.failed, lockedUntil: a.locked_until, lastLogin: a.last_login, changedAt: a.changed_at } : { hasPassword: false }, { invite });
      }
      return json(req, res, 200, { ok: true, accounts: out, mail: mailInfo(mailCfg) });
    }
    const b = await readBody(req);
    const meta = metaOf(req);
    if (path === "/api/users" && method === "POST") {
      const pe = AuthLib.passwordError(b.password, b.rec && (b.rec.email || b.rec.login));
      if (pe) return json(req, res, 200, { ok: true, res: { ok: false, errors: { password: pe }, error: pe } });
      const rec = Object.assign({}, b.rec, { id: undefined, status: "ACTIVE" });
      const r = store.execute(user.id, "user.save", { rec, source: "Administracja — użytkownicy" }, L, meta);
      const changed = !!r.__changed; delete r.__changed; delete r.before;
      if (r.ok) { store.setPassword(r.rec.id, b.password, true); store.logLogin(r.rec.login, r.rec.id, true, N_("hasło ustawione przez administratora"), ipOf(req)); }
      if (changed) broadcast(store.state.rev, user.id);
      return json(req, res, 200, Object.assign({ ok: true, res: r }, changed ? statePayload(user.id) : {}));
    }
    /** Dodaj użytkownika → zaproszenie e-mail (konto INVITED do czasu ustawienia hasła z linku). */
    if (path === "/api/users/invite" && method === "POST") {
      const rec = Object.assign({}, b.rec, { id: undefined, status: "INVITED" });
      const r = store.execute(user.id, "user.save", { rec, source: "Administracja — użytkownicy" }, L, meta);
      const changed = !!r.__changed; delete r.__changed; delete r.before;
      let mail = null;
      if (r.ok) mail = await sendInvite(r.rec, user, meta);
      if (changed) broadcast(store.state.rev, user.id);
      return json(req, res, 200, Object.assign({ ok: true, res: r, mail }, changed ? statePayload(user.id) : {}));
    }
    /** Ponowne wysłanie: zaproszenie (INVITED) albo potwierdzenie adresu (zmieniony e-mail). Bez nowego konta. */
    if (path === "/api/users/resend" && method === "POST") {
      const u = R.byId(store.state.users, b.userId);
      if (!u) return json(req, res, 404, { ok: false, error: t("Nie znaleziono użytkownika") });
      if (u.role === "admin" && user.role !== "admin") return json(req, res, 403, { ok: false, code: "FORBIDDEN", error: t("Nie masz uprawnień do wykonania tej operacji.") });
      let mail;
      if (R.statusOf(u) === "INVITED" && !u.selfRegistered) mail = await sendInvite(u, user, meta);
      else if (u.emailUnverified) mail = await sendConfirm(u, user, meta);
      else return json(req, res, 400, { ok: false, error: t("Konto jest aktywne — zaproszenie nie jest potrzebne") });
      return json(req, res, 200, Object.assign({ ok: true, mail }, statePayload(user.id)));
    }
    /** Reset hasła wysłany przez administratora (link e-mail; hasła administrator nie zna). */
    if (path === "/api/users/reset-link" && method === "POST") {
      const u = R.byId(store.state.users, b.userId);
      if (!u) return json(req, res, 404, { ok: false, error: t("Nie znaleziono użytkownika") });
      if (u.role === "admin" && user.role !== "admin") return json(req, res, 403, { ok: false, code: "FORBIDDEN", error: t("Nie masz uprawnień do wykonania tej operacji.") });
      if (R.statusOf(u) !== "ACTIVE") return json(req, res, 400, { ok: false, error: t("Twoje konto jest nieaktywne.") });
      const mail = await sendReset(u, user, meta);
      return json(req, res, 200, Object.assign({ ok: true, mail }, statePayload(user.id)));
    }
    if (path === "/api/users/password" && method === "POST") {
      const u = R.byId(store.state.users, b.userId);
      if (!u) return json(req, res, 404, { ok: false, error: t("Nie znaleziono użytkownika") });
      if (u.role === "admin" && user.role !== "admin") return json(req, res, 403, { ok: false, code: "FORBIDDEN", error: t("Nie masz uprawnień do wykonania tej operacji.") });
      const pe = AuthLib.passwordError(b.password, u.login); if (pe) return json(req, res, 400, { ok: false, error: pe });
      store.setPassword(u.id, b.password, b.mustChange !== false); store.dropUserSessions(u.id); store.dropTokens(u.id, "reset");
      store.logLogin(u.login, u.id, true, N_("hasło ustawione przez administratora"), ipOf(req));
      store.auditEvent({ entityId: u.id, opNo: u.login, code: "PASSWORD_SET_BY_ADMIN", act: R.Lx(N_("Hasło tymczasowe ustawione przez administratora: {l}"), { l: u.login }), before: null, after: { zmianaWymagana: b.mustChange !== false }, source: N_("Administracja — użytkownicy") }, meta, user);
      return json(req, res, 200, { ok: true });
    }
    if (path === "/api/users/unlock" && method === "POST") {
      if (!store.account(b.userId)) return json(req, res, 404, { ok: false, error: t("Nie znaleziono konta") });
      store.db.prepare("UPDATE accounts SET failed = 0, locked_until = NULL WHERE user_id = ?").run(b.userId);
      const ul = R.byId(store.state.users, b.userId);
      if (ul) store.auditEvent({ entityId: ul.id, opNo: ul.login, code: "USER_UNLOCKED", act: R.Lx(N_("Odblokowanie konta po nieudanych logowaniach: {l}"), { l: ul.login }), before: null, after: null, source: N_("Administracja — użytkownicy") }, meta, user);
      return json(req, res, 200, { ok: true });
    }
  }
  if ((path === "/api/auth/log" || path === "/api/audit/extra") && method === "GET") {
    R.applyRoles(store.state);
    if (!R.can(user, "users.manage") && !R.can(user, "audit.read")) return json(req, res, 403, { ok: false, code: "FORBIDDEN", error: t("Nie masz uprawnień do wykonania tej operacji.") });
    const rows = store.db.prepare("SELECT ts, login, user_id AS userId, ok, reason, ip FROM login_log ORDER BY id DESC LIMIT 1000").all().map(r => Object.assign({}, r, { ok: !!r.ok }));
    return json(req, res, 200, { ok: true, log: rows, mail: store.mailLog(300), mailConfig: mailInfo(mailCfg) });
  }
  /* ---- wysyłka dokumentu / raportu e-mailem (PDF w załączniku) — 3.6 ---- */
  if (path === "/api/mail-document" && method === "POST") {
    R.applyRoles(store.state);
    if (!R.can(user, "reports.export")) return json(req, res, 403, { ok: false, code: "FORBIDDEN", error: t("Brak uprawnienia „{p}”", { p: "reports.export" }) });
    let b;
    try { b = await readBody(req, MAIL_DOC.maxBody); } catch (e) { return json(req, res, 413, { ok: false, error: t("Załącznik jest za duży (maks. {n} MB).", { n: MAIL_DOC.maxMb }) }); }
    const v = validateDocumentMail(b, user);
    if (v.error) return json(req, res, 400, { ok: false, field: v.field, error: v.error });
    const since = new Date(Date.now() - 3600 * 1000).toISOString();
    if (store.documentsSince(user.id, since) + v.to.length > MAIL_DOC.perHour) return json(req, res, 429, { ok: false, error: t("Limit wysyłki: {n} wiadomości z dokumentami na godzinę. Spróbuj później.", { n: MAIL_DOC.perHour }) });
    const meta = metaOf(req), byEmail = user.email || user.login;
    const data = { subject: v.subject, title: v.title, message: v.message, range: v.range, warehouse: v.warehouse, filename: v.filename, sizeKb: Math.max(1, Math.round(v.bytes / 1024)), by: user.name, byEmail };
    const ids = [];
    for (const to of v.to) {
      const msg = compose("document", to, data);
      // treść i załącznik w kolejce do chwili wysłania — po wysyłce usuwane (zostaje wpis w dzienniku)
      ids.push(store.enqueueMail("document", to, user.id, msg.subject, { html: msg.html, text: msg.text, replyTo: byEmail, attachments: [{ filename: v.filename, content: v.pdf, contentType: "application/pdf" }] }, null));
    }
    store.auditEvent({ entityId: v.number || v.filename, opNo: v.number || v.filename, code: "MAIL_DOCUMENT", act: R.Lx(N_("Wysłanie e-mailem: {title} → {to}"), { title: v.title.slice(0, 160), to: v.to.join(", ") }), before: null, after: { odbiorcy: v.to, temat: v.subject, plik: v.filename, kB: data.sizeKb, rodzaj: v.kind }, entity: "report", event: "print", source: N_("Wysyłka e-mailem") }, meta, user);
    broadcast(store.state.rev, null);
    const r = await drainMail();
    const queued = store.outbox("", 50).rows.filter(x => ids.includes(x.id));
    const sent = queued.filter(x => x.status === "SENT").length;
    return json(req, res, 200, { ok: true, sent, queued: ids.length - sent, transport: mailCfg.transport,
      message: sent === ids.length ? t("Wysłano do: {to}.", { to: v.to.join(", ") }) : t("Wiadomość w kolejce wysyłki ({n}) — system ponowi próbę automatycznie.", { n: ids.length - sent }), failed: r.failed });
  }
  /* ---- poczta: dziennik wysyłki, ponowienie, test, przetworzenie kolejki (administrator) ---- */
  if (path.startsWith("/api/mail/")) {
    R.applyRoles(store.state);
    if (!R.can(user, "notifications.manage")) return json(req, res, 403, { ok: false, code: "FORBIDDEN", error: t("Nie masz uprawnień do wykonania tej operacji.") });
    if (path === "/api/mail/outbox" && method === "GET") {
      const st = String(url.searchParams.get("status") || "");
      const o = store.outbox(["QUEUED", "SENDING", "SENT", "FAILED", "DEAD"].includes(st) ? st : "", 300);
      return json(req, res, 200, { ok: true, rows: o.rows, stats: o.stats, mail: mailInfo(mailCfg) });
    }
    if (method !== "POST") return json(req, res, 404, { ok: false, error: t("Nie znaleziono") });
    const b = await readBody(req, 64 * 1024), meta = metaOf(req);
    if (path === "/api/mail/retry") {
      if (!store.retryMail(b.id)) return json(req, res, 400, { ok: false, error: t("Tej wiadomości nie można ponowić (wysłana albo bez zapisanej treści).") });
      store.auditEvent({ entityId: String(b.id), opNo: `#${b.id}`, code: "MAIL_RETRIED", act: R.Lx(N_("Ponowienie wiadomości e-mail #{n}"), { n: b.id }), before: null, after: null, entity: "system", event: "settings", source: N_("Poczta") }, meta, user);
      const r = await drainMail();
      return json(req, res, 200, { ok: true, message: t("Wysłano: {a}, nieudane: {b}", { a: r.sent, b: r.failed }) });
    }
    if (path === "/api/mail/test") {
      const to = user.email || user.login;
      const msg = compose("test", to, { name: user.name, transport: mailInfo(mailCfg).transport, by: user.name });
      store.enqueueMail("test", to, user.id, msg.subject, { html: msg.html, text: msg.text }, null);
      store.auditEvent({ entityId: user.id, opNo: to, code: "MAIL_TEST", act: R.Lx(N_("Wiadomość testowa na adres {e}"), { e: to }), before: null, after: { transport: mailCfg.transport }, entity: "system", event: "settings", source: N_("Poczta") }, meta, user);
      const r = await drainMail();
      return json(req, res, 200, { ok: true, message: r.failed ? t("Wysyłka nieudana — szczegóły w dzienniku poczty.") : t("Wiadomość wysłana na adres {e}.", { e: to }) });
    }
    if (path === "/api/mail/drain") { const r = await drainMail(); return json(req, res, 200, { ok: true, message: t("Wysłano: {a}, nieudane: {b}", { a: r.sent, b: r.failed }) }); }
    return json(req, res, 404, { ok: false, error: t("Nie znaleziono") });
  }
  /* ---- kopie zapasowe ---- */
  if (path === "/api/backups") {
    if (!R.can(user, "data.backup")) return json(req, res, 403, { ok: false, error: t("Brak uprawnienia „{p}”", { p: "data.backup" }) });
    if (method === "POST") { const r = store.backup("manual"); return json(req, res, 200, { ok: true, name: r.name }); }
    return json(req, res, 200, { ok: true, backups: store.listBackups(), keepDays: cfg.backup.keepDays, dir: cfg.backupDir, last: store.lastBackup() });
  }
  if (path.startsWith("/api/backups/") && method === "GET") {
    if (!R.can(user, "data.backup")) return json(req, res, 403, { ok: false, error: t("Brak uprawnienia „{p}”", { p: "data.backup" }) });
    const f = store.backupPath(decodeURIComponent(path.slice("/api/backups/".length)));
    if (!f) return json(req, res, 404, { ok: false, error: t("Nie znaleziono") });
    res.writeHead(200, Object.assign({ "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${f.split(/[\\/]/).pop()}"`, "Content-Length": statSync(f).size }, SEC_HEADERS));
    return void createReadStream(f).pipe(res);
  }
  return json(req, res, 404, { ok: false, error: t("Nie znaleziono") });
}

async function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/ResInvest_ERP.html")) {
      if (!existsSync(HTML_FILE)) return send(req, res, 500, "Brak pliku ResInvest_ERP.html — uruchom: npm run build", "text/plain; charset=utf-8");
      return send(req, res, 200, readFileSync(HTML_FILE), "text/html; charset=utf-8");
    }
    if (url.pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }
    send(req, res, 404, "Not found", "text/plain; charset=utf-8");
  } catch (e) {
    log("ERROR", `${req.method} ${url.pathname}: ${e.stack || e.message}`);
    if (!res.headersSent) json(req, res, e.message === "too large" ? 413 : 500, { ok: false, error: t("Błąd serwera: {m}", { m: e.message }) });
  }
}

// pusta baza + initialAdmin w konfiguracji → konto startowe administratora (jednorazowo, przed przyjęciem żądań)
if (!store.hasAccounts() && cfg.initialAdmin && cfg.initialAdmin.email) {
  const b = store.bootstrap(cfg.initialAdmin);
  if (!b.ok) log("ERROR", "Konto startowe administratora nie zostało utworzone: " + b.error);
}
const server = tls ? createHttps({ cert: readFileSync(cfg.tls.cert), key: readFileSync(cfg.tls.key) }, handler) : createHttp(handler);
server.requestTimeout = 120000;
server.listen(cfg.port, cfg.host, () => {
  const proto = tls ? "https" : "http";
  const ips = Object.values(networkInterfaces()).flat().filter(n => n && n.family === "IPv4" && !n.internal).map(n => n.address);
  log("INFO", `ResInvest ERP Serwer ${VERSION} — ${proto}://localhost:${cfg.port}` + (cfg.host === "0.0.0.0" && ips.length ? ` · w sieci: ${ips.map(ip => `${proto}://${ip}:${cfg.port}`).join(", ")}` : ""));
  log("INFO", `Dane: ${cfg.dataDir} · kopie: ${cfg.backupDir} · spójność: ${store.integrity.ok ? "OK" : store.integrity.notes.join("; ")}`);
  const mi = mailInfo(mailCfg);
  log("INFO", `Poczta: ${mi.transport}${mi.smtp ? ` ${mi.smtp.host}:${mi.smtp.port} (${mi.smtp.secure})` : ""}${mi.configured ? "" : ` (NIEPEŁNA KONFIGURACJA: ${mi.problem} — wysyłka nie zadziała)`} · nadawca: ${mi.from} · linki: ${appUrl()}${env.APP_URL ? "" : " (ustaw APP_URL)"}${mi.outDir ? " · wiadomości zapisywane w: " + mi.outDir : ""}${envFiles.length ? " · środowisko: " + envFiles.join(", ") : ""}`);
  if (!store.hasAccounts()) log("INFO", "Pierwsze uruchomienie — otwórz adres serwera w przeglądarce i utwórz konto administratora.");
  // Windows: okno aplikacji Edge/Chrome z polityką autoodtwarzania (intro z dźwiękiem od pierwszej klatki), gdy jest skrypt instalatora
  const launcher = join(ROOT, "ResInvestERP-Otworz.cmd");
  if (arg("--open")) { const u = `${proto}://localhost:${cfg.port}/`; const cmd = process.platform === "win32" ? (existsSync(launcher) ? ["cmd", ["/c", launcher, u]] : ["cmd", ["/c", "start", "", u]]) : process.platform === "darwin" ? ["open", [u]] : ["xdg-open", [u]]; try { spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" }).unref(); } catch (e) {} }
  try { store.autoBackup(true); } catch (e) { log("ERROR", "Kopia przy starcie: " + e.message); }
});
const timers = [
  setInterval(() => { try { store.autoBackup(false); store.purgeSessions(); } catch (e) { log("ERROR", "Kopia automatyczna: " + e.message); } }, 10 * 60000),
  setInterval(() => { for (const c of clients) { try { c.write(": ping\n\n"); } catch (e) { clients.delete(c); } } }, 25000),
  // kolejka poczty: ponowienia według terminów (1 min, 5 min, 15 min, 1 h, 6 h)
  setInterval(() => { drainMail().catch(e => log("ERROR", "Kolejka poczty: " + e.message)); }, 5000)
];
function shutdown(sig) {
  log("INFO", `Zatrzymywanie (${sig})…`);
  timers.forEach(clearInterval);
  for (const c of clients) { try { c.end(); } catch (e) {} }
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => { store.close(); process.exit(0); }, 3000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
