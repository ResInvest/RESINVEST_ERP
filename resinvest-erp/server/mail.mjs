/* =========================================================================
   ResInvest ERP Serwer — poczta: szablony (PL) i wysyłka.

   Transport (EMAIL_TRANSPORT):
     resend — API HTTPS Resend (https://api.resend.com/emails), klucz RESEND_API_KEY,
     smtp   — dowolny serwer SMTP firmy (Microsoft 365, Google Workspace, home.pl, własny): SSL 465 albo STARTTLS 587,
              logowanie AUTH PLAIN/LOGIN; domyślnie smtp.resend.com:465 (użytkownik „resend”, hasło = klucz API),
     agentmail — API HTTPS AgentMail (https://api.agentmail.to), klucz AGENTMAIL_API_KEY, nadawca = skrzynka AGENTMAIL_INBOX,
     file   — zapis wiadomości .eml do katalogu danych (instalacja bez poczty, testy).
   Brak konfiguracji → „file” (wiadomości trafiają do <dataDir>/mail-outbox; administrator
   może przekazać link ręcznie). Klucze są czytane WYŁĄCZNIE po stronie serwera
   (zmienne środowiskowe lub plik server.env) i nigdy nie trafiają do przeglądarki.
   ========================================================================= */
import { connect as tlsConnect } from "node:tls";
import { connect as netConnect } from "node:net";
import { hostname } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------- szablony ---------------- */
const BRAND = { name: "ResInvest ERP", green: "#1E6B45", ink: "#1F2A33", muted: "#5B6B78", line: "#DDE3E8", bg: "#F4F6F8" };

function layout({ title, lead, lines = [], button, link, note, footer, pre }) {
  const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:Segoe UI,Arial,sans-serif;color:${BRAND.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${BRAND.line};border-radius:10px;overflow:hidden">
<tr><td style="background:${BRAND.green};padding:18px 24px;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.3px">${BRAND.name}<div style="font-size:12px;font-weight:400;opacity:.85">ResInvest Commodities · system magazynowy</div></td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:20px;color:${BRAND.ink}">${esc(title)}</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${esc(lead)}</p>
${pre ? `<div style="margin:0 0 14px;padding:12px 14px;background:${BRAND.bg};border-left:3px solid ${BRAND.green};font-size:14px;line-height:1.55;white-space:pre-wrap">${esc(pre)}</div>` : ""}
${lines.map(l => `<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:${BRAND.muted}">${esc(l)}</p>`).join("")}
${button && link ? `<p style="margin:20px 0"><a href="${esc(link)}" style="display:inline-block;background:${BRAND.green};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:6px">${esc(button)}</a></p>
<p style="margin:0 0 8px;font-size:12px;color:${BRAND.muted}">Jeśli przycisk nie działa, skopiuj adres do przeglądarki:<br><span style="word-break:break-all">${esc(link)}</span></p>` : ""}
${note ? `<p style="margin:16px 0 0;font-size:12px;color:${BRAND.muted}">${esc(note)}</p>` : ""}
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid ${BRAND.line};font-size:11px;color:${BRAND.muted}">${esc(footer || `Wiadomość wysłana automatycznie przez ${BRAND.name}. Nie odpowiadaj na nią. Jeśli nie spodziewałeś się tej wiadomości, skontaktuj się z administratorem systemu.`)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [BRAND.name, "", title, "", lead, ...(pre ? ["", pre, ""] : []), ...lines, ...(link ? ["", `${button}: ${link}`] : []), ...(note ? ["", note] : []), "",
    footer || `Wiadomość wysłana automatycznie przez ${BRAND.name}. Nie odpowiadaj na nią.`].join("\n");
  return { html, text };
}

