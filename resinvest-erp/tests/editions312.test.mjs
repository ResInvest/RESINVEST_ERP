/* Testy wariantów instalacji 3.12 (firma / gmail / otwarta):  node --test tests/editions312.test.mjs
   * parseDomains — reguła COMPANY_DOMAINS (lista, „*”, błędne wpisy),
   * generator plików wariantu — domeny, poczta SMTP, brak sekretów, konto startowe, BOM pliku dla Inno Setup,
   * serwer z COMPANY_DOMAINS: domeny w /api/health (ekran logowania przed zalogowaniem), konto Gmail w trybie
     „bez ograniczeń”, zmiana wariantu przy starcie zapisana w danych i w dzienniku audytu, ograniczenie egzekwowane. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { parseDomains } from "../server/core.mjs";
import { makeEdition, EDITIONS } from "../tools/make-edition.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "server", "riw-server.mjs");
const TMP = mkdtempSync(join(tmpdir(), "riw-ed-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

test("parseDomains: nieustawione, „*”, lista z @ i spacjami, błędna domena", () => {
  assert.equal(parseDomains(undefined), null);
  assert.equal(parseDomains("  "), null);
  assert.deepEqual(parseDomains("*"), { list: [] });
  assert.deepEqual(parseDomains(" @Gmail.com, googlemail.com ;gmail.com"), { list: ["gmail.com", "googlemail.com"] });
  assert.match(parseDomains("resinvest.group, zła domena!").error, /zła/);
  assert.match(parseDomains("localhost").error, /localhost/, "domena musi mieć kropkę");
});

test("generator wariantów: domeny, poczta SMTP (EMAIL_TRANSPORT=smtp), bez sekretów, konto startowe, plik .iss z BOM", () => {
  const exp = { firma: { domains: ["resinvest.group"], host: "smtp.office365.com", admin: "magazyn@resinvest.group" },
    gmail: { domains: ["gmail.com", "googlemail.com"], host: "smtp.gmail.com", admin: "" }, otwarta: { domains: [], host: "", admin: "magazyn@resinvest.group" } };
  assert.deepEqual(EDITIONS, Object.keys(exp));
  for (const id of EDITIONS) {
    const out = join(TMP, id), r = makeEdition(id, out), e = exp[id];
    assert.deepEqual(r.domains, e.domains, id);
    const edEnv = readFileSync(join(out, "edition.env"), "utf8");
    assert.match(edEnv, new RegExp(`^COMPANY_DOMAINS=${id === "otwarta" ? "\\*" : e.domains.join(",")}\\r?$`, "m"));
    const env = readFileSync(join(out, "server.env"), "utf8");
    assert.match(env, /^EMAIL_TRANSPORT=smtp\r?$/m, id);
    assert.match(env, new RegExp(`^SMTP_HOST=${e.host.replace(/\./g, "\\.")}\\r?$`, "m"), id);
    for (const k of ["SMTP_PASS", "RESEND_API_KEY", "AGENTMAIL_API_KEY"]) assert.match(env, new RegExp(`^${k}=\\r?$`, "m"), `${id}: ${k} pusty`);
    assert.deepEqual(JSON.parse(readFileSync(join(out, "app.config.json"), "utf8")).companyDomains, e.domains);
    const app = JSON.parse(readFileSync(join(out, "app.config.json"), "utf8"));
    assert.equal(app.startup.testAdmin, undefined, "konto testowe OFFLINE nie trafia do instalacji serwera");
    const srv = JSON.parse(readFileSync(join(out, "server.config.json"), "utf8"));
    assert.equal(srv.initialAdmin.email, e.admin, id);
    if (!e.admin) assert.equal(srv.initialAdmin.password, "", "bez konta startowego nie ma hasła startowego");
    const iss = readFileSync(join(out, "edition.iss"));
    assert.deepEqual([...iss.subarray(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8 z BOM");
    assert.match(iss.toString("utf8"), new RegExp(`#define EditionId "${id}"`));
  }
});

/* ---------------- serwer z COMPANY_DOMAINS ---------------- */
const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const DATA = join(TMP, "data"), CFG = join(TMP, "server.config.json");
writeFileSync(CFG, JSON.stringify(Object.assign({}, JSON.parse(readFileSync(join(ROOT, "config", "server.config.json"), "utf8")), { initialAdmin: { email: "" } })));
async function withServer(domains, fn) {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const env = Object.assign({}, process.env, { RIW_TODAY: "2026-09-23", RIW_HOST: "127.0.0.1", RIW_CONFIG: CFG, EMAIL_TRANSPORT: "file" });
  if (domains === undefined) delete env.COMPANY_DOMAINS; else env.COMPANY_DOMAINS = domains;
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", SERVER, "--port", String(port), "--data", DATA], { env, stdio: "ignore" });
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

test("serwer „bez ograniczeń” (COMPANY_DOMAINS=*): domeny w /api/health, administrator z adresem Gmail, logowanie z sesją", async () => {
  await withServer("*", async c => {
    const h = await c.get("/api/health");
    assert.deepEqual(h.json.companyDomains, [], "przed konfiguracją: domeny z wariantu");
    const s = await c.post("/api/setup", { name: "Jan Testowy", login: "jan.testowy@gmail.com", password: "Biomasa2026", sample: false });
    assert.equal(s.status, 200, JSON.stringify(s.json));
    const lg = await c.post("/api/auth/login", { login: "Jan.Testowy@Gmail.com ", password: "Biomasa2026" });
    assert.equal(lg.status, 200, JSON.stringify(lg.json));
    const me = await c.get("/api/auth/me");
    assert.equal(me.json.user.login, "jan.testowy@gmail.com");
  });
});

test("zmiana wariantu przy starcie (COMPANY_DOMAINS=resinvest.group): zapis w danych i audycie, adres spoza domeny odrzucony", async () => {
  await withServer("resinvest.group", async c => {
    assert.deepEqual((await c.get("/api/health")).json.companyDomains, ["resinvest.group"]);
    const bad = await c.post("/api/auth/login", { login: "jan.testowy@gmail.com", password: "Biomasa2026" });
    assert.notEqual(bad.status, 200);
    assert.match(bad.json.error, /@resinvest\.group/);
  });
  // ponownie „*” — administrator Gmail loguje się, dziennik audytu ma obie zmiany z konfiguracji serwera
  await withServer("*", async c => {
    const ok = await c.post("/api/auth/login", { login: "jan.testowy@gmail.com", password: "Biomasa2026" });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    const st = await c.get("/api/state");
    const changes = st.json.state.audit.filter(a => a.code === "SETTINGS_CHANGED" && a.source === "Konfiguracja serwera (server.env)");
    assert.equal(changes.length, 2);
    assert.deepEqual(changes.map(a => a.after.domeny), ["resinvest.group", "dowolne"]);
  });
  // bez COMPANY_DOMAINS — domeny zostają takie, jak zapisane w danych
  await withServer(undefined, async c => { assert.deepEqual((await c.get("/api/health")).json.companyDomains, []); });
});
