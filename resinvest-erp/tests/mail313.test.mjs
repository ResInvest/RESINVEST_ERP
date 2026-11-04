/* Testy poczty 3.13:  node --test tests/mail313.test.mjs
   * konfiguracja z server.env: pusty SMTP_HOST ≠ cudzy serwer, hasło aplikacji Gmail ze spacjami, nadawca = skrzynka (M365/Gmail),
   * wskazówki dla administratora (kody Microsoft 365, Gmail, błędy sieci),
   * serwer: zapis konfiguracji z programu (Poczta → Konfiguracja poczty) bez restartu, hasło tylko do zapisu,
     test wysyłki z wynikiem od razu, zaproszenie z linkiem dla administratora, gdy e-mail nie wyszedł. Lokalny przekaźnik SMTP — bez wysyłki na zewnątrz. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { mailConfig, mailInfo, mailHint } from "../server/mail.mjs";
import { parseEnv } from "../server/core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "riw-mail313-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

test("mailConfig: pusty SMTP_HOST bez klucza Resend = brak konfiguracji (nie smtp.resend.com)", () => {
  const c = mailConfig({ EMAIL_TRANSPORT: "smtp", SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "" }, TMP);
  assert.equal(c.smtp.host, "");
  assert.match(mailInfo(c).problem, /SMTP_HOST/);
  assert.match(mailInfo(c).hint, /Konfiguracja poczty/);
  assert.equal(mailConfig({ EMAIL_TRANSPORT: "smtp", RESEND_API_KEY: "re_x" }, TMP).smtp.host, "smtp.resend.com");
});

test("mailConfig: hasło aplikacji Gmail ze spacjami, nadawca = zalogowana skrzynka (Gmail / Microsoft 365)", () => {
  const g = mailConfig({ EMAIL_TRANSPORT: "smtp", SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "465", SMTP_USER: "jan@gmail.com", SMTP_PASS: "abcd efgh ijkl mnop", EMAIL_FROM: "ResInvest ERP <magazyn@resinvest.group>" }, TMP);
  assert.equal(g.smtp.pass, "abcdefghijklmnop");
  assert.equal(g.from, "ResInvest ERP <jan@gmail.com>");
  assert.match(g.fromNote, /jan@gmail\.com/);
  const m = mailConfig({ EMAIL_TRANSPORT: "smtp", SMTP_HOST: "smtp.office365.com", SMTP_PORT: "587", SMTP_USER: "magazyn@resinvest.group", SMTP_PASS: "Tajne 1 2", EMAIL_FROM: "ResInvest ERP <magazyn@resinvest.group>" }, TMP);
  assert.equal(m.smtp.pass, "Tajne 1 2", "zwykłe hasło ze spacją bez zmian");
  assert.equal(m.fromNote, "");
  const own = mailConfig({ EMAIL_TRANSPORT: "smtp", SMTP_HOST: "serwer.home.pl", SMTP_USER: "erp@firma.pl", SMTP_PASS: "x", EMAIL_FROM: "ERP <biuro@firma.pl>" }, TMP);
  assert.equal(own.from, "ERP <biuro@firma.pl>", "własny serwer: nadawca bez zmian");
});

test("wskazówki dla administratora: Microsoft 365, Gmail, sieć, certyfikat", () => {
  assert.match(mailHint("SMTP AUTH (logowanie): 535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Tenant."), /Uwierzytelniony SMTP/);
  assert.match(mailHint("SMTP AUTH (logowanie): 535-5.7.8 Username and Password not accepted. BadCredentials"), /hasło aplikacji/);
  assert.match(mailHint("SMTP DATA: 554 5.2.252 SendAsDenied; 5.7.60"), /własnym imieniu/);
  assert.match(mailHint("connect ECONNREFUSED 127.0.0.1:587"), /port/);
  assert.match(mailHint("getaddrinfo ENOTFOUND smtp.zla-nazwa.pl"), /Nie znaleziono serwera/);
  assert.match(mailHint("self-signed certificate in certificate chain"), /antywirus/);
  assert.equal(mailHint("coś zupełnie innego"), "");
});

/* ---------------- serwer ---------------- */
const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
/** Przekaźnik SMTP bez szyfrowania i logowania (jak przekaźnik w sieci firmy) — zapisuje odebrane wiadomości. */
function relay() {
  const got = [];
  const srv = createServer(sock => {
    let buf = "", data = false, cur = { rcpt: [], body: "" };
    const say = l => sock.write(l + "\r\n");
    sock.on("data", ch => {
      buf += ch.toString("utf8"); let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) { if (line === ".") { data = false; got.push(cur); cur = { rcpt: [], body: "" }; say("250 OK"); } else cur.body += line + "\n"; continue; }
        const up = line.toUpperCase();
        if (up.startsWith("EHLO")) say("250-relay.test\r\n250 8BITMIME");
        else if (up.startsWith("MAIL FROM:")) { cur.from = line.slice(10); say("250 OK"); }
        else if (up.startsWith("RCPT TO:")) { cur.rcpt.push(line.slice(8)); say("250 OK"); }
        else if (up === "DATA") { data = true; say("354 go"); }
        else if (up === "QUIT") { say("221 bye"); sock.end(); }
        else say("502 no");
      }
    });
    sock.on("error", () => {});
    say("220 relay.test ESMTP");
  });
  return new Promise(res => srv.listen(0, "127.0.0.1", () => res({ port: srv.address().port, got, close: () => new Promise(r => srv.close(r)) })));
}

