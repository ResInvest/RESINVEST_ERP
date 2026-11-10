/* Testy E2E aplikacji na telefon (Android) — część HTML, w Chromium na ekranie telefonu:
   * ekran wyboru połączenia (mobile/android/app/src/main/assets/setup.html) z mostem RIWSetup jak w aplikacji:
     domyślnie „Serwer firmy”, uzupełnienie adresu, sprawdzenie połączenia przed zapisem, tryb bez serwera i demo,
   * program w aplikacji (most RIWNative): zapis plików przez aplikację (CSV → „Pobrane”), drukowanie systemowe,
     pozycja „Aplikacja — adres serwera” w menu użytkownika; w zwykłej przeglądarce — bez zmian,
   * rejestr operacji wg okresu na ekranie 390 px (bez przewijania poziomego).
   Wymaga:  node tools/build.mjs --edition demo        Uruchomienie:  node tests/e2e315mobile.cjs */
"use strict";
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const DEMO = "file://" + path.join(ROOT, "ResInvest_ERP_Demo.html");
const SETUP = "file://" + path.join(ROOT, "mobile", "android", "app", "src", "main", "assets", "setup.html");
const results = [], errors = [];
const check = (name, cond, detail) => { results.push(!!cond); console.log(`${cond ? "✔" : "✘"} ${name}${!cond && detail !== undefined ? "  → " + JSON.stringify(detail) : ""}`); };
const watch = page => { page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); }); };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "pl-PL" };
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

