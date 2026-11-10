/* Testy E2E wersji demonstracyjnej ResInvest ERP 3.15 (ResInvest_ERP_Demo.html, Chromium):
   dane przykładowe i konta demonstracyjne, pasek „Wersja demonstracyjna” i lista „Co sprawdzić”, sprzedaż (WZ) z formularza,
   PDF dokumentu WZ, skan dokumentu w bazie przeglądarki, zmiana motywu, edytor stanów początkowych w trybie lokalnym,
   rozdzielność danych: wersja demo nie czyta ani nie zmienia danych trybu lokalnego (ResInvest_ERP.html) w tej samej przeglądarce.
   Wymaga zbudowania:  node tools/build.mjs --edition demo
   Uruchomienie z katalogu resinvest-erp:  node tests/e2e315demo.cjs   (zrzuty: SHOTS=<katalog>) */
"use strict";
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const DEMO = "file://" + path.join(ROOT, "ResInvest_ERP_Demo.html");
const SHOTS = process.env.SHOTS || "";
const results = [], errors = [];
const check = (name, cond, detail) => { results.push(!!cond); console.log(`${cond ? "✔" : "✘"} ${name}${!cond && detail !== undefined ? "  → " + JSON.stringify(detail) : ""}`); };
const shot = (page, name) => SHOTS ? page.screenshot({ path: path.join(SHOTS, name + ".png") }) : null;
const nb = s => String(s || "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const combo = (page, sel, v) => page.evaluate(([s, v]) => RIW_DEBUG.combo(s, v), [sel, v]);
const fillTab = async (page, sel, v) => { await page.fill(sel, v); await page.press(sel, "Tab"); await page.waitForTimeout(80); };
const JPG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1]), Buffer.alloc(3000, 9), Buffer.from([0xFF, 0xD9])]);
const watch = page => { page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); }); };