/** Szablony wiadomości (język polski). `d` — dane: name, link, hours, email, oldEmail, newEmail, by. */
export const TEMPLATES = {
  invite: d => Object.assign({ subject: "Zaproszenie do ResInvest ERP" }, layout({
    title: "Zaproszenie do ResInvest ERP", lead: `Dzień dobry ${d.name}, administrator założył dla Ciebie konto w systemie ResInvest ERP.`,
    lines: [`Login: ${d.email}`, d.role ? `Rola: ${d.role}` : "", d.warehouse ? `Magazyn: ${d.warehouse}` : ""].filter(Boolean),
    button: "Ustaw hasło i aktywuj konto", link: d.link, note: `Link jest ważny ${d.hours} godz. i można go użyć tylko raz.` })),
  confirm: d => Object.assign({ subject: "Potwierdź adres e-mail — ResInvest ERP" }, layout({
    title: "Potwierdzenie adresu e-mail", lead: `Dzień dobry ${d.name}, potwierdź, że adres ${d.email} należy do Ciebie.`,
    button: "Potwierdź adres e-mail", link: d.link, note: `Link jest ważny ${d.hours} godz. Do czasu potwierdzenia logowanie na nowy adres jest zablokowane.` })),
  reset: d => Object.assign({ subject: "Reset hasła — ResInvest ERP" }, layout({
    title: "Reset hasła", lead: `Dzień dobry ${d.name}, otrzymaliśmy prośbę o ustawienie nowego hasła do konta ${d.email}.`,
    button: "Ustaw nowe hasło", link: d.link, note: `Link jest ważny ${d.hours} godz. i można go użyć tylko raz. Jeśli to nie Ty — zignoruj wiadomość; obecne hasło pozostaje bez zmian.` })),
  emailChanged: d => Object.assign({ subject: "Zmiana adresu e-mail konta — ResInvest ERP" }, layout({
    title: "Zmiana adresu e-mail", lead: `Adres e-mail Twojego konta w ResInvest ERP został zmieniony z ${d.oldEmail} na ${d.newEmail}.`,
    lines: [d.by ? `Zmiany dokonał: ${d.by}` : ""].filter(Boolean), note: "Jeśli to nie Ty zleciłeś zmianę, niezwłocznie skontaktuj się z administratorem." })),
  passwordChanged: d => Object.assign({ subject: "Hasło zostało zmienione — ResInvest ERP" }, layout({
    title: "Hasło zostało zmienione", lead: `Dzień dobry ${d.name}, hasło do konta ${d.email} zostało zmienione.`,
    note: "Jeśli to nie Ty zmieniłeś hasło, niezwłocznie skontaktuj się z administratorem." })),
  deactivated: d => Object.assign({ subject: "Konto dezaktywowane — ResInvest ERP" }, layout({
    title: "Konto dezaktywowane", lead: `Dzień dobry ${d.name}, Twoje konto ${d.email} w ResInvest ERP zostało dezaktywowane.`,
    lines: ["Historia Twoich operacji pozostaje w systemie."], note: "W razie pytań skontaktuj się z administratorem." })),
  /** Zgłoszenie rejestracji zatwierdzone przez administratora (3.7). */
  approved: d => Object.assign({ subject: "Konto zatwierdzone — ResInvest ERP" }, layout({
    title: "Konto zatwierdzone", lead: `Dzień dobry ${d.name}, administrator zatwierdził Twoje zgłoszenie rejestracji w ResInvest ERP.`,
    lines: [`Login: ${d.email}`, d.role ? `Rola: ${d.role}` : "", d.warehouse ? `Magazyn: ${d.warehouse}` : "", d.by ? `Zatwierdził: ${d.by}` : ""].filter(Boolean),
    button: "Zaloguj się", link: d.link, note: "Logujesz się adresem e-mail i hasłem podanym przy rejestracji." })),
  /** Powiadomienie o zmianie w magazynie (3.5): temat i linie z silnika (R.Notify.mailContent). */
  notice: d => Object.assign({ subject: `${d.subject} — ResInvest ERP` }, layout({
    title: d.subject, lead: `Dzień dobry ${d.name}, w ResInvest ERP pojawiła się zmiana, o której chcesz być powiadamiany.`,
    lines: d.lines || [], button: "Otwórz w ResInvest ERP", link: d.link,
    note: "Ustawienia powiadomień zmienisz w programie: Powiadomienia → Moje ustawienia." })),
  /** Dokument / raport wysłany przez użytkownika (3.6): PDF w załączniku, odpowiedź trafia do nadawcy. */
  document: d => Object.assign({ subject: d.subject }, layout({
    title: d.title, lead: `Dzień dobry, ${d.by} przesyła dokument z systemu ${BRAND.name}.`, pre: d.message || "",
    lines: [d.range ? `Zakres: ${d.range}` : "", d.warehouse ? `Magazyn: ${d.warehouse}` : "", `Załącznik: ${d.filename} (${d.sizeKb} kB, PDF)`].filter(Boolean),
    footer: `Wiadomość wysłana z ${BRAND.name} przez użytkownika ${d.by}${d.byEmail ? ` (${d.byEmail})` : ""}. Odpowiedź trafi do nadawcy.` })),
  test: d => Object.assign({ subject: "Wiadomość testowa — ResInvest ERP" }, layout({
    title: "Wiadomość testowa", lead: `Dzień dobry ${d.name}, to jest wiadomość testowa z ResInvest ERP Serwer.`,
    lines: [`Kanał wysyłki: ${d.transport}`, `Wysłano na prośbę: ${d.by}`], note: "Jeśli ją widzisz, poczta jest skonfigurowana poprawnie." }))
};

