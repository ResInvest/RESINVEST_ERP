/* Test w przeglądarce (Chromium, Playwright): zbudowany plik demo otwarty z dysku (file://), jak u użytkownika.
   Sprawdza: start z danymi przykładowymi, logowanie, pulpit „Obrót miesiąca”, okna szczegółów, rozwijanie lasów,
   zakładkę EUDR (rejestr, zapis numeru, import), uprawnienia (obserwator), układ na telefonie, brak błędów konsoli.
   Uruchomienie: node tests/e2e.cjs  (zrzuty ekranu: tests/out/) */
"use strict";
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const assert = require("assert");

const FILE = "file://" + path.join(__dirname, "..", "dist", "ResInvest_ERP_3.12.0_EUDR_DEMO.html");
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
let step = 0;
const ok = msg => console.log(`  ✓ ${++step}. ${msg}`);

async function session(browser, opts, login) {
  const ctx = await browser.newContext(Object.assign({ locale: "pl-PL", timezoneId: "Europe/Warsaw" }, opts));
  // stała data systemowa demo (sessionStorage riw.today) — wynik testu nie zależy od dnia uruchomienia; bez filmu intro
  await ctx.addInitScript(() => { try { localStorage.setItem("riw.intro", "0"); sessionStorage.setItem("riw.today", "2026-10-28"); } catch (e) {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/favicon|ERR_FILE_NOT_FOUND|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  await page.goto(FILE);
  await page.waitForSelector("#lg-login", { timeout: 30000 });
  await page.fill("#lg-login", login);
  await page.fill('input[type="password"]', "demo1234");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#obr", { timeout: 30000 });
  return { ctx, page, errors };
}

(async () => {
  const browser = await chromium.launch();
  try {
    /* ---------------- komputer: kierownik ---------------- */
    const { ctx, page, errors } = await session(browser, { viewport: { width: 1440, height: 1000 } }, "anna.gorska@resinvest.group");
    ok("logowanie kierownika, pulpit z sekcją „Obrót miesiąca”");
    const firmsTxt = await page.textContent("#obr-firms");
    assert.match(firmsTxt, /Zakupy od firm/); assert.match(firmsTxt, /MP/); assert.match(firmsTxt, /m³/);
    const salesTxt = await page.textContent("#obr-sales");
    assert.match(salesTxt, /Sprzedaż/); assert.match(salesTxt, /Elektrociepłownia Zabrze|Elektrownia Łaziska|EC Katowice/);
    ok("karty zakupów od firm i sprzedaży: sumy MP / m³ / t i najwięksi kontrahenci");
    await page.screenshot({ path: path.join(OUT, "01-pulpit.png"), fullPage: true });

    // las: rozwinięcie całości → widać leśnictwa i transakcje
    const closed = await page.$$eval("#obr-forest-groups details[open]", l => l.length);
    assert.strictEqual(closed, 0);
    await page.click('[data-obr-expand="1"]');
    const opened = await page.$$eval("#obr-forest-groups details[open]", l => l.length);
    assert.ok(opened >= 6, "rozwinięte nadleśnictwa i leśnictwa: " + opened);
    const forestTxt = await page.textContent("#obr-forest");
    for (const n of ["Nadleśnictwo Rudy Raciborskie", "Stanica", "Kuźnia", "Nadleśnictwo Brynek", "Świerklaniec"]) assert.ok(forestTxt.includes(n), n);
    ok(`tabela lasów: nadleśnictwo → leśnictwo → transakcje, „Rozwiń całość” (${opened} sekcji)`);
    await page.screenshot({ path: path.join(OUT, "02-lasy-rozwiniete.png"), fullPage: true });

    // rejestr ilości miesięcy
    const regRows = await page.$$eval("#obr-register tbody tr", l => l.length);
    assert.strictEqual(regRows, 6);
    ok("rejestr ilości — 6 miesięcy (MP · m³ · t)");

    // karta sprzedaży → pełny widok z odbiorcami i transakcjami
    await page.click("#obr-sales");
    await page.waitForSelector("#obr-detail");
    await page.click('#obr-detail [data-d-open="1"]');
    const saleRows = await page.$$eval("#obr-detail .obr-tx tbody tr", l => l.length);
    assert.ok(saleRows >= 6, "transakcje sprzedaży: " + saleRows);
    const dlgTxt = await page.textContent("#obr-detail");
    assert.match(dlgTxt, /Miejsce dostawy/); assert.match(dlgTxt, /⚖/);
    await page.screenshot({ path: path.join(OUT, "03-sprzedaz-szczegoly.png") });
    // wyszukiwanie zawęża listę
    await page.fill("#obr-q", "Łaziska");
    const filtered = await page.$$eval("#obr-detail .obr-tx tbody tr", l => l.length);
    assert.ok(filtered >= 1 && filtered < saleRows, `filtr: ${filtered} z ${saleRows}`);
    ok(`okno sprzedaży: ${saleRows} transakcji z miejscem dostawy i wagą, wyszukiwanie (${filtered})`);
    // eksport CSV
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#obr-detail [data-d-csv]")]);
    const csv = fs.readFileSync(await dl.path(), "utf8");
    assert.match(csv, /^﻿Data;Nr dokumentu;Odbiorca/); assert.match(csv, /Łaziska/);
    ok("eksport CSV z okna szczegółów");
    await page.click("#obr-detail [data-ok]");

    // zakupy od firm — poprzedni miesiąc strzałką
    await page.click('[data-obr-shift="-1"]');
    await page.waitForFunction(() => document.querySelector("#obr-ym").value === "2026-09");
    await page.click("#obr-firms");
    await page.waitForSelector("#obr-detail");
    assert.match(await page.textContent("#obr-detail"), /wrzesień 2026/);
    await page.click("#obr-detail [data-ok]");
    ok("zmiana miesiąca (wrzesień) i okno zakupów od firm");

    /* ---------------- EUDR ---------------- */
    await page.goto(FILE + "#/eudr");
    await page.waitForSelector(".eudr-hero");
    assert.match(await page.textContent(".eudr-hero"), /30\.12\.2026/);
    ok("zakładka EUDR: przegląd z datą stosowania 30.12.2026 i gotowością");
    await page.screenshot({ path: path.join(OUT, "04-eudr-przeglad.png"), fullPage: true });

    await page.click('[data-eu-tab="rejestr"]');
    await page.waitForSelector("#eu-reg");
    await page.selectOption("#eu-status", "BRAKI");
    await page.waitForSelector("#eu-reg");
    const missing = await page.$$eval("#eu-reg tbody tr", l => l.map(r => r.textContent));
    const kk = missing.findIndex(t => /Kędzierzyn/.test(t));
    assert.ok(kk >= 0, "zakup z Nadl. Kędzierzyn bez numeru jest w brakach");
    await page.screenshot({ path: path.join(OUT, "05-eudr-rejestr-braki.png"), fullPage: true });
    await page.click(`#eu-reg tbody tr:nth-child(${kk + 1})`);
    await page.waitForSelector("#eu-rec");
    await page.fill('#eu-refs .eu-ref [data-k="ref"]', "26PLKK00001234");
    await page.fill('#eu-refs .eu-ref [data-k="ver"]', "KX4P2M7Q");
    await page.click("#eu-rec [data-save]");
    await page.waitForSelector("#eu-rec", { state: "detached" });
    const after = await page.$$eval("#eu-reg tbody tr", l => l.map(r => r.textContent).filter(t => /Kędzierzyn/.test(t)).length);
    assert.strictEqual(after, 0, "po wpisaniu numeru zakup znika z braków");
    ok("rejestr: filtr „Braki”, wpisanie numeru DDS dla Nadl. Kędzierzyn — status zmieniony");

    // błędny numer — walidacja silnika, nic nie zapisano
    await page.selectOption("#eu-status", "");
    await page.waitForSelector("#eu-reg");
    await page.click("#eu-reg tbody tr:first-child");
    await page.waitForSelector("#eu-rec");
    if (await page.$("#eu-ref-add")) {
      await page.click("#eu-ref-add");
      await page.fill('#eu-refs .eu-ref:last-child [data-k="ref"]', "ZŁY NR!");
      await page.click("#eu-rec [data-save]");
      await page.waitForSelector(".toast", { timeout: 5000 });
      assert.ok(await page.$("#eu-rec"), "okno zostaje otwarte po błędzie");
      ok("walidacja: niepoprawny numer odrzucony, okno pozostaje otwarte");
      await page.keyboard.press("Escape");
    }

    // sprzedaż: numery do przekazania odbiorcy
    await page.selectOption("#eu-side", "OUT");
    await page.waitForSelector("#eu-reg");
    await page.click("#eu-reg tbody tr:first-child");
    await page.waitForSelector("#eu-rec");
    assert.match(await page.textContent("#eu-rec"), /Numery do przekazania odbiorcy/);
    await page.screenshot({ path: path.join(OUT, "06-eudr-sprzedaz-numery.png") });
    await page.keyboard.press("Escape");
    ok("sprzedaż: numery referencyjne z puli magazynu dla odbiorcy");

    // import numerów (CSV wklejony)
    await page.selectOption("#eu-side", "");
    await page.click("#eu-import");
    await page.fill("#eu-imp-t", "Nr dokumentu;Numer referencyjny;Numer weryfikacyjny\nWZ/008/10/2026;26PLEKOLAS00077;EK7Q2P1M\nNIEISTNIEJE/1;26PLXX00000000;");
    await page.click("#eu-imp [data-go]");
    await page.waitForSelector("#eu-imp-msg .info-line");
    assert.match(await page.textContent("#eu-imp-msg"), /NIEISTNIEJE\/1/);
    await page.keyboard.press("Escape");
    ok("import numerów: dopasowanie po nr dokumentu, raport niedopasowanych");

    // pozostałe zakładki renderują się bez błędu
    for (const tab of ["dostawcy", "dzialki", "raporty", "ustawienia", "plan"]) {
      await page.click(`[data-eu-tab="${tab}"]`);
      await page.waitForSelector(".eudr .card");
      assert.ok(!(await page.$("#page .info-line.err")), "błąd widoku: " + tab);
    }
    await page.screenshot({ path: path.join(OUT, "07-eudr-plan.png"), fullPage: true });
    ok("zakładki: dostawcy, działki, raporty, ustawienia, plan wdrożenia");

    // regresja: ekrany programu 3.11 działają jak wcześniej (pulpit bazowy pod nową sekcją, inne widoki)
    await page.goto(FILE + "#/pulpit");
    await page.waitForSelector("#obr");
    for (const id of ["#dash-hero", "#kpis", "#dash-trend", "#dash-turnover", "#dash-stock-card", "#last-ops"]) assert.ok(await page.$(id), "pulpit 3.11: " + id);
    for (const route of ["operacje", "nowa", "stany", "raporty", "historia", "planer", "dokumenty", "kontrahenci", "role"]) {
      await page.goto(FILE + "#/" + route);
      await page.waitForTimeout(250);
      assert.ok(!(await page.$("#page > .info-line.err")), "błąd widoku: " + route);
    }
    assert.match(await page.textContent("#page"), /EUDR/);                 // „Role i uprawnienia” pokazują nowe uprawnienia
    ok("regresja 3.11: pulpit bazowy i 9 innych ekranów bez błędów; nowe uprawnienia EUDR w rolach");

    // audyt: wpisy EUDR
    await page.goto(FILE + "#/audyt");
    await page.waitForTimeout(400);
    assert.match(await page.textContent("#page"), /EUDR/);
    ok("dziennik audytu zawiera zmiany EUDR");
    assert.deepStrictEqual(errors, [], "błędy konsoli: " + errors.join(" | "));
    ok("brak błędów JavaScript w konsoli (komputer)");
    await ctx.close();

    /* ---------------- obserwator: tylko odczyt ---------------- */
    const v = await session(browser, { viewport: { width: 1280, height: 900 } }, "beata.nowak@resinvest.group");
    await v.page.goto(FILE + "#/eudr");
    await v.page.click('[data-eu-tab="rejestr"]');
    await v.page.waitForSelector("#eu-reg");
    assert.ok(!(await v.page.$("#eu-import")), "obserwator nie ma importu");
    await v.page.click("#eu-reg tbody tr:first-child");
    await v.page.waitForSelector("#eu-rec");
    assert.ok(!(await v.page.$("#eu-rec [data-save]")), "obserwator nie ma zapisu");
    ok("obserwator: rejestr EUDR tylko do odczytu");
    await v.ctx.close();

    /* ---------------- telefon ---------------- */
    const m = await session(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, "adrian.wojciechowski@resinvest.group");
    const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, "przewijanie poziome strony na telefonie: " + overflow + " px");
    await m.page.locator("#obr").screenshot({ path: path.join(OUT, "08-telefon-obrot.png") });
    await m.page.click("#obr-firms");
    await m.page.waitForSelector("#obr-detail");
    await m.page.screenshot({ path: path.join(OUT, "09-telefon-szczegoly.png") });
    await m.page.keyboard.press("Escape");
    await m.page.goto(FILE + "#/eudr");
    await m.page.waitForSelector(".eudr-hero");
    const overflow2 = await m.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow2 <= 1, "EUDR — przewijanie poziome: " + overflow2 + " px");
    await m.page.screenshot({ path: path.join(OUT, "10-telefon-eudr.png"), fullPage: true });
    assert.deepStrictEqual(m.errors, [], "błędy konsoli (telefon): " + m.errors.join(" | "));
    ok("telefon 390 px: pulpit, okno szczegółów i EUDR bez przewijania poziomego i bez błędów");
    await m.ctx.close();
    console.log(`\nE2E: ${step} kroków zaliczonych.`);
  } catch (e) {
    console.error("\nE2E NIEUDANY:", e.message);
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
