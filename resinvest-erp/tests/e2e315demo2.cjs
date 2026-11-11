/* Testy E2E wersji demonstracyjnej 2 (ResInvest_ERP_Demo2.html, Chromium):
   * ekran startowy z grafik: aktywne przyciski na grafice („Zaloguj się”, „Utwórz konto”, „Poznaj możliwości”),
     formularz logowania i rejestracji programu w oknie, druga grafika po przewinięciu, telefon bez przewijania w bok,
   * pulpit: plac składowy (zdjęcie placu + oznaczenia), liczby zgodne z silnikiem (R.Yard.stats),
     edycja układu: przeciągnięcie narożnika, ilość pod załadunek, zapis (audyt), przywrócenie układu domyślnego,
   * osobne dane przeglądarki (riw.demo2.*) — wersja demo 1 i tryb lokalny nietknięte.
   Wymaga:  node tools/build.mjs --edition demo2        Uruchomienie:  node tests/e2e315demo2.cjs */
"use strict";
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const URL = "file://" + path.join(ROOT, "ResInvest_ERP_Demo2.html");
const results = [], errors = [];
const check = (name, cond, detail) => { results.push(!!cond); console.log(`${cond ? "✔" : "✘"} ${name}${!cond && detail !== undefined ? "  → " + JSON.stringify(detail) : ""}`); };
const watch = page => { page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); }); };
const init = () => { try { sessionStorage.setItem("riw.today", "2026-09-23"); localStorage.setItem("riw.demo2.lang", "pl"); localStorage.setItem("riw.demo2.intro", "0");
  if (!localStorage.getItem("riw.demo315.v3.state")) localStorage.setItem("riw.demo315.v3.state", "ZNACZNIK-DEMO-1"); } catch (e) {} };

