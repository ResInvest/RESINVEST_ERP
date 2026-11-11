/* Testy E2E modułu EUDR — drewno surowe (ResInvest_ERP_Demo2.html, tryb bez serwera, Chromium):
   menu modułu (13 pozycji), pasek trybu ACCEPTANCE, pulpit (liczniki zgodne z silnikiem), partia z dokumentu przyjęcia,
   dokument z plikiem (baza plików przeglądarki) i podgląd, należyta staranność krok po kroku z zatwierdzeniem,
   rejestr DDS z procesem kontrolowanym i eksportem danych, Centrum testów bez udawania połączenia z Komisją,
   przełączenie na PRODUCTION z potwierdzeniem (czerwony pasek), audyt 13 obszarów, szkolenie z testem, instrukcje,
   raporty PDF / Excel, historia zmian, telefon bez przewijania w bok, konsola bez błędów.
   Wymaga:  node tools/build.mjs --edition demo2        Uruchomienie:  node tests/e2e316eudr.cjs */
"use strict";
const path = require("path");
const { chromium } = require("playwright");

const URL = "file://" + path.join(path.resolve(__dirname, ".."), "ResInvest_ERP_Demo2.html");
const results = [], errors = [];
const check = (name, cond, detail) => { results.push(!!cond); console.log(`${cond ? "✔" : "✘"} ${name}${!cond && detail !== undefined ? "  → " + JSON.stringify(detail) : ""}`); };
const watch = page => { page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); }); };
const init = () => { try { sessionStorage.setItem("riw.today", "2026-11-10"); localStorage.setItem("riw.demo2.lang", "pl"); localStorage.setItem("riw.demo2.intro", "0"); } catch (e) {} };
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
async function login(page, user = "magazyn@resinvest.group") {
  await page.goto(URL); await page.waitForSelector("#landing", { timeout: 20000 });
  await page.click('.land-hs[aria-label="Zaloguj się"] >> nth=1');
  await page.fill("#lg-login", user); await page.fill("#lg-pass", "demo1234"); await page.click("#lg-submit");
  await page.waitForSelector("#demo-ribbon", { timeout: 20000 });
}
const tab = async (page, k, sel) => { await page.click(`[data-eutab="${k}"]`); if (sel) await page.waitForSelector(sel, { timeout: 8000 }); await page.waitForTimeout(100); };
const S = page => page.evaluate(() => RIW_DEBUG.store.state);
const closeModals = page => page.evaluate(() => document.querySelectorAll(".scrim").forEach(s => s.remove()));

