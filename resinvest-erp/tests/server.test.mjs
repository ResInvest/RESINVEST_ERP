/* Test integracyjny ResInvest ERP Serwer (HTTP + SQLite) — uruchamia serwer na wolnym porcie
   z tymczasowym katalogiem danych.  Uruchomienie:  node --test tests/server.test.mjs  (Node ≥ 22.13) */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
globalThis.RIW_CONFIG = {};
require("../app/src/i18n.js");
const R = require("../app/src/engine.js");
require("../app/src/seed.js");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "server", "riw-server.mjs");
const DATA = mkdtempSync(join(tmpdir(), "riw-srv-"));
// konfiguracja bez konta startowego (initialAdmin) — testy przechodzą przez ekran pierwszej konfiguracji
const CFG = join(mkdtempSync(join(tmpdir(), "riw-srv-cfg-")), "server.config.json");
writeFileSync(CFG, JSON.stringify(Object.assign({}, JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "config", "server.config.json"), "utf8")), { initialAdmin: { email: "" } })));
let proc, BASE;

const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const startServer = async (extra = []) => {
  const port = await freePort();
  BASE = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", SERVER, "--port", String(port), "--data", DATA, ...extra], { env: Object.assign({}, process.env, { RIW_TODAY: "2026-09-23", RIW_HOST: "127.0.0.1", RIW_CONFIG: CFG }), stdio: "pipe" });
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE + "/api/health"); if (r.ok) return; } catch (e) {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error("Serwer nie wystartował");
};
const stopServer = () => new Promise(res => { if (!proc || proc.exitCode !== null) return res(); proc.once("exit", res); proc.kill("SIGTERM"); });

/** Klient z ciasteczkiem sesji. */
function client() {
  let cookie = "";
  const call = async (method, path, body, headers = {}) => {
    const h = Object.assign({ "Content-Type": "application/json", "X-RIW": "1", "Accept-Language": "pl" }, cookie ? { Cookie: cookie } : {}, headers);
    const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0].endsWith("=") ? "" : sc.split(";")[0];
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
    return { status: r.status, json, headers: r.headers };
  };
  return { get: (p, h) => call("GET", p, undefined, h), post: (p, b, h) => call("POST", p, b, h), get cookie() { return cookie; } };
}

before(async () => { await startServer(); });
after(async () => { await stopServer(); rmSync(DATA, { recursive: true, force: true }); });

test("Serwer: zdrowie, konfiguracja pierwszego uruchomienia, nagłówki bezpieczeństwa", async () => {
  const h = await client().get("/api/health");
  assert.equal(h.json.app, "resinvest-erp");
  assert.equal(h.json.setup, true);
  assert.match(h.headers.get("content-security-policy") || "", /default-src/);
  assert.equal(h.headers.get("x-content-type-options"), "nosniff");
  const html = await fetch(BASE + "/");
  assert.equal(html.status, 200);
  assert.match(await html.text(), /ResInvest ERP/);
});

test("Serwer: ochrona CSRF — bez nagłówka aplikacji i z obcego pochodzenia żądanie odrzucone", async () => {
  const c = client();
  assert.equal((await c.post("/api/setup", {}, { "X-RIW": "" })).status, 403);
  assert.equal((await c.post("/api/setup", {}, { Origin: "http://evil.example" })).status, 403);
});

test("Serwer: setup → logowanie → komenda → stan; sesja HttpOnly; drugi setup zablokowany", async () => {
  const c = client();
  assert.equal((await c.post("/api/setup", { name: "Anna Admin", login: "magazyn@resinvest.group", password: "krotkie", sample: true })).status, 400);
  const s = await c.post("/api/setup", { name: "Anna Admin", login: "magazyn@resinvest.group", password: "Biomasa2026", sample: true });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal((await c.post("/api/setup", { name: "X Y Z", login: "xyz@resinvest.group", password: "Biomasa2026" })).status, 409);
  assert.equal((await c.get("/api/state")).status, 401);
  const l = await c.post("/api/auth/login", { login: "magazyn@resinvest.group", password: "Biomasa2026" });
  assert.equal(l.status, 200, JSON.stringify(l.json));
  assert.match(l.headers.get("set-cookie"), /HttpOnly/i);
  assert.match(l.headers.get("set-cookie"), /SameSite=Strict/i);
  const st = await c.get("/api/state");
  assert.equal(st.status, 200);
  const rev0 = st.json.rev, n0 = st.json.state.operations.length;
  const d = R.Seed.draftOf("2026-09-23", { type: "SPRZEDAZ", sale: { productId: "pr_zr_lesna", qty: "100", unit: "MP", buyerId: "pa_ec_zab", price: "90" }, transport: { mode: "none", place: "RiC Zabrze" } });
  const r = await c.post("/api/cmd", { cmd: "op.commit", args: { draft: d } });
  assert.equal(r.json.res.ok, true, r.json.res.error);
  assert.equal(r.json.state.operations.length, n0 + 1);
  assert.ok(r.json.rev > rev0);
  assert.equal(r.json.state.audit.at(-1).userId, r.json.state.users.find(u => u.login === "magazyn@resinvest.group").id, "autor z sesji serwera");
  const dup = await c.post("/api/cmd", { cmd: "op.commit", args: { draft: d } });
  assert.equal(((await c.get("/api/state")).json.state.operations.length), n0 + 1, "idempotencja: ponowne wysłanie nie tworzy drugiej operacji");
  assert.equal(dup.json.res.duplicate, true);
  const d2 = R.Seed.draftOf("2026-09-23", { type: "SPRZEDAZ", sale: { productId: "pr_zr_lesna", qty: "10", unit: "MP", buyerId: "pa_ec_zab", price: "90" }, transport: { mode: "none", place: "RiC Zabrze" } });
  const forged = await c.post("/api/cmd", { cmd: "op.commit", args: { draft: d2, user: { id: "u_view" }, userId: "u_view" } });
  assert.equal(forged.json.state.operations.at(-1).userId, forged.json.state.users.find(u => u.login === "magazyn@resinvest.group").id, "użytkownik podany w argumentach jest ignorowany");
});

