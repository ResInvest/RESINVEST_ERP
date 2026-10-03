/* =========================================================================
   Test E2E interfejsu (Playwright + Chromium) — provider mock, izolowany katalog danych.
   Sprawdza: ZDJĘCIE → ROZPOZNANIE → DANE, pewności, podświetlenie ramek, korektę,
   brak zgadywania (null), historię, układ na telefonie (390 px) i brak błędów CSP.
   Uruchomienie: npm run test:e2e   (zrzuty ekranu: E2E_SHOTS=<katalog>)
   ========================================================================= */
"use strict";
/* global document, window -- kod w page.evaluate() wykonuje się w przeglądarce */
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

function loadPlaywright() {
  for (const id of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
    try { return require(id); } catch { /* następna ścieżka */ }
  }
  throw new Error("Brak Playwright.");
}

const ROOT = path.resolve(__dirname, "..");
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.E2E_SHOTS || null;
let passed = 0, failed = 0;
const check = (name, cond, extra) => { if (cond) { passed++; console.log("  ok  " + name); } else { failed++; console.log("  BŁĄD " + name + (extra ? " — " + extra : "")); } };

async function waitHealth() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + "/api/health"); if (r.ok) return; } catch { /* serwer startuje */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error("Serwer nie wystartował.");
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-e2e-"));
  const srv = spawn(process.execPath, [path.join(ROOT, "server", "scanner-server.mjs"), "--provider", "mock", "--port", String(PORT), "--data", dataDir], { stdio: ["ignore", "pipe", "pipe"], env: Object.assign({}, process.env, { ANTHROPIC_API_KEY: "" }) });
  let srvOut = "";
  srv.stdout.on("data", d => { srvOut += d; });
  srv.stderr.on("data", d => { srvOut += d; });
  const { chromium } = loadPlaywright();
  let browser;
  try {
    await waitHealth();
    browser = await chromium.launch().catch(() => chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", e => consoleErrors.push(String(e)));
    page.on("dialog", d => d.accept());

    console.log("Komputer 1366×900");
    await page.goto(BASE + "/");
    await page.waitForSelector("#samples button");
    check("pasek trybu testowego", (await page.textContent(".pill-test")).includes("TRYB TESTOWY"));
    check("provider mock oznaczony jako symulacja", (await page.textContent("#providerPill")).includes("symulacja"));
    check("baner wyniku symulowanego", await page.isVisible("#simBanner"));

    // 1. WZ — przykład z zadania
    await page.click("#samples button:has-text('WZ')");
    await page.waitForSelector("#resultForm:not([hidden])");
    await page.waitForFunction(() => document.querySelectorAll("#overlay .bbox").length > 0);
    check("typ dokumentu WZ", (await page.inputValue("#docType")) === "WZ");
    check("pewność typu 98%", (await page.textContent("#docTypeConf")).includes("98%"));
    const val = k => page.inputValue("#f_" + k);
    const conf = k => page.textContent(`.frow[data-key="${k}"] .conf .val`);
    check("numer 458/10/2026 · 99%", (await val("docNumber")) === "458/10/2026" && (await conf("docNumber")) === "99%");
    check("data 03.10.2026", (await val("docDate")) === "03.10.2026");
    check("odbiorca XYZ Sp. z o.o. · 96%", (await val("recipient")) === "XYZ Sp. z o.o." && (await conf("recipient")) === "96%");
    check("towar Zrębka drzewna · 97%", (await val("product")) === "Zrębka drzewna" && (await conf("product")) === "97%");
    check("ilość 68,40 MP · 99%", (await val("quantity")) === "68,40 MP" && (await conf("quantity")) === "99%");
    check("samochód WI12345 · 91%", (await val("vehicleReg")) === "WI12345" && (await conf("vehicleReg")) === "91%");
    check("naczepa W12345 · 86%", (await val("trailerReg")) === "W12345" && (await conf("trailerReg")) === "86%");
    check("kierowca Jan Kowalski · 78% (niska pewność)", (await val("driver")) === "Jan Kowalski" && (await conf("driver")) === "78%" && await page.isVisible('.frow[data-key="driver"] .conf.mid'));
    check("dopasowanie do kartoteki ERP (kierowca)", (await page.textContent('.frow[data-key="driver"] .meta')).includes("Kartoteka ERP: Jan Kowalski"));
    check("zdjęcie obok danych", await page.isVisible("#docImage") && (await page.evaluate(() => /** @type {HTMLImageElement} */ (document.getElementById("docImage")).naturalWidth)) === 1240);
    check("ramki dla 9 pól", (await page.locator("#overlay .bbox").count()) === 9);

    await page.hover('.frow[data-key="quantity"]');
    check("najechanie na pole podświetla fragment zdjęcia", await page.isVisible('#overlay .bbox.active[data-key="quantity"]'));
    const box = await page.locator('#overlay .bbox[data-key="quantity"]').boundingBox();
    const img = await page.locator("#docImage").boundingBox();
    check("ramka ilości w prawej części tabeli", !!box && !!img && box.x > img.x + img.width * 0.6 && box.y > img.y + img.height * 0.2 && box.y < img.y + img.height * 0.35);
    await page.click('#overlay .bbox[data-key="docNumber"]', { force: true });
    check("kliknięcie ramki przenosi do pola", (await page.evaluate(() => document.activeElement && document.activeElement.id)) === "f_docNumber");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "e2e-desktop-wz.png"), fullPage: true });

    // 2. korekta ręczna
    check("zapis nieaktywny bez zmian", await page.isDisabled("#btnSave"));
    await page.fill("#f_trailerReg", "WI 1234P");
    await page.fill("#reviewer", "Tester E2E");
    check("zapis aktywny po zmianie", await page.isEnabled("#btnSave"));
    await page.click("#btnSave");
    await page.waitForFunction(() => (document.getElementById("scanMeta")?.textContent || "").includes("rew. 2"));
    check("korekta zapisana (rewizja 2)", true);
    check("pole oznaczone „ręcznie”, pewność 100%", (await page.textContent('.frow[data-key="trailerReg"] .meta')).includes("ręcznie") && (await conf("trailerReg")) === "100%");
    check("historia korekt: było W12345 → jest WI 1234P", (await page.textContent("#corrTable tbody")).includes("W12345") && (await page.textContent("#corrTable tbody")).includes("WI 1234P"));
    check("historia testów zawiera wynik", (await page.textContent("#histTable tbody")).includes("458/10/2026"));

    // 3. kwit uszkodzony — brak zgadywania
    await page.click("#samples button:has-text('Kwit wagowy (uszkodzony)')");
    await page.waitForFunction(() => /** @type {HTMLSelectElement} */ (document.getElementById("docType")).value === "KWIT_WAGOWY" && !!document.getElementById("f_netWeight"));
    check("netto nieczytelne → null (puste pole)", (await val("netWeight")) === "" && (await page.getAttribute("#f_netWeight", "placeholder")).includes("null"));
    check("pewność pola null pokazana jako —", (await conf("netWeight")) === "—");
    check("podpowiedź brutto \u2212 tara bez wpisywania", (await page.textContent("#alerts")).includes("NIE została wpisana"));
    check("nieczytelna godzina z ostrzeżeniem", (await page.textContent('.frow[data-key="time"] .meta')).includes("godziny"));

    // 4. własne zdjęcie — mock nie udaje OCR
    const own = await page.screenshot({ type: "jpeg", quality: 80 });
    const ownFile = path.join(dataDir, "wlasne.jpg");
    fs.writeFileSync(ownFile, own);
    await page.setInputFiles("#fileInput", ownFile);
    await page.waitForFunction(() => /** @type {HTMLSelectElement} */ (document.getElementById("docType")).value === "NIEZNANY");
    check("nieznane zdjęcie → NIEZNANY, wszystkie pola null", (await page.locator(".frow input:not(.is-null)").count()) === 0);
    check("komunikat: mock nie wykonuje OCR", (await page.textContent("#providerNotes")).includes("nie wykonuje OCR"));

    // 5. telefon
    console.log("Telefon 390×844");
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const m = await mctx.newPage();
    m.on("pageerror", e => consoleErrors.push(String(e)));
    await m.goto(BASE + "/");
    await m.waitForSelector("#samples button");
    await m.click("#samples button:has-text('Kwit wywozowy')");
    await m.waitForSelector("#resultForm:not([hidden])");
    await m.waitForFunction(() => /** @type {HTMLSelectElement} */ (document.getElementById("docType")).value === "KWIT_WYWOZOWY");
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("brak poziomego przewijania (390 px)", overflow <= 0, "nadmiar " + overflow + " px");
    check("kartoteka ERP: nadleśnictwo dopasowane", (await m.textContent('.frow[data-key="forestDistrict"] .meta')).includes("Nadleśnictwo Rudy Raciborskie"));
    const camAccept = await m.getAttribute("#cameraInput", "capture");
    check("przycisk aparatu (capture=environment)", camAccept === "environment");
    const btnH = await m.locator("#btnSave").boundingBox();
    check("przyciski wygodne do dotyku (≥ 40 px)", !!btnH && btnH.height >= 40);
    if (SHOTS) await m.screenshot({ path: path.join(SHOTS, "e2e-mobile-kwit.png"), fullPage: true });

    check("brak błędów JS / CSP w konsoli", consoleErrors.length === 0, consoleErrors.join(" | "));
    const files = fs.readdirSync(path.join(dataDir, "scans"));
    check("wyniki zapisane wyłącznie w katalogu testowym", files.length > 0 && files.every(f => /^scan_/.test(f)));
  } catch (e) {
    failed++;
    console.error("E2E przerwany:", e);
    console.error(srvOut);
  } finally {
    if (browser) await browser.close();
    srv.kill();
  }
  console.log(`\nE2E: ${passed} ok, ${failed} błędów`);
  process.exit(failed ? 1 : 0);
})();
