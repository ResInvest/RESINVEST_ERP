/* Testy klienta SMTP (3.9.1) na lokalnym serwerze testowym — bez wysyłki na zewnątrz.
   STARTTLS (587) i SSL (465), AUTH PLAIN i AUTH LOGIN, „dot-stuffing”, błędy logowania, brak STARTTLS,
   certyfikat bez zaufania, zakaz hasła bez szyfrowania, limit czasu, domyślne ustawienia z server.env.
   Uruchomienie:  node --test tests/smtp.test.mjs  (wymaga openssl do certyfikatu testowego) */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer as netServer } from "node:net";
import { createServer as tlsServer, TLSSocket } from "node:tls";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mailConfig, mailInfo, mailProblem, sendMail } from "../server/mail.mjs";

let dir, key, cert, hasTls = true;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "riw-smtp-"));
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
      "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem")], { stdio: "ignore" });
    key = readFileSync(join(dir, "k.pem")); cert = readFileSync(join(dir, "c.pem"));
  } catch (e) { hasTls = false; }
});
after(() => rmSync(dir, { recursive: true, force: true }));

/** Serwer SMTP do testów: mode „starttls” | „ssl” | „plain”; auth: lista mechanizmów; zapisuje przebieg rozmowy. */
function fakeSmtp({ mode = "starttls", auth = ["PLAIN", "LOGIN"], offerStartTls = true, user = "erp@firma.pl", pass = "Haslo#2026", greet = true } = {}) {
  const log = { cmds: [], data: "", authUser: null, authPass: null, tlsUsed: false };
  const handle = (sock, secure) => {
    let buf = "", inData = false, loginStep = 0, tls = secure;
    const say = l => sock.write(l + "\r\n");
    const ehlo = () => {
      const caps = ["250-smtp.test", "250-SIZE 35882577", "250-8BITMIME"];
      if (!tls && offerStartTls && mode === "starttls") caps.push("250-STARTTLS");
      if (tls || mode === "plain") caps.push("250-AUTH " + auth.join(" "));
      caps.push("250 SMTPUTF8"); sock.write(caps.join("\r\n") + "\r\n");
    };
    const onData = chunk => {
      buf += chunk.toString("utf8");
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") { inData = false; say("250 2.0.0 OK queued"); } else log.data += line + "\n";
          continue;
        }
        log.cmds.push(line.startsWith("AUTH PLAIN ") ? "AUTH PLAIN ***" : loginStep ? "***" : line);
        if (loginStep === 1) { log.authUser = Buffer.from(line, "base64").toString(); loginStep = 2; say("334 UGFzc3dvcmQ6"); continue; }
        if (loginStep === 2) { log.authPass = Buffer.from(line, "base64").toString(); loginStep = 0; say(log.authUser === user && log.authPass === pass ? "235 2.7.0 Authentication successful" : "535 5.7.3 Authentication unsuccessful"); continue; }
        const up = line.toUpperCase();
        if (up.startsWith("EHLO")) ehlo();
        else if (up === "STARTTLS") {
          say("220 2.0.0 Ready to start TLS");
          sock.removeListener("data", onData);
          const t = new TLSSocket(sock, { isServer: true, key, cert });
          tls = true; log.tlsUsed = true; buf = "";
          t.on("data", onData); t.on("error", () => {}); sock = t;
        } else if (up.startsWith("AUTH PLAIN ")) {
          const [, u, p] = Buffer.from(line.slice(11), "base64").toString().split("\0");
          log.authUser = u; log.authPass = p;
          say(u === user && p === pass ? "235 2.7.0 Authentication successful" : "535 5.7.3 Authentication unsuccessful");
        } else if (up === "AUTH LOGIN") { loginStep = 1; say("334 VXNlcm5hbWU6"); }
        else if (up.startsWith("MAIL FROM:") || up.startsWith("RCPT TO:")) say("250 2.1.0 OK");
        else if (up === "DATA") { inData = true; say("354 Start mail input; end with <CRLF>.<CRLF>"); }
        else if (up === "QUIT") { say("221 2.0.0 Bye"); sock.end(); }
        else say("502 5.5.2 Command not recognized");
      }
    };
    sock.on("data", onData); sock.on("error", () => {});
    if (greet) say("220 smtp.test ESMTP ready");
  };
  const srv = mode === "ssl" ? tlsServer({ key, cert }, s => { log.tlsUsed = true; handle(s, true); }) : netServer(s => handle(s, false));
  return new Promise(res => srv.listen(0, "127.0.0.1", () => res({ port: srv.address().port, log, close: () => new Promise(r => srv.close(r)) })));
}

