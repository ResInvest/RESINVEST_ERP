/* =========================================================================
   ResInvest ERP Serwer 3.16 — klient usług sieciowych systemu informacyjnego EUDR (TRACES), SOAP V4.

   Na podstawie oficjalnej dokumentacji technicznej Komisji Europejskiej (EUDR API for Operators, V4):
     * transport HTTPS, SOAP 1.1, nagłówek WS-Security: wsu:Timestamp + UsernameToken z PasswordDigest
       (Base64(SHA-1(nonce + created + klucz))), Nonce w Base64, Created w UTC (tolerancja 5 minut),
     * nagłówek base:WebServiceClientId (identyfikator klienta z sekcji „Web Services Access” profilu),
     * usługi: EUDRDueDiligenceStatementServiceV4 (submitDds, getDds, getDdsByInternalReference),
       EudrEchoService (test połączenia — wyłącznie środowisko ACCEPTANCE),
     * limit 5 wywołań na sekundę z jednego adresu IP; numer referencyjny odczytuje się nie wcześniej niż po 1 godzinie.
   Adresy usług pochodzą z config/app.config.json (sekcja „eudr”) — kopia adresów z dokumentacji, bez własnych adresów API.

   Bezpieczeństwo:
     * dane dostępowe wyłącznie w server.env serwera (EUDR_ACC_* / EUDR_PROD_*) — nigdy w przeglądarce, w stanie
       programu, w dzienniku ani w repozytorium; odpowiedzi API serwera nie zawierają wartości kluczy,
     * środowiska ACCEPTANCE i PRODUCTION mają osobne dane dostępowe; wywołanie produkcyjne wymaga jawnego
       potwierdzenia, a wpis DDS testowy nigdy nie jest wysyłany do produkcji,
     * EUDR_TEST_ENDPOINT (tylko adres pętli zwrotnej 127.0.0.1 / localhost) służy wyłącznie testom automatycznym
       z lokalną atrapą usługi — inne adresy są ignorowane.
   ========================================================================= */
import { createHash, randomBytes } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";

export const EUDR_KEYS = ["EUDR_ACC_USERNAME", "EUDR_ACC_AUTH_KEY", "EUDR_ACC_CLIENT_ID", "EUDR_ACC_OPERATOR_ID",
  "EUDR_PROD_USERNAME", "EUDR_PROD_AUTH_KEY", "EUDR_PROD_CLIENT_ID", "EUDR_PROD_OPERATOR_ID"];