(async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, locale: "pl-PL", acceptDownloads: true });
    await ctx.addInitScript(init);
    const page = await ctx.newPage(); watch(page);
    await login(page);
    check("Menu programu: pozycja „EUDR — drewno surowe”", await page.isVisible('.nav-item[data-nav="eudr"]'));
    await page.click('.nav-item[data-nav="eudr"]'); await page.waitForSelector("#eu-menu");
    check("Menu modułu: 13 pozycji (administrator)", (await page.$$("#eu-menu [data-eutab]")).length === 13);
    check("Pasek trybu ACCEPTANCE (pomarańczowy) z napisem o braku mocy prawnej", await page.isVisible("#eu-env.eu-env-acc") && /TRYB TESTOWY – DANE NIE MAJĄ MOCY PRAWNEJ/.test(await page.textContent("#eu-env")));
    const kpi = await page.evaluate(() => { const d = RIW.Eudr.dashboard(RIW_DEBUG.store.state, RIW_DEBUG.store.state.users[0], { today: "2026-11-10" }); return { lots: d.kpi.lots, ui: document.querySelector('[data-kpi="lots"] .k-v').textContent }; });
    check("Pulpit: liczba partii zgodna z silnikiem, alerty i historia", Number(kpi.ui) === kpi.lots && kpi.lots >= 3 && await page.isVisible("#eu-alerts"), kpi);

    /* ---------- partia z dokumentu przyjęcia ---------- */
    await tab(page, "lots", "#eu-lots");
    await page.click("#eu-rcpt"); await page.waitForSelector("#eu-rcpt [data-new]");
    const n0 = (await S(page)).eudrLots.length;
    await page.click("#eu-rcpt [data-new] >> nth=0"); await page.waitForSelector("#lf-species");
    await page.fill("#lf-species", "Sosna zwyczajna"); await page.fill("#lf-latin", "Pinus sylvestris"); await page.fill("#lf-hf", "2026-07-01");
    await page.selectOption("#lf-acq", "own_harvest"); await page.fill("#lf-lat", "50.183"); await page.fill("#lf-lon", "18.356"); await page.fill("#lf-ha", "2"); await page.fill("#lf-t", "28");
    await page.click("#lf-submit"); await page.waitForSelector("#lf-species", { state: "detached" });
    const lot = (await S(page)).eudrLots.slice(-1)[0];
    check("Partia z dokumentu przyjęcia: dane z PZ, status „Do weryfikacji”, bez podwójnego wprowadzania", (await S(page)).eudrLots.length === n0 + 1 && lot.receipt && lot.receipt.opNo && lot.status === "PENDING" && lot.wood.speciesLatin === "Pinus sylvestris", lot.receipt);

    /* ---------- dokumenty (baza plików przeglądarki) ---------- */
    for (const type of ["purchase", "transport", "legality", "harvest_right", "gps"]) {
      await tab(page, "docs", "#eu-newdoc"); await page.click("#eu-newdoc"); await page.waitForSelector("#dc-type");
      await page.selectOption("#dc-type", type); await page.selectOption("#dc-lots", lot.id);
      await page.setInputFiles("#dc-file", { name: `${type}.pdf`, mimeType: "application/pdf", buffer: PDF });
      await page.click("#dc-ok"); await page.waitForSelector("#dc-type", { state: "detached" });
    }
    const docs = (await S(page)).eudrDocs.filter(d => d.lotIds.includes(lot.id));
    check("Dokumenty: 5 plików PDF zapisanych w przeglądarce, powiązanych z partią", docs.length === 5 && docs.every(d => d.versions[0].local && d.versions[0].type === "application/pdf"));
    await page.click(`[data-dprev="${docs[0].id}"]`); await page.waitForSelector(".eu-prev-pdf");
    check("Podgląd dokumentu PDF", await page.isVisible(".eu-prev-pdf")); await closeModals(page);
    await page.click("#eu-newdoc"); await page.waitForSelector("#dc-type");
    await page.selectOption("#dc-type", "other"); await page.selectOption("#dc-lots", lot.id);
    await page.setInputFiles("#dc-file", { name: "zly.txt", mimeType: "text/plain", buffer: Buffer.from("<html><script>alert(1)</script>") });
    await page.click("#dc-ok"); await page.waitForTimeout(300);
    check("Plik z treścią aktywną (HTML) odrzucony", /Dozwolone pliki/.test(await page.textContent("#dc-msg"))); await closeModals(page);

    /* ---------- należyta staranność ---------- */
    await tab(page, "dd", "#dd-pick"); await page.selectOption("#dd-pick", lot.id); await page.waitForSelector("#eu-ddpanel");
    await page.$$eval("[data-d1ok]", xs => xs.forEach(x => { x.checked = true; }));
    await page.click('[data-d1="1"]'); await page.waitForTimeout(200);
    check("Etap 1 bez oświadczenia osoby sprawdzającej — odrzucony", /Potwierdź/.test(await page.textContent("#dd-msg")));
    await page.check("#d1-confirm"); await page.click('[data-d1="1"]'); await page.waitForTimeout(300);
    await page.$$eval("[data-d2]", xs => xs.forEach(x => { x.value = "low"; }));
    await page.selectOption("#d2-res", "NEGLIGIBLE"); await page.fill("#d2-just", "Kraj niskiego ryzyka, komplet dokumentów legalności i geolokalizacja.");
    await page.click('[data-d2s="1"]'); await page.waitForTimeout(300);
    await page.fill("#ap-just", "Osobiście sprawdziłem dokumenty i geolokalizację działki."); await page.click("#ap-ok"); await page.waitForTimeout(200);
    const refused = (await S(page)).eudrLots.find(l => l.id === lot.id).status;
    await page.check("#ap-confirm"); await page.click("#ap-ok"); await page.waitForTimeout(300);
    const after = (await S(page)).eudrLots.find(l => l.id === lot.id);
    check("Zatwierdzenie wymaga potwierdzenia osobistego sprawdzenia; potem partia „Dopuszczona”", refused === "PENDING" && after.status === "VERIFIED" && after.dd.approval.manual, { refused, st: after.status });

    /* ---------- EUDR TRACES ---------- */
    await tab(page, "traces", "#eu-portal");
    check("Przycisk „OTWÓRZ OFICJALNY SYSTEM EUDR TRACES” z adresem z konfiguracji (ACCEPTANCE)", /acceptance\.eudr\.webcloud\.ec\.europa\.eu/.test(await page.getAttribute("#eu-portal", "href")) && (await page.getAttribute("#eu-portal", "rel")).includes("noopener"));
    check("Tryb bez serwera: komunikat, że program nie udaje połączenia z Komisją", /nie udaje połączenia/.test(await page.textContent("#eu-tinfo")));
    await page.click("#dd-new"); await page.waitForSelector("#dd-kind");
    await page.selectOption("#dd-kind", "OWN"); await page.selectOption("#dd-lots", lot.id); await page.click("#dd-ok"); await page.waitForSelector("#ex-json");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#ex-xml")]);
    check("Proces kontrolowany: 6 kroków, eksport XML (SubmitDdsRequest V4) bez danych dostępowych", (await page.$$(".eu-steps li")).length === 6 && /\.xml$/.test(dl.suggestedFilename()));
    await page.click('[data-step="1"]'); await page.waitForTimeout(300);
    const dd = (await S(page)).eudrDds.slice(-1)[0];
    check("Wpis DDS w ewidencji ACCEPTANCE, krok 1 odnotowany w historii", dd.env === "ACCEPTANCE" && /^DDS-TEST\//.test(dd.no) && dd.steps[1] && dd.history.length === 2, dd.no);
    await closeModals(page);
    await page.click("#tc-run"); await page.waitForTimeout(500);
    const run = (await S(page)).eudrTests.slice(-1)[0];
    check("Centrum testów (lokalnie): 10 testów, testy połączenia pominięte (wymagają serwera), rozdzielenie danych OK", run && run.results.length === 10 && run.results.find(r => r.key === "echo").status === "SKIP" && run.results.find(r => r.key === "separation").status === "OK", run && run.results.map(r => r.key + ":" + r.status));
    const [pdfT] = await Promise.all([page.waitForEvent("download"), page.click("#tc-pdf")]);
    check("Raport testów PDF", /\.pdf$/.test(pdfT.suggestedFilename()));

    /* ---------- tryb produkcyjny ---------- */
    await tab(page, "admin", "#env-switch");
    await page.click("#env-switch"); await page.waitForSelector("#cf-in"); await page.fill("#cf-in", "tak"); await page.click(".modal [data-yes]"); await page.waitForTimeout(300);
    const still = await page.evaluate(() => RIW.Eudr.envOf(RIW_DEBUG.store.state));
    await page.click("#env-switch"); await page.waitForSelector("#cf-in"); await page.fill("#cf-in", "PRODUKCJA"); await page.click(".modal [data-yes]"); await page.waitForSelector("#eu-env.eu-env-prod");
    check("Przełączenie na PRODUCTION tylko po wpisaniu PRODUKCJA; czerwony pasek „TRYB PRODUKCYJNY”", still === "ACCEPTANCE" && /TRYB PRODUKCYJNY – OPERACJE MOGĄ WYWOŁYWAĆ SKUTKI PRAWNE/.test(await page.textContent("#eu-env")));
    await tab(page, "traces", "#eu-ddstbl");
    check("Rejestr PRODUCTION nie pokazuje wpisów testowych (bez kopiowania)", !(await page.textContent("#eu-ddstbl")).includes("DDS-TEST") && /eudr\.webcloud/.test(await page.getAttribute("#eu-portal", "href")) && !/acceptance/.test(await page.getAttribute("#eu-portal", "href")));

    /* ---------- audyt ---------- */
    await tab(page, "audit", "#au-new"); await page.click("#au-new"); await page.waitForSelector("#au-close");
    check("Audyt: 13 obszarów z opisem wymagania i podpowiedzią", (await page.$$(".eu-area")).length === 13);
    await page.$$eval('select[id^="au-st-"]', xs => xs.forEach(x => { x.value = "OK"; }));
    await page.click("#au-close"); await page.click(".modal [data-yes]"); await page.waitForTimeout(400);
    const au = (await S(page)).eudrAudits.slice(-1)[0];
    check("Audyt zakończony: wynik 100 % jako wskaźnik wewnętrzny", au.status === "CLOSED" && au.score.pct === 100 && /nie jest certyfikatem/.test(await page.textContent("#eu-body")));
    const [pa] = await Promise.all([page.waitForEvent("download"), page.click("#au-pdf")]);
    check("Raport z audytu PDF", /audyt_EUDR/.test(pa.suggestedFilename()));

    /* ---------- szkolenia, instrukcje, raporty, historia ---------- */
    await tab(page, "training", "#tr-assign");
    await page.selectOption("#tr-user", "u_admin"); await page.selectOption("#tr-mod", "basics"); await page.click("#tr-assign"); await page.waitForSelector("#eu-mytr [data-tr]");
    await page.click("#eu-mytr [data-tr]"); await page.waitForSelector("[data-les]");
    while (await page.$("[data-les]")) { await page.click("[data-les] >> nth=0"); await page.waitForTimeout(150); }
    const key = await page.evaluate(() => RIW.Eudr.moduleOf("basics").quiz.map(q => q.a));
    for (let i = 0; i < key.length; i++) await page.check(`input[name="q${i}"][value="${key[i]}"]`);
    await page.click("#tr-quiz"); await page.waitForTimeout(300);
    const tr = (await S(page)).eudrTraining.slice(-1)[0];
    check("Szkolenie: lekcje, test oceniony przez silnik (100 %)", tr.passed && tr.score === 100);
    await tab(page, "guides", ".eu-guide");
    check("Baza wiedzy: 11 instrukcji (cel, schemat, kroki, przykład, błędy)", (await page.$$(".eu-guide")).length === 11 && (await page.$$(".eu-flow")).length === 11);
    await tab(page, "reports", "#eu-reps");
    check("Raporty: 9 raportów z PDF i Excel", (await page.$$("[data-rpdf]")).length === 9 && (await page.$$("[data-rxlsx]")).length === 9);
    const [rx] = await Promise.all([page.waitForEvent("download"), page.click('[data-rxlsx="lots"]')]);
    const [rp] = await Promise.all([page.waitForEvent("download"), page.click('[data-rpdf="incomplete"]')]);
    check("Raport rejestru partii (Excel) i partii niekompletnych (PDF)", /\.xlsx$/.test(rx.suggestedFilename()) && /\.pdf$/.test(rp.suggestedFilename()));
    await tab(page, "history", ".eu-hist");
    check("Historia zmian: wpisy modułu (nowa partia, dokumenty, zatwierdzenie, tryb)", /zatwierdzenie kontroli/.test(await page.textContent(".eu-hist")) && /Tryb EUDR/.test(await page.textContent(".eu-hist")));

    /* ---------- karta partii i identyfikowalność ---------- */
    await tab(page, "lots", "#eu-lots"); await page.click(`[data-lotrow="${lot.id}"]`); await page.waitForSelector("#eu-lotcard");
    await page.click('#eu-lotcard [data-lt="trace"]'); await page.waitForSelector(".eu-chain");
    check("Karta partii: łańcuch pozyskanie → … → odbiorca (10 etapów)", (await page.$$(".eu-chain .eu-step")).length === 10);
    await closeModals(page);

    /* ---------- telefon i rola podglądu ---------- */
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "pl-PL" });
    await c2.addInitScript(init);
    const p2 = await c2.newPage(); watch(p2);
    await p2.goto(URL); await p2.waitForSelector("#landing", { timeout: 20000 });
    await p2.click(".land-cta [data-land=login]"); await p2.fill("#lg-login", "beata.nowak@resinvest.group"); await p2.fill("#lg-pass", "demo1234"); await p2.click("#lg-submit");
    await p2.waitForSelector("#demo-ribbon", { timeout: 20000 });
    await p2.evaluate(() => { location.hash = "#/eudr"; }); await p2.waitForSelector("#eu-menu");
    check("Telefon: moduł bez przewijania strony w bok", await p2.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await p2.click('[data-eutab="lots"]'); await p2.waitForSelector("#eu-lots");
    check("Rola „Podgląd”: brak przycisków zmian, brak Administracji", !(await p2.$("#eu-newlot")) && !(await p2.$('[data-eutab="admin"]')));
    check("Konsola przeglądarki bez wyjątków", errors.length === 0, errors.slice(0, 5));
  } catch (e) { check("Przebieg bez wyjątku", false, e.stack || String(e)); }
  finally { await browser.close(); }
  const ok = results.filter(Boolean).length;
  console.log(`\nWYNIK: ${ok}/${results.length} ${ok === results.length ? "OK" : "BŁĘDY"}`);
  process.exit(ok === results.length ? 0 : 1);
})();