(async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pl-PL", acceptDownloads: true });
    // dane „prawdziwego” trybu lokalnego w tej samej przeglądarce (ten sam origin file://) — wersja demo nie może ich ruszyć
    await ctx.addInitScript(() => { try {
      sessionStorage.setItem("riw.today", "2026-09-23"); localStorage.setItem("riw.lang", "pl"); localStorage.setItem("riw.intro", "0");
      if (!localStorage.getItem("riw.v3.state")) localStorage.setItem("riw.v3.state", "ZNACZNIK-DANYCH-LOKALNYCH");
    } catch (e) {} });
    const page = await ctx.newPage(); watch(page);
    await page.goto(DEMO); await page.waitForSelector("#login-form");
    check("Ekran logowania: konta demonstracyjne", (await page.$$("#demo-users [data-demo]")).length >= 5);
    await page.fill("#lg-login", "magazyn@resinvest.group"); await page.fill("#lg-pass", "demo1234"); await page.click("#lg-submit");
    await page.waitForSelector("#nav .nav-item", { timeout: 10000 });
    check("Pasek „Wersja demonstracyjna”", nb(await page.textContent("#demo-ribbon")).includes("Wersja demonstracyjna"));
    const s0 = await page.evaluate(() => ({ ops: RIW_DEBUG.store.state.operations.length, whs: RIW_DEBUG.store.state.warehouses.map(w => w.name), sample: !!RIW_DEBUG.store.state.meta.sample }));
    check("Dane przykładowe: operacje i magazyny RiC Zabrze, RiC Brąszewice, RiC Rokitki", s0.ops >= 10 && s0.sample && s0.whs.join("|") === "RiC Zabrze|RiC Brąszewice|RiC Rokitki", s0);
    const keys = await page.evaluate(() => Object.keys(localStorage));
    check("Osobna przestrzeń danych: riw.demo315.v3.state, dane trybu lokalnego nietknięte",
      keys.includes("riw.demo315.v3.state") && keys.includes("riw.demo315.v3.auth") && (await page.evaluate(() => localStorage.getItem("riw.v3.state"))) === "ZNACZNIK-DANYCH-LOKALNYCH", keys);
    await page.click("#demo-guide"); await page.waitForSelector("#demo-guide-dialog .demo-list");
    check("„Co sprawdzić”: lista z odnośnikami (WZ, skany, motywy, stany początkowe)", (await page.$$("#demo-guide-dialog .demo-list a")).length >= 10 && (await page.$('#demo-guide-dialog a[href="#/stanypoczatkowe"]')) !== null);
    await shot(page, "demo-01-co-sprawdzic");
    await page.click('#demo-guide-dialog a[href="#/nowa?preset=wz"]');
    // sprzedaż z magazynu (WZ)
    await page.waitForSelector("#opf");
    await combo(page, "#f-sale-productId", "pr_zr_lesna"); await page.waitForTimeout(150);
    await fillTab(page, "#f-sale-qty", "40"); await fillTab(page, "#f-sale-price", "85");
    await combo(page, "#f-sale-buyerId", "pa_ec_zab"); await page.waitForTimeout(150);
    const n0 = await page.evaluate(() => RIW_DEBUG.store.state.operations.length);
    await page.click("#summary [data-save]"); await page.waitForSelector("#confirm-op", { timeout: 5000 }); await page.click("#confirm-yes");
    await page.waitForFunction(n => RIW_DEBUG.store.state.operations.length > n, n0, { timeout: 8000 });
    const op = await page.evaluate(() => { const s = RIW_DEBUG.store.state; const o = s.operations[s.operations.length - 1]; return { id: o.id, no: o.no, type: o.type, docs: (o.documents || []).map(d => d.type) }; });
    check("WZ zapisana przez silnik (numer dokumentu, typ SPRZEDAŻ)", op.type === "SPRZEDAZ" && /^WZ\/\d{3}\/\d{2}\/2026$/.test(op.no), op);
    // PDF dokumentu
    await page.waitForSelector("#op-detail [data-doc]", { timeout: 8000 });
    await page.click("#op-detail [data-doc]"); await page.waitForSelector("#doc-preview [data-pdf]");
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }).catch(() => null), page.click("#doc-preview [data-pdf]")]);
    const pdf = await page.evaluate(() => RIW_DEBUG.lastPdf && { name: RIW_DEBUG.lastPdf.name, size: RIW_DEBUG.lastPdf.size });
    check("PDF dokumentu WZ wygenerowany i pobrany", !!dl && pdf && pdf.size > 2000 && /\.pdf$/.test(pdf.name), pdf);
    await page.keyboard.press("Escape"); await page.waitForTimeout(200);
    // skan dokumentu w bazie przeglądarki (osobna baza wersji demo)
    await page.evaluate(id => OpDetail.open(id), op.id); await page.waitForSelector("#op-scans #scan-file");
    await page.setInputFiles("#scan-file", { name: "wz-podpisana.jpg", mimeType: "image/jpeg", buffer: JPG });
    await page.waitForFunction(() => document.querySelectorAll("#op-scans .scan-item").length === 1, null, { timeout: 8000 }).catch(() => {});
    const dbs = await page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map(d => d.name) : []));
    check("Skan dokumentu zapisany w bazie przeglądarki wersji demo (riw-demo-scans)", (await page.$$("#op-scans .scan-item")).length === 1 && dbs.includes("riw-demo-scans") && !dbs.includes("riw-scans"), dbs);
    await shot(page, "demo-02-skan");
    // zamknięcie wszystkich okien (szczegóły operacji, podgląd dokumentu)
    for (let i = 0; i < 4 && await page.$(".scrim"); i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(150); }
    // motyw
    await page.evaluate(() => { location.hash = "#/wyglad"; }); await page.waitForSelector(".theme-row, [data-theme-id], input[name='theme']");
    const before = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    const tid = before === "graphite" ? "pearl" : "graphite";
    await page.evaluate(id => RIWUI.Prefs.applyTheme(id), tid);
    check("Zmiana motywu działa (podgląd)", (await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === tid, { before, tid });
    // edytor stanów początkowych w trybie lokalnym
    await page.evaluate(() => { location.hash = "#/stanypoczatkowe"; }); await page.waitForSelector("#op-table");
    await page.selectOption("#op-wh", "wh_rok"); await page.waitForSelector('[data-oin="pr_zr_tow"]');
    await page.fill("#op-date", "2026-09-01"); await page.dispatchEvent("#op-date", "change");
    await page.fill('[data-oin="pr_zr_tow"]', "75,5");
    await page.click("#op-save"); await page.click(".modal [data-yes]");
    await page.waitForFunction(() => document.querySelector("#op-docs") !== null, null, { timeout: 8000 });
    const rok = await page.evaluate(() => RIW.Stock.balance(RIW_DEBUG.store.state, "wh_rok", "pr_zr_tow"));
    check("Edytor stanów początkowych w wersji demo: RiC Rokitki zrębka towar 75,5 MP", rok === 75.5, rok);
    // po przeładowaniu dane demo zostają, dane trybu lokalnego nadal nietknięte
    await page.reload(); await page.waitForSelector("#nav .nav-item, #login-form", { timeout: 10000 });
    check("Dane wersji demo zachowane po przeładowaniu; dane trybu lokalnego bez zmian",
      (await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("riw.demo315.v3.state")); return s.operations.length; })) === n0 + 1
      && (await page.evaluate(() => localStorage.getItem("riw.v3.state"))) === "ZNACZNIK-DANYCH-LOKALNYCH");
    // telefon
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "pl-PL" });
    await ctx2.addInitScript(() => { try { localStorage.setItem("riw.lang", "pl"); localStorage.setItem("riw.intro", "0"); } catch (e) {} });
    const p2 = await ctx2.newPage(); watch(p2);
    await p2.goto(DEMO); await p2.waitForSelector("#login-form");
    await p2.fill("#lg-login", "magazyn@resinvest.group"); await p2.fill("#lg-pass", "demo1234"); await p2.click("#lg-submit");
    await p2.waitForSelector("#demo-ribbon", { timeout: 10000 });
    check("Telefon 390 px: pasek demo bez przewijania poziomego", await p2.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await shot(p2, "demo-03-telefon");
    check("Konsola przeglądarki bez wyjątków", errors.length === 0, errors.slice(0, 5));
  } catch (e) { check("Przebieg bez wyjątku", false, e.stack || String(e)); }
  finally { await browser.close(); }
  const ok = results.filter(Boolean).length;
  console.log(`\nWYNIK: ${ok}/${results.length} ${ok === results.length ? "OK" : "BŁĘDY"}`);
  process.exit(ok === results.length ? 0 : 1);
})();