test("Serwer: język odpowiedzi wg Accept-Language / profilu", async () => {
  const c = client();
  await c.post("/api/auth/login", { login: "magazyn@resinvest.group", password: "Biomasa2026" });
  const r = await c.post("/api/cmd", { cmd: "master.save", args: { kind: "partners", rec: { name: "Firma Z", role: "buyer", nip: "1234567890" } } }, { "Accept-Language": "en" });
  assert.equal(r.json.res.ok, false);
  assert.match(JSON.stringify(r.json.res), /Invalid NIP|NIP tax ID/);
});

test("Serwer: użytkownik tworzony przez administratora — hasło tymczasowe wymusza zmianę", async () => {
  const a = client();
  await a.post("/api/auth/login", { login: "magazyn@resinvest.group", password: "Biomasa2026" });
  const cr = await a.post("/api/users", { rec: { firstName: "Jan", lastName: "Magazyn", email: "jan.mag@resinvest.group", role: "magazynier", whId: "wh_zab" }, password: "Tymczas2026" });
  assert.equal(cr.json.res.ok, true, JSON.stringify(cr.json.res));
  const j = client();
  const l = await j.post("/api/auth/login", { login: "jan.mag@resinvest.group", password: "Tymczas2026" });
  assert.equal(l.json.mustChange, true);
  assert.equal((await j.get("/api/state")).json.code, "MUST_CHANGE");
  assert.equal((await j.post("/api/auth/password", { old: "Tymczas2026", new: "Wlasne2026x" })).status, 200);
  assert.equal((await j.get("/api/state")).status, 200);
  assert.equal((await j.post("/api/users", { rec: { name: "Ktoś Inny", login: "ktos@resinvest.group", role: "admin", whId: "wh_zab" }, password: "Tymczas2026" })).status, 403, "magazynier nie zarządza kontami");
});

test("Serwer: blokada konta po 5 błędnych hasłach, odblokowanie przez administratora", async () => {
  const x = client();
  for (let i = 0; i < 5; i++) assert.equal((await x.post("/api/auth/login", { login: "jan.mag@resinvest.group", password: "zle-haslo-" + i })).status, 401);
  const locked = await x.post("/api/auth/login", { login: "jan.mag@resinvest.group", password: "Wlasne2026x" });
  assert.equal(locked.status, 401);
  assert.match(locked.json.error, /zablokowane/);
  const a = client();
  await a.post("/api/auth/login", { login: "magazyn@resinvest.group", password: "Biomasa2026" });
  const jan = (await a.get("/api/state")).json.state.users.find(u => u.login === "jan.mag@resinvest.group");
  const acc = (await a.get("/api/users/accounts")).json.accounts[jan.id];
  assert.ok(acc.lockedUntil, JSON.stringify(acc));
  assert.equal((await a.post("/api/users/unlock", { userId: jan.id })).status, 200);
  assert.equal((await x.post("/api/auth/login", { login: "jan.mag@resinvest.group", password: "Wlasne2026x" })).status, 200);
});

