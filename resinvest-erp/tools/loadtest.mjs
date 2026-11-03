/* =========================================================================
   ResInvest ERP Serwer — test obciążeniowy (wielu użytkowników jednocześnie)

   Uruchamia serwer na kopii danych przykładowych w katalogu tymczasowym i przez określony czas symuluje
   równoczesną pracę wielu stanowisk tak jak przeglądarka: pełny stan przy otwarciu / odświeżeniu strony, potem
   synchronizacja samymi zmianami (od posiadanej rewizji), zakupy i sprzedaż z odpowiedzią „tylko zmiany”,
   sprawdzenie sesji. Potem:
     · fala jednoczesnych zapisów (wszyscy zatwierdzają w tej samej chwili),
     · weryfikacja spójności: liczba operacji = liczba udanych zapisów, rewizja, dziennik skrótów (--check),
     stan każdego stanowiska po nałożeniu zmian = pełny widok serwera,
     · raport: przepustowość, czasy odpowiedzi p50/p95/p99/max, błędy, rozmiar bazy.
   Nie dotyka danych produkcyjnych.

   Uruchomienie:  node tools/loadtest.mjs [--users 40] [--seconds 45] [--burst 60] [--think 50,300] [--preload 0] [--report plik.md]
     --think min,max  — przerwa użytkownika między czynnościami [ms] (realnie: 3000,10000)
     --preload N      — przed testem dopisuje N operacji (baza „po latach pracy”, np. 3000 ≈ 2 lata)
   ========================================================================= */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { tmpdir, cpus, totalmem } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
globalThis.RIW_CONFIG = {};
require(join(ROOT, "app/src/i18n.js"));
const R = require(join(ROOT, "app/src/engine.js"));
require(join(ROOT, "app/src/seed.js"));

const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const USERS = Number(opt("users", 40)), SECONDS = Number(opt("seconds", 45)), BURST = Number(opt("burst", 60)), REPORT = opt("report", "");
const [THINK_MIN, THINK_MAX] = String(opt("think", "50,300")).split(",").map(Number), PRELOAD = Number(opt("preload", 0));
const { Store } = await import("../server/core.mjs");
const TODAY = "2026-09-23", ADMIN = "magazyn@resinvest.group", ADMIN_PW = "Biomasa2026", DEMO = "demo1234", NEWPW = "Praca2026x";
const ACCOUNTS = [ADMIN, "anna.gorska@resinvest.group", "tomasz.zajac@resinvest.group", "michal.lewandowski@resinvest.group"];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });

function client(base) {
  let cookie = "";
  const call = async (method, path, body) => {
    const t0 = performance.now();
    const r = await fetch(base + path, { method, headers: Object.assign({ "Content-Type": "application/json", "X-RIW": "1" }, cookie ? { Cookie: cookie } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0].endsWith("=") ? "" : sc.split(";")[0];
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* odpowiedź nie-JSON */ }
    return { status: r.status, json, ms: performance.now() - t0, bytes: text.length };
  };
  return { get: p => call("GET", p), post: (p, b) => call("POST", p, b) };
}

const stats = {};
const rec = (name, r, ok) => { const s = stats[name] || (stats[name] = { n: 0, err: 0, ms: [], bytes: 0, why: {} }); s.n++; s.ms.push(r.ms); s.bytes += r.bytes || 0;
  if (!ok) { s.err++; const w = (r.json && r.json.res && (r.json.res.error || r.json.res.code)) || `HTTP ${r.status}`; s.why[w] = (s.why[w] || 0) + 1; } };
const pct = (a, p) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p / 100 * b.length))]; };

