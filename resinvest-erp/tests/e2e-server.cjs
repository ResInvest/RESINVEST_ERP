/* Testy E2E trybu FIRMOWEGO (ResInvest ERP Serwer + Chromium): zaproszenie e-mail → link →
   ustawienie hasła → logowanie; „Nie pamiętam hasła” → link → nowe hasło; izolacja magazynów w interfejsie.
   Poczta: transport „file” (wiadomości .eml w katalogu danych) — rzeczywista wysyłka przez Resend
   nie jest tu sprawdzana.
   Uruchomienie z katalogu resinvest-erp:  NODE_PATH=$(npm root -g) node tests/e2e-server.cjs */
"use strict";
const path = require("path");
const fs = require("fs");
const os = require("os");
const net = require("net");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const results = [], consoleErrors = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond }); console.log(`${cond ? "✔" : "✘"} ${name}${!cond && detail !== undefined ? "  → " + JSON.stringify(detail) : ""}`); };
const nb = s => String(s || "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const ADMIN = "magazyn@resinvest.group", ADMIN_PW = "Biomasa2026";

const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
function parseEml(raw) {
  const to = (/^To: (.*)$/m.exec(raw) || [])[1];
  const m = /Content-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/.exec(raw);
  const text = m ? Buffer.from(m[1].replace(/\s+/g, ""), "base64").toString("utf8") : "";
  return { to, text, link: (/(http:\/\/127\.0\.0\.1:\d+\/#\/[^\s]+)/.exec(text) || [])[1] || "" };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "riw-e2e-srv-"));
  const port = await freePort(), BASE = `http://127.0.0.1:${port}`;
  const cfg = path.join(dir, "server.config.json");
  fs.writeFileSync(cfg, JSON.stringify({ port, host: "127.0.0.1", dataDir: path.join(dir, "data") }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(RESEND_|AGENTMAIL_|EMAIL_|SMTP_|APP_URL|RIW_)/.test(k)));
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(ROOT, "server", "riw-server.mjs")],
    { env: Object.assign(env, { RIW_CONFIG: cfg, RIW_TODAY: "2026-09-23", EMAIL_TRANSPORT: "file", APP_URL: BASE }), stdio: "pipe" });
  let log = ""; proc.stdout.on("data", d => { log += d; }); proc.stderr.on("data", d => { log += d; });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + "/api/health")).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 100)); }
  const setup = await fetch(BASE + "/api/setup", { method: "POST", headers: { "Content-Type": "application/json", "X-RIW": "1" }, body: JSON.stringify({ name: "Mateusz Roesner", email: ADMIN, password: ADMIN_PW, sample: true }) });
  check("Serwer: konfiguracja z danymi przykładowymi", setup.ok);
  const outDir = path.join(dir, "data", "mail-outbox");
  const seen = new Set();
  const newMails = () => { if (!fs.existsSync(outDir)) return []; const out = []; for (const f of fs.readdirSync(outDir).sort()) { if (seen.has(f)) continue; seen.add(f); out.push(parseEml(fs.readFileSync(path.join(outDir, f), "utf8"))); } return out; };

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: "pl-PL" });
  await ctx.addInitScript(() => { try { localStorage.setItem("riw.lang", "pl"); localStorage.setItem("riw.intro", "0"); } catch (e) {} });
  const page = await ctx.newPage();
  page.on("pageerror", e => consoleErrors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/401|403|Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
  const skipIntro = async () => { await page.waitForTimeout(300); await page.keyboard.press("Escape").catch(() => {}); await page.waitForSelector(".splash", { state: "detached", timeout: 6000 }).catch(() => {}); };
  const login = async (email, pw) => {
    await page.waitForSelector("#login-form");
    await page.fill("#lg-login", email); await page.fill("#lg-pass", pw); await page.click("#lg-submit");
    await page.waitForSelector("#nav .nav-item", { timeout: 8000 });
  };
  const logout = async () => { await page.evaluate(() => RIW_DEBUG.app.logout()); await page.waitForSelector("#login-form"); };

  try {
    await page.goto(BASE + "/"); await skipIntro();
    check("Logowanie: tryb FIRMOWY, „Nie pamiętam hasła”, bez rejestracji", nb(await page.textContent(".auth-box .lead")).startsWith("FIRMOWY") && !!(await page.$("#lg-forgot")) && !(await page.$('[data-auth-tab="register"]')));
    await login(ADMIN, ADMIN_PW);
    check("Nagłówek: użytkownik, rola, magazyn", nb(await page.textContent("#user-btn")).includes("Mateusz Roesner") && nb(await page.textContent("#user-btn")).includes("Administrator") && nb(await page.textContent("#wh-chip")).includes("RiC Zabrze"));

    // zaproszenie
    await page.evaluate(() => { location.hash = "#/admin/users"; }); await page.waitForSelector("#users-table");
    await page.click("#user-add"); await page.waitForSelector("#user-edit");
    check("Dodaj użytkownika: domyślnie „Wyślij zaproszenie”", nb(await page.textContent("#user-edit [data-yes]")) === "Wyślij zaproszenie");
    await page.fill("#me-firstName", "Robert"); await page.fill("#me-lastName", "Zaproszony"); await page.fill("#me-email", "robert.zaproszony@resinvest.group");
    await page.selectOption("#me-role", "magazynier"); await page.selectOption("#me-whId", "wh_rok");
    await page.click("#user-edit [data-yes]"); await page.waitForSelector("#user-edit", { state: "detached" });
    await page.waitForTimeout(300);
    const inv = await page.evaluate(() => RIW_DEBUG.store.state.users.find(u => u.login === "robert.zaproszony@resinvest.group"));
    check("Zaproszenie: konto INVITED", inv && inv.status === "INVITED", inv && inv.status);
    const row = nb(await page.textContent(`[data-user="${inv.id}"]`));
    check("Tabela: status „zaproszony”, termin ważności, „Wyślij ponownie zaproszenie”", row.includes("zaproszony") && row.includes("zaproszenie ważne do") && !!(await page.$(`[data-uresend="${inv.id}"]`)), row);
    let mails = newMails();
    check("E-mail z zaproszeniem zapisany (transport file)", mails.length === 1 && mails[0].to === "robert.zaproszony@resinvest.group" && /#\/invite\/accept\?token=/.test(mails[0].link), mails);
    // ponowne wysłanie — nowy link, poprzedni nieważny
    await page.click(`[data-uresend="${inv.id}"]`); await page.waitForTimeout(500);
    const again = newMails();
    check("Wyślij ponownie zaproszenie: nowy link", again.length === 1 && again[0].link !== mails[0].link);
    await logout();

    // stary link — nieważny
    await page.goto(mails[0].link); await skipIntro();
    await page.waitForSelector("#token-screen"); await page.waitForSelector("#tk-err", { timeout: 6000 }).catch(() => {});
    check("Stary link zaproszenia: „Link został już wykorzystany.”", nb(await page.textContent("#token-screen")).includes("Link został już wykorzystany."));
    // aktywacja
    await page.goto(again[0].link); await skipIntro();
    await page.waitForSelector("#tk-form");
    check("Aktywacja: token usunięty z adresu", await page.evaluate(() => !location.href.includes("token=")));
    check("Aktywacja: powitanie z imieniem i adresem", nb(await page.textContent("#token-screen .lead")).includes("Robert") && nb(await page.textContent("#token-screen .lead")).includes("robert.zaproszony@resinvest.group"));
    await page.fill("#tk-pass", "krotkie"); await page.fill("#tk-pass2", "krotkie"); await page.click("#tk-submit"); await page.waitForTimeout(200);
    check("Aktywacja: polityka haseł", nb(await page.textContent("#tk-err")).includes("Hasło musi mieć"));
    await page.fill("#tk-pass", "Rokitki2026r"); await page.fill("#tk-pass2", "Rokitki2026r"); await page.click("#tk-submit");
    await page.waitForSelector("#login-form");
    check("Aktywacja: komunikat i e-mail w polu logowania", nb(await page.textContent("#auth-info")).includes("Konto aktywne") && (await page.inputValue("#lg-login")) === "robert.zaproszony@resinvest.group");
    await page.fill("#lg-pass", "Rokitki2026r"); await page.click("#lg-submit"); await page.waitForSelector("#nav .nav-item");
    const view = await page.evaluate(() => { const S = RIW_DEBUG.store.state; return { ops: [...new Set(S.operations.map(o => o.whId))], users: S.users.length, projected: !!S.projected }; });
    check("Izolacja: magazynier Rokitek nie dostaje danych innych magazynów", view.projected && view.ops.every(w => w === "wh_rok"), view);
    check("Magazynier: brak modułów administracyjnych w menu", await page.evaluate(() => !document.querySelector('[data-nav="uzytkownicy"]') && !document.querySelector('[data-nav="audyt"]') && !document.querySelector('[data-nav="role"]')));
    await logout();

    // nie pamiętam hasła
    await page.click("#lg-forgot"); await page.waitForSelector("#fp-form");
    await page.fill("#fp-email", "robert.zaproszony@resinvest.group"); await page.click("#fp-submit"); await page.waitForSelector("#fp-info");
    check("Nie pamiętam hasła: neutralny komunikat", nb(await page.textContent("#fp-info")).includes("Jeśli konto z tym adresem istnieje"));
    mails = newMails();
    const reset = mails.find(m => /#\/reset-password\?token=/.test(m.link));
    check("E-mail z linkiem resetu", !!reset);
    await page.goto(reset.link); await skipIntro(); await page.waitForSelector("#tk-form");
    await page.fill("#tk-pass", "Nowe2026rok"); await page.fill("#tk-pass2", "Nowe2026rok"); await page.click("#tk-submit");
    await page.waitForSelector("#login-form");
    check("Reset: komunikat „Hasło zmienione”", nb(await page.textContent("#auth-info")).includes("Hasło zmienione"));
    await page.fill("#lg-pass", "Rokitki2026r"); await page.click("#lg-submit"); await page.waitForTimeout(400);
    check("Reset: stare hasło nie działa", nb(await page.textContent("#lg-err")).includes("Nieprawidłowy e-mail lub hasło."));
    await page.fill("#lg-pass", "Nowe2026rok"); await page.click("#lg-submit"); await page.waitForSelector("#nav .nav-item");
    check("Reset: logowanie nowym hasłem", true);
    await logout();

    // administrator: dziennik audytu z kodami i adresem IP; zakładka e-mail
    await login(ADMIN, ADMIN_PW);
    await page.evaluate(() => { location.hash = "#/admin/audit"; }); await page.waitForSelector("#audit-admin-table");
    const au = nb(await page.textContent("#audit-admin-table"));
    check("Audyt: USER_INVITED, INVITE_SENT, USER_ACTIVATED, PASSWORD_RESET_REQUESTED, adres IP", ["USER_INVITED", "INVITE_SENT", "USER_ACTIVATED", "PASSWORD_RESET_REQUESTED", "127.0.0.1"].every(x => au.includes(x)));
    await page.click('[data-autab="mail"]'); await page.waitForSelector("#mail-log-table");
    const ml = nb(await page.textContent("#mail-log-table"));
    check("Audyt: zakładka wiadomości e-mail (invite, reset, passwordChanged)", ["invite", "reset", "passwordChanged"].every(x => ml.includes(x)));
    // 3.6: raport miesiąca wysłany e-mailem z programu (PDF w załączniku, kolejka serwera, audyt)
    await page.evaluate(() => { location.hash = "#/raporty"; }); await page.waitForSelector('[data-mail="rep"]');
    await page.click('[data-mail="rep"]'); await page.waitForSelector("#mail-dialog #ml-to");
    check("3.6 FIRMOWY: okno e-mail bez informacji OFFLINE, przycisk „Wyślij”", !(await page.$("#ml-offline")) && nb(await page.textContent("#ml-send")) === "Wyślij");
    await page.fill("#ml-to", "biuro@odbiorca.pl");
    await page.click("#ml-send");
    await page.waitForFunction(() => RIW_DEBUG.lastMail && RIW_DEBUG.lastMail.mode === "server", null, { timeout: 8000 }).catch(() => {});
    const lm = await page.evaluate(() => RIW_DEBUG.lastMail);
    check("3.6 FIRMOWY: serwer przyjął i wysłał wiadomość", lm && lm.ok && lm.sent === 1, lm && { ok: lm.ok, sent: lm.sent, error: lm.error });
    const docEml = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter(f => f.includes("-document-")) : [];
    const raw = docEml.length ? fs.readFileSync(path.join(outDir, docEml[0]), "utf8") : "";
    check("3.6 FIRMOWY: wiadomość .eml z załącznikiem PDF (raport_…pdf) do biuro@odbiorca.pl", /^To: biuro@odbiorca\.pl$/m.test(raw) && /Content-Type: application\/pdf; name="raport_[^"]+\.pdf"/.test(raw));
    const pdfPart = /Content-Disposition: attachment[^\r\n]*\r\n\r\n([A-Za-z0-9+\/=\r\n]+)/.exec(raw);
    check("3.6 FIRMOWY: załącznik to poprawny PDF wygenerowany w przeglądarce", !!pdfPart && Buffer.from(pdfPart[1].replace(/\s+/g, ""), "base64").subarray(0, 5).toString("latin1") === "%PDF-");
    await page.evaluate(() => { location.hash = "#/admin/audit"; }); await page.waitForSelector('[data-autab="events"]'); await page.click('[data-autab="events"]'); await page.waitForSelector("#audit-admin-table");
    check("3.6 FIRMOWY: wysyłka w dzienniku audytu (MAIL_DOCUMENT)", nb(await page.textContent("#audit-admin-table")).includes("MAIL_DOCUMENT"));
    // 3.10: synchronizacja samymi zmianami — odpowiedź komendy bez pełnego stanu; stan w przeglądarce = pełny widok serwera
    const cmdResp = page.waitForResponse(r => r.url().endsWith("/api/cmd"));
    const pr = await page.evaluate(() => RIW_DEBUG.store.exec("print.register", { kind: "report", title: "Test synchronizacji", range: "2026-09", format: "pdf" }, "Test"));
    const cmdJson = await (await cmdResp).json();
    const sync = await page.evaluate(async () => {
      const r = await (await fetch("/api/state", { headers: { "X-RIW": "1" }, credentials: "same-origin" })).json();
      return { same: JSON.stringify(RIW_DEBUG.store.state) === JSON.stringify(r.state), rev: r.rev, mine: RIW_DEBUG.store.state.rev, sync: Object.assign({}, RIW_DEBUG.store.backend.sync) };
    });
    check("3.10: komenda — w odpowiedzi tylko zmiany (bez pełnego stanu)", pr && pr.ok && !!cmdJson.delta && !cmdJson.state, Object.keys(cmdJson));
    check("3.10: stan w przeglądarce po nałożeniu zmian = pełny widok serwera (bez ponownego pełnego pobrania)", sync.same && sync.rev === sync.mine && sync.sync.delta > 0 && sync.sync.refetch === 0, sync);
    // wylogowanie → #/login, stan wyczyszczony
    await logout();
    check("Wylogowanie: #/login i brak danych w pamięci", await page.evaluate(() => location.hash === "#/login" && !RIW_DEBUG.store.state && !RIW_DEBUG.store.userId));
  } catch (e) {
    console.error(e); check("Przebieg bez wyjątków", false, e.message);
  } finally {
    check("Konsola przeglądarki bez wyjątków", consoleErrors.length === 0, consoleErrors);
    check("Serwer: komendy na szybkiej ścieżce zapisu (bez pełnej kopii bazy)", !/pełnej kopii/.test(log), (log.match(/.*pełnej kopii.*/g) || []).slice(0, 5));
    await browser.close();
    await new Promise(res => { proc.once("exit", res); proc.kill("SIGTERM"); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const bad = results.filter(r => !r.ok).length;
  console.log(`\nWYNIK: ${results.length - bad}/${results.length} OK`);
  if (bad) console.log(log.split("\n").slice(-15).join("\n"));
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