const NS = {
  soap: "http://schemas.xmlsoap.org/soap/envelope/",
  wsse: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd",
  wsu: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd",
  digest: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest",
  b64: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary",
  base: "http://ec.europa.eu/sanco/tracesnt/base/v4",
  dds: "http://ec.europa.eu/tracesnt/certificate/eudr/due-diligence-statement/v4",
  common: "http://ec.europa.eu/tracesnt/certificate/eudr/common/v4",
  echo: "http://ec.europa.eu/tracesnt/eudr/echo"
};
const P = (s, p) => p ? String(s).replace(/\{(\w+)\}/g, (m, k) => p[k] === undefined ? m : String(p[k])) : s;
const xesc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Skrót hasła WS-Security: Base64(SHA-1(nonce + created + hasło)) — Base64 w jednej linii. */
export function passwordDigest(nonce, created, password) {
  return createHash("sha1").update(Buffer.concat([nonce, Buffer.from(created, "utf8"), Buffer.from(password, "utf8")])).digest("base64");
}
/** Nagłówek SOAP: WS-Security (znacznik czasu, UsernameToken) i identyfikator klienta usług sieciowych. */
export function securityHeader({ username, authKey, clientId, now = new Date(), ttlSec = 60, nonce = randomBytes(16) }) {
  const created = new Date(now).toISOString(), expires = new Date(new Date(now).getTime() + ttlSec * 1000).toISOString();
  return `<soapenv:Header><wsse:Security xmlns:wsse="${NS.wsse}" xmlns:wsu="${NS.wsu}" soapenv:mustUnderstand="1">`
    + `<wsu:Timestamp wsu:Id="TS-1"><wsu:Created>${created}</wsu:Created><wsu:Expires>${expires}</wsu:Expires></wsu:Timestamp>`
    + `<wsse:UsernameToken wsu:Id="UT-1"><wsse:Username>${xesc(username)}</wsse:Username>`
    + `<wsse:Password Type="${NS.digest}">${passwordDigest(nonce, created, authKey)}</wsse:Password>`
    + `<wsse:Nonce EncodingType="${NS.b64}">${nonce.toString("base64")}</wsse:Nonce><wsu:Created>${created}</wsu:Created></wsse:UsernameToken>`
    + `</wsse:Security><base:WebServiceClientId>${xesc(clientId)}</base:WebServiceClientId></soapenv:Header>`;
}
export function envelope(header, bodyXml) {
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="${NS.soap}" xmlns:base="${NS.base}" xmlns:dds="${NS.dds}" xmlns:eudrCommon="${NS.common}" xmlns:echo="${NS.echo}">`
    + header + `<soapenv:Body>${bodyXml}</soapenv:Body></soapenv:Envelope>`;
}
/** Odczyt odpowiedzi SOAP: błąd (Fault) albo wartości elementów (bez przestrzeni nazw). */
export function parseSoap(xml) {
  const s = String(xml || "");
  const local = tag => { const out = []; const re = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, "g"); let m; while ((m = re.exec(s))) out.push(m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()); return out; };
  const fault = /<(?:[\w-]+:)?Fault[\s>]/.test(s) ? { code: local("faultcode")[0] || "", text: local("faultstring")[0] || "", detail: (local("errorMessage")[0] || local("message")[0] || local("detail")[0] || "").slice(0, 600) } : null;
  return { fault, get: tag => local(tag), first: tag => local(tag)[0] || "" };
}
/** Odczyt list przeglądu DDS (DdsOverviewResponseType). */
export function parseOverview(xml) {
  const s = String(xml || ""), out = [];
  const re = /<(?:[\w-]+:)?ddsOverviewList(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?ddsOverviewList>/g;
  let m;
  while ((m = re.exec(s))) { const p = parseSoap(m[1]); out.push({ uuid: p.first("uuid"), internalReferenceNumber: p.first("internalReferenceNumber"), referenceNumber: p.first("referenceNumber"), verificationNumber: p.first("verificationNumber"), status: p.first("status"), date: p.first("date"), info: p.first("referenceNumberInfo") || p.first("rejectionReason") }); }
  return out;
}

/* ---------------- konfiguracja ---------------- */
const isLoop = h => h === "127.0.0.1" || h === "localhost" || h === "[::1]";
/** Adresy usług i stan konfiguracji środowisk (bez wartości kluczy). */
export function tracesConfig(env, appConfig) {
  const t = (appConfig && appConfig.eudr && appConfig.eudr.traces) || {};
  let testBase = "";
  if (env.EUDR_TEST_ENDPOINT) { try { const u = new URL(env.EUDR_TEST_ENDPOINT); if (isLoop(u.hostname)) testBase = u.href.replace(/\/?$/, "/"); } catch (e) { /* ignorowane */ } }
  const one = (k, pre) => {
    const base = testBase || (t[k] && t[k].base) || "";
    return { env: k, base, portal: (t[k] && t[k].portal) || base, ddsService: (t.services && t.services.dds) || "ws/EUDRDueDiligenceStatementServiceV4", echoService: (t.services && t.services.echo) || "ws/EudrEchoService",
      echo: k === "ACCEPTANCE", test: !!testBase,
      username: env[`EUDR_${pre}_USERNAME`] || "", authKey: env[`EUDR_${pre}_AUTH_KEY`] || "", clientId: env[`EUDR_${pre}_CLIENT_ID`] || "", operatorId: env[`EUDR_${pre}_OPERATOR_ID`] || "" };
  };
  return { ACCEPTANCE: one("ACCEPTANCE", "ACC"), PRODUCTION: one("PRODUCTION", "PROD") };
}
const mask = v => !v ? "" : v.length <= 4 ? "••••" : v.slice(0, 2) + "•••" + v.slice(-2);
/** Informacja dla przeglądarki — bez wartości kluczy (nazwa użytkownika i identyfikator klienta zamaskowane). */
export function publicInfo(cfg) {
  const one = c => ({ base: c.base, portal: c.portal, configured: !!(c.username && c.authKey && c.clientId), username: mask(c.username), clientId: mask(c.clientId), operatorId: mask(c.operatorId), hasKey: !!c.authKey, echo: c.echo, test: c.test });
  return { ACCEPTANCE: one(cfg.ACCEPTANCE), PRODUCTION: one(cfg.PRODUCTION), keys: EUDR_KEYS };
}

/* ---------------- wywołania ---------------- */
export function createTracesClient({ env, appConfig, now = () => new Date(), log = () => {} }) {
  let cfg = tracesConfig(env, appConfig);
  let last = 0;
  /** Limit: najwyżej 5 wywołań na sekundę (co najmniej 200 ms odstępu). */
  async function slot() { const wait = Math.max(0, last + 210 - Date.now()); last = Date.now() + wait; if (wait) await new Promise(r => setTimeout(r, wait)); }
  function post(url, xml, action, timeoutMs = 30000) {
    return new Promise(resolve => {
      let u;
      try { u = new URL(url); } catch (e) { return resolve({ ok: false, error: "Nieprawidłowy adres usługi" }); }
      if (u.protocol !== "https:" && !(u.protocol === "http:" && isLoop(u.hostname))) return resolve({ ok: false, error: "Wymagane połączenie HTTPS" });
      const body = Buffer.from(xml, "utf8"), t0 = Date.now();
      const req = (u.protocol === "https:" ? httpsRequest : httpRequest)(u, { method: "POST", timeout: timeoutMs, headers: { "Content-Type": "text/xml; charset=utf-8", "Content-Length": body.length, SOAPAction: `"${action}"`, "User-Agent": "ResInvestERP-EUDR/3.16" } }, res => {
        const chunks = []; let size = 0;
        res.on("data", c => { size += c.length; if (size <= 8 * 1048576) chunks.push(c); });
        res.on("end", () => resolve({ ok: true, status: res.statusCode, date: res.headers.date || "", body: Buffer.concat(chunks).toString("utf8"), ms: Date.now() - t0 }));
      });
      req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
      req.on("error", e => resolve({ ok: false, error: e.code === "ETIMEDOUT" ? "Przekroczony czas oczekiwania na odpowiedź" : P("Błąd połączenia: {m}", { m: e.code || e.message }), ms: Date.now() - t0 }));
      req.end(body);
    });
  }
  /** Wywołanie operacji SOAP w danym środowisku. */
  async function call(envName, service, action, bodyXml, opt = {}) {
    const c = cfg[envName];
    if (!c) return { ok: false, error: "Nieznane środowisko" };
    if (!c.base) return { ok: false, error: "Brak adresu usługi w konfiguracji" };
    if (!(c.username && c.authKey && c.clientId)) return { ok: false, error: P("Brak danych dostępowych {e} w server.env serwera", { e: envName }), code: "NO_CREDENTIALS" };
    if (envName === "PRODUCTION" && opt.confirm !== "PRODUKCJA") return { ok: false, error: "Wywołanie produkcyjne wymaga potwierdzenia", code: "CONFIRM" };
    await slot();
    const xml = envelope(securityHeader({ username: c.username, authKey: c.authKey, clientId: c.clientId, now: now() }), bodyXml);
    const r = await post(c.base + service, xml, action, opt.timeoutMs);
    log("INFO", P("EUDR {e}: {a} → {s} ({ms} ms)", { e: envName, a: action, s: r.ok ? r.status : r.error, ms: r.ms || 0 }));
    if (!r.ok) return r;
    const p = parseSoap(r.body);
    if (p.fault) return { ok: false, status: r.status, date: r.date, ms: r.ms, fault: p.fault, error: P("System EUDR zwrócił błąd: {f}", { f: [p.fault.text, p.fault.detail].filter(Boolean).join(" — ") || r.status }) };
    if (r.status >= 400) return { ok: false, status: r.status, ms: r.ms, error: P("Odpowiedź HTTP {s}", { s: r.status }) };
    return { ok: true, status: r.status, date: r.date, ms: r.ms, xml: r.body, p };
  }
  const echo = (envName, query = "ResInvest ERP") => cfg[envName] && cfg[envName].echo
    ? call(envName, cfg[envName].echoService, "testEcho", `<echo:EudrEchoRequest><echo:query>${xesc(query)}</echo:query></echo:EudrEchoRequest>`)
    : Promise.resolve({ ok: false, skip: true, error: "Usługa Echo jest dostępna wyłącznie w środowisku ACCEPTANCE" });
  const submitDds = (envName, bodyXml, opt) => call(envName, cfg[envName].ddsService, "submitDds", bodyXml, opt).then(r => r.ok ? Object.assign(r, { uuid: r.p.first("uuid") }) : r);
  const getDds = (envName, uuids, opt) => call(envName, cfg[envName].ddsService, "getDds", `<dds:GetDdsRequest>${uuids.map(u => `<dds:uuidList>${xesc(u)}</dds:uuidList>`).join("")}</dds:GetDdsRequest>`, opt).then(r => r.ok ? Object.assign(r, { list: parseOverview(r.xml) }) : r);
  const getByInternal = (envName, ref, opt) => call(envName, cfg[envName].ddsService, "getDdsByInternalReference", `<dds:GetDdsByInternalReferenceRequest><dds:internalReference>${xesc(ref)}</dds:internalReference></dds:GetDdsByInternalReferenceRequest>`, opt).then(r => r.ok ? Object.assign(r, { list: parseOverview(r.xml) }) : r);

  /** Testy sieciowe i konfiguracji serwera (Centrum testów); testy danych wykonuje silnik (R.Eudr.localTest). */
  async function runTest(envName, key, opt = {}) {
    const c = cfg[envName], t0 = Date.now();
    const done = (status, detail) => ({ key, status, detail, ms: Date.now() - t0 });
    if (key === "endpoint") {
      if (!c.base) return done("FAIL", "Brak adresu usługi w konfiguracji");
      const u = new URL(c.base);
      if (c.test) return done("OK", P("Adres atrapy testowej {h} (tylko testy automatyczne)", { h: u.host }));
      return u.protocol === "https:" ? done("OK", P("{b}{s}", { b: c.base, s: c.ddsService })) : done("FAIL", "Adres bez HTTPS");
    }
    if (key === "credentials") {
      const miss = [["nazwa użytkownika", c.username], ["klucz uwierzytelniający", c.authKey], ["identyfikator klienta (WebServiceClientId)", c.clientId]].filter(x => !x[1]).map(x => x[0]);
      return miss.length ? done("FAIL", P("Brak w server.env ({e}): {m}", { e: envName, m: miss.join(", ") })) : done("OK", P("Użytkownik {u}, klient {c} — wartości kluczy nie są wyświetlane", { u: mask(c.username), c: mask(c.clientId) }));
    }
    if (key === "wsse") {
      const nonce = randomBytes(16), at = now(), h = securityHeader({ username: "u", authKey: "k", clientId: "c", now: at, nonce });
      const created = /<wsu:Created>([^<]+)</.exec(h)[1], dig = /PasswordDigest">([^<]+)</.exec(h)[1];
      const ok = dig === passwordDigest(nonce, created, "k") && !/\n/.test(dig) && /<base:WebServiceClientId>/.test(h) && /wsu:Expires/.test(h);
      return ok ? done("OK", "Nagłówek zgodny z profilem UsernameToken (PasswordDigest, Nonce Base64, Created UTC)") : done("FAIL", "Nieprawidłowy nagłówek WS-Security");
    }
    if (key === "echo" || key === "clock") {
      if (!c.echo && key === "echo") return done("SKIP", "Usługa Echo jest dostępna wyłącznie w ACCEPTANCE");
      if (!(c.username && c.authKey && c.clientId)) return done("SKIP", "Brak danych dostępowych — uzupełnij server.env");
      const r = c.echo ? await echo(envName) : await getByInternal(envName, "RIW-TEST-POLACZENIA", opt);
      if (key === "clock") {
        const d = Date.parse(r.date || "");
        if (!d) return done(r.ok || r.fault ? "SKIP" : "FAIL", r.ok || r.fault ? "Serwer EUDR nie podał czasu w odpowiedzi" : r.error);
        const diff = Math.round(Math.abs(d - now().getTime()) / 1000);
        return diff <= 240 ? done("OK", P("Różnica czasu {s} s", { s: diff })) : done("FAIL", P("Zegar serwera różni się o {s} s — ustaw synchronizację czasu (NTP)", { s: diff }));
      }
      if (r.ok) return done("OK", P("Odpowiedź: {s} ({ms} ms)", { s: r.p.first("status") || "OK", ms: r.ms }));
      return done("FAIL", r.error);
    }
    if (key === "retrieve") {
      if (!(c.username && c.authKey && c.clientId)) return done("SKIP", "Brak danych dostępowych — uzupełnij server.env");
      if (envName === "PRODUCTION" && opt.confirm !== "PRODUKCJA") return done("SKIP", "Test produkcyjny wymaga potwierdzenia (odczyt z filtrem, bez zmian danych)");
      const r = await getByInternal(envName, opt.internalRef || "RIW-TEST-POLACZENIA", opt);
      if (r.ok) return done("OK", P("Odczyt działa ({n} wyników, {ms} ms)", { n: r.list.length, ms: r.ms }));
      // brak wyników zgłaszany jako błąd „nie znaleziono” oznacza poprawne uwierzytelnienie
      if (r.fault && /notfound|not found|nie znaleziono/i.test(`${r.fault.code} ${r.fault.text} ${r.fault.detail}`)) return done("OK", "Uwierzytelnienie poprawne — brak oświadczeń o numerze testowym");
      return done("FAIL", r.error);
    }
    return null;
  }
  return {
    get cfg() { return cfg; }, reload(newEnv) { cfg = tracesConfig(newEnv, appConfig); }, info: () => publicInfo(cfg),
    call, echo, submitDds, getDds, getByInternal, runTest
  };
}
