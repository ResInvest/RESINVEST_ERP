/* Testy serwera — moduł EUDR (3.16):  node --test tests/eudr-server316.test.mjs
   * klient SOAP V4: nagłówek WS-Security (PasswordDigest = Base64(SHA-1(nonce+created+klucz))), WebServiceClientId,
     Echo (tylko ACCEPTANCE), submitDds → UUID, getDds → numer referencyjny i weryfikacyjny, błędy SOAP (Fault),
     brak danych dostępowych, potwierdzenie produkcji — na lokalnej atrapie usługi (bez połączenia z Komisją Europejską),
   * dane dostępowe tylko po stronie serwera: odpowiedzi API bez wartości kluczy, plik nie jest dołączany z polecenia przeglądarki,
   * pliki dokumentów: folder skanów + kopia, typ po treści (HTML odrzucony), odczyt, nowa wersja,
   * Centrum testów: przebieg zapisany w historii; kolekcje EUDR w wierszach bazy i po ponownym uruchomieniu. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as netServer } from "node:net";
import { createServer as httpServer } from "node:http";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createTracesClient, securityHeader, passwordDigest, parseSoap, publicInfo, tracesConfig } from "../server/eudr-traces.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "riw-eudr-"));
after(() => rmSync(TMP, { recursive: true, force: true }));
const freePort = () => new Promise(res => { const s = netServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const KEY = "klucz-testowy-atrapy", USER = "uzytkownik-testowy", CLIENT = "klient-testowy";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

/** Atrapa usług EUDR: sprawdza nagłówek WS-Security i odpowiada jak w przykładach dokumentacji. */
function mockTraces() {
  const calls = [];
  const srv = httpServer((req, res) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      const xml = Buffer.concat(chunks).toString("utf8"), p = parseSoap(xml);
      const nonce = Buffer.from(p.first("Nonce"), "base64"), created = p.first("Created"), digest = p.first("Password");
      const auth = p.first("Username") === USER && digest === passwordDigest(nonce, created, KEY) && p.first("WebServiceClientId") === CLIENT && Math.abs(Date.now() - Date.parse(created)) < 300000;
      const op = /<(?:\w+:)?(EudrEchoRequest|SubmitDdsRequest|GetDdsRequest|GetDdsByInternalReferenceRequest)\b/.exec(xml);
      calls.push({ path: req.url, op: op && op[1], auth, xml });
      const send = body => { res.writeHead(200, { "Content-Type": "text/xml", Date: new Date().toUTCString() }); res.end(`<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body>${body}</S:Body></S:Envelope>`); };
      if (!auth) { res.writeHead(500, { "Content-Type": "text/xml" }); return res.end(`<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><S:Fault><faultcode>S:Server</faultcode><faultstring>Authentication failed</faultstring></S:Fault></S:Body></S:Envelope>`); }
      if (op && op[1] === "EudrEchoRequest") return send(`<ns:EudrEchoResponse xmlns:ns="http://ec.europa.eu/tracesnt/eudr/echo"><ns:status>OK</ns:status></ns:EudrEchoResponse>`);
      if (op && op[1] === "SubmitDdsRequest") return send(`<ns5:SubmitDdsResponse xmlns:ns5="v4"><ns5:uuid>071874bd-8c62-4cac-8eb6-b2fbe003410c</ns5:uuid></ns5:SubmitDdsResponse>`);
      if (op && op[1] === "GetDdsRequest") return send(`<ns5:GetDdsResponse xmlns:ns5="v4"><ns5:ddsOverviewList><ns5:uuid>071874bd-8c62-4cac-8eb6-b2fbe003410c</ns5:uuid><ns5:referenceNumber>26PLTESTATRAPA</ns5:referenceNumber><ns5:verificationNumber>ATRAPA12345</ns5:verificationNumber><ns5:status>AVAILABLE</ns5:status></ns5:ddsOverviewList></ns5:GetDdsResponse>`);
      if (op && op[1] === "GetDdsByInternalReferenceRequest") { res.writeHead(500, { "Content-Type": "text/xml", Date: new Date().toUTCString() }); return res.end(`<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><S:Fault><faultcode>S:Client</faultcode><faultstring>NotFoundException</faultstring></S:Fault></S:Body></S:Envelope>`); }
      res.writeHead(400); res.end();
    });
  });
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r({ srv, calls, url: `http://127.0.0.1:${srv.address().port}/tracesnt/` })));
}
const appConfig = { eudr: { traces: { ACCEPTANCE: { base: "https://acceptance.eudr.webcloud.ec.europa.eu/tracesnt/" }, PRODUCTION: { base: "https://eudr.webcloud.ec.europa.eu/tracesnt/" }, services: { dds: "ws/EUDRDueDiligenceStatementServiceV4", echo: "ws/EudrEchoService" } } } };