let seq = 0;
const WH = { [ADMIN]: "RiC Zabrze", "anna.gorska@resinvest.group": "RiC Zabrze", "tomasz.zajac@resinvest.group": "RiC Brąszewice", "michal.lewandowski@resinvest.group": "RiC Rokitki" };
function purchase(login) {
  return R.Seed.draftOf(TODAY, { purchase: { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: String(1 + (seq++ % 9)), unit: "m3", price: "230" },
    transport: { mode: "none", place: WH[login] } });
}
function sale(login) {
  return R.Seed.draftOf(TODAY, { type: "SPRZEDAZ", sale: { productId: "pr_zr_lesna", qty: "1", unit: "MP", buyerId: "pa_ec_zab", price: "90", priceUnit: "MP" }, transport: { mode: "none", place: WH[login] } });
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "riw-load-")), port = await freePort(), base = `http://127.0.0.1:${port}`;
  const cfgFile = join(dir, "server.config.json");
  writeFileSync(cfgFile, JSON.stringify({ port, host: "127.0.0.1", dataDir: join(dir, "data"), security: { maxFailed: 5, lockMinutes: 15, ipAttemptsPer15Min: 100000 }, initialAdmin: { email: "" } }));
  const env = Object.assign({}, process.env, { RIW_CONFIG: cfgFile, RIW_TODAY: TODAY, EMAIL_TRANSPORT: "file", APP_URL: "http://127.0.0.1:" + port });
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(ROOT, "server/riw-server.mjs")], { env, stdio: "pipe" });
  let srvOut = ""; proc.stdout.on("data", d => { srvOut += d; }); proc.stderr.on("data", d => { srvOut += d; });
  let proc2 = null;
  const stop = () => new Promise(res => { const p = proc2 || proc; if (p.exitCode !== null) return res(); p.once("exit", res); p.kill("SIGTERM"); });
  try {
    for (let i = 0; i < 150; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch (e) { /* serwer startuje */ } await sleep(100); }
    const setup = await client(base).post("/api/setup", { name: "Mateusz Roesner", email: ADMIN, password: ADMIN_PW, sample: true });
    if (setup.status !== 200) throw new Error("setup: " + JSON.stringify(setup.json));
    if (PRELOAD > 0) {          // baza „po latach”: operacje dopisane bezpośrednio przez silnik (jak przy normalnej pracy), jeden zapis
      await stop();
      const s = new Store({ dataDir: join(dir, "data"), backupDir: join(dir, "data", "backups"), backup: { hour: 2, keepDays: 30 }, todayOverride: TODAY });
      const st = s.workCopy(), admin = R.byId(st.users, "u_admin") || st.users.find(u => u.role === "admin");
      for (let i = 0; i < PRELOAD; i++) { const d = i % 3 ? purchase(ADMIN) : sale(ADMIN); const r = R.commitOperation(st, d, { user: admin, today: TODAY }); if (!r.ok) throw new Error("preload: " + r.error); }
      st.rev += 1; s.saveState(st, null, "loadtest.preload", { operacje: PRELOAD }, st.rev - 1); s.close();
      proc2 = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(ROOT, "server/riw-server.mjs")], { env, stdio: "pipe" });
      proc2.stdout.on("data", d => { srvOut += d; }); proc2.stderr.on("data", d => { srvOut += d; });
      for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch (e) { /* serwer startuje */ } await sleep(100); }
    }

    // stanowiska: każde konto loguje się kilka razy (osobne sesje = osobne komputery)
    const vus = [];
    for (let i = 0; i < USERS; i++) {
      const login = ACCOUNTS[i % ACCOUNTS.length], c = client(base);
      let l = await c.post("/api/auth/login", { login, password: login === ADMIN ? ADMIN_PW : DEMO });
      if (l.status !== 200 && login !== ADMIN) l = await c.post("/api/auth/login", { login, password: NEWPW });
      if (l.status !== 200) throw new Error(`logowanie ${login}: ${l.status} ${JSON.stringify(l.json)}`);
      if (l.json.mustChange) { const p = await c.post("/api/auth/password", { old: DEMO, new: NEWPW }); if (p.status !== 200) throw new Error("zmiana hasła " + login); }
      vus.push({ login, c });
    }
    const st0 = await vus[0].c.get("/api/state"), ops0 = st0.json.state.operations.length, rev0 = st0.json.rev;
    let committed = 0, pending = 0, fullFallbacks = 0;
    // przeglądarka: pełny widok przy otwarciu strony, potem tylko zmiany (R.applyDelta — ten sam kod co w aplikacji)
    const fullLoad = async (vu, name) => { const r = await vu.c.get("/api/state"); rec(name, r, r.status === 200 && !!r.json.state); if (r.json && r.json.state) vu.view = r.json.state; };
    const applyResp = async (vu, r) => {
      if (!r.json) return;
      if (r.json.state) { vu.view = r.json.state; return; }
      if (r.json.delta) { const next = R.applyDelta(vu.view, r.json.delta); if (next) vu.view = next; else { fullFallbacks++; await fullLoad(vu, "GET /api/state (pełny stan — zmiany nie pasowały)"); } }
    };
    await Promise.all(vus.map(vu => fullLoad(vu, "GET /api/state (pełny stan — otwarcie strony)")));

    // 1) praca ciągła
    const end = Date.now() + SECONDS * 1000;
    const t0 = Date.now();
    await Promise.all(vus.map(async (vu, i) => {
      await sleep(i * Math.min(250, THINK_MIN / 4 + 15));
      while (Date.now() < end) {
        const x = Math.random();
        if (x < 0.03) await fullLoad(vu, "GET /api/state (pełny stan — odświeżenie strony)");
        else if (x < 0.55) { const r = await vu.c.get("/api/state?since=" + vu.view.rev); rec("GET /api/state?since (zmiany od rewizji)", r, r.status === 200); await applyResp(vu, r); }
        else if (x < 0.65) { const r = await vu.c.get("/api/auth/me"); rec("GET /api/auth/me", r, r.status === 200); }
        else if (x < 0.90) {
          const r = await vu.c.post("/api/cmd", { cmd: "op.commit", args: { draft: purchase(vu.login) }, haveRev: vu.view.rev });
          const ok = r.status === 200 && r.json && r.json.res && r.json.res.ok; rec("POST op.commit — zakup", r, ok);
          if (ok) { committed++; if (r.json.res.op && r.json.res.op.status === "PENDING") pending++; await applyResp(vu, r); }
        } else if (WH[vu.login] === "RiC Zabrze") {            // sprzedaż tylko tam, gdzie jest zrębka na stanie
          const r = await vu.c.post("/api/cmd", { cmd: "op.commit", args: { draft: sale(vu.login) }, haveRev: vu.view.rev });
          const ok = r.status === 200 && r.json && r.json.res && r.json.res.ok; rec("POST op.commit — sprzedaż", r, ok);
          if (ok) { committed++; await applyResp(vu, r); }
        }
        await sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));       // „czas myślenia” użytkownika
      }
    }));
    const steady = (Date.now() - t0) / 1000;

    // 2) fala: wszyscy zatwierdzają w tej samej chwili
    const tb = performance.now();
    const burst = await Promise.all(Array.from({ length: BURST }, (_, i) => vus[i % vus.length]).map(vu => vu.c.post("/api/cmd", { cmd: "op.commit", args: { draft: purchase(vu.login) }, haveRev: vu.view.rev })));
    const burstMs = performance.now() - tb;
    let burstOk = 0;
    for (const r of burst) { const ok = r.status === 200 && r.json && r.json.res && r.json.res.ok; rec("FALA — jednoczesny zapis", r, ok); if (ok) { burstOk++; committed++; } }

    // 3) spójność: każde stanowisko dociąga zmiany i porównuje swój stan z pełnym widokiem serwera
    let viewsOk = 0;
    for (const vu of vus) {
      const r = await vu.c.get("/api/state?since=" + vu.view.rev); await applyResp(vu, r);
      const f = await vu.c.get("/api/state");
      if (f.json && JSON.stringify(f.json.state) === JSON.stringify(vu.view)) viewsOk++;
      else if (process.env.RIW_LOAD_DEBUG && f.json) { const a = f.json.state, b = vu.view; console.error("RÓŻNICE", vu.login, Object.keys(a).join(","), "|", Object.keys(b).join(","), Object.keys(a).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map(k => k + (Array.isArray(a[k]) ? `(${a[k].length}/${(b[k] || []).length})` : ""))); }
    }
    const st1 = await vus[0].c.get("/api/state");
    const ops1 = st1.json.state.operations.length, rev1 = st1.json.rev;
    const lostOrDup = ops1 - ops0 - committed;
    await stop();
    const chk = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", join(ROOT, "server/riw-server.mjs"), "--check"], { env, encoding: "utf8" });
    let check = null; try { check = JSON.parse(chk.stdout); } catch (e) { check = { ok: false, raw: chk.stdout + chk.stderr }; }
    const dbFile = join(dir, "data", "resinvest.sqlite"), dbMb = statSync(dbFile).size / 1048576;
    const walFiles = readdirSync(join(dir, "data")).filter(f => f.startsWith("resinvest.sqlite"));

    const total = Object.values(stats).reduce((s, x) => s + x.n, 0), errs = Object.values(stats).reduce((s, x) => s + x.err, 0);
    const rows = Object.entries(stats).map(([k, s]) => `| ${k} | ${s.n} | ${s.err} | ${pct(s.ms, 50).toFixed(0)} | ${pct(s.ms, 95).toFixed(0)} | ${pct(s.ms, 99).toFixed(0)} | ${Math.max(...s.ms).toFixed(0)} | ${(s.bytes / s.n / 1024).toFixed(0)} |`);
    const fastPath = !/pełnej kopii/.test(srvOut);
    const ok = errs === 0 && lostOrDup === 0 && check && check.ok && viewsOk === vus.length && fastPath;
    const md = [
      `# Test obciążeniowy ResInvest ERP Serwer ${R.VERSION}`, "",
      `Środowisko: ${cpus().length} × ${cpus()[0].model.trim()}, RAM ${(totalmem() / 1073741824).toFixed(1)} GB, Node ${process.version}. Dane przykładowe (3 magazyny), dziennik zmian włączony, zapis bazy z \`synchronous=FULL\`.`, "",
      `Scenariusz: **${USERS} stanowisk jednocześnie** (${ACCOUNTS.length} konta, osobne sesje) przez ${steady.toFixed(0)} s — odczyt stanu, sprawdzenie sesji, zakupy i sprzedaż, przerwa między czynnościami ${THINK_MIN}–${THINK_MAX} ms; potem **fala ${BURST} jednoczesnych zatwierdzeń**.${PRELOAD ? ` Baza przed testem: **${ops0} operacji** (dopisano ${PRELOAD}).` : ""}`, "",
      "| Żądanie | Liczba | Błędy | p50 [ms] | p95 [ms] | p99 [ms] | max [ms] | śr. odpowiedź [kB] |", "|---|---|---|---|---|---|---|---|", ...rows, "",
      `* Razem żądań: **${total}** (${(total / steady).toFixed(1)} żądań/s w pracy ciągłej), błędów: **${errs}**.`,
      ...Object.entries(stats).filter(([, x]) => x.err).map(([k, x]) => `  * ${k} — odrzucone: ${Object.entries(x.why).map(([w, n]) => `${n} × „${w}”`).join("; ")}`),
      `* Zapisane operacje: **${committed}** (w tym ${pending} czekających na zatwierdzenie), rewizja ${rev0} → ${rev1}.`,
      `* Fala ${BURST} jednoczesnych zapisów: ${burstOk}/${BURST} zapisanych w ${burstMs.toFixed(0)} ms (zapisy kolejkowane — żaden nie nadpisał drugiego).`,
      `* Spójność: operacji w stanie ${ops0} → ${ops1}, różnica względem udanych zapisów: **${lostOrDup}** (0 = nic nie zginęło i nic się nie zdublowało).`,
      `* Synchronizacja przeglądarek samymi zmianami: stan **${viewsOk}/${vus.length}** stanowisk identyczny z pełnym widokiem serwera; pełne pobranie z powodu niepasujących zmian: ${fullFallbacks}.`,
      `* Zapis przyrostowy: ${fastPath ? "wszystkie komendy na szybkiej ścieżce (bez kopiowania całej bazy)" : "UWAGA: część komend na pełnej kopii — patrz dziennik serwera"}.`,
      `* Kontrola bazy (\`--check\`): **${check && check.ok ? "OK" : "BŁĄD"}** — sumy kontrolne stanu i łańcuch skrótów dziennika (${check && check.journal} wpisów).`,
      `* Rozmiar bazy po teście: ${dbMb.toFixed(1)} MB (${walFiles.join(", ")}).`, "",
      `**Wynik: ${ok ? "ZALICZONY" : "NIEZALICZONY"}**`
    ].join("\n");
    console.log(md);
    if (REPORT) writeFileSync(REPORT, md + "\n");
    if (!ok) { console.error(srvOut.split("\n").filter(l => /ERROR|WARN/.test(l)).slice(-20).join("\n")); process.exitCode = 1; }
  } finally {
    await stop();
    rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e); process.exit(1); });