test("Serwer: rejestracja samodzielna (po włączeniu przez administratora) → aktywacja; obieg zatwierdzania włączony", async () => {
  const anon = client();
  const off = await anon.post("/api/auth/register", { rec: { name: "Ewa Nowicka", email: "ewa.nowicka@resinvest.group" }, password: "Rejestracja2026" });
  assert.equal(off.status, 400); assert.equal(off.json.code, "DISABLED", "domyślnie tylko zaproszenia");
  const a = client();
  await a.post("/api/auth/login", { login: "magazyn@resinvest.group", password: "Biomasa2026" });
  assert.equal((await a.post("/api/cmd", { cmd: "settings.save", args: { settings: { allowSelfRegistration: true, requireApproval: true } } })).json.res.ok, true);
  assert.equal((await anon.get("/api/health")).json.selfRegistration, true);
  assert.equal((await anon.post("/api/auth/register", { rec: { name: "Obcy Ktoś", email: "obcy@gmail.com" }, password: "Rejestracja2026" })).status, 400);
  assert.equal((await anon.post("/api/auth/register", { rec: { name: "Ewa Nowicka", email: "ewa.nowicka@resinvest.group" }, password: "Rejestracja2026" })).status, 200);
  const unv = await anon.post("/api/auth/login", { login: "ewa.nowicka@resinvest.group", password: "Rejestracja2026" });
  assert.equal(unv.json.code, "UNVERIFIED", "3.7: najpierw potwierdzenie adresu e-mail");
  const box = join(DATA, "mail-outbox"), eml = readdirSync(box).filter(f => f.includes("-confirm-")).map(f => readFileSync(join(box, f), "utf8")).find(x => /^To: ewa\.nowicka@resinvest\.group$/m.test(x));
  const txt = Buffer.from(/Content-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/.exec(eml)[1].replace(/\s+/g, ""), "base64").toString("utf8");
  assert.equal((await anon.post("/api/auth/confirm", { token: /token=([A-Za-z0-9_-]+)/.exec(txt)[1] })).status, 200);
  const pend = await anon.post("/api/auth/login", { login: "ewa.nowicka@resinvest.group", password: "Rejestracja2026" });
  assert.equal(pend.json.code, "INVITED");
  const ewa = (await a.get("/api/state")).json.state.users.find(u => u.login === "ewa.nowicka@resinvest.group");
  const act = await a.post("/api/cmd", { cmd: "user.save", args: { rec: Object.assign({}, ewa, { role: "magazynier", whId: "wh_zab", warehouseIds: ["wh_zab"], status: "ACTIVE" }) } });
  assert.equal(act.json.res.ok, true, act.json.res.error);
  const e = client();
  assert.equal((await e.post("/api/auth/login", { login: "ewa.nowicka@resinvest.group", password: "Rejestracja2026" })).status, 200);
  const d = R.Seed.draftOf("2026-09-23", { type: "SPRZEDAZ", sale: { productId: "pr_zr_lesna", qty: "5", unit: "MP", buyerId: "pa_ec_zab", price: "90" }, transport: { mode: "none", place: "RiC Zabrze" } });
  const direct = await e.post("/api/cmd", { cmd: "op.commit", args: { draft: d } });
  assert.equal(direct.status, 403); assert.equal(direct.json.res.code, "FORBIDDEN", "przy włączonym obiegu magazynier nie zatwierdza sam");
  const sub = await e.post("/api/cmd", { cmd: "op.submit", args: { draft: d } });
  assert.equal(sub.json.res.ok, true, sub.json.res.error);
  const id = sub.json.state.drafts.find(x => x.status === "PENDING").id;
  const ap = await a.post("/api/cmd", { cmd: "op.approve", args: { id } });
  assert.equal(ap.json.res.ok, true, ap.json.res.error);
  const op = ap.json.state.operations.at(-1);
  assert.equal(op.userName, "Ewa Nowicka"); assert.equal(op.approvedById, "u_admin");
  assert.equal((await a.post("/api/cmd", { cmd: "settings.save", args: { settings: { allowSelfRegistration: false, requireApproval: false } } })).json.res.ok, true);
});

test("Serwer: wylogowanie unieważnia sesję", async () => {
  const c = client();
  await c.post("/api/auth/login", { login: "magazyn@resinvest.group", password: "Biomasa2026" });
  const old = c.cookie;
  assert.equal((await c.post("/api/auth/logout", {})).status, 200);
  const r = await fetch(BASE + "/api/state", { headers: { Cookie: old } });
  assert.equal(r.status, 401);
});