/* ---------------- konfiguracja ---------------- */
export function mailConfig(env, dataDir) {
  const resendKey = String(env.RESEND_API_KEY || "").trim(), amKey = String(env.AGENTMAIL_API_KEY || "").trim();
  let transport = String(env.EMAIL_TRANSPORT || "").trim().toLowerCase();
  if (!transport) transport = resendKey ? "resend" : amKey ? "agentmail" : "file";
  if (!["resend", "smtp", "agentmail", "file"].includes(transport)) transport = "file";
  const key = transport === "agentmail" ? amKey : resendKey;
  const amInbox = String(env.AGENTMAIL_INBOX || "").trim().toLowerCase();
  const smtpHost = String(env.SMTP_HOST || "smtp.resend.com").trim(), smtpPort = Number(env.SMTP_PORT || 465) || 465;
  const isResend = /(^|\.)resend\.com$/i.test(smtpHost);
  let secure = String(env.SMTP_SECURE || "").trim().toLowerCase();
  if (!["ssl", "starttls", "none"].includes(secure)) secure = smtpPort === 465 ? "ssl" : "starttls";
  return {
    transport, key,
    agentmail: { inbox: amInbox, apiUrl: String(env.AGENTMAIL_API_URL || "https://api.agentmail.to").replace(/\/+$/, "") },
    from: String(env.EMAIL_FROM || "ResInvest ERP <no-reply@resinvest.group>").trim(),
    replyTo: String(env.EMAIL_REPLY_TO || "").trim(),
    smtp: {
      host: smtpHost, port: smtpPort, secure,
      user: String(env.SMTP_USER || (isResend ? "resend" : "")).trim(),
      pass: String(env.SMTP_PASS || (isResend ? resendKey : "")),
      ehlo: String(env.SMTP_EHLO || hostname() || "resinvest-erp").trim().replace(/[^A-Za-z0-9.-]/g, "") || "resinvest-erp",
      envelopeFrom: String(env.SMTP_ENVELOPE_FROM || "").trim(),
      rejectUnauthorized: String(env.SMTP_TLS_REJECT_UNAUTHORIZED || "true").trim().toLowerCase() !== "false",
      timeoutMs: Math.max(1000, Number(env.SMTP_TIMEOUT_MS || 30000) || 30000)
    },
    outDir: join(dataDir, "mail-outbox"),
    apiUrl: String(env.RESEND_API_URL || "https://api.resend.com/emails")
  };
}
/** Brak czego w konfiguracji kanału (pusty napis = kanał gotowy do wysyłki). */
export function mailProblem(c) {
  if (c.transport === "file") return "";
  if (c.transport === "agentmail") return !c.key ? "brak klucza AGENTMAIL_API_KEY" : !c.agentmail.inbox ? "brak AGENTMAIL_INBOX (adres skrzynki nadawcy)" : "";
  if (c.transport === "resend") return c.key ? "" : "brak klucza RESEND_API_KEY";
  if (!c.smtp.host) return "brak SMTP_HOST";
  if (c.smtp.user && !c.smtp.pass) return "brak hasła SMTP_PASS";
  if (!c.smtp.user && c.smtp.secure !== "none") return "brak SMTP_USER (logowanie do serwera poczty)";
  return "";
}
/** Opis konfiguracji bez sekretów (panel administratora, raport startowy). */
export const mailInfo = c => Object.assign({ transport: c.transport, from: c.transport === "agentmail" ? c.agentmail.inbox : c.from,
  configured: !mailProblem(c), problem: mailProblem(c), outDir: c.transport === "file" ? c.outDir : "" },
  c.transport === "smtp" ? { smtp: { host: c.smtp.host, port: c.smtp.port, secure: c.smtp.secure, user: c.smtp.user, auth: !!c.smtp.user } } : {});