test("WS-Security: skrót hasła, Nonce i Created, identyfikator klienta, bez znaków nowej linii", () => {
  const nonce = Buffer.alloc(16, 1), now = new Date("2026-11-10T10:00:00.000Z");
  const h = securityHeader({ username: "u", authKey: "k", clientId: "c", now, nonce });
  const expected = createHash("sha1").update(Buffer.concat([nonce, Buffer.from("2026-11-10T10:00:00.000Z"), Buffer.from("k")])).digest("base64");
  assert.ok(h.includes(`#PasswordDigest">${expected}</wsse:Password>`));
  assert.ok(h.includes(`<wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString("base64")}</wsse:Nonce>`));
  assert.ok(h.includes("<wsu:Expires>2026-11-10T10:01:00.000Z</wsu:Expires>"));
  assert.ok(h.includes("<base:WebServiceClientId>c</base:WebServiceClientId>"));
  assert.ok(!h.includes("\n"));
  assert.ok(!h.includes(">k<"), "klucz nie trafia do komunikatu jawnym tekstem");
});

test("konfiguracja: oficjalne adresy, adres testowy tylko pętla zwrotna, informacja bez wartości kluczy", () => {
  const c = tracesConfig({ EUDR_ACC_USERNAME: USER, EUDR_ACC_AUTH_KEY: KEY, EUDR_ACC_CLIENT_ID: CLIENT, EUDR_TEST_ENDPOINT: "https://zly.example.com/" }, appConfig);
  assert.equal(c.ACCEPTANCE.base, "https://acceptance.eudr.webcloud.ec.europa.eu/tracesnt/");
  assert.equal(c.PRODUCTION.echo, false);
  const info = JSON.stringify(publicInfo(c));
  assert.ok(!info.includes(KEY) && !info.includes(USER) && !info.includes(CLIENT));
  assert.equal(publicInfo(c).ACCEPTANCE.configured, true); assert.equal(publicInfo(c).PRODUCTION.configured, false);
});