test("Serwer: kopia zapasowa na żądanie i kontrola spójności dziennika", async () => {
  const a = client();
  await a.post("/api/auth/login", { login: "magazyn@resinvest.group", password: "Biomasa2026" });
  const b = await a.post("/api/backups", {});
  assert.equal(b.status, 200, JSON.stringify(b.json));
  const list = await a.get("/api/backups");
  assert.ok(list.json.backups.length >= 1);
  await stopServer();
  const chk = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", SERVER, "--data", DATA, "--check"], { encoding: "utf8", env: Object.assign({}, process.env, { RIW_TODAY: "2026-09-23" }) });
  assert.equal(chk.status, 0, chk.stdout + chk.stderr);
  assert.ok(readdirSync(join(DATA, "backups")).some(f => f.endsWith(".sqlite")));
  await startServer();
  const again = client();
  assert.equal((await again.post("/api/auth/login", { login: "magazyn@resinvest.group", password: "Biomasa2026" })).status, 200, "dane przetrwały restart");
});

test("Serwer: synchronizacja samymi zmianami (3.10) — zmiany od rewizji, izolacja magazynów, pełny stan gdy trzeba", async () => {
  const a = client();
  await a.post("/api/auth/login", { login: "magazyn@resinvest.group", password: "Biomasa2026" });
  const cr = await a.post("/api/users", { rec: { firstName: "Olga", lastName: "Delta", email: "olga.delta@resinvest.group", role: "magazynier", whId: "wh_zab" }, password: "Tymczas2026" });
  assert.equal(cr.json.res.ok, true, JSON.stringify(cr.json.res));
  const m = client();
  await m.post("/api/auth/login", { login: "olga.delta@resinvest.group", password: "Tymczas2026" });
  assert.equal((await m.post("/api/auth/password", { old: "Tymczas2026", new: "Wlasne2026x" })).status, 200);
  const full = async () => (await m.get("/api/state")).json;
  let view = (await full()).state;
  const rev0 = view.rev;
  const sale = (wh, qty, place) => R.Seed.draftOf("2026-09-23", { type: "SPRZEDAZ", whId: wh, sale: { productId: "pr_zr_lesna", qty, unit: "MP", buyerId: "pa_ec_zab", price: "90" }, transport: { mode: "none", place } });
  // zmiany innego użytkownika: jedna w magazynie użytkownika, jedna poza nim
  const r1 = await a.post("/api/cmd", { cmd: "op.commit", args: { draft: sale("wh_zab", "3", "RiC Zabrze") } });
  assert.equal(r1.json.res.ok, true, r1.json.res.error);
  const d = await m.get("/api/state?since=" + rev0);
  assert.ok(d.json.delta && !d.json.state, "odpowiedź z samymi zmianami");
  assert.ok(d.json.delta.colls.operations.up.some(([, o]) => o.id === r1.json.res.op.id));
  assert.ok(Buffer.byteLength(JSON.stringify(d.json)) < Buffer.byteLength(JSON.stringify(await full())) / 3, "zmiany wielokrotnie mniejsze niż pełny stan");
  view = R.applyDelta(view, d.json.delta);
  assert.deepEqual(view, (await full()).state, "stan po nałożeniu zmian = pełny widok serwera");
  // komenda użytkownika z posiadaną rewizją → w odpowiedzi tylko zmiany
  const r2 = await m.post("/api/cmd", { cmd: "draft.save", args: { draft: sale("wh_zab", "2", "RiC Zabrze") }, haveRev: view.rev });
  assert.equal(r2.json.res.ok, true, r2.json.res.error);
  assert.ok(r2.json.delta && !r2.json.state);
  view = R.applyDelta(view, r2.json.delta);
  assert.deepEqual(view, (await full()).state);
  // usunięcie wersji roboczej
  const r3 = await m.post("/api/cmd", { cmd: "draft.delete", args: { id: r2.json.res.id }, haveRev: view.rev });
  assert.deepEqual(r3.json.delta.colls.drafts.del, [r2.json.res.id]);
  view = R.applyDelta(view, r3.json.delta);
  assert.deepEqual(view, (await full()).state);
  // nieaktualna rewizja klienta: zmiany nie pasują → null (klient pobiera pełny stan)
  assert.equal(R.applyDelta(view, r3.json.delta), null, "widok w innej rewizji niż `since`");
  // zmiana kont / uprawnień → pełny stan
  const revU = view.rev;
  const u = (await a.get("/api/state")).json.state.users.find(x => x.login === "olga.delta@resinvest.group");
  assert.equal((await a.post("/api/cmd", { cmd: "user.save", args: { rec: Object.assign({}, u, { phone: "600 100 200" }) } })).json.res.ok, true);
  const afterUser = await m.get("/api/state?since=" + revU);
  assert.ok(afterUser.json.state && !afterUser.json.delta, "po zmianie kont — pełny widok");
  // rewizja sprzed startu serwera / spoza historii → pełny stan; rewizja nieprawidłowa → pełny stan
  assert.ok((await m.get("/api/state?since=0")).json.state);
  assert.ok((await m.get("/api/state?since=abc")).json.state);
  assert.ok((await m.get("/api/state?since=999999999")).json.state);
});