/* ---------------- wysyłka ---------------- */
const b64 = s => Buffer.from(String(s), "utf8").toString("base64");
const encHeader = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;
const addr = s => { const m = /<([^>]+)>/.exec(s); return (m ? m[1] : s).trim(); };
const encFrom = s => { const m = /^(.*)<([^>]+)>\s*$/.exec(s); return m ? `${encHeader(m[1].trim())} <${m[2]}>` : s; };
const replyOf = (c, msg) => msg.replyTo || c.replyTo || "";
function mime(c, msg) {
  const boundary = "riw" + randomBytes(12).toString("hex"), id = `<${randomBytes(16).toString("hex")}@resinvest-erp>`;
  const wrap = s => b64(s).replace(/.{1,76}/g, "$&\r\n");
  const files = Array.isArray(msg.attachments) ? msg.attachments : [];
  const alt = [`--${boundary}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", wrap(msg.text),
    `--${boundary}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "", wrap(msg.html), `--${boundary}--`];
  const reply = replyOf(c, msg);
  const head = [`From: ${encFrom(c.from)}`, `To: ${msg.to}`, `Subject: ${encHeader(msg.subject)}`, `Date: ${new Date().toUTCString()}`, `Message-ID: ${id}`,
    ...(reply ? [`Reply-To: ${reply}`] : []), "MIME-Version: 1.0"];
  if (!files.length) return { id, data: [...head, `Content-Type: multipart/alternative; boundary="${boundary}"`, "", ...alt, ""].join("\r\n") };
  // multipart/mixed: treść (alternative) + załączniki (base64, nazwa pliku zakodowana RFC 2047)
  const mixed = "riwm" + randomBytes(12).toString("hex");
  const parts = files.map(f => [`--${mixed}`, `Content-Type: ${f.contentType || "application/octet-stream"}; name="${encHeader(f.filename)}"`, "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${encHeader(f.filename)}"`, "", String(f.content).replace(/.{1,76}/g, "$&\r\n")].join("\r\n"));
  return { id, data: [...head, `Content-Type: multipart/mixed; boundary="${mixed}"`, "", `--${mixed}`, `Content-Type: multipart/alternative; boundary="${boundary}"`, "", ...alt, ...parts, `--${mixed}--`, ""].join("\r\n") };
}
async function viaResend(c, msg) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(c.apiUrl, { method: "POST", signal: ctl.signal, headers: { Authorization: `Bearer ${c.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ from: c.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }, replyOf(c, msg) ? { reply_to: replyOf(c, msg) } : {},
        Array.isArray(msg.attachments) && msg.attachments.length ? { attachments: msg.attachments.map(f => ({ filename: f.filename, content: f.content })) } : {})) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Resend HTTP ${r.status}: ${body.message || body.name || "błąd"}`);
    return { providerId: body.id || "" };
  } finally { clearTimeout(timer); }
}
/** AgentMail: wysyłka ze skrzynki AGENTMAIL_INBOX (POST /v0/inboxes/{inbox}/messages/send). */
async function viaAgentMail(c, msg) {
  if (!c.agentmail.inbox) throw new Error("brak AGENTMAIL_INBOX (adres skrzynki nadawcy)");
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const reply = replyOf(c, msg);
    const body = Object.assign({ to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html, labels: ["resinvest-erp", String(msg.template || "mail")] },
      reply ? { reply_to: [addr(reply)] } : {},
      Array.isArray(msg.attachments) && msg.attachments.length ? { attachments: msg.attachments.map(f => ({ filename: f.filename, content_type: f.contentType || "application/octet-stream", content: f.content })) } : {});
    const r = await fetch(`${c.agentmail.apiUrl}/v0/inboxes/${encodeURIComponent(c.agentmail.inbox)}/messages/send`, { method: "POST", signal: ctl.signal,
      headers: { Authorization: `Bearer ${c.key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const res = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`AgentMail HTTP ${r.status}: ${res.message || res.name || res.error || "błąd"}`);
    return { providerId: res.message_id || "" };
  } finally { clearTimeout(timer); }
}
/**
 * Klient SMTP (RFC 5321) dla dowolnej poczty firmowej: Microsoft 365 / Exchange, Google Workspace, home.pl, OVH,
 * nazwa.pl, własny serwer. Tryby (SMTP_SECURE): „ssl” — TLS od początku połączenia (port 465), „starttls” — połączenie
 * jawne i obowiązkowe przejście na TLS komendą STARTTLS (port 587), „none” — bez szyfrowania (tylko lokalny przekaźnik
 * poczty w sieci firmy, bez logowania hasłem). Logowanie AUTH PLAIN albo AUTH LOGIN — wg możliwości serwera (EHLO).
 * Certyfikat serwera jest zawsze weryfikowany (wyjątek tylko jawnie: SMTP_TLS_REJECT_UNAUTHORIZED=false).
 */