test("klient SOAP na atrapie: Echo, submitDds, getDds, błąd uwierzytelnienia, brak danych, potwierdzenie produkcji", async () => {
  const m = await mockTraces();
  try {
    const env = { EUDR_ACC_USERNAME: USER, EUDR_ACC_AUTH_KEY: KEY, EUDR_ACC_CLIENT_ID: CLIENT, EUDR_TEST_ENDPOINT: m.url };
    const c = createTracesClient({ env, appConfig });
    const e = await c.echo("ACCEPTANCE");
    assert.equal(e.ok, true, e.error); assert.equal(e.p.first("status"), "OK");
    assert.equal(m.calls[0].path, "/tracesnt/ws/EudrEchoService"); assert.equal(m.calls[0].auth, true);
    assert.equal((await c.echo("PRODUCTION")).skip, true, "Echo tylko w ACCEPTANCE");
    const s = await c.submitDds("ACCEPTANCE", "<dds:SubmitDdsRequest><dds:operatorRole>OPERATOR</dds:operatorRole></dds:SubmitDdsRequest>");
    assert.equal(s.ok, true); assert.equal(s.uuid, "071874bd-8c62-4cac-8eb6-b2fbe003410c");
    assert.equal(m.calls.slice(-1)[0].path, "/tracesnt/ws/EUDRDueDiligenceStatementServiceV4");
    const g = await c.getDds("ACCEPTANCE", [s.uuid]);
    assert.equal(g.list[0].referenceNumber, "26PLTESTATRAPA"); assert.equal(g.list[0].status, "AVAILABLE");
    const r = await c.runTest("ACCEPTANCE", "retrieve");
    assert.equal(r.status, "OK", r.detail);
    assert.equal((await c.runTest("ACCEPTANCE", "clock")).status, "OK");
    const wrong = createTracesClient({ env: Object.assign({}, env, { EUDR_ACC_AUTH_KEY: "zly" }), appConfig });
    const f = await wrong.echo("ACCEPTANCE");
    assert.equal(f.ok, false); assert.match(f.error, /Authentication failed/);
    const none = createTracesClient({ env: { EUDR_TEST_ENDPOINT: m.url }, appConfig });
    assert.equal((await none.echo("ACCEPTANCE")).code, "NO_CREDENTIALS");
    const prod = createTracesClient({ env: { EUDR_PROD_USERNAME: USER, EUDR_PROD_AUTH_KEY: KEY, EUDR_PROD_CLIENT_ID: CLIENT, EUDR_TEST_ENDPOINT: m.url }, appConfig });
    assert.equal((await prod.submitDds("PRODUCTION", "<x/>")).code, "CONFIRM");
    assert.equal((await prod.runTest("PRODUCTION", "retrieve")).status, "SKIP");
    // atrapa nie jest wywoływana bez potwierdzenia
    assert.ok(m.calls.every(x => x.op));
  } finally { m.srv.close(); }
});