(async () => {
  const browser = await chromium.launch();
  try {
    /* ---------------- ekran wyboru połączenia ---------------- */
    const c1 = await browser.newContext(PHONE);
    await c1.addInitScript(() => {
      window.__calls = [];
      window.RIWSetup = {
        config: () => JSON.stringify({ mode: "server", serverUrl: "", version: "3.15.0" }),
        test: u => { window.__calls.push(["test", u]); setTimeout(() => window.riwTestResult(/192\.168\.1\.10/.test(u), /192\.168\.1\.10/.test(u) ? "Połączono" : "Nie można połączyć"), 20); },
        save: (m, u) => window.__calls.push(["save", m, u])
      };
    });
    const s = await c1.newPage(); watch(s);
    await s.goto(SETUP);
    check("Start aplikacji: ekran połączenia, domyślnie „Serwer firmy”, wersja aplikacji", (await s.isChecked('input[value="server"]')) && /3\.15\.0/.test(await s.textContent("#ver")) && await noHScroll(s));
    await s.click("#go"); await s.waitForTimeout(80);
    check("Bez adresu: komunikat, nic nie zapisano", /Wpisz adres/.test(await s.textContent("#msg")) && (await s.evaluate(() => window.__calls.length)) === 0);
    await s.fill("#url", "10.0.0.99:8080"); await s.click("#go"); await s.waitForTimeout(150);
    const bad = await s.evaluate(() => window.__calls);
    check("Serwer nieosiągalny: sprawdzenie (adres uzupełniony o http://), bez zapisu", bad.length === 1 && bad[0][1] === "http://10.0.0.99:8080" && /Nie można/.test(await s.textContent("#msg")), bad);
    await s.fill("#url", "192.168.1.10:8080/"); await s.click("#go"); await s.waitForTimeout(150);
    const good = await s.evaluate(() => window.__calls.slice(-2));
    check("Serwer dostępny: sprawdzenie, potem zapis adresu i uruchomienie programu", good[0][0] === "test" && good[1].join("|") === "save|server|http://192.168.1.10:8080", good);
    await s.check('input[value="demo"]'); await s.click("#go"); await s.waitForTimeout(80);
    check("Wersja demonstracyjna: zapis trybu bez adresu i bez sprawdzania serwera", (await s.evaluate(() => window.__calls.slice(-1)[0].join("|"))) === "save|demo|" && await s.isHidden("#srv-box"));
    await s.goto(SETUP + "?error=" + encodeURIComponent("Nie można połączyć z serwerem http://192.168.1.10:8080"));
    check("Błąd połączenia z aplikacji: komunikat na ekranie połączenia", /Nie można połączyć/.test(await s.textContent("#err-top")) && await s.isVisible("#err-top"));

    /* ---------------- program w aplikacji (most RIWNative) ---------------- */
    const c2 = await browser.newContext(PHONE);
    await c2.addInitScript(() => {
      try { sessionStorage.setItem("riw.today", "2026-09-23"); localStorage.setItem("riw.lang", "pl"); localStorage.setItem("riw.intro", "0"); } catch (e) {}
      window.__native = [];
      window.RIWNative = {
        saveFile: (name, mime, b64, open) => window.__native.push({ fn: "saveFile", name, mime, text: decodeURIComponent(escape(atob(b64))).slice(0, 400), open }),
        download: (url, name, open) => window.__native.push({ fn: "download", url, name, open }),
        printHtml: (html, title) => window.__native.push({ fn: "printHtml", title, n: html.length, kwit: /Kwit produkcji/.test(html) }),
        settings: () => window.__native.push({ fn: "settings" }),
        info: () => "{\"app\":\"android\",\"version\":\"3.15.0\"}"
      };
    });
    const p = await c2.newPage(); watch(p);
    await p.goto(DEMO); await p.waitForSelector("#login-form");
    await p.fill("#lg-login", "magazyn@resinvest.group"); await p.fill("#lg-pass", "demo1234"); await p.click("#lg-submit");
    await p.waitForSelector("#demo-ribbon", { timeout: 10000 });
    await p.evaluate(() => { location.hash = "#/operacje"; }); await p.waitForSelector("#o-mode");
    await p.selectOption("#o-mode", "all"); await p.waitForTimeout(150);
    check("Telefon: rejestr operacji wg okresu bez przewijania poziomego strony, nagłówki miesięcy", (await p.$$("#ops-table tr.ops-grp")).length >= 2 && await noHScroll(p));
    const popups = []; p.on("popup", x => popups.push(x));
    await p.click("#ops-csv"); await p.waitForTimeout(600);
    const csv = await p.evaluate(() => window.__native.find(x => x.fn === "saveFile"));
    check("CSV z aplikacji: zapis przez aplikację (Pobrane), poprawna treść, bez pobierania przez przeglądarkę", !!csv && /\.csv$/.test(csv.name) && /Zakup|Sprzedaż/.test(csv.text) && csv.open === false, csv && { name: csv.name, mime: csv.mime });
    await p.evaluate(() => { location.hash = "#/kwit"; }); await p.waitForSelector("[data-print]");
    await p.fill("#k-date", "2026-09-22"); await p.dispatchEvent("#k-date", "change"); await p.waitForTimeout(150);
    await p.click("[data-print]"); await p.waitForTimeout(500);
    const pr = await p.evaluate(() => window.__native.find(x => x.fn === "printHtml"));
    check("Drukowanie z aplikacji: dokument do drukarki systemowej Androida, bez nowego okna", !!pr && pr.kwit && pr.n > 1000 && popups.length === 0, pr);
    await p.click("#user-btn"); await p.waitForSelector("[data-appsrv]");
    await p.click("[data-appsrv]"); await p.waitForTimeout(100);
    check("Menu użytkownika: „Aplikacja — adres serwera” otwiera ustawienia połączenia aplikacji", (await p.evaluate(() => window.__native.some(x => x.fn === "settings"))));

    /* ---------------- zwykła przeglądarka — bez zmian ---------------- */
    const c3 = await browser.newContext(PHONE);
    await c3.addInitScript(() => { try { localStorage.setItem("riw.lang", "pl"); localStorage.setItem("riw.intro", "0"); } catch (e) {} });
    const b = await c3.newPage(); watch(b);
    await b.goto(DEMO); await b.waitForSelector("#login-form");
    await b.fill("#lg-login", "magazyn@resinvest.group"); await b.fill("#lg-pass", "demo1234"); await b.click("#lg-submit");
    await b.waitForSelector("#demo-ribbon", { timeout: 10000 });
    await b.click("#user-btn"); await b.waitForSelector("[data-logout]");
    check("Przeglądarka (bez aplikacji): menu bez pozycji aplikacji", (await b.$("[data-appsrv]")) === null);
    check("Konsola przeglądarki bez wyjątków", errors.length === 0, errors.slice(0, 5));
  } catch (e) { check("Przebieg bez wyjątku", false, e.stack || String(e)); }
  finally { await browser.close(); }
  const ok = results.filter(Boolean).length;
  console.log(`\nWYNIK: ${ok}/${results.length} ${ok === results.length ? "OK" : "BŁĘDY"}`);
  process.exit(ok === results.length ? 0 : 1);
})();