function smtpSession(c, onTimeout) {
  let sock, buf = "", waiter = null, lines = [], closed = null;
  const flush = () => {
    // odpowiedź = linie „250-…” zakończone linią „250 …”
    const idx = lines.findIndex(l => /^\d{3}(?: |$)/.test(l));
    if (idx < 0 || !waiter) return;
    const reply = lines.splice(0, idx + 1), w = waiter; waiter = null;
    w.resolve({ code: Number(reply[idx].slice(0, 3)), lines: reply.map(l => l.slice(4)), text: reply.join(" | ").slice(0, 300) });
  };
  const attach = s => {
    sock = s; sock.setTimeout(c.smtp.timeoutMs, onTimeout);
    sock.on("data", chunk => { buf += chunk.toString("utf8"); const parts = buf.split(/\r?\n/); buf = parts.pop(); lines.push(...parts); flush(); });
    sock.on("error", e => { closed = e; if (waiter) { const w = waiter; waiter = null; w.reject(e); } });
    sock.on("close", () => { if (!closed) closed = new Error("SMTP: serwer zamknął połączenie"); if (waiter) { const w = waiter; waiter = null; w.reject(closed); } });
  };
  const read = () => new Promise((resolve, reject) => { if (closed && !lines.length) return reject(closed); waiter = { resolve, reject }; flush(); });
  const tlsOpts = { servername: c.smtp.host, rejectUnauthorized: c.smtp.rejectUnauthorized, minVersion: "TLSv1.2" };
  return {
    open: () => new Promise((resolve, reject) => {
      const s = c.smtp.secure === "ssl" ? tlsConnect(Object.assign({ host: c.smtp.host, port: c.smtp.port }, tlsOpts)) : netConnect({ host: c.smtp.host, port: c.smtp.port });
      s.once(c.smtp.secure === "ssl" ? "secureConnect" : "connect", () => { s.removeListener("error", reject); resolve(); });
      s.once("error", reject); attach(s);
    }),
    upgrade: () => new Promise((resolve, reject) => {
      const plain = sock; plain.removeAllListeners("data"); plain.removeAllListeners("close"); plain.removeAllListeners("error"); plain.setTimeout(0);
      const s = tlsConnect(Object.assign({ socket: plain }, tlsOpts));
      s.once("secureConnect", () => { s.removeListener("error", reject); resolve(); });
      s.once("error", reject); buf = ""; lines = []; attach(s);
    }),
    cmd: async (line, expect, hide) => {
      if (line !== null) sock.write(line + "\r\n");
      const r = await read();
      if (!expect.includes(r.code)) throw new Error(`SMTP ${hide ? hide : (line || "powitanie").split(" ")[0]}: ${r.text}`);
      return r;
    },
    raw: s => sock.write(s),
    close: () => { try { sock.end(); } catch (e) { /* połączenie już zamknięte */ } },
    destroy: () => { try { sock.destroy(); } catch (e) { /* połączenie już zamknięte */ } },
    get encrypted() { return !!(sock && sock.encrypted); }
  };
}
const caps = r => r.lines.map(l => l.toUpperCase());

