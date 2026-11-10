/* Testy E2E ResInvest ERP 3.13 (ResInvest ERP Serwer + Chromium):
   * ekran startowy (splash): od pierwszej klatki do wczytania bazy — intro wyłączone (sam ekran ładowania),
     intro przy „ograniczeniu animacji” w Windows, intro pominięte przed końcem ładowania, wczytywanie bazy po zalogowaniu,
   * język i motyw tylko w Ustawienia → Wygląd i język (bez przycisków w górnym pasku i na ekranie logowania),
   * poczta jak po instalacji (EMAIL_TRANSPORT=smtp, bez serwera i hasła): ostrzeżenie na pulpicie, zaproszenie z linkiem
     dla administratora, konfiguracja w Poczta → Konfiguracja poczty (gotowe ustawienia Gmail / Microsoft 365), test wysyłki
     przez lokalny przekaźnik SMTP (bez wysyłki na zewnątrz), telefon bez przewijania poziomego.
   Uruchomienie z katalogu resinvest-erp:  node tests/e2e313.cjs   (zrzuty: SHOTS=<katalog>) */
"use strict";
const path = require("path");
const fs = require("fs");
const os = require("os");
const net = require("net");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = process.env.SHOTS || "";
const results = [], consoleErrors = [];
const check = (name, cond, detail) => { results.push(!!cond); console.log(`${cond ? "✔" : "✘"} ${name}${!cond && detail !== undefined ? "  → " + JSON.stringify(detail) : ""}`); };
const shot = (page, name) => SHOTS ? page.screenshot({ path: path.join(SHOTS, name + ".png") }) : null;
const ADMIN = "magazyn@resinvest.group", ADMIN_PW = "Biomasa2026";
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Przekaźnik SMTP bez szyfrowania (jak w sieci firmy) — zapisuje adresatów. */
function relay() {
  const got = [];
  const srv = net.createServer(sock => {
    let buf = "", data = false;
    const say = l => sock.write(l + "\r\n");
    sock.on("data", ch => {
      buf += ch.toString("utf8"); let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) { if (line === ".") { data = false; say("250 OK"); } continue; }
        const up = line.toUpperCase();
        if (up.startsWith("EHLO")) say("250-relay.test\r\n250 8BITMIME");
        else if (up.startsWith("RCPT TO:")) { got.push(line.slice(8)); say("250 OK"); }
        else if (up.startsWith("MAIL FROM:")) say("250 OK");
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

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "riw-e2e313-"));
  const port = await freePort(), BASE = `http://127.0.0.1:${port}`, data = path.join(dir, "data");
  const cfg = path.join(dir, "server.config.json");
  fs.writeFileSync(cfg, JSON.stringify({ port, host: "127.0.0.1", dataDir: data }));
  // jak po instalacji: EMAIL_TRANSPORT=smtp, puste SMTP_HOST i SMTP_PASS
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, "server.env"), "EMAIL_TRANSPORT=smtp\r\nSMTP_HOST=\r\nSMTP_PORT=465\r\nSMTP_USER=\r\nSMTP_PASS=\r\n");
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(RESEND_|AGENTMAIL_|EMAIL_|SMTP_|APP_URL|RIW_|COMPANY_DOMAINS)/.test(k)));
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(ROOT, "server", "riw-server.mjs")],
    { env: Object.assign(env, { RIW_CONFIG: cfg, RIW_TODAY: "2026-09-23", COMPANY_DOMAINS: "*" }), stdio: "pipe" });
  let log = ""; proc.stdout.on("data", d => { log += d; }); proc.stderr.on("data", d => { log += d; });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + "/api/health")).ok) break; } catch (e) {} await sleep(100); }
  const setup = await fetch(BASE + "/api/setup", { method: "POST", headers: { "Content-Type": "application/json", "X-RIW": "1" }, body: JSON.stringify({ name: "Mateusz Roesner", email: ADMIN, password: ADMIN_PW, sample: true }) });
  check("Serwer: konfiguracja z danymi przykładowymi", setup.ok);
  const smtp = await relay();
  const browser = await chromium.launch();
  const newCtx = async (opts = {}, init = {}) => {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1366, height: 860 }, locale: "pl-PL" }, opts));
    await ctx.addInitScript(i => { try { localStorage.setItem("riw.lang", "pl"); localStorage.setItem("riw.intro", i.intro ? "1" : "0"); } catch (e) {} }, init);
    const page = await ctx.newPage();
    page.on("pageerror", e => consoleErrors.push(e.message));
    page.on("console", m => { if (m.type() === "error" && !/401|403|Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
    return { ctx, page };
  };
  const splashInfo = page => page.evaluate(() => { const el = document.getElementById("splash"); return el ? { cls: el.className, text: (el.querySelector("[data-load-text]") || {}).textContent || "", video: !!el.querySelector("video"), visible: getComputedStyle(el).display !== "none" } : null; });

  try {
    /* ---------------- ekran startowy: intro wyłączone → ekran ładowania do gotowości bazy ---------------- */
    let { ctx, page } = await newCtx({}, { intro: false });
    await page.route("**/api/health", async r => { await sleep(1500); await r.continue(); });
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    const s1 = await splashInfo(page);
    check("Splash: intro wyłączone — ekran ładowania od startu, etap „Łączenie z serwerem…”", s1 && s1.visible && /loading/.test(s1.cls) && s1.text === "Łączenie z serwerem…" && !s1.video, s1);
    await shot(page, "313-splash-ladowanie");
    await page.waitForSelector("#login-form", { timeout: 10000 });
    await page.waitForSelector("#splash", { state: "detached", timeout: 5000 }).catch(() => {});
    check("Splash: znika po wczytaniu (ekran logowania)", !(await page.$("#splash")));
    check("Logowanie: bez przełączników języka i motywu", !(await page.$(".auth-tools")) && !(await page.$("[data-auth-theme]")) && !(await page.$("[data-auth-lang]")));
    // logowanie z wolnym wczytaniem bazy — ten sam ekran ładowania
    await page.unroute("**/api/health");
    await page.route("**/api/auth/login", async r => { await sleep(1200); await r.continue(); });
    await page.fill("#lg-login", ADMIN); await page.fill("#lg-pass", ADMIN_PW); await page.click("#lg-submit");
    await page.waitForTimeout(600);
    const s2 = await splashInfo(page);
    check("Splash po zalogowaniu: „Logowanie i wczytywanie bazy danych…”", s2 && /loading/.test(s2.cls) && s2.text === "Logowanie i wczytywanie bazy danych…", s2);
    await page.waitForSelector("#nav .nav-item", { timeout: 10000 });
    await page.waitForSelector("#splash", { state: "detached", timeout: 5000 }).catch(() => {});
    check("Splash po zalogowaniu znika, pulpit widoczny", !(await page.$("#splash")) && !!(await page.$("#page .page-head, #page .hero, #page .kpi")));
    check("Górny pasek: bez wyboru języka i motywu (tylko Ustawienia)", !(await page.$("#lang-btn")) && !(await page.$("#theme-btn")) && !!(await page.$('#nav [data-nav="wyglad"]')));
    const alertTxt = await page.textContent("#page");
    check("Pulpit administratora: ostrzeżenie „Poczta nie jest skonfigurowana”", alertTxt.includes("Poczta nie jest skonfigurowana"));

    /* ---------------- zaproszenie bez działającej poczty → link dla administratora ---------------- */
    await page.evaluate(() => { location.hash = "#/uzytkownicy"; }); await page.waitForSelector("#users-table");
    await page.click("#user-add"); await page.waitForSelector("#user-edit");
    await page.fill("#me-firstName", "Ewa"); await page.fill("#me-lastName", "Nowa"); await page.fill("#me-email", "ewa.nowa@gmail.com");
    await page.selectOption("#me-role", "magazynier"); await page.selectOption("#me-whId", "wh_rok");
    await page.click("#user-edit [data-yes]");
    await page.waitForSelector("#mail-link-dialog", { timeout: 8000 }).catch(() => {});
    const dlg = await page.evaluate(() => { const d = document.getElementById("mail-link-dialog"); return d ? { text: d.textContent, link: (d.querySelector("#ml-link") || {}).value || "" } : null; });
    check("Zaproszenie bez poczty: okno z przyczyną, wskazówką i linkiem do przekazania", dlg && /SMTP_HOST/.test(dlg.text) && /Konfiguracja poczty/.test(dlg.text) && /#\/invite\/accept\?token=/.test(dlg.link), dlg);
    await shot(page, "313-link-zaproszenia");
    if (dlg) { await page.click("#mail-link-dialog [data-close]"); }

    /* ---------------- Poczta → Konfiguracja poczty ---------------- */
    await page.evaluate(() => { location.hash = "#/poczta"; }); await page.waitForSelector("#mail-config", { timeout: 8000 });
    check("Poczta: przyczyna niepełnej konfiguracji i wskazówka", (await page.textContent("#mail-problem")).includes("SMTP_HOST"));
    await page.click('[data-mc-preset="gmail"]');
    check("Gotowe ustawienia Gmail: smtp.gmail.com, 465, SSL", (await page.inputValue("#mc-host")) === "smtp.gmail.com" && (await page.inputValue("#mc-port")) === "465" && (await page.inputValue("#mc-secure")) === "ssl");
    await page.click('[data-mc-preset="m365"]');
    check("Gotowe ustawienia Microsoft 365: smtp.office365.com, 587, STARTTLS", (await page.inputValue("#mc-host")) === "smtp.office365.com" && (await page.inputValue("#mc-port")) === "587" && (await page.inputValue("#mc-secure")) === "starttls");
    await shot(page, "313-konfiguracja-poczty");
    // przekaźnik w sieci firmy (bez logowania) — lokalny serwer testowy
    await page.click('[data-mc-preset="other"]');
    await page.fill("#mc-host", "127.0.0.1"); await page.fill("#mc-port", String(smtp.port)); await page.selectOption("#mc-secure", "none");
    await page.fill("#mc-user", ""); await page.fill("#mc-from", "ResInvest ERP <erp@firma.pl>"); await page.fill("#mc-app", BASE);
    await page.click("#mc-save");
    await page.waitForFunction(() => !document.getElementById("mail-problem") && document.getElementById("mail-config"), null, { timeout: 8000 }).catch(() => {});
    check("Zapis konfiguracji: bez restartu serwera, poczta skonfigurowana", !(await page.$("#mail-problem")) && fs.readFileSync(path.join(data, "server.env"), "utf8").includes(`SMTP_PORT=${smtp.port}`));
    await page.fill("#mc-to", "test.odbiorcy@firma.pl"); await page.click("#mc-test");
    await page.waitForFunction(() => /wysłana/.test((document.getElementById("mc-result") || {}).textContent || ""), null, { timeout: 8000 }).catch(() => {});
    check("Wyślij test: wynik od razu, wiadomość dotarła do serwera SMTP", (await page.textContent("#mc-result")).includes("Wiadomość wysłana") && smtp.got.some(x => x.includes("test.odbiorcy@firma.pl")), { res: await page.textContent("#mc-result"), got: smtp.got });
    await page.evaluate(() => { location.hash = "#/pulpit"; }); await page.waitForTimeout(400);
    check("Pulpit: ostrzeżenie o poczcie znika po konfiguracji", !(await page.textContent("#page")).includes("Poczta nie jest skonfigurowana"));
    await ctx.close();

    /* ---------------- intro przy „ograniczeniu animacji” i pominięcie przed końcem ładowania ---------------- */
    ({ ctx, page } = await newCtx({ reducedMotion: "reduce" }, { intro: true }));
    await page.route("**/api/health", async r => { await sleep(2500); await r.continue(); });
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    const st = await page.evaluate(() => (window.RIW_DEBUG && RIW_DEBUG.intro) || null);
    check("Intro startuje od razu także przy ograniczeniu animacji (Windows)", st && st.phase === "playing", st);
    await page.keyboard.press("Escape"); await page.waitForTimeout(500);
    const s3 = await splashInfo(page);
    check("Intro pominięte przed wczytaniem bazy → ten sam ekran zostaje jako ekran ładowania (bez filmu)", s3 && /loading/.test(s3.cls) && !s3.video && s3.text.length > 0, s3);
    await page.waitForSelector("#login-form", { timeout: 10000 });
    await page.waitForSelector("#splash", { state: "detached", timeout: 5000 }).catch(() => {});
    check("Po wczytaniu: ekran ładowania znika", !(await page.$("#splash")));
    await ctx.close();

    /* ---------------- telefon: Wygląd i język ---------------- */
    ({ ctx, page } = await newCtx({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, { intro: false }));
    await page.goto(BASE + "/"); await page.waitForSelector("#login-form");
    await page.fill("#lg-login", ADMIN); await page.fill("#lg-pass", ADMIN_PW); await page.click("#lg-submit");
    await page.waitForSelector("#nav .nav-item", { timeout: 10000 });
    await page.evaluate(() => { location.hash = "#/wyglad"; }); await page.waitForSelector("#ui-res");
    check("Telefon: Wygląd i język bez przewijania poziomego", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.evaluate(() => { location.hash = "#/poczta"; }); await page.waitForSelector("#mail-config");
    check("Telefon: Konfiguracja poczty bez przewijania poziomego", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await shot(page, "313-telefon-poczta");
    await ctx.close();

    check("Konsola przeglądarki bez wyjątków", consoleErrors.length === 0, consoleErrors.slice(0, 5));
  } catch (e) {
    console.error(e); results.push(false);
  } finally {
    await browser.close(); await smtp.close();
    proc.kill("SIGTERM");
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const ok = results.filter(Boolean).length;
  console.log(`\nWYNIK: ${ok}/${results.length} ${ok === results.length ? "OK" : "BŁĘDY"}`);
  if (ok !== results.length) { console.log(log.split("\n").slice(-15).join("\n")); process.exit(1); }
})();