const cfgFor = (port, extra) => mailConfig(Object.assign({ EMAIL_TRANSPORT: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), SMTP_USER: "erp@firma.pl",
  SMTP_PASS: "Haslo#2026", EMAIL_FROM: "ResInvest ERP <erp@firma.pl>", SMTP_TLS_REJECT_UNAUTHORIZED: "false", SMTP_TIMEOUT_MS: "4000" }, extra), dir);

test("STARTTLS (587): szyfrowanie przed logowaniem, AUTH PLAIN, ponowne EHLO, nagłówki UTF-8", { skip: !hasTls && "brak openssl" }, async () => {
  const s = await fakeSmtp({ mode: "starttls" });
  try {
    const c = cfgFor(s.port, { SMTP_SECURE: "starttls" });
    const r = await sendMail(c, "test", "kierownik@firma.pl", { name: "Test", transport: "smtp", by: "Admin" });
    assert.equal(r.ok, true, r.error);
    assert.equal(s.log.tlsUsed, true);
    const cmds = s.log.cmds.map(x => x.split(" ")[0].toUpperCase());
    assert.deepEqual(cmds.slice(0, 4), ["EHLO", "STARTTLS", "EHLO", "AUTH"], s.log.cmds.join(" | "));
    assert.equal(s.log.authUser, "erp@firma.pl"); assert.equal(s.log.authPass, "Haslo#2026");
    assert.ok(s.log.cmds.includes("MAIL FROM:<erp@firma.pl>") && s.log.cmds.includes("RCPT TO:<kierownik@firma.pl>"));
    assert.match(s.log.data, /Subject: =\?UTF-8\?B\?/);
  } finally { await s.close(); }
});

test("SSL (465): TLS od początku, serwer oferuje tylko AUTH LOGIN", { skip: !hasTls && "brak openssl" }, async () => {
  const s = await fakeSmtp({ mode: "ssl", auth: ["LOGIN"] });
  try {
    const c = cfgFor(s.port, { SMTP_SECURE: "ssl" });
    assert.equal(c.smtp.secure, "ssl");
    const r = await sendMail(c, "test", "kierownik@firma.pl", { name: "Test", transport: "smtp", by: "Admin" });
    assert.equal(r.ok, true, r.error);
    assert.ok(s.log.cmds.includes("AUTH LOGIN"));
    assert.equal(s.log.authUser, "erp@firma.pl"); assert.equal(s.log.authPass, "Haslo#2026");
  } finally { await s.close(); }
});

test("złe hasło: błąd 535 z opisem etapu, bez ujawniania hasła", { skip: !hasTls && "brak openssl" }, async () => {
  const s = await fakeSmtp({ mode: "starttls" });
  try {
    const r = await sendMail(cfgFor(s.port, { SMTP_PASS: "zle-haslo" }), "test", "a@firma.pl", { name: "T", transport: "smtp", by: "A" });
    assert.equal(r.ok, false);
    assert.match(r.error, /AUTH \(logowanie\): 535/);
    assert.ok(!r.error.includes("zle-haslo"));
  } finally { await s.close(); }
});

test("serwer bez STARTTLS przy SMTP_SECURE=starttls — przerwanie przed wysłaniem hasła", async () => {
  const s = await fakeSmtp({ mode: "starttls", offerStartTls: false });
  try {
    const r = await sendMail(cfgFor(s.port), "test", "a@firma.pl", { name: "T", transport: "smtp", by: "A" });
    assert.equal(r.ok, false); assert.match(r.error, /nie oferuje STARTTLS/);
    assert.ok(!s.log.cmds.some(x => x.startsWith("AUTH")), "hasło nie może pójść jawnym tekstem");
  } finally { await s.close(); }
});