async function viaSmtp(c, msg) {
  const { id, data } = mime(c, msg);
  let timer = null;
  const s = smtpSession(c, () => s.destroy());
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { s.destroy(); reject(new Error("SMTP: przekroczony czas")); }, c.smtp.timeoutMs); });
  const run = async () => {
    await s.open();
    await s.cmd(null, [220]);
    let ehlo = await s.cmd(`EHLO ${c.smtp.ehlo}`, [250]);
    if (c.smtp.secure === "starttls") {
      if (!caps(ehlo).some(l => l.startsWith("STARTTLS"))) throw new Error("SMTP: serwer nie oferuje STARTTLS (sprawdź port i SMTP_SECURE)");
      await s.cmd("STARTTLS", [220]); await s.upgrade();
      ehlo = await s.cmd(`EHLO ${c.smtp.ehlo}`, [250]);               // po TLS — ponowne przedstawienie się (RFC 3207)
    }
    if (c.smtp.user) {
      if (!s.encrypted) throw new Error("SMTP: logowanie hasłem bez szyfrowania jest zablokowane (ustaw SMTP_SECURE=ssl albo starttls)");
      const auth = caps(ehlo).find(l => l.startsWith("AUTH")) || "";
      if (/\bPLAIN\b/.test(auth) || !/\bLOGIN\b/.test(auth)) {
        await s.cmd(`AUTH PLAIN ${b64("\0" + c.smtp.user + "\0" + c.smtp.pass)}`, [235], "AUTH (logowanie)");
      } else {
        await s.cmd("AUTH LOGIN", [334]); await s.cmd(b64(c.smtp.user), [334], "AUTH (użytkownik)"); await s.cmd(b64(c.smtp.pass), [235], "AUTH (logowanie)");
      }
    }
    await s.cmd(`MAIL FROM:<${addr(c.smtp.envelopeFrom || c.from)}>`, [250]);
    await s.cmd(`RCPT TO:<${addr(msg.to)}>`, [250, 251]);
    await s.cmd("DATA", [354]);
    // „dot-stuffing” (RFC 5321 §4.5.2): linia zaczynająca się kropką dostaje drugą kropkę
    const body = data.replace(/\r\n\./g, "\r\n..").replace(/^\./, "..");
    s.raw(body + (body.endsWith("\r\n") ? "" : "\r\n"));
    await s.cmd(".", [250], "DATA (treść)");
    await s.cmd("QUIT", [221]).catch(() => {});
    s.close();
    return { providerId: id };
  };
  try { return await Promise.race([run(), deadline]); }
  catch (e) { s.destroy(); throw e; }
  finally { clearTimeout(timer); }
}
function viaFile(c, msg) {
  mkdirSync(c.outDir, { recursive: true });
  const { id, data } = mime(c, msg);
  const name = `${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}-${msg.template}-${randomBytes(4).toString("hex")}.eml`;
  writeFileSync(join(c.outDir, name), data);
  return { providerId: id, file: name };
}

/** Wiadomość z szablonu: { to, template, subject, html, text } (bez wysyłki). */
export function compose(template, to, data) {
  const tpl = TEMPLATES[template];
  return tpl ? Object.assign({ to, template }, tpl(data || {})) : null;
}
async function deliver(c, msg) {
  const problem = mailProblem(c);
  if (problem) throw new Error(problem);
  return c.transport === "resend" ? viaResend(c, msg) : c.transport === "agentmail" ? viaAgentMail(c, msg) : c.transport === "smtp" ? viaSmtp(c, msg) : viaFile(c, msg);
}

/** Wysyłka gotowej wiadomości (kolejka). Nigdy nie rzuca — zwraca { ok, error?, providerId?, file? }. */
export async function sendRaw(c, msg, log) {
  try {
    const r = await deliver(c, msg);
    if (log) log("INFO", `E-mail „${msg.template}” → ${msg.to} (${c.transport}${r.file ? ": " + r.file : ""})`);
    return Object.assign({ ok: true, subject: msg.subject }, r);
  } catch (e) {
    if (log) log("ERROR", `E-mail „${msg.template}” → ${msg.to} nieudany (${c.transport}): ${e.message}`);
    return { ok: false, error: e.message, subject: msg.subject };
  }
}

/**
 * Wysyła wiadomość z szablonu. Nigdy nie rzuca — zwraca { ok, error?, providerId?, file? }.
 * Szczegóły błędu trafiają do dziennika serwera; użytkownik widzi komunikat ogólny.
 */
export async function sendMail(c, template, to, data, log) {
  const msg = compose(template, to, data);
  if (!msg) return { ok: false, error: "unknown template" };
  return sendRaw(c, msg, log);
}
