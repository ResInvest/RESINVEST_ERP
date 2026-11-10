/* Testy E2E ResInvest ERP 3.15 (Chromium):
   * serwer z czystą bazą (jak po przeniesieniu danych): administrator wpisuje stany początkowe RiC Zabrze,
     RiC Brąszewice i RiC Rokitki w edytorze, poprawia jedną wartość (dokument z różnicą), stany magazynowe
     pokazują wpisane ilości, błędne wartości są oznaczone, magazynier widzi tylko podgląd,
   * telefon: edytor bez przewijania poziomego strony.
   Uruchomienie z katalogu resinvest-erp:  node tests/e2e315.cjs   (zrzuty: SHOTS=<katalog>) */
"use strict";
const path = require("path");
const fs = require("fs");
const os = require("os");
const net = require("net");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = process.env.SHOTS || "";
const results = [], errors = [];
const check = (name, cond, detail) => { results.push(!!cond); console.log(`${cond ? "✔" : "✘"} ${name}${!cond && detail !== undefined ? "  → " + JSON.stringify(detail) : ""}`); };
const shot = (page, name) => SHOTS ? page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }) : null;
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nb = s => String(s || "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const watch = page => { page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource|401|403/.test(m.text())) errors.push(m.text()); }); };
const api = (BASE, p, body, cookie) => fetch(BASE + p, { method: body ? "POST" : "GET", headers: Object.assign({ "Content-Type": "application/json", "X-RIW": "1" }, cookie ? { cookie } : {}), body: body ? JSON.stringify(body) : undefined });

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "riw-e2e315-"));
  const port = await freePort(), BASE = `http://127.0.0.1:${port}`, data = path.join(dir, "data");
  const cfg = path.join(dir, "server.config.json");
  fs.writeFileSync(cfg, JSON.stringify({ port, host: "127.0.0.1", dataDir: data }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(RESEND_|AGENTMAIL_|EMAIL_|SMTP_|APP_URL|RIW_|COMPANY_DOMAINS|BACKUP_COPY_TO|DB_|DATABASE_URL)/.test(k)));
  Object.assign(env, process.env.E2E_DB_DRIVER === "postgres" ? { DB_DRIVER: "postgres", DATABASE_URL: process.env.E2E_DATABASE_URL } : {});
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(ROOT, "server", "riw-server.mjs")], { env: Object.assign(env, { RIW_CONFIG: cfg, RIW_TODAY: "2026-11-10", EMAIL_TRANSPORT: "file" }), stdio: "pipe" });
  let srvLog = ""; proc.stdout.on("data", d => { srvLog += d; }); proc.stderr.on("data", d => { srvLog += d; });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + "/api/health")).ok) break; } catch (e) {} await sleep(100); }
  // czysta baza: konto administratora, 3 magazyny, katalog produktów, bez operacji (jak po przeniesieniu danych)
  await api(BASE, "/api/setup", { name: "Mateusz Roesner", email: "magazyn@resinvest.group", password: "Biomasa2026", sample: false });
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pl-PL" });
    await ctx.addInitScript(() => { try { localStorage.setItem("riw.lang", "pl"); localStorage.setItem("riw.intro", "0"); } catch (e) {} });
    const page = await ctx.newPage(); watch(page);
    await page.goto(BASE + "/"); await page.waitForSelector("#login-form");
    await page.fill("#lg-login", "magazyn@resinvest.group"); await page.fill("#lg-pass", "Biomasa2026"); await page.click("#lg-submit");
    await page.waitForSelector("#nav .nav-item", { timeout: 10000 });
    check("Menu: pozycja „Stany początkowe”", await page.$('#nav [data-nav="stanypoczatkowe"]') !== null);
    await page.evaluate(() => { location.hash = "#/administracja"; }); await page.waitForSelector("#dm-opening");
    check("Administracja: skrót do edytora przy „Start pracy na czysto”", await page.$eval("#dm-opening", a => a.getAttribute("href")) === "#/stanypoczatkowe");
    await page.click("#dm-opening"); await page.waitForSelector("#op-table");
    const whs = await page.$$eval("#op-wh option", o => o.map(x => x.textContent.trim()));
    check("Edytor: trzy magazyny RiC Zabrze, RiC Brąszewice, RiC Rokitki", JSON.stringify(whs) === JSON.stringify(["RiC Zabrze", "RiC Brąszewice", "RiC Rokitki"]), whs);
    check("Edytor: podpowiedź dla pustego magazynu", nb(await page.textContent("main")).includes("nie ma jeszcze stanu ani operacji"));
    await shot(page, "e2e315-01-edytor-pusty");

    const plan = { wh_zab: { pr_drewno: "817", pr_zr_lesna: "8 173,5", pr_pks: "728" }, wh_bra: { pr_drewno: "30", pr_zr_lesna: "250" }, wh_rok: { pr_zr_tow: "120,25", pr_lupina: "4,5" } };
    for (const [wh, vals] of Object.entries(plan)) {
      await page.selectOption("#op-wh", wh); await page.waitForSelector(`#op-table [data-oin="pr_drewno"]`);
      await page.fill("#op-date", "2026-11-01");
      await page.dispatchEvent("#op-date", "change");
      for (const [pid, v] of Object.entries(vals)) await page.fill(`[data-oin="${pid}"]`, v);
      if (wh === "wh_zab") check("Różnica liczona na bieżąco (bez zapisu)", nb(await page.textContent('[data-odelta="pr_zr_lesna"]')).includes("+8 173,5"), await page.textContent('[data-odelta="pr_zr_lesna"]'));
      await page.click("#op-save"); await page.waitForSelector(".modal [data-yes]"); await page.click(".modal [data-yes]");
      await page.waitForFunction(() => document.querySelector("#op-docs") !== null, null, { timeout: 8000 });
    }
    // RiC Zabrze: stan bieżący po zapisie i poprawka (różnica)
    await page.selectOption("#op-wh", "wh_zab"); await page.waitForSelector("#op-docs");
    check("Zabrze: stan początkowy zrębki 8 173,5", nb(await page.textContent('[data-oopen="pr_zr_lesna"]')) === "8 173,5", await page.textContent('[data-oopen="pr_zr_lesna"]'));
    check("Zabrze: stan bieżący = stan początkowy", nb(await page.textContent('[data-ocur="pr_drewno"]')) === "817");
    await page.fill('[data-oin="pr_drewno"]', "800");
    await page.click("#op-save"); await page.click(".modal [data-yes]");
    await page.waitForFunction(() => document.querySelectorAll("#op-docs tbody tr").length === 2, null, { timeout: 8000 });
    check("Poprawka: drugi dokument BO, stan początkowy 800, dokumenty zostają w historii", nb(await page.textContent('[data-oopen="pr_drewno"]')) === "800" && (await page.$$("#op-docs tbody tr")).length === 2);
    // błędne wartości
    await page.fill('[data-oin="pr_pks"]', "-5"); await page.fill('[data-oin="pr_lupina"]', "abc");
    check("Błędna liczba oznaczona przy wpisywaniu", await page.$eval('[data-omsg="pr_lupina"]', x => !x.classList.contains("hidden")));
    await page.fill('[data-oin="pr_lupina"]', "");
    await page.click("#op-save"); await page.click(".modal [data-yes]"); await page.waitForTimeout(500);
    check("Wartość ujemna odrzucona z komunikatem przy produkcie", nb(await page.textContent('[data-omsg="pr_pks"]')).includes("nie może być ujemny"));
    await shot(page, "e2e315-02-edytor-zabrze");
    // stany magazynowe
    await page.evaluate(() => { location.hash = "#/stany"; }); await page.waitForSelector("table.tbl");
    const login = await api(BASE, "/api/auth/login", { login: "magazyn@resinvest.group", password: "Biomasa2026" });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const state = (await (await api(BASE, "/api/state", null, cookie)).json()).state;
    const R = (() => { globalThis.RIW_CONFIG = {}; require(path.join(ROOT, "app/src/i18n.js")); return require(path.join(ROOT, "app/src/engine.js")); })();
    const bal = (w, p) => R.Stock.balance(state, w, p);
    check("Serwer: stany po zapisie (Zabrze 800 / 8173,5 / 728, Brąszewice 30 / 250, Rokitki 120,25 / 4,5)",
      [bal("wh_zab", "pr_drewno"), bal("wh_zab", "pr_zr_lesna"), bal("wh_zab", "pr_pks"), bal("wh_bra", "pr_drewno"), bal("wh_bra", "pr_zr_lesna"), bal("wh_rok", "pr_zr_tow"), bal("wh_rok", "pr_lupina")].join("|") === "800|8173.5|728|30|250|120.25|4.5");
    check("Dziennik audytu: zmiana z wartościami przed → po", state.audit.some(a => a.source === "Edytor stanów początkowych" && a.after && (a.after.zmiany || []).some(z => z.przed === 817 && z.po === 800)));
    // magazynier: podgląd bez pól
    const inv = await api(BASE, "/api/users", { rec: { name: "Jan Magazynier", email: "jan.mag@resinvest.group", login: "jan.mag@resinvest.group", role: "magazynier", whId: "wh_rok", warehouseIds: ["wh_rok"], status: "ACTIVE" }, password: "Magazyn2026x", mustChange: false }, cookie);
    const invJ = await inv.json();
    // konto z hasłem tymczasowym — zmiana hasła przy pierwszym logowaniu (jak w programie)
    if (invJ.res && invJ.res.ok) {
      const l2 = await api(BASE, "/api/auth/login", { login: "jan.mag@resinvest.group", password: "Magazyn2026x" });
      const c2 = l2.headers.get("set-cookie").split(";")[0];
      await api(BASE, "/api/auth/password", { old: "Magazyn2026x", new: "Magazyn2026y" }, c2);
    }
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "pl-PL" });
    await ctx2.addInitScript(() => { try { localStorage.setItem("riw.lang", "pl"); localStorage.setItem("riw.intro", "0"); } catch (e) {} });
    const p2 = await ctx2.newPage(); watch(p2);
    if (invJ.res && invJ.res.ok) {
      await p2.goto(BASE + "/"); await p2.waitForSelector("#login-form");
      await p2.fill("#lg-login", "jan.mag@resinvest.group"); await p2.fill("#lg-pass", "Magazyn2026y"); await p2.click("#lg-submit");
      await p2.waitForSelector("#nav .nav-item", { timeout: 10000 });
      await p2.evaluate(() => { location.hash = "#/stanypoczatkowe"; }); await p2.waitForSelector("#op-table");
      check("Magazynier: podgląd bez pól edycji i przycisku zapisu", (await p2.$$("[data-oin]")).length === 0 && (await p2.$("#op-save")) === null);
      check("Magazynier: widzi tylko swój magazyn", JSON.stringify(await p2.$$eval("#op-wh option", o => o.map(x => x.value))) === JSON.stringify(["wh_rok"]));
      const r = await p2.evaluate(() => RIWUI.Store.exec("stock.opening", { whId: "wh_rok", date: "2026-11-01", lines: [{ productId: "pr_drewno", qty: "5" }] }, "test"));
      check("Magazynier: komenda odrzucona przez serwer (FORBIDDEN)", r && r.code === "FORBIDDEN", r);
    } else check("Utworzenie konta magazyniera (warunek testu)", false, invJ);
    // telefon
    const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "pl-PL" });
    await ctx3.addInitScript(() => { try { localStorage.setItem("riw.lang", "pl"); localStorage.setItem("riw.intro", "0"); } catch (e) {} });
    const p3 = await ctx3.newPage(); watch(p3);
    await p3.goto(BASE + "/"); await p3.waitForSelector("#login-form");
    await p3.fill("#lg-login", "magazyn@resinvest.group"); await p3.fill("#lg-pass", "Biomasa2026"); await p3.click("#lg-submit");
    await p3.waitForTimeout(1500);
    await p3.evaluate(() => { location.hash = "#/stanypoczatkowe"; }); await p3.waitForSelector("#op-table");
    const ov = await p3.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check("Telefon 390 px: strona bez przewijania poziomego (tabela przewija się w ramce)", ov <= 1, ov);
    await shot(p3, "e2e315-03-telefon");
    check("Konsola przeglądarki bez wyjątków", errors.length === 0, errors.slice(0, 5));
  } catch (e) { check("Przebieg bez wyjątku", false, e.stack || String(e)); console.log(srvLog.slice(-2000)); }
  finally { await browser.close(); proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
  const ok = results.filter(Boolean).length;
  console.log(`\nWYNIK: ${ok}/${results.length} ${ok === results.length ? "OK" : "BŁĘDY"}`);
  process.exit(ok === results.length ? 0 : 1);
})();