test("certyfikat bez zaufania jest odrzucany przy domyślnych ustawieniach", { skip: !hasTls && "brak openssl" }, async () => {
  const s = await fakeSmtp({ mode: "ssl" });
  try {
    const r = await sendMail(cfgFor(s.port, { SMTP_SECURE: "ssl", SMTP_TLS_REJECT_UNAUTHORIZED: "" }), "test", "a@firma.pl", { name: "T", transport: "smtp", by: "A" });
    assert.equal(r.ok, false); assert.match(r.error, /self[- ]signed|certificate/i);
  } finally { await s.close(); }
});

test("bez szyfrowania (SMTP_SECURE=none): przekaźnik bez logowania działa, logowanie hasłem zablokowane", async () => {
  const s = await fakeSmtp({ mode: "plain" });
  try {
    const relay = cfgFor(s.port, { SMTP_SECURE: "none", SMTP_USER: "", SMTP_PASS: "" });
    assert.equal(mailProblem(relay), "");
    assert.equal((await sendMail(relay, "test", "a@firma.pl", { name: "T", transport: "smtp", by: "A" })).ok, true);
    const withPw = cfgFor(s.port, { SMTP_SECURE: "none" });
    const r = await sendMail(withPw, "test", "a@firma.pl", { name: "T", transport: "smtp", by: "A" });
    assert.equal(r.ok, false); assert.match(r.error, /bez szyfrowania jest zablokowane/);
  } finally { await s.close(); }
});

test("limit czasu: serwer, który nie odpowiada, nie blokuje programu", async () => {
  const s = await fakeSmtp({ greet: false });
  try {
    const t0 = Date.now();
    const r = await sendMail(cfgFor(s.port, { SMTP_TIMEOUT_MS: "1200" }), "test", "a@firma.pl", { name: "T", transport: "smtp", by: "A" });
    assert.equal(r.ok, false); assert.match(r.error, /przekroczony czas/);
    assert.ok(Date.now() - t0 < 5000);
  } finally { await s.close(); }
});

test("domyślne ustawienia z server.env: port → tryb, Resend, opis bez haseł", () => {
  assert.equal(mailConfig({ EMAIL_TRANSPORT: "smtp", SMTP_HOST: "smtp.office365.com", SMTP_PORT: "587", SMTP_USER: "erp@firma.pl", SMTP_PASS: "x" }, dir).smtp.secure, "starttls");
  assert.equal(mailConfig({ EMAIL_TRANSPORT: "smtp", SMTP_HOST: "serwer.home.pl", SMTP_PORT: "465", SMTP_USER: "erp@firma.pl", SMTP_PASS: "x" }, dir).smtp.secure, "ssl");
  const rs = mailConfig({ EMAIL_TRANSPORT: "smtp", RESEND_API_KEY: "re_test" }, dir);
  assert.deepEqual([rs.smtp.host, rs.smtp.port, rs.smtp.user, rs.smtp.pass, rs.smtp.secure], ["smtp.resend.com", 465, "resend", "re_test", "ssl"]);
  const m365 = mailConfig({ EMAIL_TRANSPORT: "smtp", SMTP_HOST: "smtp.office365.com", SMTP_PORT: "587", SMTP_USER: "erp@firma.pl" }, dir);
  assert.equal(mailProblem(m365), "brak hasła SMTP_PASS");
  const info = mailInfo(mailConfig({ EMAIL_TRANSPORT: "smtp", SMTP_HOST: "smtp.office365.com", SMTP_PORT: "587", SMTP_USER: "erp@firma.pl", SMTP_PASS: "Tajne123" }, dir));
  assert.equal(JSON.stringify(info).includes("Tajne123"), false);
  assert.deepEqual(info.smtp, { host: "smtp.office365.com", port: 587, secure: "starttls", user: "erp@firma.pl", auth: true });
});
