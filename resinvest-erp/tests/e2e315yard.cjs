/* Testy E2E modułu „Plan placu / Terminarz pociągów / Symulacja załadunku / Panel operatora” (ResInvest_ERP_Demo2.html):
   ekran startowy (sama grafika, okienka), mapa placu (kolory wg terminarza, szczegóły pryzmy, nowa pryzma, przesunięcie
   w trybie edycji, zoom), terminarz (dodanie pociągu → przydział i niedobór, kalendarz / lista / tabela),
   symulacja (warianty A–C, edycja, zapis, zatwierdzenie = rezerwacja), realizacja i zakończenie dokumentem WZ,
   panel operatora, telefon bez przewijania w bok, zgodność stanów z księgą.
   Wymaga:  node tools/build.mjs --edition demo2        Uruchomienie:  node tests/e2e315yard.cjs */
"use strict";
const path = require("path");
const { chromium } = require("playwright");

const URL = "file://" + path.join(path.resolve(__dirname, ".."), "ResInvest_ERP_Demo2.html");
const results = [], errors = [];
const check = (name, cond, detail) => { results.push(!!cond); console.log(`${cond ? "✔" : "✘"} ${name}${!cond && detail !== undefined ? "  → " + JSON.stringify(detail) : ""}`); };
const watch = page => { page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); }); };
const init = () => { try { sessionStorage.setItem("riw.today", "2026-09-23"); localStorage.setItem("riw.demo2.lang", "pl"); localStorage.setItem("riw.demo2.intro", "0"); } catch (e) {} };
const nb = s => String(s || "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
async function login(page) {
  await page.goto(URL); await page.waitForSelector("#landing", { timeout: 20000 });
  await page.click('.land-hs[aria-label="Zaloguj się"] >> nth=1');
  await page.fill("#lg-login", "magazyn@resinvest.group"); await page.fill("#lg-pass", "demo1234"); await page.click("#lg-submit");
  await page.waitForSelector("#demo-ribbon", { timeout: 20000 });
}
const go = async (page, r, sel) => { await page.evaluate(x => { location.hash = "#/" + x; }, r); await page.waitForSelector(sel, { timeout: 8000 }); await page.waitForTimeout(120); };
const st = (page, fn) => page.evaluate(fn);

(async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, locale: "pl-PL", acceptDownloads: true });
    await ctx.addInitScript(init);
    const page = await ctx.newPage(); watch(page);
    await page.goto(URL); await page.waitForSelector("#landing", { timeout: 20000 });
    check("Ekran startowy: tylko grafika logowania, formularz niewidoczny", (await page.$$("#landing img")).length === 1 && !(await page.isVisible("#lg-login")) && (await page.$("#land-more")) === null);
    await page.click('.land-hs[aria-label="Poznaj możliwości ResInvest ERP"]'); await page.waitForSelector("#land-info:not(.hidden)");
    check("„Poznaj możliwości” → okienko z opisem systemu", await page.isVisible("#land-pop.on #land-info") && !(await page.isVisible("#lg-login")));
    await page.click('#land-info [data-land="register"]'); await page.waitForSelector("#reg-form");
    check("„Utwórz konto” → okienko rejestracji", await page.isVisible("#land-pop.on #reg-form"));
    await login(page);

    /* ---------------- plan placu ---------------- */
    await go(page, "plac", "#ymap");
    const cols = await page.$$eval("#ymap .yo-pile", g => g.map(x => [x.querySelector(".yo-t").textContent.slice(0, 5), (x.getAttribute("class").match(/c-(\w+)/) || [])[1]]));
    check("Mapa: pryzmy z kolorami wg terminarza (zielone na najbliższy pociąg, pomarańczowa, niebieska, czerwona)", JSON.stringify(cols) === JSON.stringify([["P-001", "green"], ["P-002", "green"], ["P-003", "orange"], ["P-004", "blue"], ["P-005", "red"]]), cols);
    const kinds = await page.$$eval("#ymap .yo", g => [...new Set(g.map(x => (x.getAttribute("class").match(/yo-(\w+)/) || [])[1]))].sort());
    check("Mapa: infrastruktura (tory, miejsce załadunku, droga, szlaban, waga, kontenery, próbki, tablica, ogrodzenie)", ["board", "container", "fence", "gate", "loading", "road", "sample", "scale", "track"].every(k => kinds.includes(k)), kinds);
    check("Pasek najbliższego pociągu: FORTUM/01, 2 400 MP przygotowane", /FORTUM\/01/.test(await page.textContent("#ynext")) && nb(await page.textContent("#ynext-total")) === "2 400 MP");
    await page.click('#ymap .yo-pile >> nth=0'); await page.waitForSelector("#pile-detail");
    const det = nb(await page.textContent("#pile-detail"));
    check("Klik pryzmy → szczegóły: ilość MP / m³ / t, wymiary, objętość geometryczna, przypisany pociąg", /2 250 MP/.test(det) && /562,5 m³/.test(det) && /60 × 15 × 5 m/.test(det) && /FORTUM\/01 — 2 250 MP/.test(det) && /Masa szacunkowa/.test(det), det.slice(0, 300));
    const vb0 = await page.getAttribute("#ymap", "viewBox"); await page.click("#yz-in"); const vb1 = await page.getAttribute("#ymap", "viewBox"); await page.click("#yz-fit");
    check("Zoom mapy: przybliżenie zmienia widok, „Cały plac” przywraca", vb0 !== vb1 && (await page.getAttribute("#ymap", "viewBox")) === vb0, [vb0, vb1]);
    // nowa pryzma — walidacja względem ewidencji, potem utworzenie
    await page.click("#y-addpile"); await page.waitForSelector("#pile-dialog");
    await page.fill("#pile-dialog #pf-name", "Test E2E"); await page.selectOption("#pile-dialog #pf-product", "pr_zr_lesna"); await page.fill("#pile-dialog #pf-qty", "99999"); await page.click("#pf-create"); await page.waitForTimeout(250);
    const tooMuch = await page.isVisible("#pile-dialog");
    await page.fill("#pile-dialog #pf-qty", "500"); await page.click("#pf-create"); await page.waitForSelector("#pile-dialog", { state: "detached" });
    const np = await st(page, () => { const p = RIW_DEBUG.store.state.yard.find(o => o.name === "Test E2E"); return p && { no: p.no, qty: p.qty, x: p.x, y: p.y }; });
    check("Nowa pryzma: ilość ponad ewidencję odrzucona, poprawna zapisana (P-006, 500 MP)", tooMuch && np && np.no === "P-006" && np.qty === 500, np);
    // przesunięcie w trybie edycji
    await page.click("#y-edit"); await page.waitForSelector("#ymap.editing");
    const g = await page.$(`#ymap .yo-pile:has-text("P-006")`); const bb = await g.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.move(bb.x + bb.width / 2 + 60, bb.y + bb.height / 2 + 40, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300);
    const mv = await st(page, () => { const p = RIW_DEBUG.store.state.yard.find(o => o.name === "Test E2E"), a = RIW_DEBUG.store.state.audit.at(-1); return { x: p.x, y: p.y, act: a.action }; });
    check("Edycja układu: przeciągnięcie pryzmy zapisuje nowe położenie (audyt)", mv.x > np.x && mv.y > np.y && mv.act === "Pryzma — zmiana położenia", mv);
    check("Uchwyty zaznaczonej pryzmy: zmiana wymiarów i obrót", (await page.$$('#ymap [data-h="size"]')).length === 4 && (await page.$$('#ymap [data-h="rot"]')).length === 1);
    await page.click("#y-edit");

    /* ---------------- terminarz ---------------- */
    await go(page, "pociagi", "#train-cal");
    check("Terminarz — kalendarz: trzy pociągi we wrześniu / październiku, najbliższy wyróżniony", (await page.$$("#train-cal .ycal-t")).length >= 2 && (await page.$$("#train-cal .ycal-t.next")).length === 1);
    await page.click("#t-add"); await page.waitForSelector("#train-dialog");
    await page.fill("#tf-no", "PKP-E2E"); await page.selectOption("#tf-buyer", "pa_ec_zab"); await page.fill("#tf-adate", "2026-09-24"); await page.fill("#tf-lstart", "06:00"); await page.fill("#tf-qty", "7500");
    await page.click("#tf-save"); await page.waitForSelector("#train-dialog", { state: "detached" });
    const al = await st(page, () => { const S = RIW_DEBUG.store.state, Y = RIW.YardPlan, A = Y.allocate(S, "wh_zab"), t = S.trains.find(x => x.no === "PKP-E2E"), T = A.byTrain.get(t.id); return { next: A.next === t.id, total: T.total, short: T.shortage, sum: [...A.byPile.values()].every(b => b.parts.reduce((s, p) => s + p.qty, 0) >= 0) }; });
    check("Nowy pociąg z wcześniejszym terminem staje się najbliższym; system wylicza przydział i niedobór", al.next && al.total === 7350 && al.short === 150, al);
    check("Pasek pokazuje NIEDOBÓR 150 MP", /NIEDOBÓR 150 MP/.test(nb(await page.textContent("#ynext-short"))));
    await page.click('[data-tview="table"]'); await page.waitForSelector("#train-table");
    const rowsN = (await page.$$("#train-table tbody tr")).length;
    await page.click('[data-tview="list"]'); await page.waitForSelector("#train-list");
    check("Terminarz — tabela i lista chronologiczna (4 pociągi)", rowsN === 4 && (await page.$$("#train-list .ylist-i")).length === 4);
    await page.click('[data-tview="table"]'); await page.click(`#train-table tr:has-text("PKP-E2E") [data-tedit]`); await page.waitForSelector("#train-dialog");
    await page.fill("#tf-qty", "1000"); await page.click("#tf-save"); await page.waitForSelector("#train-dialog", { state: "detached" });
    check("Edycja pociągu: po zmniejszeniu zapotrzebowania niedobór znika", (await page.$("#ynext-short")) === null);

    /* ---------------- symulacja ---------------- */
    await go(page, "zaladunek", "#load-variants");
    check("Symulacja: domyślnie najbliższy pociąg", /PKP-E2E/.test(await page.$eval("#ld-train", s => s.options[s.selectedIndex].textContent)));
    const led0 = await st(page, () => RIW.Stock.balance(RIW_DEBUG.store.state, "wh_zab", "pr_zr_lesna"));
    await page.click("#ld-propose"); await page.waitForSelector('[data-var="p0"]');
    check("Warianty A, B, C wyliczone i porównane (jeden oznaczony jako najkorzystniejszy)", (await page.$$('#load-table tr[data-var^="p"]')).length === 3 && (await page.$$("#load-table tr.ybest")).length === 1);
    await page.click('[data-propedit="0"]'); await page.waitForSelector("#load-editor");
    check("Edytor wariantu: mapa z kolejnością pobierania i trasą ładowarki, kalkulator", (await page.$$("#load-editor .ym")).length >= 1 && (await page.$$("#load-editor .yr")).length >= 1 && /1 000 MP/.test(nb(await page.textContent("#le-calc"))));
    await page.fill('[data-lp="wagonMP"]', "100"); await page.dispatchEvent('[data-lp="wagonMP"]', "change"); await page.waitForTimeout(150);
    check("Zmiana parametru (ładowność wagonu 100 MP) przelicza liczbę wagonów: 10", /Wagony\s*10/.test(nb(await page.textContent("#le-calc"))), nb(await page.textContent("#le-calc")));
    await page.click("#le-save"); await page.waitForSelector("#load-editor", { state: "detached" });
    const p1 = await st(page, () => { const S = RIW_DEBUG.store.state, p = S.loadPlans.at(-1); return { st: p.status, n: p.lines.length, res: RIW.YardPlan.reserved(S).size }; });
    check("Zapis projektu: status „Projekt”, bez rezerwacji i bez zmiany stanu magazynu", p1.st === "DRAFT" && p1.res === 0 && (await st(page, () => RIW.Stock.balance(RIW_DEBUG.store.state, "wh_zab", "pr_zr_lesna"))) === led0, p1);
    await page.click('[data-pact="approve"]'); await page.waitForSelector("#load-run");
    const p2 = await st(page, () => { const S = RIW_DEBUG.store.state, p = S.loadPlans.at(-1); return { st: p.status, res: [...RIW.YardPlan.reserved(S).values()].reduce((a, b) => a + b, 0), tr: S.trains.find(x => x.id === p.trainId).status }; });
    check("Zatwierdzenie planu rezerwuje 1 000 MP, pociąg „Przygotowanie biomasy”", p2.st === "APPROVED" && p2.res === 1000 && p2.tr === "PREPARING", p2);
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }).catch(() => null), page.click("[data-ppdf]")]);
    check("Plan załadunku do PDF", !!dl && /plan_zaladunku.*\.pdf$/.test(dl.suggestedFilename()), dl && dl.suggestedFilename());
    await page.click('[data-pact="handover"]'); await page.waitForTimeout(200);

    /* ---------------- panel operatora ---------------- */
    await go(page, "operator", "#op-panel");
    check("Panel operatora: pociąg, ilość do załadunku, aktualna pryzma na mapie", /PKP-E2E/.test(await page.textContent("#op-panel")) && (await page.isVisible("#op-current")) && (await page.$$("#op-panel .ym")).length >= 1);
    await page.click("#op-start"); await page.waitForSelector("#op-qty");
    await page.fill("#op-qty", "960"); await page.click("#op-done"); await page.waitForTimeout(250);
    const o1 = await st(page, () => { const p = RIW_DEBUG.store.state.loadPlans.at(-1); return { st: p.status, a: p.actual.lines[0] }; });
    check("Operator: start załadunku, wpis pobranej ilości i „pryzma wykorzystana”", o1.st === "RUNNING" && o1.a.qty === 960 && o1.a.done === true && /96%/.test(await page.textContent("#op-pct")), o1);

    /* ---------------- realizacja i WZ ---------------- */
    await go(page, "zaladunek", "#load-variants");
    if (!(await page.$("#lr-progress"))) await page.click("[data-prun]"); await page.waitForSelector("#lr-progress");
    check("Realizacja: plan 1 000 MP, załadowano 960 MP, różnica −40, pozostało 40", /1 000 MP/.test(nb(await page.textContent("#lr-progress"))) && /960 MP/.test(nb(await page.textContent("#lr-progress"))) && /40 MP/.test(nb(await page.textContent("#lr-progress"))));
    await page.fill('[data-wn="0"]', "W-1"); await page.fill('[data-wq="0"]', "120");
    await page.click("#lr-finish"); await page.waitForSelector("#finish-dialog");
    await page.click("#fn-ok"); await page.waitForTimeout(250);
    const stillOpen = await page.isVisible("#finish-dialog");
    await page.fill("#fn-price", "92"); await page.fill("#fn-weight", "316,8"); await page.click("#fn-ok"); await page.waitForSelector("#finish-dialog", { state: "detached" });
    const fin = await st(page, () => { const S = RIW_DEBUG.store.state, p = S.loadPlans.at(-1), op = S.operations.at(-1), pile = S.yard.find(o => o.id === p.lines[0].pileId), c = RIW.YardPlan.consistency(S, "wh_zab").find(x => x.productId === "pr_zr_lesna");
      return { st: p.status, no: p.opNo, type: op.type, qty: op.sale.qty, led: RIW.Stock.balance(S, "wh_zab", "pr_zr_lesna"), pile: pile.qty, tr: S.trains.find(x => x.id === p.trainId).status, over: c.over, inP: c.inPiles, wag: p.actual.wagons.length }; });
    check("Zakończenie bez ceny i tonażu odrzucone; z danymi → dokument WZ na 960 MP", stillOpen && fin.st === "DONE" && /^WZ\//.test(fin.no) && fin.type === "SPRZEDAZ" && fin.qty === 960 && fin.wag === 1, fin);
    check("Stan księgi −960 MP, pryzma 2 250 → 1 290 MP, pociąg „Zakończony”, suma pryzm ≤ ewidencja", fin.led === led0 - 960 && fin.pile === 1290 && fin.tr === "DONE" && fin.over === false, fin);
    await go(page, "dokumenty", "main");
    check("Dokument WZ załadunku widoczny w rejestrze dokumentów", (await page.textContent("main")).includes(fin.no));
    await go(page, "plac", "#ymap");
    check("Mapa po załadunku: najbliższy pociąg to FORTUM/01", /FORTUM\/01/.test(await page.textContent("#ynext")));

    /* ---------------- telefon ---------------- */
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "pl-PL" });
    await c2.addInitScript(init);
    const p2p = await c2.newPage(); watch(p2p); await login(p2p);
    const noScroll = () => p2p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    await go(p2p, "plac", "#ymap"); const m1 = await noScroll() && (await p2p.$$("#ymap .yo-pile")).length >= 5;
    await go(p2p, "pociagi", "#train-cal"); const m2 = await noScroll();
    await go(p2p, "zaladunek", "#load-variants"); const m3 = await noScroll();
    await go(p2p, "operator", "#op-empty, #op-panel"); const m4 = await noScroll();
    check("Telefon 390 px: plan placu, terminarz, symulacja i panel operatora bez przewijania w bok", m1 && m2 && m3 && m4, [m1, m2, m3, m4]);
    check("Konsola przeglądarki bez wyjątków", errors.length === 0, errors.slice(0, 5));
  } catch (e) { check("Przebieg bez wyjątku", false, e.stack || String(e)); }
  finally { await browser.close(); }
  const ok = results.filter(Boolean).length;
  console.log(`\nWYNIK: ${ok}/${results.length} ${ok === results.length ? "OK" : "BŁĘDY"}`);
  process.exit(ok === results.length ? 0 : 1);
})();