(async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pl-PL" });
    await ctx.addInitScript(init);
    const page = await ctx.newPage(); watch(page);
    await page.goto(URL); await page.waitForSelector("#landing", { timeout: 20000 });
    const imgs = await page.evaluate(() => [...document.querySelectorAll("#landing img")].map(i => ({ ok: i.complete && i.naturalWidth > 1000, w: i.naturalWidth })));
    check("Ekran startowy: tylko grafika logowania (osadzona w programie)", imgs.length === 1 && imgs.every(i => i.ok), imgs);
    check("Formularz logowania ukryty do kliknięcia przycisku na grafice", !(await page.isVisible("#lg-login")));
    await page.click('.land-hero .land-hs[aria-label="Zaloguj się"] >> nth=1'); await page.waitForTimeout(150);
    check("„Zaloguj się” na grafice → formularz logowania programu w oknie", await page.isVisible("#land-pop.on #login-form") && await page.evaluate(() => document.activeElement && document.activeElement.id === "lg-login"));
    await page.keyboard.press("Escape"); await page.waitForTimeout(100);
    check("Esc zamyka okno logowania", !(await page.isVisible("#lg-login")));
    await page.click('.land-hero .land-hs[aria-label="Utwórz konto"]'); await page.waitForSelector("#reg-form", { timeout: 5000 });
    check("„Utwórz konto” na grafice → formularz rejestracji", await page.isVisible("#land-pop.on #reg-form") && await page.isVisible("#rg-name"));
    await page.click("#land-x"); await page.waitForTimeout(100);
    await page.click('.land-hero .land-hs[aria-label="Poznaj możliwości ResInvest ERP"]'); await page.waitForSelector("#land-info:not(.hidden)");
    check("„Poznaj możliwości” → okienko z opisem systemu", await page.isVisible("#land-pop.on #land-info"));
    await page.click('#land-info [data-land="login"]'); await page.waitForSelector("#land-pop.on #login-form");
    await page.fill("#lg-login", "magazyn@resinvest.group"); await page.fill("#lg-pass", "demo1234"); await page.click("#lg-submit");
    await page.waitForSelector("#yard-card", { timeout: 20000 });
    check("Logowanie z ekranu startowego → pulpit z pasku wersji demonstracyjnej", await page.isVisible("#demo-ribbon"));
    // plac składowy
    const ui = await page.evaluate(() => ({ stock: document.querySelector("#yard-stock").textContent, res: document.querySelector("#yard-reserved").textContent, rem: document.querySelector("#yard-remaining").textContent,
      st: RIW.Yard.stats(RIW_DEBUG.store.state), img: document.querySelector("#yard-stage img").naturalWidth, poly: document.querySelectorAll("#yard-svg .y-train, #yard-svg .y-front, #yard-svg .y-pin").length }));
    const n = s => Number(String(s).replace(/[^\d,]/g, "").replace(",", "."));
    check("Plac: zdjęcie placu z oznaczeniami (pryzma pod pociąg, czoło pryzmy, P1–P5)", ui.img === 1600 && ui.poly === 7, ui);
    check("Plac: liczby z księgi (zrębka na placu, pod załadunek, pozostało) zgodne z silnikiem", n(ui.stock) === ui.st.stock && n(ui.res) === ui.st.reserved && n(ui.rem) === ui.st.remaining && ui.st.stock > 0, ui);
    await page.uncheck("#yard-marks"); const hid = await page.isHidden("#yard-svg"); await page.check("#yard-marks");
    check("Przełącznik „Oznaczenia” ukrywa i pokazuje warstwę na zdjęciu", hid && await page.isVisible("#yard-svg"));
    // edycja: przeciągnięcie narożnika i ilość pod załadunek
    await page.click("#yard-edit"); await page.waitForSelector("#yard-form");
    const h = await page.$('#yard-svg .y-h[data-k="train"][data-i="0"]'); await h.scrollIntoViewIfNeeded(); const bb = await h.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.move(bb.x + bb.width / 2 + 40, bb.y + bb.height / 2 + 20, { steps: 5 }); await page.mouse.up();
    await page.fill("#yd-res", "1500"); await page.dispatchEvent("#yd-res", "input");
    await page.click("#yd-save"); await page.waitForSelector("#yard-edit", { timeout: 5000 });
    const saved = await page.evaluate(() => ({ y: RIW_DEBUG.store.state.config.yard, st: RIW.Yard.stats(RIW_DEBUG.store.state), a: RIW_DEBUG.store.state.audit.slice(-1)[0], res: document.querySelector("#yard-reserved").textContent }));
    check("Edycja układu: przesunięty narożnik i 1 500 MP pod załadunek zapisane (audyt)", saved.y && saved.y.train[0][0] > 255 && saved.y.reservedMP === 1500 && saved.st.reserved === 1500 && saved.a.entityId === "yard" && n(saved.res) === 1500, { t: saved.y && saved.y.train[0], r: saved.st.reserved });
    // przeładowanie: dane z localStorage; sesja (sessionStorage) w pliku lokalnym bywa czyszczona przez Chromium — wtedy ponowne logowanie
    await page.reload(); await page.waitForFunction(() => !!document.querySelector("#yard-card, #landing"), null, { timeout: 20000 });
    if (await page.$("#landing")) { await page.click('.land-hero .land-hs[aria-label="Zaloguj się"] >> nth=1'); await page.fill("#lg-login", "magazyn@resinvest.group"); await page.fill("#lg-pass", "demo1234"); await page.click("#lg-submit"); }
    await page.waitForFunction(() => !!document.querySelector("#yard-card") && !!(window.RIW_DEBUG && RIW_DEBUG.store && RIW_DEBUG.store.state), null, { timeout: 20000 });
    check("Układ placu zachowany po przeładowaniu", await page.evaluate(() => !!(RIW_DEBUG.store.state.config.yard && RIW_DEBUG.store.state.config.yard.reservedMP === 1500)));
    await page.click("#yard-edit"); await page.click("#yd-reset"); await page.click(".modal [data-yes]"); await page.waitForSelector("#yard-edit", { timeout: 5000 });
    check("Przywrócenie układu domyślnego", await page.evaluate(() => RIW_DEBUG.store.state.config.yard === undefined));
    check("Osobne dane przeglądarki: riw.demo2.v3.state, dane wersji demo 1 nietknięte",
      await page.evaluate(() => !!localStorage.getItem("riw.demo2.v3.state") && localStorage.getItem("riw.demo315.v3.state") === "ZNACZNIK-DEMO-1"));
    // telefon
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "pl-PL" });
    await c2.addInitScript(init);
    const p2 = await c2.newPage(); watch(p2);
    await p2.goto(URL); await p2.waitForSelector("#landing", { timeout: 20000 });
    check("Telefon: przyciski „Zaloguj się / Utwórz konto” pod grafiką, bez przewijania w bok", await p2.isVisible(".land-cta [data-land=login]") && await p2.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await p2.click(".land-cta [data-land=login]"); await p2.fill("#lg-login", "magazyn@resinvest.group"); await p2.fill("#lg-pass", "demo1234"); await p2.click("#lg-submit");
    await p2.waitForSelector("#yard-card", { timeout: 20000 });
    check("Telefon: plac składowy na pulpicie bez przewijania w bok", await p2.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector("#yard-stage").getBoundingClientRect().width > 300));
    check("Konsola przeglądarki bez wyjątków", errors.length === 0, errors.slice(0, 5));
  } catch (e) { check("Przebieg bez wyjątku", false, e.stack || String(e)); }
  finally { await browser.close(); }
  const ok = results.filter(Boolean).length;
  console.log(`\nWYNIK: ${ok}/${results.length} ${ok === results.length ? "OK" : "BŁĘDY"}`);
  process.exit(ok === results.length ? 0 : 1);
})();