test("serwer: pliki dokumentów, Centrum testów, złożenie DDS na atrapie, dane dostępowe niewidoczne, zapis w wierszach bazy", async () => {
  const m = await mockTraces();
  const dataDir = join(TMP, "data"), port = await freePort(), base = `http://127.0.0.1:${port}`;
  const cfgFile = join(TMP, "server.config.json");
  writeFileSync(cfgFile, JSON.stringify({ port, host: "127.0.0.1", dataDir }));
  const env = Object.assign({}, process.env, { RIW_TODAY: "2026-11-10", RIW_CONFIG: cfgFile, EMAIL_TRANSPORT: "file", EUDR_ACC_USERNAME: USER, EUDR_ACC_AUTH_KEY: KEY, EUDR_ACC_CLIENT_ID: CLIENT, EUDR_TEST_ENDPOINT: m.url });
  delete env.COMPANY_DOMAINS;
  const start = () => spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(ROOT, "server", "riw-server.mjs")], { env, stdio: "ignore" });
  const stop = p => new Promise(res => { if (p.exitCode !== null) return res(); p.once("exit", res); p.kill("SIGTERM"); });
  const up = async () => { for (let i = 0; i < 100; i++) { try { if ((await fetch(base + "/api/health")).ok) return true; } catch (e) {} await new Promise(r => setTimeout(r, 100)); } return false; };
  let cookie = "";
  const call = async (method, path, body, headers = {}) => {
    const raw = Buffer.isBuffer(body);
    const r = await fetch(base + path, { method, headers: Object.assign({ "X-RIW": "1" }, raw ? {} : { "Content-Type": "application/json" }, cookie ? { Cookie: cookie } : {}, headers), body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    const ct = r.headers.get("content-type") || "";
    const text = Buffer.from(await r.arrayBuffer());
    return { status: r.status, headers: r.headers, text: text.toString("utf8"), json: ct.includes("json") ? JSON.parse(text.toString("utf8")) : null, buf: text };
  };
  const cmd = (c, args) => call("POST", "/api/cmd", { cmd: c, args });
  let proc = start();
  try {
    assert.ok(await up(), "serwer wystartował");
    assert.equal((await call("POST", "/api/setup", { name: "Administrator Testowy", email: "magazyn@resinvest.group", password: "Biomasa2026", sample: true })).status, 200);
    assert.equal((await call("POST", "/api/auth/login", { login: "magazyn@resinvest.group", password: "Biomasa2026" })).status, 200);
    const st = (await call("GET", "/api/state")).json.state;
    assert.ok(st.eudrLots.length >= 3);
    const lot = st.eudrLots[0];
    // informacja o systemie EUDR bez wartości kluczy
    const info = await call("GET", "/api/eudr/traces/info");
    assert.equal(info.status, 200); assert.equal(info.json.info.ACCEPTANCE.configured, true);
    assert.ok(!info.text.includes(KEY) && !info.text.includes(USER) && !info.text.includes(CLIENT));
    assert.ok(!JSON.stringify(st).includes(KEY), "klucz nie trafia do stanu programu");
    // plik dokumentu
    const meta = encodeURIComponent(JSON.stringify({ type: "legality", lotIds: [lot.id], number: "ZEZW/1" }));
    const f = await call("POST", `/api/eudr/files?meta=${meta}&name=${encodeURIComponent("zezwolenie.pdf")}`, PDF, { "Content-Type": "application/pdf" });
    assert.equal(f.status, 200, f.text);
    const doc = f.json.doc;
    assert.match(doc.versions[0].key, /^SKANY LISTOPAD 2026\/EUDR_legality_/);
    assert.ok(existsSync(join(dataDir, "skany", doc.versions[0].key)) && existsSync(join(dataDir, "backups", "skany", doc.versions[0].key)));
    const g = await call("GET", `/api/eudr/files?id=${doc.id}`);
    assert.equal(g.status, 200); assert.deepEqual(g.buf, PDF); assert.match(g.headers.get("content-disposition"), /^inline/);
    assert.equal((await call("POST", `/api/eudr/files?meta=${meta}&name=x.txt`, Buffer.from("<html><script>alert(1)</script>"))).status, 415);
    const v2 = await call("POST", `/api/eudr/files?meta=${encodeURIComponent(JSON.stringify({ id: doc.id }))}&name=v2.pdf`, PDF);
    assert.equal(v2.json.doc.versions.length, 2);
    const viaCmd = await cmd("eudr.doc.save", { type: "invoice", lotIds: [lot.id], file: { key: "SKANY LISTOPAD 2026/EUDR_x.pdf", name: "x.pdf", type: "application/pdf", size: 10 } });
    assert.equal(viaCmd.status, 403, "pliku nie dołącza się poleceniem przeglądarki");
    // Centrum testów w ACCEPTANCE (atrapa)
    const t = await call("POST", "/api/eudr/traces/tests", {});
    assert.equal(t.status, 200, t.text);
    const res = Object.fromEntries(t.json.run.results.map(r => [r.key, r.status]));
    assert.equal(res.credentials, "OK"); assert.equal(res.wsse, "OK"); assert.equal(res.echo, "OK"); assert.equal(res.retrieve, "OK"); assert.equal(res.separation, "OK");
    assert.equal(t.json.run.mode, "server"); assert.equal(t.json.run.env, "ACCEPTANCE");
    // złożenie DDS: partia dopuszczona w panelu należytej staranności
    const lotArgs = { whId: "wh_zab", productId: "pr_drewno", qty: "10", m3: "10", t: "9.5", partnerId: "pa_ndl_rr", acq: "own_harvest",
      wood: { species: "Sosna zwyczajna", speciesLatin: "Pinus sylvestris", cn: "4401", country: "PL", harvestFrom: "2026-05-01" }, origin: { owner: "PRZYKŁAD", country: "PL", riskCountry: "low", lat: "50.1", lon: "18.2", areaHa: "1" } };
    const nl = (await cmd("eudr.lot.save", lotArgs)).json.res.lot;
    const dd = (await cmd("eudr.dds.save", { kind: "OWN", lotIds: [nl.id] })).json.res.dds;
    const notReady = await call("POST", "/api/eudr/traces/submit", { id: dd.id });
    assert.equal(notReady.status, 400); assert.match(notReady.json.error, /niedopuszczone/);
    for (const [i, type] of ["purchase", "transport", "legality", "harvest_right", "gps"].entries())
      assert.equal((await call("POST", `/api/eudr/files?meta=${encodeURIComponent(JSON.stringify({ type, lotIds: [nl.id] }))}&name=d${i}.pdf`, PDF)).status, 200);
    const items = Object.fromEntries(["description", "quantity", "country", "geo", "period", "supplier", "buyer", "deforestation", "legality"].map(k => [k, { ok: true }]));
    assert.equal((await cmd("eudr.dd.stage", { id: nl.id, stage: 1, items, done: true, confirm: true })).json.res.ok, true);
    const crit = Object.fromEntries(["countryRisk", "forestPresence", "complexity", "corruption", "concerns", "supplierHistory"].map(k => [k, { level: "low" }]));
    assert.equal((await cmd("eudr.dd.stage", { id: nl.id, stage: 2, criteria: crit, result: "NEGLIGIBLE", justification: "Kraj niskiego ryzyka, dokumenty kompletne.", done: true })).json.res.ok, true);
    const ap = await cmd("eudr.dd.approve", { id: nl.id, result: "ACCEPTED", confirm: true, justification: "Dokumenty i geolokalizacja sprawdzone osobiście." });
    assert.equal(ap.json.res.ok, true, JSON.stringify(ap.json.res));
    const sub = await call("POST", "/api/eudr/traces/submit", { id: dd.id });
    assert.equal(sub.status, 200, sub.text); assert.equal(sub.json.uuid, "071874bd-8c62-4cac-8eb6-b2fbe003410c");
    assert.ok(m.calls.some(c => c.op === "SubmitDdsRequest" && c.auth && /Pinus sylvestris/.test(c.xml)));
    assert.equal((await call("POST", "/api/eudr/traces/status", { id: dd.id })).status, 429, "status po 1 godzinie");
    // tryb produkcyjny: wpis testowy nie jest wysyłany
    assert.equal((await cmd("eudr.env.set", { env: "PRODUCTION", confirm: "PRODUKCJA" })).json.res.ok, true);
    const dd2 = (await cmd("eudr.dds.save", { kind: "OWN", lotIds: [nl.id] })).json.res.dds;
    const acc = (await call("GET", "/api/state")).json.state.eudrDds.find(d => d.env === "ACCEPTANCE" && d.kind === "OWN");
    assert.equal((await call("POST", "/api/eudr/traces/submit", { id: acc.id })).status, 400);
    assert.equal((await call("POST", "/api/eudr/traces/submit", { id: dd2.id })).json.code, "CONFIRM");
  } finally { await stop(proc); }
  // wiersze bazy i ponowne uruchomienie
  const db = new DatabaseSync(join(dataDir, "resinvest.sqlite"), { readOnly: true });
  try { for (const k of ["eudrLots", "eudrDocs", "eudrDds", "eudrTests"]) assert.ok(db.prepare("SELECT COUNT(*) AS n FROM rows WHERE coll = ?").get(k).n > 0, k); } finally { db.close(); }
  proc = start();
  try {
    assert.ok(await up());
    cookie = "";
    assert.equal((await call("POST", "/api/auth/login", { login: "magazyn@resinvest.group", password: "Biomasa2026" })).status, 200);
    const st = (await call("GET", "/api/state")).json.state;
    assert.ok(st.eudrDds.some(d => d.uuid === "071874bd-8c62-4cac-8eb6-b2fbe003410c" && d.status === "SUBMITTED" && d.env === "ACCEPTANCE"));
    assert.equal(st.config.eudr.env, "PRODUCTION");
    assert.ok(st.eudrTests.length >= 1);
  } finally { await stop(proc); m.srv.close(); }
});