async function withServer(dataDir, fn) {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const cfgFile = join(TMP, "server.config.json");
  writeFileSync(cfgFile, JSON.stringify(Object.assign({}, JSON.parse(readFileSync(join(ROOT, "config", "server.config.json"), "utf8")), { initialAdmin: { email: "" } })));
  const env = Object.assign({}, process.env, { RIW_TODAY: "2026-11-04", RIW_HOST: "127.0.0.1", RIW_CONFIG: cfgFile, COMPANY_DOMAINS: "*" });
  for (const k of Object.keys(env)) if (/^(SMTP_|EMAIL_|RESEND_|AGENTMAIL_|APP_URL)/.test(k)) delete env[k];
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(ROOT, "server", "riw-server.mjs"), "--port", String(port), "--data", dataDir], { env, stdio: "ignore" });
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) { try { up = (await fetch(base + "/api/health")).ok; } catch (e) {} if (!up) await new Promise(r => setTimeout(r, 100)); }
    assert.ok(up, "serwer wystartował");
    let cookie = "";
    const call = async (method, path, body) => {
      const r = await fetch(base + path, { method, headers: Object.assign({ "Content-Type": "application/json", "X-RIW": "1" }, cookie ? { Cookie: cookie } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
      const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
      return { status: r.status, json: await r.json().catch(() => null) };
    };
    await fn({ get: p => call("GET", p), post: (p, b) => call("POST", p, b) });
  } finally { await new Promise(res => { if (proc.exitCode !== null) return res(); proc.once("exit", res); proc.kill("SIGTERM"); }); }
}

test("serwer: konfiguracja poczty z programu, test wysyłki, link zaproszenia dla administratora", async () => {
  const data = join(TMP, "data"), smtp = await relay();
  // jak po instalacji wariantu „Bez ograniczeń”: EMAIL_TRANSPORT=smtp, puste SMTP_HOST i SMTP_PASS
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, "server.env"), readFileSync(join(ROOT, ".env.example"), "utf8").replace(/^EMAIL_TRANSPORT=.*$/m, "EMAIL_TRANSPORT=smtp").replace(/^SMTP_HOST=.*$/m, "SMTP_HOST="));
  try {
    await withServer(data, async c => {
      assert.equal((await c.get("/api/health")).json.mailReady, false, "bez konfiguracji poczty");
      assert.equal((await c.post("/api/setup", { name: "Anna Admin", login: "anna@firma.pl", password: "Biomasa2026", sample: false })).status, 200);
      assert.equal((await c.post("/api/auth/login", { login: "anna@firma.pl", password: "Biomasa2026" })).status, 200);

      // 1) poczta nieskonfigurowana: zaproszenie zakłada konto, administrator dostaje przyczynę, wskazówkę i link
      const inv = await c.post("/api/users/invite", { rec: { firstName: "Jan", lastName: "Nowak", email: "jan@gmail.com", login: "jan@gmail.com", role: "magazynier", whId: "", warehouseIds: [] } });
      assert.equal(inv.status, 200, JSON.stringify(inv.json));
      let mail = inv.json.mail;
      if (!mail) {                                          // magazyn domyślny wymagany — weź pierwszy z danych
        const st = await c.get("/api/state");
        const whId = st.json.state.warehouses[0].id;
        const again = await c.post("/api/users/invite", { rec: { firstName: "Jan", lastName: "Nowak", email: "jan@gmail.com", login: "jan@gmail.com", role: "magazynier", whId, warehouseIds: [whId] } });
        assert.ok(again.json.res.ok, JSON.stringify(again.json.res));
        mail = again.json.mail;
      }
      assert.equal(mail.ok, false);
      assert.match(mail.detail, /SMTP_HOST/);
      assert.match(mail.hint, /Konfiguracja poczty/);
      assert.match(mail.link, /#\/invite\/accept\?token=/, "link dla administratora");
      const tk = new URL(mail.link.replace("#/", "")).searchParams.get("token");
      const peek = await c.post("/api/auth/token", { kind: "invite", token: tk });
      assert.equal(peek.json.email, "jan@gmail.com", "link zaproszenia działa");

      // 2) zapis konfiguracji z programu: hasło z „$”, „#” i spacją, przeładowanie bez restartu
      const bad = await c.post("/api/mail/config", { transport: "smtp", host: "zła nazwa", port: 25, secure: "none" });
      assert.equal(bad.status, 400);
      const save = await c.post("/api/mail/config", { transport: "smtp", host: "127.0.0.1", port: smtp.port, secure: "none", user: "", pass: "Pa$$ #1 x", from: "ResInvest ERP <erp@firma.pl>", appUrl: "http://erp.firma.local:8080" });
      assert.equal(save.status, 200, JSON.stringify(save.json));
      assert.equal(save.json.mail.configured, true);
      assert.equal(save.json.appUrl, "http://erp.firma.local:8080");
      const envText = readFileSync(join(data, "server.env"), "utf8");
      assert.equal(parseEnv(envText).SMTP_PASS, "Pa$$ #1 x", "hasło zapisane dosłownie");
      assert.equal(parseEnv(envText).SMTP_HOST, "127.0.0.1");
      const ob = await c.get("/api/mail/outbox");
      assert.equal(ob.json.settings.hasPass, true);
      assert.equal(JSON.stringify(ob.json).includes("Pa$$"), false, "hasło nie wraca do przeglądarki");
      assert.equal((await c.get("/api/health")).json.mailReady, true);

      // 3) test wysyłki — wynik od razu
      const ts = await c.post("/api/mail/test", { to: "kontrola@firma.pl" });
      assert.equal(ts.json.ok, true, JSON.stringify(ts.json));
      assert.equal(smtp.got.length, 1);
      assert.match(smtp.got[0].rcpt[0], /kontrola@firma\.pl/);

      // 4) ponowne zaproszenie — wychodzi e-mailem, link w treści z APP_URL
      const users = (await c.get("/api/state")).json.state.users, jan = users.find(u => u.login === "jan@gmail.com");
      const rs = await c.post("/api/users/resend", { userId: jan.id });
      assert.equal(rs.json.mail.ok, true, JSON.stringify(rs.json.mail));
      assert.equal(rs.json.mail.link, undefined, "wysłane e-mailem — bez linku w odpowiedzi");
      // treść w base64 (MIME): pierwsza część text/plain
      const plain = Buffer.from(smtp.got[1].body.split(/\n\n/)[2].split("\n--")[0].replace(/\s+/g, ""), "base64").toString("utf8");
      assert.match(plain, /http:\/\/erp\.firma\.local:8080\/#\/invite\/accept\?token=/);

      // 5) serwer poczty niedostępny — administrator widzi przyczynę i wskazówkę
      await c.post("/api/mail/config", { transport: "smtp", host: "127.0.0.1", port: await freePort(), secure: "none", user: "", from: "", appUrl: "" });
      const fail = await c.post("/api/mail/test", {});
      assert.equal(fail.json.ok, false);
      assert.match(fail.json.detail, /ECONNREFUSED/);
      assert.match(fail.json.hint, /port/);

    });
    // konfiguracja zapisana w server.env działa po restarcie
    await withServer(data, async c => {
      assert.equal((await c.post("/api/auth/login", { login: "anna@firma.pl", password: "Biomasa2026" })).status, 200);
      const ob = await c.get("/api/mail/outbox");
      assert.equal(ob.json.settings.host, "127.0.0.1");
      assert.equal(ob.json.settings.hasPass, true, "hasło pozostało (puste pole = bez zmian)");
    });
  } finally { await smtp.close(); }
});
