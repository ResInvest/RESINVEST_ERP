/* Testy E2E ResInvest ERP 3.2 (Playwright + Chromium) — tryb lokalny z logowaniem, interfejs PL.
   Uruchomienie z katalogu resinvest-erp:
     NODE_PATH=$(npm root -g) node tests/e2e.cjs
   Zmienne: SHOTS=<katalog> — zrzuty ekranu; PDF_PYTHON=<python z pypdf> — pełna kontrola tekstu PDF
   (bez niej sprawdzana jest struktura pliku: nagłówek, osadzona czcionka, mapa ToUnicode). */
"use strict";
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const PREMIUM = /Premium/.test(process.env.RIW_HTML || "");
const FILE = "file://" + path.resolve(__dirname, "..", process.env.RIW_HTML || "ResInvest_ERP.html");   // RIW_HTML=ResInvest_ERP_Premium.html — edycja Premium
const SHOTS = process.env.SHOTS || "";
const TODAY = "2026-09-23";
const results = [], consoleErrors = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond }); console.log(`${cond ? "✔" : "✘"} ${name}${!cond && detail !== undefined ? "  → " + JSON.stringify(detail) : ""}`); };
const nb = s => String(s || "").replace(/[\u00A0\u202F]/g, " ").replace(/\s+/g, " ").trim();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "riw-e2e-"));

function watch(page, label) {
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(`${label}: ${m.text()}`); });
  page.on("pageerror", e => { consoleErrors.push(`${label}: ${e.message}`); if (process.env.E2E_STACK) console.log("STACK", e.stack); });
}
async function newCtx(browser, opts = {}) {
  const { sample, ...ctxOpts } = opts;    // sample: false → czysta baza (pierwsze uruchomienie)
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: "pl-PL" }, ctxOpts));
  // edycja Premium: konta demonstracyjne / testowe są w zwijanej sekcji — w testach rozwinięta
  if (PREMIUM) await ctx.addInitScript(() => { new MutationObserver(() => document.querySelectorAll("details.prem-more:not([open])").forEach(d => { d.open = true; })).observe(document, { childList: true, subtree: true }); });
  await ctx.addInitScript(([d, sample]) => { try { if (!sessionStorage.getItem("riw.today")) sessionStorage.setItem("riw.today", d); if (!localStorage.getItem("riw.lang")) localStorage.setItem("riw.lang", "pl"); if (sample) localStorage.setItem("riw.sample", "1"); } catch (e) {} }, [TODAY, sample !== false]);
  return ctx;
}
async function boot(page) {
  await page.goto(FILE);
  await page.waitForSelector(".splash", { timeout: 5000 }).catch(() => {});
  await page.keyboard.press("Escape");
  await page.waitForSelector(".splash", { state: "detached", timeout: 5000 });
  await page.waitForSelector("#login-form", { timeout: 5000 });
  await login(page, LOGINS.u_kier);
}
/** Logowanie przez formularz (e-mail firmowy + hasło demo1234) — tak jak użytkownik. */
async function login(page, email, pw = "demo1234") {
  await closeModals(page);
  if (await page.$("#nav")) await page.evaluate(() => RIW_DEBUG.app.logout());
  await page.waitForSelector("#login-form");
  await page.fill("#lg-login", email); await page.fill("#lg-pass", pw);
  await page.click("#lg-submit");
  await page.waitForSelector("#nav .nav-item", { timeout: 8000 });
  await page.waitForTimeout(150);
}
const go = (page, route) => page.evaluate(r => { location.hash = "#/" + r; }, route).then(() => page.waitForTimeout(150));
const preset = async (page, p) => { await go(page, "pulpit"); await go(page, "nowa?preset=" + p); await page.waitForSelector("#opf"); };
const bal = (page, pid, wh = "wh_zab") => page.evaluate(([p, w]) => RIW_DEBUG.R.Stock.balance(RIW_DEBUG.store.state, w, p), [pid, wh]);
const opsN = page => page.evaluate(() => RIW_DEBUG.store.state.operations.length);
const lastOp = page => page.evaluate(() => { const o = RIW_DEBUG.store.state.operations.at(-1); return { id: o.id, no: o.no, status: o.status, type: o.type }; });
const out = async (page, key) => nb(await page.textContent(`[data-out="${key}"]`));
const msg = async (page, key) => nb(await page.textContent(`[data-msg="${key}"]`));
const tick = (page, id) => page.click(`label.opt:has(#${id})`);
const fillTab = async (page, sel, v) => { await page.fill(sel, v); await page.press(sel, "Tab"); await page.waitForTimeout(60); };
// 3.11: pojazd / rębak w operacji — pole „wybierz z listy albo wpisz” (etykieta jak na liście podpowiedzi)
const pickVeh = async (page, i, id) => { const label = await page.evaluate(id => { const v = RIWUI.Store.state.fleet.vehicles.find(x => x.id === id); return `${v.reg} · ${v.name}`; }, id); await page.fill(`#f-transport-own-runs-${i}-vehicleReg`, label); await page.waitForTimeout(100); };
const runVeh = (page, i) => page.evaluate(i => RIWForm.draft.transport.own.runs[i].vehicleId, i);
const runDrv = (page, i) => page.evaluate(i => RIWForm.draft.transport.own.runs[i].driverId, i);
const pickChip = async (page, id) => { const label = await page.evaluate(id => RIWForm.chipLabel(RIWUI.Store.state.fleet.chippers.find(x => x.id === id)), id); await fillTab(page, "#f-production-chipperName", label); await page.waitForTimeout(150); };
const LOGINS = { u_admin: "magazyn@resinvest.group", u_kier: "anna.gorska@resinvest.group", u_mag: "adrian.wojciechowski@resinvest.group", u_bra: "pawel.kaczmarek@resinvest.group", u_kbra: "tomasz.zajac@resinvest.group", u_view: "beata.nowak@resinvest.group" };
const setUser = (page, uid) => login(page, LOGINS[uid]);
const allExist = async (page, sels) => { for (const s of sels) if (!(await page.$(s))) return false; return true; };
const closeModals = async page => { for (let i = 0; i < 4 && await page.$(".scrim"); i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(80); } };
/** Zatwierdzenie z oknem podsumowania; zwraca liczbę nowych operacji. */
async function approve(page, { dbl = false } = {}) {
  const n0 = await opsN(page);
  await page.click("#summary [data-save]");
  await page.waitForSelector("#confirm-op", { timeout: 3000 });
  if (dbl) await page.dblclick("#confirm-yes"); else await page.click("#confirm-yes");
  await page.waitForFunction(n => RIW_DEBUG.store.state.operations.length > n, n0, { timeout: 4000 }).catch(() => {});
  await page.waitForSelector("#op-detail", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(250);
  const added = (await opsN(page)) - n0;
  await closeModals(page);
  return added;
}
async function openOp(page, id) { await closeModals(page); await page.evaluate(i => OpDetail.open(i), id); await page.waitForSelector("#op-detail"); }
function pdfText(file) {
  const buf = fs.readFileSync(file);
  const structural = buf.slice(0, 5).toString() === "%PDF-" && buf.includes("/FontFile2") && buf.includes("/ToUnicode") && buf.includes("%%EOF");
  if (!process.env.PDF_PYTHON) return { structural, text: null };
  const text = execFileSync(process.env.PDF_PYTHON, ["-c", "import sys\nfrom pypdf import PdfReader\nr=PdfReader(sys.argv[1])\nprint(len(r.pages))\nprint('\\n'.join(p.extract_text() for p in r.pages))", file], { encoding: "utf8" });
  return { structural, text };
}
async function downloadPdf(page, selector, name) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }), page.click(selector)]);
  const file = path.join(TMP, name);
  await dl.saveAs(file);
  return { file, suggested: dl.suggestedFilename(), ...pdfText(file) };
}
async function fillForestDirect(page) {
  await page.fill("#f-production-ndl", "Rudy Raciborskie");
  await page.fill("#f-production-lesnictwo", "Kuźnia");
  await page.fill("#f-production-kwit", "KW 0400/09/2026");
}

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  {
    const ctx = await newCtx(browser);
    const page = await ctx.newPage(); watch(page, "desktop");
    await boot(page);

    /* ------------- menu i motyw ------------- */
    const menu = await page.$$eval("#nav .nav-item", l => l.map(x => x.textContent.trim()));
    const need = ["Pulpit", "Operacje", "Przyjęcia", "Wydania / WZ", "Produkcja", "Kwit produkcji dnia", "MM", "Stany magazynowe", "Dokumenty", "Historia", "Raporty", "Transport", "Flota", "Produkty", "Kontrahenci", "Magazyny", "Administracja"];
    check("§20 Menu: wszystkie wymagane pozycje", need.every(n => menu.some(m => m.startsWith(n))), need.filter(n => !menu.some(m => m.startsWith(n))));
    const lum = c => { const [r, g, b] = c.match(/\d+/g).map(Number); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const card = await page.evaluate(() => getComputedStyle(document.querySelector(".card, .kpi")).backgroundColor);
    // edycja Premium startuje w motywie „Złota biomasa” (karty w kolorze kości słoniowej)
    check(PREMIUM ? "Premium: motyw „Złota biomasa” domyślnie — jasne tło, karty kość słoniowa" : "§19 Jasny motyw: jasne tło, białe karty", lum(bg) > 0.85 && card === (PREMIUM ? "rgb(255, 253, 248)" : "rgb(255, 255, 255)") && (!PREMIUM || await page.evaluate(() => document.documentElement.dataset.theme === "aurum")), { bg, card });
    // 3.2: pięć motywów — przełączanie z profilu, zapis w profilu użytkownika, Ctrl+D przez całą piątkę
    await go(page, "profil"); await page.waitForSelector(".theme-cards");
    check("3.2 Motywy: 8 kart w ustawieniach (Perła, Grafit, Graphite Azure, Ultra Dark, Light Premium, Szkło, Złota biomasa, Stacja wagowa)", (await page.$$eval("[data-ptheme]", l => l.map(x => x.dataset.ptheme).join(","))) === "pearl,graphite,azure,ultra,premium,glass,aurum,waga");
    const themeLook = async id => { await page.click(`[data-ptheme="${id}"]`); await page.waitForTimeout(200); return page.evaluate(() => ({ th: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor, cs: document.documentElement.style.colorScheme, saved: RIW_DEBUG.store.state.users.find(u => u.id === RIW_DEBUG.store.userId).theme })); };
    const ul = await themeLook("ultra");
    check("3.2 Ultra Dark: czarne tło (OLED), schemat ciemny, zapis w profilu", ul.th === "ultra" && ul.bg === "rgb(0, 0, 0)" && ul.cs === "dark" && ul.saved === "ultra", ul);
    const pr = await themeLook("premium");
    check("3.2 Light Premium: tło kość słoniowa, schemat jasny, granat marki", pr.th === "premium" && pr.bg === "rgb(247, 244, 238)" && pr.cs === "light" && (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand").trim())) === "#1B2A4A", pr);
    const cyc = []; for (let i = 0; i < 8; i++) { await page.keyboard.press("Control+d"); await page.waitForTimeout(80); cyc.push(await page.evaluate(() => document.documentElement.dataset.theme)); }
    check("3.2 Ctrl+D przełącza przez osiem motywów", cyc.join(",") === "glass,aurum,waga,pearl,graphite,azure,ultra,premium", cyc);
    const wg = await themeLook("waga");
    check("3.11 Stacja wagowa: granatowa belka górna, stalowe tło, schemat jasny, zapis w profilu", wg.th === "waga" && wg.cs === "light" && wg.saved === "waga" && (await page.evaluate(() => getComputedStyle(document.querySelector(".topbar")).backgroundImage)).includes("gradient"), wg);
    const gl = await themeLook("glass");
    check("3.7 Szkło: pastelowe tło z gradientem, szklane karty z rozmyciem, zielona marka, zapis w profilu", gl.th === "glass" && gl.cs === "light" && gl.saved === "glass" && await page.evaluate(() => { const c = getComputedStyle(document.querySelector(".card, .theme-cards") || document.body); return getComputedStyle(document.body).backgroundImage.includes("radial-gradient") && getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() === "#1F7F45"; }) && await page.evaluate(() => /blur/.test(getComputedStyle(document.querySelector(".sidebar")).backdropFilter)), gl);
    await themeLook("pearl"); await go(page, "pulpit"); await page.waitForSelector("#kpi-wood");

    /* ------------- pulpit ------------- */
    check("§13 Pulpit: KPI stanów z ≈ t i ≈ GJ", nb(await page.textContent("#kpi-wood .k-v")).replace(/ /g, "") === "817m³" && nb(await page.textContent("#kpi-wood")).includes("≈ 778 t · ≈ 6 611 GJ"), nb(await page.textContent("#kpi-wood")));
    check("§14 Pulpit: kafle stanów wg produktu (wskaźnik + linia 30 dni)", (await page.$$("#dash-stock .stile .meter i")).length >= 5 && (await page.$$("#dash-stock .stile svg")).length >= 5);
    check("§15 Pulpit: OBROTY WEDŁUG TYPU OPERACJI — 5 typów", nb(await page.textContent("#dash-turnover h3")) === "OBROTY WEDŁUG TYPU OPERACJI" && (await page.$$("#turn-chart .hbar-row")).length === 5);
    await page.selectOption("#dash-mode", "custom"); await page.waitForTimeout(150);
    await page.fill("#dash-from", "2026-09-15"); await page.press("#dash-from", "Tab"); await page.waitForTimeout(150);
    check("§15 Pulpit: zakres własny obrotów (15.09 – 23.09)", nb(await page.textContent("#dash-turnover .sub")).startsWith("15.09.2026"), nb(await page.textContent("#dash-turnover .sub")));
    await page.hover("#turn-chart .hbar-row >> nth=1"); await page.waitForTimeout(100);
    check("§15 Pulpit: podpowiedź po najechaniu na słupek", !(await page.$eval("#chart-tip", e => e.classList.contains("hidden"))));
    await page.click("#turn-chart .hbar-row >> nth=1"); await page.waitForSelector("#drill");
    check("Pulpit: kliknięcie obrotu → operacje źródłowe", (await page.$$("#drill-table tbody tr")).length >= 1);
    await closeModals(page);

    /* ------------- stany ------------- */
    await go(page, "stany");
    const cell = async (id, a = "data-native") => nb(await page.textContent(`[data-stock="wh_zab"] [${a}="${id}"]`));
    check("§4 Stany: 8 293 MP ≈ 2 737 t ≈ 23 262 GJ", (await cell("pr_zr_lesna")) === "8 293 MP" && (await cell("pr_zr_lesna", "data-mass")) === "≈ 2 737 t" && (await cell("pr_zr_lesna", "data-gj")) === "≈ 23 262 GJ");
    check("§4 Stany: drewno 817 m³ ≈ 778 t", (await cell("pr_drewno")) === "817 m³" && (await cell("pr_drewno", "data-mass")) === "≈ 778 t");
    check("§4 Stany: PKS tylko t (728 t ≈ 6 188 GJ)", (await cell("pr_pks")) === "728 t" && (await cell("pr_pks", "data-mass")) === "—" && (await cell("pr_pks", "data-gj")) === "≈ 6 188 GJ");

    /* ------------- §22 TEST 1 / §31.16 A: produkcja na magazynie ------------- */
    await preset(page, "produkcja");
    check("§5 Produkcja na magazynie: brak transportu, przewoźnika, odbiorcy, sprzedaży", !(await page.$("#f-transport-place")) && !(await page.$("#f-sale-buyerId")) && !(await page.$("#f-mode-own")) && !(await page.$("#f-purchase-supplierId")));
    check("§6 Produkcja: magazyn, surowiec, stan, produkt, ilość, zużycie, masa/GJ, cena i koszt rąbania, uwagi, nr dokumentu",
      await allExist(page, ["production.wh", "production.rawProductId", "production.stock", "production.outProductId", "production.outQty", "production.consume", "production.orient", "production.chipRate", "production.chipCost", "notes", "extDoc"].map(k => `[data-field="${k}"]`)));
    check("§18 Cena za rąbanie domyślnie 10,00 zł/MP", (await page.inputValue("#f-production-chipRate")) === "10,00");
    await fillTab(page, "#f-production-outQty", "500");
    check("§22 T1: 500 MP → zużycie 125 m³ liczone automatycznie", (await out(page, "production.consume")) === "125 m³", await out(page, "production.consume"));
    check("§22 T1: stan surowca 817 → po 692 m³", (await out(page, "production.stock")) === "817 m³" && (await out(page, "production.after")) === "692 m³");
    check("§22 T7: koszt rąbania 500 × 10 = 5 000,00 zł", (await out(page, "production.chipCost")) === "5 000,00 zł");
    check("§4 Produkcja: masa i energia orientacyjna 165 t · 1 402,5 GJ", (await out(page, "production.orient")) === "≈ 165,00 t · ≈ 1 402,5 GJ", await out(page, "production.orient"));
    await page.fill("#f-extDoc", "KP 1/09/2026");
    await page.click("#summary [data-save]"); await page.waitForSelector("#confirm-op");
    const conf = nb(await page.textContent("#confirm-op"));
    check("§31.15 Podsumowanie przed zatwierdzeniem: zużycie, produkt, stan przed/po, masa, GJ, rąbanie", ["125 m³", "500 MP", "817 m³", "692 m³", "8 293 MP", "8 793 MP", "GJ", "5 000,00 zł", "WZ", "Rozchód wewnętrzny (zużycie)", "Przyjęcie wewnętrzne (produkcja)"].every(x => conf.includes(x)), conf.slice(0, 300));
    await page.click("#confirm-op [data-no]"); await page.waitForTimeout(100);
    check("§31.15 „Wróć do edycji” nie zapisuje", (await opsN(page)) === 11);
    const nProd = await approve(page, { dbl: true });
    check("§31.16 F: podwójne kliknięcie „Zatwierdź dokument” = jedna operacja", nProd === 1, nProd);
    const prodOp = await lastOp(page);
    check("§22 T1: po zapisie drewno 692 m³, zrębka 8 793 MP, status ZATWIERDZONY", (await bal(page, "pr_drewno")) === 692 && (await bal(page, "pr_zr_lesna")) === 8793 && prodOp.status === "POSTED" && prodOp.no.startsWith("WZ/"));

    /* ------------- §31.16 B: brak surowca (Brąszewice 30 m³) ------------- */
    await setUser(page, "u_bra");
    await preset(page, "produkcja");
    await fillTab(page, "#f-production-outQty", "500");
    check("§31.16 B: komunikat „Brak wystarczającej ilości surowca. Dostępne: 30 m³. Wymagane: 125 m³. Brakuje: 95 m³.”", (await msg(page, "production.outQty")) === "Brak wystarczającej ilości surowca. Dostępne: 30 m³. Wymagane: 125 m³. Brakuje: 95 m³.", await msg(page, "production.outQty"));
    const nB = await opsN(page);
    await page.click("#summary [data-save]"); await page.waitForTimeout(300);
    check("§31.16 B: zatwierdzenie zablokowane — brak okna i brak zapisu", !(await page.$("#confirm-op")) && (await opsN(page)) === nB && nb(await page.textContent("#toasts")).includes("Nie można zatwierdzić"));
    await page.selectOption("#f-production-outProductId", "pr_drewno"); await page.waitForTimeout(150);
    check("§31.16 C: surowiec = produkt wyjściowy zablokowany", (await msg(page, "production.outProductId")).includes("różnymi produktami"));
    await setUser(page, "u_kier");

    /* ------------- §22 TEST 2: WZ ------------- */
    await preset(page, "wz");
    await page.selectOption("#f-sale-productId", "pr_zr_lesna"); await page.waitForTimeout(100);
    check("§9 WZ: stan dostępny 8 793 MP", (await out(page, "sale.onStock")) === "8 793 MP");
    await fillTab(page, "#f-sale-qty", "8793,01");
    check("§9 WZ ponad stan: „Nie można sprzedać … Dostępny stan: 8 793 MP.”", (await msg(page, "sale.qty")) === "Nie można sprzedać 8 793,01 MP. Dostępny stan: 8 793 MP.", await msg(page, "sale.qty"));
    await fillTab(page, "#f-sale-qty", "500");
    check("§9 WZ: stan po WZ 8 293 MP", (await out(page, "sale.after")) === "8 293 MP");
    await page.fill("#f-sale-price", "90"); await page.selectOption("#f-sale-buyerId", "pa_ec_zab"); await page.waitForTimeout(100);
    check("WZ: miejsce dostawy = odbiorca", (await page.inputValue("#f-transport-place")) === "Elektrociepłownia Zabrze S.A.");
    check("WZ: 1 dokument po zatwierdzeniu", (await approve(page)) === 1);
    const wzOp = await lastOp(page);
    check("§22 T2: po WZ stan 8 293 MP", (await bal(page, "pr_zr_lesna")) === 8293);

    /* ------------- §22 TEST 3 / §31.16 I: sprzedaż bezpośrednia ------------- */
    await preset(page, "bezposrednia");
    await fillForestDirect(page);
    await fillTab(page, "#f-production-outQty", "600");
    check("§8 Bezpośrednia: surowiec liczony (150 m³, nie ze stanu)", (await out(page, "production.rawQty")).startsWith("150 m³"), await out(page, "production.rawQty"));
    await page.selectOption("#f-sale-buyerId", "pa_elektrownia"); await page.fill("#f-sale-price", "88");
    await fillTab(page, "#f-sale-qtyMP", "650");
    check("§31.16 I: sprzedaż 650 MP z produkcji 600 MP zablokowana", (await msg(page, "sale.qtyMP")).includes("Nie można sprzedać 650 MP z produkcji 600 MP"));
    await fillTab(page, "#f-sale-qtyMP", "");
    check("§22 T3: zatwierdzenie bezpośredniej", (await approve(page)) === 1);
    check("§22 T3: stan zrębki i drewna bez zmian (8 293 MP, 692 m³)", (await bal(page, "pr_zr_lesna")) === 8293 && (await bal(page, "pr_drewno")) === 692);

    /* ------------- §22 TEST 5–6: pociąg ------------- */
    await preset(page, "wz");
    await tick(page, "f-mode-train"); await page.waitForSelector("#f-transport-train-wagonCount");
    await fillTab(page, "#f-transport-train-wagonCount", "20"); await fillTab(page, "#f-transport-train-sameT", "60");
    check("§22 T5: tonaż wspólny 20 × 60 = 1 200 t", nb(await page.textContent("[data-train-total]")) === "1 200 t");
    await tick(page, "f-ton-each"); await fillTab(page, "#f-transport-train-wagonCount", "5");
    const tons = ["58,4", "60,1", "59,7", "61,2", "59,8"];
    for (let i = 0; i < 5; i++) await fillTab(page, `#f-transport-train-wagonT-${i}`, tons[i]);
    check("§22 T6: tonaż każdego wagonu → 299,2 t", (await out(page, "train.sumT")) === "299,2 t" && nb(await page.textContent("[data-train-total]")) === "299,2 t");
    const trs = nb(await page.textContent("#train-summary"));
    check("Pociąg: podsumowanie składu z przewoźnikiem, dokumentem, kosztem", ["Liczba wagonów", "Łączny tonaż składu", "Przewoźnik", "Nr dokumentu", "Koszt transportu"].every(x => trs.includes(x)));

    /* ------------- MM: wybór źródła i celu, walidacja, tonaż, tryb dwuetapowy, przyjęcie ------------- */
    await preset(page, "mm");
    check("MM: pole magazynu źródłowego aktywne, domyślnie magazyn użytkownika", !(await page.isDisabled("#f-mm-fromWhId")) && (await page.inputValue("#f-mm-fromWhId")) === "wh_zab");
    const srcOpts = await page.$$eval("#f-mm-fromWhId option", o => o.map(x => x.value));
    const dstOpts = await page.$$eval("#f-mm-toWhId option", o => o.map(x => x.value).filter(Boolean));
    check("MM: listy magazynów z danych — źródło: dostępne użytkownikowi, cel: wszystkie aktywne", srcOpts.join() === "wh_zab,wh_bra" && ["wh_zab", "wh_bra", "wh_rok"].every(w => dstOpts.includes(w)), [srcOpts, dstOpts]);
    check("MM: informacja o trybie dwuetapowym", nb(await page.textContent("#mm-mode-info")).includes("dwuetapowy"));
    await page.selectOption("#f-mm-productId", "pr_zr_lesna"); await page.waitForTimeout(100);
    await fillTab(page, "#f-mm-qty", "300");
    await page.selectOption("#f-mm-toWhId", "wh_zab"); await page.waitForTimeout(120);
    await page.click("#summary [data-save]"); await page.waitForTimeout(200);
    check("MM: ten sam magazyn źródłowy i docelowy — błąd walidacji", (await msg(page, "mm.toWhId")).includes("nie mogą być takie same") && !(await page.$("#confirm-op")), await msg(page, "mm.toWhId"));
    await page.selectOption("#f-mm-toWhId", "wh_bra"); await page.waitForTimeout(120);
    check("MM: źródło 8 293 → 7 993 MP, cel 220 → 520 MP po przyjęciu", (await out(page, "mm.srcBal")) === "8 293 MP → 7 993 MP" && (await out(page, "mm.dstBal")) === "220 MP → 520 MP po przyjęciu", [await out(page, "mm.srcBal"), await out(page, "mm.dstBal")]);
    check("MM: tonaż automatyczny z przelicznika (300 MP × 0,33 = 99 t)", (await out(page, "mm.weightAuto")) === "≈ 99,00 t", await out(page, "mm.weightAuto"));
    await page.selectOption("#f-mm-weightMode", "manual"); await page.waitForSelector("#f-mm-weightManual");
    await fillTab(page, "#f-mm-weightManual", "98,6");
    check("MM: zatwierdzenie (wysłanie)", (await approve(page)) === 1);
    const mmOp = await lastOp(page);
    const mmSt = () => page.evaluate(id => { const o = RIW_DEBUG.store.state.operations.find(x => x.id === id); return { st: RIW_DEBUG.R.mmState(o), w: o.mm.weightT, rc: o.mm.receipt }; }, mmOp.id);
    await openOp(page, mmOp.id);
    const st1 = await mmSt();
    check("MM: W DRODZE — źródło 7 993 MP, cel bez zmian (220 MP), tonaż 98,6 t", (await bal(page, "pr_zr_lesna")) === 7993 && (await bal(page, "pr_zr_lesna", "wh_bra")) === 220 && st1.st === "W_DRODZE" && st1.w === 98.6 && mmOp.no.startsWith("WZ/") && !!(await page.$("#op-detail #mm-transit-info")),
      [await bal(page, "pr_zr_lesna"), await bal(page, "pr_zr_lesna", "wh_bra"), st1.st, st1.w, mmOp.no, !!(await page.$("#op-detail #mm-transit-info"))]);
    await closeModals(page);
    await setUser(page, "u_bra"); await go(page, "mm"); await page.waitForSelector("#mm-incoming");
    check("MM: magazyn docelowy widzi MM do przyjęcia", nb(await page.textContent("#mm-incoming")).includes(mmOp.no));
    await page.click(`#mm-incoming [data-receive="${mmOp.id}"]`); await page.waitForSelector("#mm-receive");
    await page.fill("#rcv-qty", "295"); await page.dispatchEvent("#rcv-qty", "input"); await page.waitForTimeout(80);
    await page.click("#rcv-yes"); await page.waitForTimeout(200);
    check("MM: różnica przy przyjęciu wymaga przyczyny", !(await page.isHidden("#rcv-reason-f")) && nb(await page.textContent('[data-rmsg="reason"]')).includes("wskaż przyczynę") && (await bal(page, "pr_zr_lesna", "wh_bra")) === 220);
    await page.selectOption("#rcv-reason", "ubytek"); await page.fill("#rcv-note", "kwit BR 0923"); await page.dispatchEvent("#rcv-note", "input");
    check("MM: podsumowanie przyjęcia — ubytek 5 MP, stan 220 → 515", nb(await page.textContent("#rcv-summary")).includes("ubytek 5 MP") && nb(await page.textContent("#rcv-summary")).includes("515 MP"), nb(await page.textContent("#rcv-summary")));
    await page.click("#rcv-yes"); await page.waitForSelector("#op-detail", { timeout: 3000 }).catch(() => {}); await page.waitForTimeout(250);
    const rcv = await mmSt();
    check("MM: przyjęte — cel 515 MP, różnica 5 MP z przyczyną, status PRZYJĘTE", (await bal(page, "pr_zr_lesna", "wh_bra")) === 515 && rcv.st === "PRZYJETE" && rcv.rc && rcv.rc.diff === 5 && rcv.rc.reason === "ubytek" && nb(await page.textContent("#op-detail")).includes("PRZYJĘTE"));
    await closeModals(page);
    await setUser(page, "u_kier");

    /* ------------- wersja robocza ------------- */
    await preset(page, "zakup");
    await fillTab(page, "#f-purchase-supplierName", "Lander Agro"); await fillTab(page, "#f-purchase-qty", "12");
    const nD = await opsN(page);
    await page.click("#summary [data-draft]"); await page.waitForTimeout(300);
    await go(page, "operacje");
    check("§32.1 Wersja robocza: status ROBOCZY, bez numeru i bez wpływu na stan", nb(await page.textContent("#drafts-table")).includes("ROBOCZY") && (await opsN(page)) === nD && (await bal(page, "pr_drewno")) === 692);
    await page.selectOption("#o-scope", "all"); await page.waitForTimeout(150);
    const opsTxt = nb(await page.textContent("#ops-table"));
    check("§32.1 Rejestr: kolumna Status z ZATWIERDZONY / SKORYGOWANY / ANULOWANY", ["ZATWIERDZONY", "SKORYGOWANY", "ANULOWANY"].every(x => opsTxt.includes(x)));

    /* ------------- §32.23: anulowanie WZ ------------- */
    await page.click(`#ops-table tr[data-opid="${wzOp.id}"]`); await page.waitForSelector("#op-detail");
    await page.click("#op-detail [data-cancel]"); await page.waitForSelector("#cancel-dialog");
    check("§32.2 Anulowanie: podgląd wpływu na stan (+500 MP)", nb(await page.textContent("#cancel-effect")).includes("+500 MP"));
    await page.click("#cancel-yes"); await page.waitForTimeout(150);
    check("§32.2 Anulowanie wymaga przyczyny", nb(await page.textContent("#cancel-msg")).length > 0 && (await page.$("#cancel-dialog")) !== null);
    await page.selectOption("#cancel-reason", "błędny kontrahent"); await page.click("#cancel-yes");
    await page.waitForSelector("#op-detail"); await page.waitForTimeout(200);
    check("§32.23 T1: dokument ANULOWANY, stan przywrócony (+500 MP), dokument AN", nb(await page.textContent("#op-detail .modal-h")).includes("ANULOWANY") && (await bal(page, "pr_zr_lesna")) === 8493 && nb(await page.textContent("#op-docs")).includes("ANULOWANIE"));
    check("§32.3 Anulowany dokument: brak przycisków Koryguj / Anuluj", !(await page.$("#op-detail [data-correct]")) && !(await page.$("#op-detail [data-cancel]")));
    await closeModals(page);

    /* ------------- §32.4: blokada anulowania przy zależnościach ------------- */
    await setUser(page, "u_kbra");
    const dep = await page.evaluate(async () => {
      const R = RIW_DEBUG.R, S = RIW_DEBUG.store;
      const d1 = R.Seed.draftOf("2026-09-23", { purchase: { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: "100", unit: "m3", price: "230" }, transport: { mode: "none", place: "RiC Brąszewice" } });
      const a = await S.exec("op.commit", { draft: d1 }, "test");
      const b = await S.exec("op.commit", { draft: R.Seed.draftOf("2026-09-23", { type: "PRODUKCJA", production: { rawProductId: "pr_drewno", outProductId: "pr_zr_lesna", outQty: "480" } }) }, "test");
      return { ok: a.ok && b.ok, buy: a.op && a.op.id, use: b.op && b.op.id };
    });
    await setUser(page, "u_admin");
    await openOp(page, dep.buy);
    await page.click("#op-detail [data-cancel]"); await page.waitForSelector("#cancel-dialog");
    const blocked = nb(await page.textContent("#cancel-dialog"));
    check("§32.4 Blokada: „Nie można bezpośrednio anulować dokumentu … wykorzystany w późniejszych operacjach”", blocked.includes("Nie można bezpośrednio anulować dokumentu") && blocked.includes("wykorzystany w późniejszych operacjach") && !(await page.$("#cancel-yes")));
    await closeModals(page);
    await setUser(page, "u_kier");

    /* ------------- §32.5–32.17: korekta produkcji ------------- */
    await openOp(page, prodOp.id);
    await page.click("#op-detail [data-correct]"); await page.waitForSelector("#corr-preview");
    check("§32.5 Korekta: nagłówek „KOREKTA dokumentu nr …”", nb(await page.textContent(".page-head h2")).startsWith(`KOREKTA dokumentu nr ${prodOp.no}`));
    await fillTab(page, "#f-production-outQty", "400");
    await page.waitForSelector("#corr-changes");
    const cp = nb(await page.textContent("#corr-preview"));
    check("§32.9 Podgląd: oryginał / korekta / różnica / wpływ / stan przed-po", cp.includes("500 MP") && cp.includes("400 MP") && cp.includes("-100") && cp.includes("+25 m³") && (await page.$("#corr-effect")) !== null, cp.slice(0, 300));
    await page.click("#summary [data-save]"); await page.waitForTimeout(150);
    check("§32.8 Korekta bez powodu odrzucona", nb(await page.textContent("#corr-reason-msg")).length > 0);
    await page.selectOption("#corr-reason", "błędne zużycie surowca");
    await page.click("#summary [data-save]"); await page.click(".scrim [data-yes]");
    await page.waitForSelector("#op-detail"); await page.waitForTimeout(200);
    check("§32.23 Korekta produkcji: status SKORYGOWANY, drewno +25 m³, zrębka −100 MP, dokument korekty w serii WZ", nb(await page.textContent("#op-detail .modal-h")).includes("SKORYGOWANY") && (await bal(page, "pr_drewno")) === 717 && (await bal(page, "pr_zr_lesna")) === 8393 && nb(await page.textContent("#op-corr")).includes("WZ/"));
    await page.click("#op-corr [data-reverse]"); await page.fill("#cf-in", "test odwrócenia"); await page.click(".scrim:last-child [data-yes]");
    await page.waitForTimeout(400);
    check("§32.16 Odwrócenie korekty nową korektą (stan jak przed korektą)", (await bal(page, "pr_drewno")) === 692 && (await page.evaluate(id => RIW_DEBUG.store.state.operations.find(o => o.id === id).corrections.length, prodOp.id)) === 2);
    await closeModals(page);

    /* ------------- uprawnienia ------------- */
    await setUser(page, "u_mag"); await openOp(page, mmOp.id);
    check("§32.22 Magazynier: brak „Anuluj” i „Koryguj”", !(await page.$("#op-detail [data-cancel]")) && !(await page.$("#op-detail [data-correct]")));
    await closeModals(page);
    await setUser(page, "u_view"); await go(page, "nowa");
    check("Rola Podgląd nie tworzy operacji", nb(await page.textContent("#page")).includes("nie pozwala tworzyć operacji"));
    await setUser(page, "u_kier");

    /* ------------- historia ------------- */
    await go(page, "historia");
    const hHead = await page.$$eval("#hist-table thead th", t => t.map(x => x.textContent));
    check("§10 Historia: kolumny data, godzina, użytkownik, typ, dokument, magazyn, produkt, ilość, jednostka, stan przed/zmiana/po, kontrahent, powiązana, uwagi", ["Data", "Godz.", "Użytkownik", "Typ", "Nr dokumentu", "Magazyn", "Produkt", "Ilość", "Jedn.", "Stan przed", "Zmiana", "Stan po", "Kontrahent", "Powiązana operacja", "Uwagi"].every(h => hHead.includes(h)), hHead);
    await page.selectOption("#h-type", "KOREKTA"); await page.waitForTimeout(150);
    check("§32.18 Historia: filtr typu Korekta", (await page.$$eval("#hist-table tbody tr", r => r.length)) >= 2 && nb(await page.textContent("#hist-table")).includes("WZ/"));
    await page.selectOption("#h-type", ""); await page.selectOption("#h-mode", "custom"); await page.waitForTimeout(100);
    await page.fill("#h-from", "2026-09-15"); await page.press("#h-from", "Tab"); await page.fill("#h-to", "2026-09-16"); await page.press("#h-to", "Tab"); await page.waitForTimeout(150);
    const dates = await page.$$eval("#hist-table tbody tr td:first-child", t => [...new Set(t.map(x => x.textContent))]);
    check("§23 Historia: zakres dat 15.09–16.09", dates.every(d => d === "15.09.2026" || d === "16.09.2026") && dates.length === 2, dates);
    // dziennik audytu zapisuje rzeczywisty czas zdarzenia (zegar systemu), a „dziś” programu jest w teście ustawione na 23.09.2026 —
    // zakres roczny obejmuje oba niezależnie od daty uruchomienia testu
    await page.selectOption("#h-mode", "year"); await page.waitForTimeout(150);
    await page.click('[data-htab="audit"]');
    check("Dziennik audytu: anulowanie z powodem", nb(await page.textContent("#audit-table")).includes("Anulowanie dokumentu") && nb(await page.textContent("#audit-table")).includes("błędny kontrahent"));

    /* ------------- raporty + PDF + spójność ------------- */
    await go(page, "raporty");
    check("§11 Raport miesięczny: tytuł i bilans spójny", nb(await page.textContent("#rep-title")) === "Raport miesięczny — WRZESIEŃ 2026" && nb(await page.textContent("#rep-consistent")).includes("spójny"));
    check("§11 Raport: sekcje zakupy, produkcja, sprzedaż, zużycie, MM, transport, wycena, korekty, anulowania", await allExist(page, ["#sec-recon", "#sec-purchases", "#sec-production", "#sec-sales", "#sec-consumption", "#sec-mm", "#sec-transport", "#sec-valuation"]) && nb(await page.textContent("#page")).includes("Korekty w okresie") && nb(await page.textContent("#page")).includes("Anulowania w okresie"));
    check("Test 31: wycena — produkt bez zakupu „BRAK WYCENY”", nb(await page.textContent("#rep-valuation")).includes("BRAK WYCENY"));
    await page.click("#rep-purchases tbody tr.drill >> nth=0"); await page.waitForSelector("#drill");
    check("§11 Drill-down: wiersz raportu → operacje źródłowe", (await page.$$("#drill-table tbody tr")).length >= 1);
    await closeModals(page);
    await page.selectOption("#r-wh", "wh_zab"); await page.waitForTimeout(200);
    const recRow = await page.$$eval("#rep-recon tbody tr", r => r.map(x => [...x.children].map(c => c.textContent)));
    const lesna = recRow.find(r => r[0].startsWith("Zrębka produkcyjna leśna"));
    const zabStock = await bal(page, "pr_zr_lesna");
    check("Test 33: spójność Raport = Stany (stan końcowy zrębki = księga)", lesna && nb(lesna[10]) === nb(await page.evaluate(q => RIW_DEBUG.R.fmtQ(q), zabStock)), [lesna && lesna[10], zabStock]);
    const repPurch = nb(await page.textContent("#rep-kpis .kpi:first-child .k-v"));
    const pdfR = await downloadPdf(page, "[data-pdf]", "raport.pdf");
    check("§12 GENERUJ PDF: prawdziwy plik PDF z osadzoną czcionką", pdfR.structural && pdfR.suggested.endsWith(".pdf"), pdfR.suggested);
    if (pdfR.text !== null) {
      check("§12 PDF: polskie znaki i treść raportu (tytuł, bilans, numer raportu, podpis)", ["Raport miesięczny — WRZESIEŃ 2026", "Bilans stanów", "Zrębka produkcyjna leśna", "Nr RAP/", "Sporządził", "Wygenerowano", "Strona 1 z"].every(x => pdfR.text.includes(x)), pdfR.text.slice(0, 400));
      check("Test 34: spójność Raport ekran = PDF (zakupy)", pdfR.text.includes(repPurch.replace(/ /g, "\u00A0")) || nb(pdfR.text).includes(repPurch), repPurch);
    }
    const [pop] = await Promise.all([page.waitForEvent("popup"), page.click("[data-print]")]);
    await pop.waitForLoadState(); await page.waitForTimeout(300);
    check("§12 DRUKUJ: wydruk w nowym oknie z tą samą treścią", (await pop.textContent("h1")).includes("Raport miesięczny") && (await pop.textContent("body")).includes("Bilans stanów"));
    await pop.close();
    check("Wydruk i PDF zapisane w audycie", await page.evaluate(() => RIW_DEBUG.store.state.audit.filter(a => a.event === "print").length >= 2));
    await go(page, "pulpit");
    const dashPurch = nb(await page.textContent("#kpi-purchase .k-v"));
    check("Test 35: spójność Pulpit = Raport (zakup miesiąca Zabrze)", repPurch.replace(/,\d\d zł$/, "") === dashPurch.replace(/ ?zł$/, ""), [repPurch, dashPurch]);

    /* ------------- kwit produkcji dnia ------------- */
    await go(page, "kwit");
    await page.fill("#k-date", "2026-09-22"); await page.press("#k-date", "Tab"); await page.waitForTimeout(150);
    await page.selectOption("#k-wh", "wh_bra"); await page.waitForTimeout(150);
    const kw = nb(await page.textContent("#kwit-kpis"));
    check("§16 Kwit: 20 MP = 5 m³, 6,60 t, 56,1 GJ, 200,00 zł", ["20 MP", "= 5 m³ surowca", "6,60 t", "56,1 GJ", "200,00 zł"].every(x => kw.includes(x)), kw);
    const kh = await page.$$eval("#kwit-table thead th", t => t.map(x => x.textContent));
    check("§16 Kwit: kolumny operator, surowiec, zużycie, produkt, MP, m³, t, GJ, cena, koszt, uwagi, nr", ["Nr PW", "Operator", "Surowiec", "Zużycie", "Produkt", "MP", "m³", "t", "GJ", "zł/MP", "Koszt", "Uwagi"].every(h => kh.includes(h)), kh);
    const pdfK = await downloadPdf(page, "[data-pdf]", "kwit.pdf");
    check("§16 Kwit: PDF", pdfK.structural && (pdfK.text === null || (pdfK.text.includes("Kwit produkcji dnia 22.09.2026") && pdfK.text.includes("Adam Mazur") && pdfK.text.includes("Operator rębaka"))), pdfK.text && pdfK.text.slice(0, 300));

    /* ------------- dokumenty, rejestry ------------- */
    await go(page, "dokumenty");
    await page.check("#r-aux"); await page.waitForTimeout(150); // KOR / AN to dokumenty pomocnicze (od 3.4.1 domyślnie ukryte)
    check("Dokumenty: kolumna Status i dokumenty KOR / AN", (await page.$$eval("#docs-table thead th", t => t.map(x => x.textContent))).includes("Status") && nb(await page.textContent("#docs-table")).includes("Korekta dokumentu") && nb(await page.textContent("#docs-table")).includes("Anulowanie dokumentu"));
    await page.uncheck("#r-aux"); await page.waitForTimeout(150);
    await page.click("#docs-table [data-view] >> nth=0"); await page.waitForSelector("#doc-preview");
    const pdfD = await downloadPdf(page, "#doc-preview [data-pdf]", "dok.pdf");
    check("Dokument: PDF pojedynczego dokumentu", pdfD.structural);
    await closeModals(page);
    for (const [r, sel] of [["przyjecia", "#docs-table"], ["wz", "#docs-table"], ["mm", "#docs-table"], ["produkcja", "#prod-table"], ["transport", "#tr-table"], ["produkty", "#products-table"], ["kontrahenci", "#partners-table"], ["magazyny", "[data-wh]"], ["administracja", "#bk-export"], ["profil", "#pf-pw"]]) {
      await go(page, r);
      check(`Moduł „${r}” działa`, !!(await page.$(sel)));
    }
    await go(page, "uzytkownicy"); await page.waitForSelector("#users-table");
    check("Użytkownicy: Kierownik — tylko podgląd (bez dodawania i zmian statusu)", !(await page.$("#user-add")) && !(await page.$("[data-ustat]")));
    await setUser(page, "u_admin"); await go(page, "admin/permissions"); await page.waitForSelector("#perm-table");
    check("Administracja: uprawnienia documents.cancel / documents.correct w macierzy", nb(await page.textContent("#perm-table")).includes("documents.cancel") && nb(await page.textContent("#perm-table")).includes("production.correct"));
    await setUser(page, "u_kier");
    /* ------------- 2.2: grupa dostawcy, leśnictwo, kursy transportu własnego ------------- */
    await preset(page, "zakup");
    check("2.2 Dostawca: dwie grupy (firma / nadleśnictwo), domyślnie firma → KZR", !!(await page.$("#f-skind-firma")) && !!(await page.$("#f-skind-nadlesnictwo")) && (await page.inputValue("#f-purchase-basis")) === "KZR" && !(await page.$("#f-purchase-lesnictwo")));
    await tick(page, "f-skind-nadlesnictwo"); await page.waitForTimeout(100);
    const ndlOpts = await page.$$eval("#dl-suppliers option", o => o.map(x => x.value));
    check("2.2 Nadleśnictwo: lista tylko nadleśnictw, podstawa Deklaracja, pole Leśnictwo", ndlOpts.length === 2 && ndlOpts.every(x => x.startsWith("Nadleśnictwo")) && (await page.inputValue("#f-purchase-basis")) === "DEKL" && !!(await page.$("#f-purchase-lesnictwo")), ndlOpts);
    await fillTab(page, "#f-purchase-supplierName", "Nadleśnictwo Rudy Raciborskie"); await page.waitForTimeout(100);
    const lesn = await page.$$eval("#dl-lesn option", o => o.map(x => x.value));
    check("2.2 Leśnictwo: lista zapisanych leśnictw nadleśnictwa", ["Stanica", "Kuźnia"].every(x => lesn.includes(x)), lesn);
    await page.selectOption("#f-purchase-basis", "KZR");
    check("2.2 Podstawa: ręczna zmiana możliwa", (await page.inputValue("#f-purchase-basis")) === "KZR");
    await page.selectOption("#f-purchase-basis", "DEKL");
    await fillTab(page, "#f-purchase-lesnictwo", "Leśnictwo Testowe");
    await fillTab(page, "#f-purchase-qty", "100"); await page.fill("#f-purchase-price", "210");
    await tick(page, "f-production-enabled"); await page.waitForSelector("#f-production-kwit");
    check("2.2 Produkcja z nadleśnictwa: nadleśnictwo i leśnictwo uzupełnione z zakupu", (await page.inputValue("#f-production-ndl")) === "Rudy Raciborskie" && (await page.inputValue("#f-production-lesnictwo")) === "Leśnictwo Testowe");
    await page.fill("#f-production-kwit", "KW 0600/09/2026");
    await tick(page, "f-mode-own"); await page.waitForSelector("#f-transport-own-runCount");
    await pickVeh(page, 0, "ve_scania");
    await fillTab(page, "#f-transport-own-runs-0-km", "45");
    await fillTab(page, "#f-transport-own-runCount", "4");
    check("2.2 Liczba kursów 4 → 4 osobne rubryki (pojazd i km przejęte z poprzedniego)", (await page.$$(".run-card")).length === 4 && (await runVeh(page, 3)) === "ve_scania" && (await page.inputValue("#f-transport-own-runs-3-km")) === "45");
    check("2.2 Kurs: kierowca domyślny z pojazdu", (await runDrv(page, 2)) === "dr_kowalski" && (await page.inputValue("#f-transport-own-runs-2-driverName")) === "Jan Kowalski");
    await pickVeh(page, 1, "ve_volvo");
    check("2.2 Zmiana pojazdu w kursie → jego kierowca domyślny", (await runDrv(page, 1)) === "dr_nowak" && (await page.inputValue("#f-transport-own-runs-1-driverName")) === "Piotr Nowak");
    for (let i = 0; i < 4; i++) { await fillTab(page, `#f-transport-own-runs-${i}-kwit`, `KW O359${i}/09/2026`); await fillTab(page, `#f-transport-own-runs-${i}-qty`, "100"); await fillTab(page, `#f-transport-own-runs-${i}-weightT`, "33"); }
    check("2.2 Podsumowanie kursów: 400 MP, 132 t, 4 × 45 km × 5 zł = 900,00 zł", nb(await page.textContent("[data-runs-qty]")) === "400 MP" && nb(await page.textContent("[data-runs-t]")).startsWith("132 t") && nb(await page.textContent("[data-runs-cost]")) === "900,00 zł",
      [nb(await page.textContent("[data-runs-qty]")), nb(await page.textContent("[data-runs-t]")), nb(await page.textContent("[data-runs-cost]"))]);
    const calcTxt = nb(await page.textContent('[data-calc="production.chipCost"]'));
    check("Poprawka: opis wyliczenia nie powiela się przy kolejnych przeliczeniach", (calcTxt.match(/zł\/MP/g) || []).length === 1, calcTxt);
    check("2.2 Zatwierdzenie zakupu z 4 kursami", (await approve(page)) === 1);
    const kop = await page.evaluate(() => RIW_DEBUG.store.state.operations.at(-1).transport);
    check("2.2 Zapisane: 4 kursy, 2 pojazdy, 400 MP, koszt 900 zł", kop.runs.length === 4 && kop.reg === "SGL 4T821, SZA 12345" && kop.totalQty === 400 && kop.cost === 900, kop.reg);
    await preset(page, "zakup"); await tick(page, "f-skind-nadlesnictwo"); await fillTab(page, "#f-purchase-supplierName", "Nadleśnictwo Rudy Raciborskie"); await page.waitForTimeout(100);
    check("2.2 Nowe leśnictwo zapisane na liście", (await page.$$eval("#dl-lesn option", o => o.map(x => x.value))).includes("Leśnictwo Testowe"));
    /* ------------- 2.3: dostawca i nadleśnictwo wpisywane ręcznie ------------- */
    await preset(page, "zakup");
    check("2.3 Pole dostawcy: tekst do wpisania + podpowiedzi z kartoteki", (await page.getAttribute("#f-purchase-supplierName", "list")) === "dl-suppliers" && (await page.$$("#dl-suppliers option")).length >= 3);
    await fillTab(page, "#f-purchase-supplierName", "Tartak Nowy Las");
    check("2.3 Nowa firma: komunikat „nowy dostawca”, podstawa KZR", nb(await page.textContent('[data-calc="purchase.supplierName"]')).includes("nowy dostawca") && (await page.inputValue("#f-purchase-basis")) === "KZR");
    await fillTab(page, "#f-purchase-qty", "10"); await page.fill("#f-purchase-price", "200");
    const np0 = await page.evaluate(() => RIW_DEBUG.store.state.partners.length);
    await page.click("#summary [data-save]"); await page.waitForSelector("#confirm-op");
    check("2.3 Podsumowanie: dostawca oznaczony jako nowy", nb(await page.textContent("#confirm-op")).includes("Tartak Nowy Las") && nb(await page.textContent("#confirm-op")).includes("nowy — zostanie dodany do kartoteki"));
    await page.click("#confirm-yes"); await page.waitForSelector("#op-detail"); await closeModals(page);
    check("2.3 Nowa firma dopisana do kartoteki (grupa firma)", await page.evaluate(n => { const s = RIW_DEBUG.store.state; const p = s.partners.find(x => x.name === "Tartak Nowy Las"); return s.partners.length === n + 1 && p && p.kind === "firma" && s.operations.at(-1).purchase.supplierId === p.id; }, np0));
    await preset(page, "zakup"); await tick(page, "f-skind-nadlesnictwo"); await page.waitForTimeout(100);
    await fillTab(page, "#f-purchase-supplierName", "Nadleśnictwo Kędzierzyn");
    await fillTab(page, "#f-purchase-lesnictwo", "Sławięcice");
    check("2.3 Nowe nadleśnictwo wpisane ręcznie: Deklaracja, leśnictwo wpisane", (await page.inputValue("#f-purchase-basis")) === "DEKL" && nb(await page.textContent('[data-calc="purchase.supplierName"]')).includes("nowy dostawca"));
    await fillTab(page, "#f-purchase-qty", "20"); await page.fill("#f-purchase-price", "205");
    check("2.3 Zatwierdzenie zakupu z nowego nadleśnictwa", (await approve(page)) === 1);
    check("2.3 Nowe nadleśnictwo w kartotece z leśnictwem na liście", await page.evaluate(() => { const s = RIW_DEBUG.store.state; const p = s.partners.find(x => x.name === "Nadleśnictwo Kędzierzyn"); return !!p && p.kind === "nadlesnictwo" && s.operations.at(-1).purchase.lesnictwo === "Sławięcice"; }));
    await preset(page, "zakup"); await fillTab(page, "#f-purchase-supplierName", "nadleśnictwo kędzierzyn"); await page.waitForTimeout(100);
    check("2.3 Ponowne wpisanie (inna wielkość liter) → istniejący, grupa i leśnictwa z kartoteki", (await page.isChecked("#f-skind-nadlesnictwo")) && nb(await page.textContent('[data-calc="purchase.supplierName"]')).includes("z kartoteki") && (await page.$$eval("#dl-lesn option", o => o.map(x => x.value))).includes("Sławięcice"));
    await go(page, "kontrahenci");
    check("2.3 Kontrahenci: nowi dostawcy widoczni", nb(await page.textContent("#partners-table")).includes("Tartak Nowy Las") && nb(await page.textContent("#partners-table")).includes("Nadleśnictwo Kędzierzyn"));

    /* ------------- 2.4: kursy transportu zewnętrznego ------------- */
    await preset(page, "zakup");
    await fillTab(page, "#f-purchase-supplierName", "Lander Agro"); await fillTab(page, "#f-purchase-qty", "100"); await page.fill("#f-purchase-price", "230");
    await tick(page, "f-production-enabled"); await page.waitForSelector("#f-production-kwit");
    await page.fill("#f-production-ndl", "Rudy Raciborskie"); await page.fill("#f-production-lesnictwo", "Stanica"); await page.fill("#f-production-kwit", "KW 0800/09/2026");
    await tick(page, "f-mode-external"); await page.waitForSelector("#f-transport-external-runCount");
    await fillTab(page, "#f-transport-external-company", "ESI Logistics");
    await fillTab(page, "#f-transport-external-runs-0-km", "45");
    await fillTab(page, "#f-transport-external-runCount", "4");
    check("2.4 Zewnętrzny: liczba kursów 4 → 4 rubryki (km przejęte z poprzedniego)", (await page.$$("[data-xrun]")).length === 4 && (await page.inputValue("#f-transport-external-runs-3-km")) === "45");
    for (let i = 0; i < 4; i++) { await fillTab(page, `#f-transport-external-runs-${i}-kwit`, `KW E402${i}/09/2026`); await fillTab(page, `#f-transport-external-runs-${i}-reg`, `ESI 1000${i}`); await fillTab(page, `#f-transport-external-runs-${i}-driver`, "Jan Nowak"); await fillTab(page, `#f-transport-external-runs-${i}-qty`, "100"); await fillTab(page, `#f-transport-external-runs-${i}-weightT`, "33"); }
    check("2.4 Zewnętrzny: podsumowanie 400 MP, 132 t, 4 × 45 km × 5 zł = 900,00 zł", nb(await page.textContent("[data-runs-qty]")) === "400 MP" && nb(await page.textContent("[data-runs-t]")).startsWith("132 t") && nb(await page.textContent("[data-runs-cost]")) === "900,00 zł",
      [nb(await page.textContent("[data-runs-qty]")), nb(await page.textContent("[data-runs-cost]"))]);
    await fillTab(page, "#f-transport-external-runs-0-freight", "300");
    check("2.4 Zewnętrzny: fracht kursu z faktury zastępuje km × stawka (300 + 3 × 225 = 975 zł)", nb(await page.textContent("[data-runs-cost]")) === "975,00 zł", nb(await page.textContent("[data-runs-cost]")));
    check("2.4 Zatwierdzenie zakupu z 4 kursami zewnętrznymi", (await approve(page)) === 1);
    const xop = await page.evaluate(() => RIW_DEBUG.store.state.operations.at(-1).transport);
    check("2.4 Zapisane: przewoźnik, 4 kursy, 400 MP, 132 t, 975 zł", xop.company === "ESI Logistics" && xop.runs.length === 4 && xop.totalQty === 400 && xop.totalWeightT === 132 && xop.cost === 975);

    /* ------------- 2.6: kwity wywozowe w każdym kursie ------------- */
    await preset(page, "zakup");
    await tick(page, "f-skind-nadlesnictwo"); await fillTab(page, "#f-purchase-supplierName", "Nadleśnictwo Rybnik"); await fillTab(page, "#f-purchase-lesnictwo", "Wielopole");
    await fillTab(page, "#f-purchase-qty", "100"); await page.fill("#f-purchase-price", "210");
    await tick(page, "f-production-enabled"); await page.waitForSelector("#f-production-outQty");
    check("2.6 Bez transportu: kwit wywozowy przy produkcji", !!(await page.$("#f-production-kwit")));
    await tick(page, "f-mode-own"); await page.waitForSelector("#own-runs");
    check("2.6 Z kursami: brak pola kwitu w produkcji, kwit i m³ w kursie", !(await page.$("#f-production-kwit")) && !!(await page.$("#f-transport-own-runs-0-kwit")) && !!(await page.$("#f-transport-own-runs-0-kwitM3")));
    await pickVeh(page, 0, "ve_scania");
    await fillTab(page, "#f-transport-own-runs-0-km", "30"); await fillTab(page, "#f-transport-own-runCount", "4");
    for (let i = 0; i < 4; i++) { await fillTab(page, `#f-transport-own-runs-${i}-kwit`, `KW 0300/${i + 1}/09/2026`); await fillTab(page, `#f-transport-own-runs-${i}-kwitM3`, "25"); await fillTab(page, `#f-transport-own-runs-${i}-weightT`, "33"); }
    check("2.6 m³ z kwitu × 4 → MP na aucie (25 m³ → 100 MP)", (await page.inputValue("#f-transport-own-runs-2-qty")) === "100");
    check("2.6 Podsumowanie: kwity, 100 m³, 400 MP, wszystko rozwiezione", nb(await page.textContent("#runs-summary")).includes("KW 0300/4/09/2026") && nb(await page.textContent("[data-runs-m3]")) === "100 m³" && nb(await page.textContent("[data-runs-qty]")) === "400 MP" && nb(await page.textContent("[data-runs-limit]")).includes("wszystko rozwiezione"));
    await fillTab(page, "#f-transport-own-runs-3-kwitM3", "26");
    check("2.6 Suma kursów ponad produkcję → blokada z komunikatem", nb(await page.textContent('[data-msg="transport.runs"]')).includes("Suma kursów 404 MP przekracza ilość z produkcji 400 MP"), nb(await page.textContent('[data-msg="transport.runs"]')));
    const nK = await opsN(page);
    await page.click("#summary [data-save]"); await page.waitForTimeout(200);
    check("2.6 Zatwierdzenie zablokowane przy przekroczeniu", !(await page.$("#confirm-op")) && (await opsN(page)) === nK);
    await fillTab(page, "#f-transport-own-runs-3-kwitM3", "25");
    check("2.6 Zatwierdzenie z 4 kwitami", (await approve(page)) === 1);
    const kwS = await page.evaluate(() => { const o = RIW_DEBUG.store.state.operations.at(-1); return { kwit: o.production.kwit, m3: o.transport.totalM3, pw: o.documents.find(d => d.type === "PW").meta.kwit }; });
    check("2.6 Zapisane kwity w produkcji i na PW", kwS.kwit.split(", ").length === 4 && kwS.m3 === 100 && kwS.pw === kwS.kwit, kwS);

    /* ------------- 2.5: transport własny + zewnętrzny w jednej produkcji ------------- */
    await preset(page, "zakup");
    await fillTab(page, "#f-purchase-supplierName", "Lander Agro"); await fillTab(page, "#f-purchase-qty", "100"); await page.fill("#f-purchase-price", "230");
    await tick(page, "f-production-enabled"); await page.waitForSelector("#f-production-kwit");
    await page.fill("#f-production-ndl", "Rudy Raciborskie"); await page.fill("#f-production-lesnictwo", "Stanica"); await page.fill("#f-production-kwit", "KW 0950/09/2026");
    await tick(page, "f-mode-own"); await page.waitForSelector("#own-runs");
    await tick(page, "f-mode-external"); await page.waitForSelector("#ext-runs");
    check("2.5 Własny i zewnętrzny zaznaczone razem — obie sekcje kursów widoczne", (await page.isChecked("#f-mode-own")) && (await page.isChecked("#f-mode-external")) && !!(await page.$("#own-runs")) && (await page.evaluate(() => RIW_DEBUG.plan.norm.transport.mode)) === "mixed");
    await pickVeh(page, 0, "ve_scania");
    await fillTab(page, "#f-transport-own-runs-0-km", "45"); await fillTab(page, "#f-transport-own-runCount", "3");
    for (let i = 0; i < 3; i++) { await fillTab(page, `#f-transport-own-runs-${i}-kwit`, `KW O421${i}/09/2026`); await fillTab(page, `#f-transport-own-runs-${i}-qty`, "80"); await fillTab(page, `#f-transport-own-runs-${i}-weightT`, "33"); }
    await fillTab(page, "#f-transport-external-company", "ESI Logistics"); await fillTab(page, "#f-transport-external-runs-0-km", "45"); await fillTab(page, "#f-transport-external-runCount", "2");
    for (let i = 0; i < 2; i++) { await fillTab(page, `#f-transport-external-runs-${i}-kwit`, `KW E423${i}/09/2026`); await fillTab(page, `#f-transport-external-runs-${i}-reg`, `ESI 2000${i}`); await fillTab(page, `#f-transport-external-runs-${i}-qty`, "80"); await fillTab(page, `#f-transport-external-runs-${i}-weightT`, "33"); }
    const kinds = await page.$$eval("#runs-summary tbody tr", r => r.map(x => x.dataset.runKind).join(","));
    check("2.5 Wspólne podsumowanie: 3 kursy własne + 2 zewnętrzne, 400 MP, 165 t, 1 125,00 zł", kinds === "own,own,own,external,external" && nb(await page.textContent("[data-runs-qty]")) === "400 MP" && nb(await page.textContent("[data-runs-t]")).startsWith("165 t") && nb(await page.textContent("[data-runs-cost]")) === "1 125,00 zł",
      [kinds, nb(await page.textContent("[data-runs-qty]")), nb(await page.textContent("[data-runs-cost]"))]);
    check("2.5 Podział kosztu: flota własna / firma zewnętrzna", nb(await page.textContent("[data-runs-split]")).includes("3 × flota własna: 240 MP, 675,00 zł") && nb(await page.textContent("[data-runs-split]")).includes("2 × ESI Logistics: 160 MP, 450,00 zł"), nb(await page.textContent("[data-runs-split]")));
    check("2.5 Zatwierdzenie produkcji z transportem mieszanym", (await approve(page)) === 1);
    const mop = await page.evaluate(() => { const o = RIW_DEBUG.store.state.operations.at(-1); return { id: o.id, mode: o.transport.mode, n: o.transport.runs.length, cost: o.transport.cost }; });
    check("2.5 Zapisane: tryb mieszany, 5 kursów, 1 125 zł", mop.mode === "mixed" && mop.n === 5 && mop.cost === 1125, mop);
    await openOp(page, mop.id);
    await page.click("#op-docs [data-doctype='TR']"); await page.waitForSelector("#doc-preview");
    const trTxt = nb(await page.textContent("#doc-preview"));
    check("2.5 Karta TR: kursy floty własnej i firmy zewnętrznej osobno", trTxt.includes("Kursy floty własnej") && trTxt.includes("Kursy firmy zewnętrznej — ESI Logistics"));
    await closeModals(page);

    await go(page, "flota");
    check("2.2 Flota: kursy liczone pojedynczo", nb(await page.textContent("#runs-table")).includes("kurs 4"));

    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "e2e_desktop.png"), fullPage: true });
    await ctx.close();
  }

  /* ------------- wyścig dwóch kart ------------- */
  {
    const ctx = await newCtx(browser, { viewport: { width: 1280, height: 900 } });
    const p1 = await ctx.newPage(); watch(p1, "karta1"); await boot(p1);
    const p2 = await ctx.newPage(); watch(p2, "karta2"); await boot(p2);
    for (const p of [p1, p2]) {
      await preset(p, "wz");
      await p.selectOption("#f-sale-productId", "pr_zr_lesna");
      await fillTab(p, "#f-sale-qty", "5000");
      await p.fill("#f-sale-price", "90");
      await p.selectOption("#f-sale-buyerId", "pa_ec_zab");
    }
    await p1.click("#summary [data-save]"); await p1.waitForSelector("#confirm-op");
    await p2.click("#summary [data-save]"); await p2.waitForSelector("#confirm-op");
    await p1.click("#confirm-yes"); await p1.waitForSelector("#op-detail");
    await p2.click("#confirm-yes");
    // odpowiedź na zapis — czekanie na komunikat zamiast stałej przerwy (obciążona maszyna testowa)
    await p2.waitForFunction(() => /Nie zapisano/.test(document.querySelector("#toasts").textContent), null, { timeout: 5000 }).catch(() => {});
    check("Wyścig: druga WZ na ten sam stan odrzucona", nb(await p2.textContent("#toasts")).includes("Nie zapisano"));
    check("Wyścig: stan 3 293 MP, nie ujemny", (await bal(p2, "pr_zr_lesna")) === 3293);
    await ctx.close();
  }

  /* ------------- telefon ------------- */
  {
    const ctx = await newCtx(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(); watch(page, "mobile"); await boot(page);
    for (const r of ["pulpit", "operacje", "nowa?preset=zakup", "nowa?preset=produkcja", "nowa?preset=bezposrednia", "nowa?preset=mm", "stany", "historia", "raporty", "kwit", "dokumenty", "administracja"]) {
      await go(page, r);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`Telefon 390 px: ${r} bez przewijania w poziomie`, over <= 1, over);
    }
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "e2e_mobile.png"), fullPage: false });
    await ctx.close();
  }

  /* ------------- 3.1: rejestracja, role, obieg zatwierdzania, magazyny ------------- */
  {
    const ctx = await newCtx(browser);
    const page = await ctx.newPage(); watch(page, "3.1"); await boot(page);
    check("3.1 Stopka autorska w programie", nb(await page.textContent(".app-foot")).includes("Program stworzony przez Roesner Mateusz dla ResInvest Commodities"));
    check("3.1 Trzy magazyny RiC", (await page.evaluate(() => RIW_DEBUG.store.state.warehouses.map(w => w.name).join("|"))) === "RiC Zabrze|RiC Brąszewice|RiC Rokitki");
    // 3.2: rejestracja domyślnie wyłączona — konta zakłada administrator
    await page.evaluate(() => RIW_DEBUG.app.logout()); await page.waitForSelector("#login-form");
    check("3.2 Logowanie: pole „E-mail służbowy”, tryb OFFLINE, bez zakładki rejestracji", nb(await page.textContent('label[for="lg-login"]')) === (PREMIUM ? "E-mail" : "E-mail służbowy") && nb(await page.textContent(".auth-box .lead")).startsWith("OFFLINE") && !(await page.$('[data-auth-tab="register"]')));
    check("3.2 Wylogowanie: adres #/login", await page.evaluate(() => location.hash === "#/login"));
    await page.fill("#lg-login", "jan@gmail.com"); await page.fill("#lg-pass", "Cokolwiek2026"); await page.click("#lg-submit"); await page.waitForTimeout(200);
    check("3.2 Logowanie: domena spoza firmy odrzucona", nb(await page.textContent("#lg-err")).includes("Wymagany e-mail firmowy"));
    await login(page, LOGINS.u_admin); await go(page, "administracja"); await page.waitForSelector("#access-card");
    await page.check("#cfg-selfreg"); await page.waitForTimeout(250); await page.check("#cfg-approval"); await page.waitForTimeout(250);
    check("3.2 Konfiguracja dostępu: rejestracja i obieg zatwierdzania włączone (audyt SETTINGS_CHANGED)", await page.evaluate(() => { const S = RIW_DEBUG.store.state; return S.config.allowSelfRegistration && S.config.requireApproval && S.audit.filter(a => a.code === "SETTINGS_CHANGED").length === 2; }));
    await page.evaluate(() => RIW_DEBUG.app.logout()); await page.waitForSelector("#login-form");
    await page.click('[data-auth-tab="register"]');
    const reg = async (name, email) => { await page.fill("#rg-name", name); await page.fill("#rg-email", email); await page.fill("#rg-pass", "Rejestracja2026"); await page.fill("#rg-pass2", "Rejestracja2026"); await page.click("#rg-submit"); await page.waitForTimeout(400); };
    await reg("Jan Obcy", "jan@gmail.com");
    check("3.1 Rejestracja: tylko domena firmowa", nb(await page.textContent("#rg-err")).includes("Wymagany e-mail firmowy"));
    await reg("Ewa Nowicka", "ewa.nowicka@resinvest.group");
    check("3.1 Rejestracja: konto utworzone, oczekuje", nb(await page.textContent("#auth-info")).includes("zarejestrowane"));
    await page.fill("#lg-pass", "Rejestracja2026"); await page.click("#lg-submit"); await page.waitForTimeout(400);
    check("3.1 Rejestracja: logowanie zablokowane do zatwierdzenia", nb(await page.textContent("#lg-err")).includes("oczekuje na zatwierdzenie"));
    await login(page, LOGINS.u_admin);
    check("3.1 Zgłoszenie widoczne dla administratora (pulpit)", nb(await page.textContent("#dash-todo")).includes("zgłoszenie rejestracji"));
    await go(page, "uzytkownicy"); await page.waitForSelector("#reg-table");
    await page.click("[data-uapprove]"); await page.waitForSelector("#user-edit");
    await page.selectOption("#me-role", "magazynier"); await page.selectOption("#me-whId", "wh_zab"); await page.click("#user-edit [data-yes]"); await page.waitForTimeout(400);
    check("3.1 Administrator aktywuje konto (rola, magazyn, status)", (await page.evaluate(() => { const u = RIW_DEBUG.store.state.users.find(x => x.login === "ewa.nowicka@resinvest.group"); return `${u.role}/${u.whId}/${u.status}`; })) === "magazynier/wh_zab/ACTIVE");
    // magazynier przekazuje operację do zatwierdzenia
    await login(page, "ewa.nowicka@resinvest.group", "Rejestracja2026");
    await preset(page, "wz");
    check("3.1 Magazynier: przycisk „Przekaż do zatwierdzenia…”", nb(await page.textContent("#summary [data-save]")) === "Przekaż do zatwierdzenia…");
    await page.selectOption("#f-sale-productId", "pr_zr_lesna"); await fillTab(page, "#f-sale-qty", "120"); await page.fill("#f-sale-price", "90"); await page.selectOption("#f-sale-buyerId", "pa_ec_zab"); await page.waitForTimeout(100);
    const n0 = await opsN(page), st0 = await bal(page, "pr_zr_lesna");
    await page.click("#summary [data-save]"); await page.waitForSelector("#confirm-op"); await page.click("#confirm-yes"); await page.waitForTimeout(500);
    check("3.1 Przekazana operacja: bez numeru i bez zmiany stanu", (await opsN(page)) === n0 && (await bal(page, "pr_zr_lesna")) === st0 && (await page.evaluate(() => RIW_DEBUG.store.state.drafts.filter(d => d.status === "PENDING").length)) === 1);
    // kierownik innego magazynu nie widzi kolejki, kierownik Zabrza zatwierdza
    await login(page, LOGINS.u_kbra); await go(page, "operacje");
    check("3.1 Kierownik Brąszewic nie zatwierdza operacji Zabrza", !(await page.$("#approvals-table [data-review]")));
    await login(page, LOGINS.u_kier); await go(page, "operacje"); await page.waitForSelector("#approvals-table");
    check("3.1 Kolejka „Do zatwierdzenia” u kierownika (znacznik w menu)", nb(await page.textContent('[data-nav="operacje"] .cnt')) === "1");
    await page.click("#approvals-table [data-review]"); await page.waitForSelector("#opf");
    await page.click("#summary [data-save]"); await page.waitForSelector("#confirm-op"); await page.click("#confirm-yes");
    await page.waitForSelector("#op-detail", { timeout: 4000 }).catch(() => {});
    const apr = await page.evaluate(() => { const o = RIW_DEBUG.store.state.operations.at(-1); return { no: o.no, by: o.userName, ap: o.approvedByName }; });
    check("3.1 Zatwierdzenie: dokument WZ, autor magazynier, zatwierdził kierownik", apr.no.startsWith("WZ/") && apr.by === "Ewa Nowicka" && apr.ap === "Anna Górska" && (await bal(page, "pr_zr_lesna")) === st0 - 120, apr);
    await closeModals(page);
    // obieg wyłączony — magazynier zatwierdza sam
    await login(page, LOGINS.u_admin); await go(page, "administracja"); await page.waitForSelector("#access-card"); await page.uncheck("#cfg-approval"); await page.waitForTimeout(250);
    await login(page, "ewa.nowicka@resinvest.group", "Rejestracja2026"); await preset(page, "wz");
    check("3.2 Obieg wyłączony: magazynier ma przycisk „Zatwierdź…”", nb(await page.textContent("#summary [data-save]")) === "Zatwierdź…");
    // obserwator
    await login(page, LOGINS.u_view);
    check("3.1 Obserwator: brak „Nowej operacji” i edycji kartotek", await page.evaluate(() => document.querySelector("#top-new").classList.contains("hidden")) && (await go(page, "produkty"), !(await page.$("[data-madd]"))));
    // administrator: magazyn roboczy, flota wg magazynu
    await login(page, LOGINS.u_admin);
    await page.click("#wh-chip"); await page.click('[data-wh="wh_rok"]'); await page.waitForTimeout(300);
    check("3.1 Administrator przełącza magazyn roboczy", nb(await page.textContent("#wh-chip")).includes("RiC Rokitki"));
    await preset(page, "produkcja");
    const chOpts = await page.$$eval("#dl-chippers option", o => o.map(x => x.value).filter(Boolean));
    check("3.1 Formularz: rębaki własne tylko z magazynu operacji (+ rębaki firm zewnętrznych)", chOpts.includes("Albach Diamant 2000") && !chOpts.includes("Eschlböck Biber 92") && chOpts.every(v => v === "Albach Diamant 2000" || / — /.test(v)), chOpts);
    // 3.2: zakup — ilość w m³, cena za MP; zmiana jednostki ilości przelicza ilość; transport zapewnia dostawca
    await preset(page, "zakup");
    await fillTab(page, "#f-purchase-supplierName", "Lander Agro"); await fillTab(page, "#f-purchase-qty", "10");
    await page.selectOption("#f-purchase-priceUnit", "MP"); await page.waitForTimeout(150);
    await fillTab(page, "#f-purchase-price", "57,5");
    check("3.2 Zakup: 10 m³ × 57,50 zł/MP = 2 300 zł (ilość w m³, cena za MP)", nb(await out(page, "purchase.cost")).startsWith("2 300,00"), await out(page, "purchase.cost"));
    await page.selectOption("#f-purchase-unit", "MP"); await page.waitForTimeout(150);
    check("3.2 Zmiana jednostki ilości m³ → MP przelicza ilość (10 m³ = 40 MP), koszt bez zmian", (await page.inputValue("#f-purchase-qty")) === "40" && nb(await out(page, "purchase.cost")).startsWith("2 300,00"), await page.inputValue("#f-purchase-qty"));
    await tick(page, "f-mode-supplier"); await page.waitForTimeout(150);
    check("3.2 Transport w cenie zakupu — zapewnia dostawca (bez TR)", nb(await page.textContent("#opf")).includes("Transport zapewnia dostawca Lander Agro") && !nb(await page.textContent("#summary")).includes("TR "));
    const nBuy = await opsN(page);
    check("3.2 Zatwierdzenie zakupu z transportem dostawcy", (await approve(page)) === 1 && (await page.evaluate(() => { const o = RIW_DEBUG.store.state.operations.at(-1); return o.transport.mode === "supplier" && o.totals.purchaseCost === 2300 && !o.documents.some(d => d.type === "TR"); })), nBuy);
    await closeModals(page);
    // 3.2: korekta zakupu drewna — zmiana jednostki ilości MP → m³ i ceny na zł/m³ (zgłoszenie: „brak korekty z m³ na MP”)
    const buyOp = await lastOp(page), wood0 = await bal(page, "pr_drewno", "wh_rok");
    await openOp(page, buyOp.id); await page.click("#op-detail [data-correct]"); await page.waitForSelector("#corr-preview");
    await page.selectOption("#f-purchase-unit", "m3"); await page.waitForTimeout(150);
    check("3.2 Korekta: zmiana jednostki MP → m³ przelicza ilość (40 MP = 10 m³)", (await page.inputValue("#f-purchase-qty")) === "10", await page.inputValue("#f-purchase-qty"));
    await page.selectOption("#f-purchase-priceUnit", "m3"); await page.waitForTimeout(150); await fillTab(page, "#f-purchase-price", "240");
    await page.selectOption("#corr-reason", { index: 1 });
    await page.click("#summary [data-save]"); await page.click(".scrim [data-yes]");
    await page.waitForSelector("#op-detail"); await page.waitForTimeout(200);
    const corrOp = await page.evaluate(id => { const o = RIW_DEBUG.store.state.operations.find(x => x.id === id); return { st: o.status, unit: o.purchase.unit, pu: o.purchase.priceUnit, cost: o.totals.purchaseCost, stock: o.purchase.stockQty }; }, buyOp.id);
    check("3.2 Korekta zapisana: 10 m³ × 240 zł/m³ = 2 400 zł, stan drewna bez zmian", corrOp.st === "CORRECTED" && corrOp.unit === "m3" && corrOp.pu === "m3" && corrOp.cost === 2400 && corrOp.stock === 10 && (await bal(page, "pr_drewno", "wh_rok")) === wood0, corrOp);
    await closeModals(page);
    // 3.2: Produkty — nowa łupina liczona w MP, PKS z gęstością (m³)
    await go(page, "produkty"); await page.click('[data-madd="products"]'); await page.waitForSelector("#master-edit");
    await page.fill("#me-code", "LUP-MP"); await page.fill("#me-name", "Łupina nerkowca MP"); await page.selectOption("#me-cat", "agro");
    await page.selectOption("#me-unit", "MP"); await page.check('[data-unit-ok="m3"]'); await page.fill("#me-tPerUnit", "0,25");
    await page.click("#master-edit [data-yes]"); await page.waitForTimeout(300);
    const lupMP = await page.evaluate(() => { const p = RIW_DEBUG.store.state.products.find(x => x.code === "LUP-MP"); return p ? `${p.unit}/${RIW_DEBUG.R.Units.allowed(p).join(",")}` : null; });
    check("3.2 Produkty: nowa łupina w MP (dozwolone m³, MP, t)", lupMP === "MP/m3,MP,t", lupMP);
    await page.click('[data-medit="products|pr_pks"]'); await page.waitForSelector("#master-edit");
    check("3.2 Produkty: PKS — jednostka magazynowa zablokowana (ruchy w księdze)", await page.$eval("#me-unit", x => x.disabled));
    await page.check('[data-unit-ok="m3"]'); await page.fill("#me-tPerM3", "0,6"); await page.click("#master-edit [data-yes]"); await page.waitForTimeout(300);
    check("3.2 Produkty: PKS kupowany także w m³ (gęstość 0,6 t/m³)", await page.evaluate(() => { const p = RIW_DEBUG.store.state.products.find(x => x.id === "pr_pks"); return RIW_DEBUG.R.Units.allowed(p).join(",") === "m3,t" && RIW_DEBUG.R.Units.convert(10, "m3", "t", p, RIW_DEBUG.store.state.config) === 6; }));
    // 3.2: dodanie użytkownika (OFFLINE — hasło tymczasowe), wiele magazynów, status
    await go(page, "admin/users"); await page.waitForSelector("#users-table");
    check("3.2 Tabela użytkowników: kolumny wg specyfikacji", (await page.$$eval("#users-table thead th", l => l.map(x => x.textContent.trim()).join("|"))) === "Użytkownik|E-mail|Rola|Magazyn|Status|Ostatnie logowanie|Akcje");
    await page.click("#user-add"); await page.waitForSelector("#user-edit");
    await page.fill("#me-firstName", "Olga"); await page.fill("#me-lastName", "Testowa"); await page.fill("#me-email", "Olga.Testowa@resinvest.group");
    await page.selectOption("#me-role", "kierownik"); await page.selectOption("#me-whId", "wh_bra"); await page.check('[data-whacc="wh_rok"]');
    await page.fill("#me-pw", "Tymczas2026"); await page.fill("#me-pw2", "Tymczas2026"); await page.click("#user-edit [data-yes]"); await page.waitForTimeout(400);
    const olga = await page.evaluate(() => { const u = RIW_DEBUG.store.state.users.find(x => x.login === "olga.testowa@resinvest.group"); return u ? `${u.name}/${u.role}/${u.whId}/${u.warehouseIds.sort().join(",")}/${u.status}` : null; });
    check("3.2 Dodanie użytkownika: imię, nazwisko, e-mail (małe litery), rola, magazyn domyślny + dostępne", olga === "Olga Testowa/kierownik/wh_bra/wh_bra,wh_rok/ACTIVE", olga);
    const oid = await page.evaluate(() => RIW_DEBUG.store.state.users.find(x => x.login === "olga.testowa@resinvest.group").id);
    await page.click(`[data-ustat="${oid}|SUSPENDED"]`); await page.waitForTimeout(200); await page.click(".scrim [data-yes] >> nth=-1"); await page.waitForTimeout(300);
    check("3.2 Zawieszenie konta (status SUSPENDED, audyt USER_SUSPENDED)", await page.evaluate(id => { const S = RIW_DEBUG.store.state; return S.users.find(u => u.id === id).status === "SUSPENDED" && S.audit.some(a => a.code === "USER_SUSPENDED" && a.entityId === id); }, oid));
    // role i audyt
    await go(page, "admin/roles"); await page.waitForSelector("#roles-grid");
    const rolesTxt = nb(await page.textContent("#roles-grid"));
    check("3.2 Role: ADMINISTRATOR, MANAGER, MAGAZYNIER, OBSERWATOR, AUDYTOR", ["ADMINISTRATOR", "MANAGER", "MAGAZYNIER", "OBSERWATOR", "AUDYTOR"].every(c => rolesTxt.includes(c)));
    await page.check('[data-perm="obserwator|reports.export"]'); await page.click('[data-rsave="obserwator"]'); await page.waitForTimeout(300);
    check("3.2 Edycja uprawnień roli (audyt ROLE_PERMISSIONS_CHANGED)", await page.evaluate(() => RIW_DEBUG.R.can({ role: "obserwator" }, "reports.export") && RIW_DEBUG.store.state.audit.at(-1).code === "ROLE_PERMISSIONS_CHANGED"));
    await page.click('[data-rreset="obserwator"]'); await page.waitForTimeout(300);
    check("3.2 Przywrócenie domyślnych uprawnień", await page.evaluate(() => !RIW_DEBUG.R.can({ role: "obserwator" }, "reports.export")));
    await go(page, "admin/audit"); await page.waitForSelector("#audit-admin-table");
    const auTxt = nb(await page.textContent("#audit-admin-table"));
    check("3.2 Dziennik audytu: kody zdarzeń (USER_CREATED, USER_SUSPENDED, ROLE_PERMISSIONS_CHANGED)", ["USER_CREATED", "USER_SUSPENDED", "ROLE_PERMISSIONS_CHANGED"].every(c => auTxt.includes(c)));
    // kierownik z dwoma magazynami przełącza magazyn roboczy tylko na przydzielone
    await login(page, LOGINS.u_kier);
    await page.click("#wh-chip"); await page.waitForSelector(".dd [data-wh], [data-wh]");
    const whOpts = await page.$$eval("[data-wh]", l => l.map(x => x.dataset.wh).join(","));
    check("3.2 Magazyn roboczy: tylko przydzielone magazyny (Zabrze, Brąszewice)", whOpts === "wh_zab,wh_bra", whOpts);
    await page.click('[data-wh="wh_bra"]'); await page.waitForTimeout(300);
    check("3.2 Przełączenie na RiC Brąszewice", nb(await page.textContent("#wh-chip")).includes("RiC Brąszewice"));
    await page.click("#wh-chip"); await page.click('[data-wh="wh_zab"]'); await page.waitForTimeout(200);
    await login(page, LOGINS.u_bra);
    check("3.2 Magazynier jednego magazynu: bez przełącznika", !(await page.evaluate(() => document.querySelector("#wh-chip").classList.contains("switchable"))));
    await ctx.close();
  }

  /* ------------- 3.4: operacje dodatkowe, kartoteka, kafel pulpitu, tonaż, numery ręczne, usuwanie, XLSX/DOCX ------------- */
  {
    const ctx = await newCtx(browser); const page = await ctx.newPage(); watch(page, "3.4");
    await boot(page);
    // kafel pulpitu z wyborem miesiąca
    check("3.4 Pulpit: kafel OPERACJE DODATKOWE z wyborem miesiąca", await allExist(page, ["#dash-extras", "#xt-month", "#xt-cost", "#xt-count"]) && nb(await page.textContent("#dash-extras h3")) === "OPERACJE DODATKOWE");
    const expSep = await page.evaluate(() => { const R = RIW_DEBUG.R, S = RIW_DEBUG.store.state; return R.Reports.extras(S, "2026-09-01", "2026-09-23", "wh_zab"); });
    check("3.4 Pulpit: koszt i liczba = zestawienie silnika (wrzesień)", nb(await page.textContent("#xt-count")) === String(expSep.count) && nb(await page.textContent("#xt-cost")).replace(/\s/g, "") === (await page.evaluate(v => RIW_DEBUG.R.money(v), expSep.cost)).replace(/[\s  ]/g, ""), { exp: expSep.count, got: await page.textContent("#xt-count") });
    await page.fill("#xt-month", "2026-08"); await page.dispatchEvent("#xt-month", "change"); await page.waitForTimeout(250);
    const expAug = await page.evaluate(() => RIW_DEBUG.R.Reports.extras(RIW_DEBUG.store.state, "2026-08-01", "2026-08-31", "wh_zab"));
    check("3.4 Pulpit: zmiana miesiąca (sierpień) przelicza kafel", nb(await page.textContent("#xt-count")) === String(expAug.count) && expAug.count >= 1 && nb(await page.textContent("#xt-table")).includes("Holowanie"), expAug.count);
    // kartoteka
    await go(page, "dodatkowe"); await page.waitForSelector("#extra-types-table");
    check("3.4 Kartoteki → Dodatkowe operacje: lista rodzajów z bazy", (await page.$$eval("#extra-types-table tbody tr", r => r.length)) >= 5 && nb(await page.textContent("#extra-types-table")).includes("Holowanie"));
    check("3.4 Menu: pozycja „Dodatkowe operacje” w Kartotekach", nb(await page.textContent("#nav")).includes("Dodatkowe operacje"));
    // produkcja z operacjami dodatkowymi
    await preset(page, "produkcja");
    await fillTab(page, "#f-production-outQty", "100");
    check("3.4 Produkcja: checkbox „Dodaj operację dodatkową”", !!(await page.$("#f-extras-enabled")) && nb(await page.textContent("#opf")).includes("Dodaj operację dodatkową"));
    await tick(page, "f-extras-enabled"); await page.waitForSelector("#f-extras-items-0-typeId");
    await page.selectOption("#f-extras-items-0-typeId", "xt_holowanie"); await page.waitForTimeout(120);
    await page.selectOption("#f-extras-items-0-vehicleId", "ve_scania"); await page.waitForTimeout(80);
    await fillTab(page, "#f-extras-items-0-cost", "500");
    await page.click("#extra-add"); await page.waitForSelector("#f-extras-items-1-typeId");
    await page.selectOption("#f-extras-items-1-typeId", "xt_ladowarka"); await page.waitForTimeout(120);
    await fillTab(page, "#f-extras-items-1-qty", "2");
    check("3.4 Produkcja: koszt pozycji = ilość × stawka domyślna (2 h × 160 zł)", (await out(page, "extra.1.cost")).includes("320,00"), await out(page, "extra.1.cost"));
    check("3.4 Produkcja: suma operacji dodatkowych 820,00 zł", (await out(page, "extras.total")).includes("820,00"), await out(page, "extras.total"));
    await page.click("#summary [data-save]"); await page.waitForSelector("#confirm-op");
    check("3.4 Podsumowanie: operacje dodatkowe w oknie zatwierdzenia", nb(await page.textContent("#confirm-op")).includes("Holowanie"));
    await page.click("#confirm-op [data-no]"); await page.waitForTimeout(100);
    check("3.4 Produkcja z operacjami dodatkowymi zapisana", (await approve(page)) === 1);
    const xo = await page.evaluate(() => { const o = RIW_DEBUG.store.state.operations.at(-1); return { id: o.id, n: o.extras.length, cost: o.totals.extraCost, linked: o.extras.every(x => x.opId === o.id) }; });
    check("3.4 Operacje dodatkowe: 2 osobne rekordy powiązane z operacją, koszt 820 zł", xo.n === 2 && xo.cost === 820 && xo.linked, xo);
    await openOp(page, xo.id);
    check("3.4 Szczegóły operacji: lista operacji dodatkowych", nb(await page.textContent("#op-extras")).includes("Holowanie") && nb(await page.textContent("#op-extras")).includes("SGL 4T821"));
    await closeModals(page);
    // sprzedaż z tonażem ręcznym i ręcznym numerem WZ
    await preset(page, "wz");
    await page.selectOption("#f-sale-productId", "pr_zr_lesna"); await page.waitForTimeout(100);
    await fillTab(page, "#f-sale-qty", "60");
    await page.fill("#f-sale-price", "90"); await page.selectOption("#f-sale-buyerId", "pa_ec_zab"); await page.waitForTimeout(100);
    await page.selectOption("#f-sale-weightMode", "manual"); await page.waitForSelector("#f-sale-weightManual");
    await fillTab(page, "#f-sale-weightManual", "20,35");
    check("3.4 Sprzedaż: linia „60 MP | 20,35 t | RĘCZNY”", (await out(page, "sale.tonLine")) === "60 MP | 20,35 t | RĘCZNY", await out(page, "sale.tonLine"));
    check("3.4.1 Numeracja WZ: lista „Automatycznie / Ręcznie”, domyślnie automatycznie", (await page.inputValue("#f-docNoMode-WZ")) === "auto" && !(await page.$("#f-docNos-WZ")) && (await page.$$eval("#f-docNoMode-WZ option", o => o.map(x => x.value).join(","))) === "auto,manual");
    await page.selectOption("#f-docNoMode-WZ", "manual"); await page.waitForSelector("#f-docNos-WZ");
    await fillTab(page, "#f-docNos-WZ", "WZ/27");
    await fillTab(page, "#f-docDate", "2026-09-22");
    check("3.4.1 Sprzedaż z magazynu: sekcja operacji dodatkowych dostępna", !!(await page.$("#f-extras-enabled")));
    await tick(page, "f-extras-enabled"); await page.waitForSelector("#f-extras-items-0-typeId");
    await page.selectOption("#f-extras-items-0-typeId", "xt_holowanie"); await page.waitForTimeout(100);
    await fillTab(page, "#f-extras-items-0-cost", "150");
    check("3.4 Sprzedaż z ręcznym numerem WZ zapisana", (await approve(page)) === 1);
    const wz = await page.evaluate(() => { const o = RIW_DEBUG.store.state.operations.at(-1), d = o.documents.find(x => x.type === "WZ"); return { id: o.id, no: d.no, docDate: d.docDate, mode: d.weightMode, w: o.sale.weightT }; });
    check("3.4 WZ: numer ręczny WZ/27, data dokumentu 22.09, tonaż RĘCZNY 20,35 t", wz.no === "WZ/27" && wz.docDate === "2026-09-22" && wz.mode === "manual" && wz.w === 20.35, wz);
    check("3.4.1 WZ: operacja dodatkowa zapisana przy sprzedaży (150 zł)", await page.evaluate(() => { const o = RIW_DEBUG.store.state.operations.at(-1); return o.extras.length === 1 && o.totals.extraCost === 150; }));
    await preset(page, "wz");
    await page.selectOption("#f-sale-productId", "pr_zr_lesna"); await page.waitForTimeout(100);
    await fillTab(page, "#f-sale-qty", "10"); await page.fill("#f-sale-price", "90"); await page.selectOption("#f-sale-buyerId", "pa_ec_zab"); await page.waitForTimeout(100);
    await page.selectOption("#f-docNoMode-WZ", "manual"); await page.waitForSelector("#f-docNos-WZ");
    await fillTab(page, "#f-docNos-WZ", "wz/27");
    check("3.4 Numer WZ/27 drugi raz w magazynie i roku — odrzucony", (await msg(page, "docNos.WZ")).includes("już użyty"), await msg(page, "docNos.WZ"));
    // rejestr dokumentów: akcje, kolory, eksport XLSX
    await go(page, "dokumenty"); await page.waitForTimeout(150);
    check("3.4 Rejestr dokumentów: akcje Otwórz / Podgląd / Koryguj / Usuń", await allExist(page, ["[data-corr]", "[data-del]"]) && nb(await page.textContent("#page")).includes("Podgląd"));
    // 3.8: jedna seria WZ — wszystkie dokumenty mają znacznik WZ (jeden kolor), rodzaj ruchu tylko jako opis pomocniczy
    const badges = await page.$$eval("#docs-table tbody .doc-badge", b => [...new Set(b.map(x => x.textContent.trim() + "|" + x.className))]);
    check("3.8 Rejestr: wszystkie dokumenty w jednej serii WZ (znacznik WZ, jeden kolor)", badges.length === 1 && badges[0].startsWith("WZ|") && badges[0].includes("doc-WZ") && !!(await page.$("tr.doc-row-WZ")) && !(await page.$("tr.doc-row-PZ")), badges);
    const wzColor = await page.$eval(".doc-badge.doc-WZ", e => getComputedStyle(e).backgroundColor);
    check("3.8 Rejestr: znacznik WZ — mocny kolor (pełne tło)", wzColor === "rgb(194, 65, 12)", wzColor);
    const rows1 = await page.$$eval("#docs-table tbody tr", r => r.length);
    check("3.8 Rejestr: numery w formacie WZ/NNN/MM/RRRR", (await page.$$eval("#docs-table tbody tr td:first-child b", b => b.map(x => x.textContent))).every(n => /^WZ\//.test(n) || n === "WZ/27"));
    await page.check("#r-aux"); await page.waitForTimeout(200);
    const txt2 = nb(await page.textContent("#docs-table"));
    check("3.8 Rejestr: „Pokaż dokumenty pomocnicze” dodaje zużycie, produkcję i transport (także w serii WZ)", (await page.$$eval("#docs-table tbody tr", r => r.length)) > rows1 && ["Rozchód wewnętrzny (zużycie)", "Przyjęcie wewnętrzne (produkcja)", "Karta transportu"].every(x => txt2.includes(x)), rows1);
    await page.uncheck("#r-aux"); await page.waitForTimeout(150);
    const [dlx] = await Promise.all([page.waitForEvent("download"), page.click("#reg-xlsx")]);
    const xfile = path.join(TMP, "rejestr.xlsx"); await dlx.saveAs(xfile);
    const xb = fs.readFileSync(xfile);
    check("3.4 Eksport XLSX rejestru: plik ZIP/OOXML z arkuszem", xb.readUInt32LE(0) === 0x04034b50 && xb.includes(Buffer.from("xl/worksheets/sheet1.xml")) && dlx.suggestedFilename().endsWith(".xlsx"), dlx.suggestedFilename());
    // usuwanie (soft delete) WZ/27
    await page.click(`[data-del="${wz.id}"]`).catch(async () => { await openOp(page, wz.id); await page.click("#op-delete-btn"); });
    await page.waitForSelector("#delete-dialog");
    await page.click("#delete-yes"); await page.waitForTimeout(150);
    check("3.4 Usuń: wymagany powód", !!(await page.$("#delete-dialog")));
    const opt = await page.$$eval("#delete-reason option", o => o.map(x => x.value).filter(Boolean)[0]);
    await page.selectOption("#delete-reason", opt);
    if (await page.$("#delete-reason-text")) await page.fill("#delete-reason-text", "dokument wprowadzony podwójnie");
    await page.click("#delete-yes"); await page.waitForTimeout(400);
    const del = await page.evaluate(id => { const o = RIW_DEBUG.store.state.operations.find(x => x.id === id); return { exists: !!o, deleted: !!(o && o.deleted), audit: RIW_DEBUG.store.state.audit.some(a => a.entityId === id && a.event === "delete") }; }, wz.id);
    check("3.4 Usuń = soft delete: rekord zostaje, znacznik usunięcia, wpis w audycie", del.exists && del.deleted && del.audit, del);
    await closeModals(page); await go(page, "dokumenty"); await page.waitForTimeout(150);
    check("3.4 Rejestr: usunięty dokument ukryty domyślnie", !nb(await page.textContent("#page")).includes("WZ/27"));
    await page.check("#r-deleted"); await page.waitForTimeout(200);
    check("3.4 Rejestr: filtr „Pokaż usunięte” pokazuje WZ/27 jako USUNIĘTY", nb(await page.textContent("#page")).includes("WZ/27") && nb(await page.textContent("#page")).includes("USUNIĘTY"));
    // DOCX z podglądu dokumentu (rejestr → Podgląd)
    await page.click("[data-view] >> nth=0"); await page.waitForSelector('[data-docx="doc"]');
    const [dd] = await Promise.all([page.waitForEvent("download"), page.click('[data-docx="doc"]')]);
    const dfile = path.join(TMP, "dok.docx"); await dd.saveAs(dfile);
    const db = fs.readFileSync(dfile);
    check("3.4 Eksport DOCX dokumentu z podglądu", dd.suggestedFilename().endsWith(".docx") && db.readUInt32LE(0) === 0x04034b50 && db.includes(Buffer.from("word/document.xml")), dd.suggestedFilename());
    await closeModals(page);
    // rębak firmy zewnętrznej w produkcji (operator opisowy)
    await preset(page, "produkcja");
    await pickChip(page, "ch_ext_drwal");
    check("3.4 Rębak firmy zewnętrznej: pole operatora opisowego zamiast operatora z floty", !!(await page.$("#f-production-operatorName")) && /firma zewnętrzna/.test(await page.textContent('[data-field="production.operatorId"] label')) && (await page.evaluate(() => RIWForm.draft.production.chipperId)) === "ch_ext_drwal");
    // telefon: kafel bez poziomego przewijania
    await page.setViewportSize({ width: 390, height: 844 }); await go(page, "pulpit"); await page.waitForTimeout(250);
    check("3.4 Telefon: kafel operacji dodatkowych mieści się w szerokości", await page.evaluate(() => { const e = document.querySelector("#dash-extras"); return e && e.getBoundingClientRect().right <= window.innerWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1; }));
    await ctx.close();
  }

  /* ------------- 3.5: planer zakupów, powiadomienia, poczta ------------- */
  {
    const ctx = await newCtx(browser); const page = await ctx.newPage(); watch(page, "3.5");
    await boot(page);                                     // Anna Górska (kierownik Zabrze + Brąszewice)
    check("3.5 Menu: Planer zakupów i Powiadomienia; Poczta tylko dla administratora", !!(await page.$('#nav [data-nav="planer"]')) && !!(await page.$('#nav [data-nav="powiadomienia"]')) && !(await page.$('#nav [data-nav="poczta"]')));
    const badge = await page.textContent("#bell-btn");
    check("3.5 Dzwonek: liczba nieprzeczytanych powiadomień", /\d/.test(badge), badge);
    await go(page, "planer"); await page.waitForSelector("#pl-week-table");
    await page.fill("#pl-date", "2026-09-14"); await page.dispatchEvent("#pl-date", "change"); await page.waitForSelector("#pl-week-table");
    const wk = await page.evaluate(() => [...document.querySelectorAll("#pl-week-table tbody tr")].map(r => r.dataset.day));
    check("3.5 Planer: tydzień pon–niedz (14–20.09.2026)", wk.length === 7 && wk[0] === "2026-09-14" && wk[6] === "2026-09-20", wk);
    const act15 = nb(await page.textContent('#pl-week-table tr[data-day="2026-09-15"] td:nth-child(3)'));
    check("3.5 Planer: wykonanie 15.09 = 600 MP z produkcji w lesie (AUTO z dokumentu)", act15 === "600", act15);
    // wpis planu dnia: zapis po Enter, wersja, audyt
    await page.fill("#plan-2026-09-17", "75,5"); await page.press("#plan-2026-09-17", "Enter"); await page.waitForTimeout(300);
    const pl = await page.evaluate(() => RIW_DEBUG.store.state.plans.find(p => p.whId === "wh_zab" && p.date === "2026-09-17"));
    check("3.5 Planer: plan dnia zapisany w danych (75,5 MP, wersja 2, autor)", pl && pl.planMP === 75.5 && pl.version === 2 && pl.updatedBy === "Anna Górska", pl);
    check("3.5 Planer: zmiana planu w dzienniku audytu (PLAN_UPDATED)", await page.evaluate(() => RIW_DEBUG.store.state.audit.at(-1).code === "PLAN_UPDATED"));
    check("3.5 Planer: po Enter fokus na następnym dniu", await page.evaluate(() => document.activeElement && document.activeElement.id === "plan-2026-09-18"));
    await page.fill("#plan-2026-09-18", "-3"); await page.press("#plan-2026-09-18", "Enter"); await page.waitForTimeout(300);
    check("3.5 Planer: plan ujemny odrzucony z komunikatem", (await page.textContent("#toasts")).includes("Plan nie może być ujemny"));
    // dokumenty źródłowe dnia
    await page.click('#pl-week-table tr[data-day="2026-09-15"] .drill'); await page.waitForSelector("#drill");
    check("3.5 Planer: dokumenty źródłowe dnia w oknie", (await page.$$("#drill [data-opid]")).length === 1);
    await closeModals(page);
    await page.click('[data-plview="year"]'); await page.waitForSelector("#pl-year-table");
    const sepAct = nb(await page.textContent('#pl-year-table tr[data-goto-month="2026-09"] td:nth-child(3)'));
    check("3.5 Planer: miesiące i rok — wrzesień 680 MP, wykres 12 miesięcy", sepAct === "680" && (await page.$$("#pl-chart rect[data-month]")).length === 12, sepAct);
    await page.click('[data-plview="drivers"]'); await page.waitForSelector("#pl-drivers");
    await page.click('[data-plview="week"]');
    await page.selectOption("#pl-wh", "ALL"); await page.waitForSelector("#pl-week-table");
    check("3.5 Planer: „Wszystkie magazyny” — suma bez pól edycji", !(await page.$(".plan-in")));
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#pl-xlsx")]);
    check("3.5 Planer: eksport XLSX", dl.suggestedFilename().startsWith("planer_week") && dl.suggestedFilename().endsWith(".xlsx"), dl.suggestedFilename());
    // powiadomienia: skrzynka, otwarcie operacji, przeczytane
    await go(page, "powiadomienia"); await page.waitForSelector("#nt-list");
    const unread0 = await page.evaluate(() => RIWUI.unreadNotices());
    await page.click("#nt-list .nt-item.unread >> nth=0"); await page.waitForSelector("#op-detail, .modal", { timeout: 4000 });
    check("3.5 Powiadomienia: kliknięcie otwiera operację i oznacza jako przeczytane", (await page.evaluate(() => RIWUI.unreadNotices())) === unread0 - 1);
    await closeModals(page);
    // ustawienia własne: zdarzenie bez zgody zablokowane
    await page.click('[data-nttab="settings"]'); await page.waitForSelector("#nt-events");
    check("3.5 Powiadomienia: zdarzenie bez zgody administratora zablokowane (Decyzja)", await page.$eval('[data-ev="DECISION"]', x => x.disabled));
    await page.click('label.nt-ev:has([data-ev="PW"])'); await page.waitForTimeout(250);
    check("3.5 Powiadomienia: włączenie zdarzenia zapisuje się na koncie", await page.evaluate(() => RIW_DEBUG.app.user().notify.events.includes("PW")));
    // magazynier wprowadza PZ w Zabrzu → kierownik dostaje powiadomienie
    await setUser(page, "u_mag");
    const before = await page.evaluate(() => RIW_DEBUG.store.state.notices.length);
    const r = await page.evaluate(async () => { const d = RIW_DEBUG.R.Seed.draftOf("2026-09-23", { purchase: { supplierId: "pa_drwal", basis: "DEKL", productId: "pr_zr_tow", qty: "12", unit: "MP", price: "50" }, transport: { mode: "none", place: "RiC Zabrze" } }); d.idemKey = "e2e-35"; return RIW_DEBUG.store.exec("op.commit", { draft: d }, "E2E"); });
    const added = await page.evaluate(n => RIW_DEBUG.store.state.notices.slice(n).map(x => x.userId), before);
    check("3.5 Powiadomienia: PZ magazyniera → kierownik (bez autora)", r.ok && added.includes("u_kier") && !added.includes("u_mag"), added);
    // administrator: zgody i poczta (OFFLINE — bez wysyłki)
    await setUser(page, "u_admin");
    await go(page, "powiadomienia"); await page.click('[data-nttab="allow"]'); await page.waitForSelector("#nt-allow-table");
    await page.click('tr[data-allow-user="u_view"] [data-allow="PZ"]'); await page.waitForTimeout(250);
    check("3.5 Zgody: administrator nadaje zgodę (audyt NOTIFICATIONS_ALLOWED)", await page.evaluate(() => RIW_DEBUG.R.byId(RIW_DEBUG.store.state.users, "u_view").notifyAllowed.includes("PZ") && RIW_DEBUG.store.state.audit.at(-1).code === "NOTIFICATIONS_ALLOWED"));
    await go(page, "poczta"); await page.waitForSelector("#mail-offline");
    check("3.5 Poczta (OFFLINE): informacja o braku wysyłki i dziennik powiadomień", (await page.$$("#mail-table tbody tr")).length > 5);
    // telefon: planer i powiadomienia bez poziomego przewijania
    await page.setViewportSize({ width: 390, height: 844 });
    for (const r2 of ["planer", "powiadomienia", "poczta"]) {
      await go(page, r2); await page.waitForTimeout(200);
      check(`3.5 Telefon: ${r2} bez poziomego przewijania`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    }
    await ctx.close();
  }

  /* ------------- 3.7: czysta baza, administrator startowy, rejestracja i zatwierdzenie ------------- */
  {
    const ctx = await newCtx(browser, { sample: false });
    const page = await ctx.newPage(); watch(page, "3.7-czysta");
    // dane demonstracyjne z poprzedniej wersji w tej przeglądarce → kopia i czysta baza
    await page.goto(FILE); await page.keyboard.press("Escape"); await page.waitForSelector("#login-form", { timeout: 8000 }); await page.evaluate(() => { localStorage.setItem("riw.v3.state", JSON.stringify(Object.assign(RIW_DEBUG.R.Seed.build("2026-09-23"), {}))); localStorage.removeItem("riw.clean37"); });
    await page.goto(FILE);
    await page.waitForSelector(".splash", { timeout: 5000 }).catch(() => {}); await page.keyboard.press("Escape");
    await page.waitForSelector("#login-form", { timeout: 8000 });
    // 3.8: konto administratora z hasłem demonstracyjnym zapisane przez starą kartę → hasło startowe z konfiguracji działa
    const stale = await newCtx(browser, { sample: false }); const sp = await stale.newPage(); watch(sp, "3.8-stare-dane");
    await sp.goto(FILE); await sp.keyboard.press("Escape"); await sp.waitForSelector("#login-form", { timeout: 8000 });
    await sp.evaluate(() => { localStorage.setItem("riw.v3.state", JSON.stringify(RIW_DEBUG.R.Seed.build("2026-09-23"))); localStorage.setItem("riw.clean37", "x"); });
    await sp.reload(); await sp.keyboard.press("Escape"); await sp.waitForSelector("#login-form", { timeout: 8000 });
    await sp.fill("#lg-login", "magazyn@resinvest.group"); await sp.fill("#lg-pass", "Admin1234"); await sp.click("#lg-submit");
    check("3.8 Logowanie Admin1234 działa, gdy stara karta zapisała dane demonstracyjne po pierwszym starcie", await sp.waitForSelector("#force-form", { timeout: 6000 }).then(() => true).catch(() => false));
    await sp.evaluate(() => { const a = JSON.parse(localStorage.getItem("riw.v3.auth")); a.accounts.u_admin = Object.assign({}, a.accounts.u_admin, { demo: true, hash: "00", startup: false }); localStorage.setItem("riw.v3.auth", JSON.stringify(a)); sessionStorage.removeItem("riw.v3.session"); });
    await sp.reload(); await sp.keyboard.press("Escape"); await sp.waitForSelector("#login-form", { timeout: 8000 });
    await sp.fill("#lg-login", "magazyn@resinvest.group"); await sp.fill("#lg-pass", "Admin1234"); await sp.click("#lg-submit");
    check("3.8 Logowanie Admin1234 działa, gdy konto administratora miało hasło demonstracyjne", await sp.waitForSelector("#force-form", { timeout: 6000 }).then(() => true).catch(() => false));
    await stale.close();
    // 3.7.2: konto testowe administratora z konfiguracji — działa przy dowolnych danych zapisanych w przeglądarce
    {
      const tc = await newCtx(browser, { sample: false }); const tp = await tc.newPage(); watch(tp, "3.7.2-test");
      await tp.goto(FILE); await tp.keyboard.press("Escape"); await tp.waitForSelector("#login-form", { timeout: 8000 });
      await tp.evaluate(() => { localStorage.setItem("riw.v3.state", JSON.stringify(RIW_DEBUG.R.Seed.minimal({ email: "szef@resinvest.group" }))); localStorage.setItem("riw.v3.auth", JSON.stringify({ v: 1, accounts: { u_admin: { algo: "pbkdf2-sha256", iter: 1, salt: "00", hash: "00" } }, log: [] })); });
      await tp.reload(); await tp.keyboard.press("Escape"); await tp.waitForSelector("#test-admin", { timeout: 8000 });
      check("3.7.2 Ekran logowania: przycisk konta testowego administratora (test@resinvest.group)", nb(await tp.textContent("#test-admin")).includes("test@resinvest.group"));
      await tp.click("#test-admin"); await tp.click("#lg-submit");
      const okT = await tp.waitForSelector("#nav .nav-item", { timeout: 8000 }).then(() => true).catch(() => false);
      check("3.7.2 Konto testowe: logowanie przy obcych danych w przeglądarce, rola administratora, wpis w audycie", okT && await tp.evaluate(() => RIW_DEBUG.app.user().role === "admin" && RIW_DEBUG.store.state.audit.some(a => a.code === "CONFIG_ACCOUNT_RESTORED")));
      await tp.evaluate(() => RIW_DEBUG.app.logout()); await tp.waitForSelector("#login-form");
      await tp.fill("#lg-login", "test@resinvest.group"); await tp.fill("#lg-pass", "Test1234 "); await tp.click("#lg-submit");
      check("3.7.2 Hasło ze spacją na końcu (klawiatura telefonu) przyjęte", await tp.waitForSelector("#nav .nav-item", { timeout: 8000 }).then(() => true).catch(() => false));
      await tp.evaluate(() => RIW_DEBUG.app.logout()); await tp.waitForSelector("#login-form");
      await tp.fill("#lg-login", "test@resinvest.group"); await tp.fill("#lg-pass", "Zle12345"); await tp.click("#lg-submit"); await tp.waitForTimeout(800);
      check("3.7.2 Konto testowe: błędne hasło odrzucone", !(await tp.$("#nav")) && nb(await tp.textContent("#lg-err")).includes("Nieprawidłowy"));
      await tc.close();
    }
    const st0 = await page.evaluate(() => ({ users: RIW_DEBUG.store.state.users.map(u => u.login), ops: RIW_DEBUG.store.state.operations.length, partners: RIW_DEBUG.store.state.partners.length, fleet: RIW_DEBUG.store.state.fleet.vehicles.length, wh: RIW_DEBUG.store.state.warehouses.length, backup: !!localStorage.getItem("riw.v3.state.demo-przed-3.7"), cfgKeys: Object.keys(RIW_DEBUG.store.state.config) }));
    check("3.7 Czysta baza: tylko administrator, 3 magazyny, bez operacji, kontrahentów i floty; kopia danych demonstracyjnych", st0.users.join() === "magazyn@resinvest.group" && st0.ops === 0 && st0.partners === 0 && st0.fleet === 0 && st0.wh === 3 && st0.backup && !st0.cfgKeys.includes("startup"), st0);
    check("3.7 Ekran logowania: konto testowe administratora, brak kont demonstracyjnych", !!(await page.$("#test-admin")) && !(await page.$("#demo-users")));
    check("3.7 Rejestracja włączona na ekranie logowania", !!(await page.$('[data-auth-tab="register"]')));
    // rejestracja: zła domena, różne hasła, poprawna
    await page.click('[data-auth-tab="register"]'); await page.waitForSelector("#reg-form");
    const reg = async (name, email, pw, pw2) => { await page.fill("#rg-name", name); await page.fill("#rg-email", email); await page.fill("#rg-pass", pw); await page.fill("#rg-pass2", pw2); await page.click("#rg-submit"); await page.waitForTimeout(300); };
    await reg("Jan Kowalski", "jan.kowalski@gmail.com", "Magazyn2026", "Magazyn2026");
    check("3.7 Rejestracja: adres spoza domeny firmy odrzucony", nb(await page.textContent("#rg-err")).includes("resinvest.group"), nb(await page.textContent("#rg-err")));
    await reg("Jan Kowalski", "jan.kowalski@resinvest.group", "Magazyn2026", "Inne2026x");
    check("3.7 Rejestracja: różne hasła odrzucone", nb(await page.textContent("#rg-err")).includes("nie są takie same"));
    await reg("Jan Kowalski", "jan.kowalski@resinvest.group", "abc", "abc");
    check("3.7 Rejestracja: słabe hasło odrzucone", nb(await page.textContent("#rg-err")).includes("Hasło musi mieć"));
    await reg("Jan Kowalski", "jan.kowalski@resinvest.group", "Magazyn2026", "Magazyn2026");
    check("3.7 Rejestracja: konto zgłoszone, komunikat o zatwierdzeniu przez administratora", nb(await page.textContent("#auth-info")).includes("Administrator nada rolę i magazyn"));
    const ru = await page.evaluate(() => { const u = RIW_DEBUG.store.state.users.find(x => x.login === "jan.kowalski@resinvest.group"); return { st: RIW_DEBUG.R.statusOf(u), role: u.role, perms: RIW_DEBUG.R.permsOf ? RIW_DEBUG.R.permsOf(u).length : null }; });
    check("3.7 Rejestracja: status „zaproszony”, bez samodzielnego nadania roli administratora", ru.st === "INVITED" && ru.role !== "admin", ru);
    await page.fill("#lg-login", "jan.kowalski@resinvest.group"); await page.fill("#lg-pass", "Magazyn2026"); await page.click("#lg-submit"); await page.waitForTimeout(300);
    check("3.7 Rejestracja: logowanie przed zatwierdzeniem zablokowane", nb(await page.textContent("#lg-err")).includes("oczekuje na zatwierdzenie"));
    // administrator: hasło startowe z konfiguracji → wymuszona zmiana
    await page.fill("#lg-login", "magazyn@resinvest.group"); await page.fill("#lg-pass", "Admin1234"); await page.click("#lg-submit");
    await page.waitForSelector("#force-form", { timeout: 6000 });
    check("3.7 Administrator magazyn@resinvest.group: hasło startowe Admin1234 działa, wymuszona zmiana hasła", !!(await page.$("#force-form")));
    await page.fill("#fc-old", "Admin1234"); await page.fill("#fc-new", "Biomasa2027"); await page.fill("#fc-new2", "Biomasa2027");
    await page.click('#force-form [type="submit"]'); await page.waitForSelector("#nav .nav-item", { timeout: 8000 });
    check("3.7 Administrator: po zmianie hasła pulpit pustej bazy", (await page.evaluate(() => RIW_DEBUG.store.state.operations.length)) === 0 && !!(await page.$("#nav")));
    const nt = await page.evaluate(() => (RIW_DEBUG.store.state.notices || []).filter(n => n.kind === "registration" && n.userId === RIW_DEBUG.store.userId).map(n => n.title));
    check("3.7 Powiadomienie administratora o zgłoszeniu rejestracji", nt.length === 1, nt);
    await go(page, "uzytkownicy"); await page.waitForSelector('tr[data-reg]');
    check("3.7 Użytkownicy: zgłoszenie rejestracji na liście do zatwierdzenia", nb(await page.textContent('tr[data-reg]')).includes("jan.kowalski@resinvest.group"));
    await page.click("[data-uapprove]"); await page.waitForSelector("#me-role");
    await page.selectOption("#me-role", "magazynier"); await page.selectOption("#me-whId", "wh_bra"); await page.waitForTimeout(100);
    await page.click(".modal [data-yes]"); await page.waitForTimeout(400);
    const ap = await page.evaluate(() => { const u = RIW_DEBUG.store.state.users.find(x => x.login === "jan.kowalski@resinvest.group"); return { st: RIW_DEBUG.R.statusOf(u), role: u.role, wh: u.whId, by: u.approvedBy, audit: RIW_DEBUG.store.state.audit.some(a => a.code === "USER_REGISTERED") }; });
    check("3.7 Zatwierdzenie: rola magazynier, magazyn RiC Brąszewice, aktywne, zapis w audycie", ap.st === "ACTIVE" && ap.role === "magazynier" && ap.wh === "wh_bra" && !!ap.by && ap.audit, ap);
    await page.evaluate(() => RIW_DEBUG.app.logout()); await page.waitForSelector("#login-form");
    await page.fill("#lg-login", "jan.kowalski@resinvest.group"); await page.fill("#lg-pass", "Magazyn2026"); await page.click("#lg-submit");
    await page.waitForSelector("#nav .nav-item", { timeout: 8000 }).catch(() => {});
    check("3.7 Zatwierdzony użytkownik loguje się hasłem z rejestracji (bez dostępu do administracji)", !!(await page.$("#nav")) && !(await page.$('#nav [data-nav="uzytkownicy"]')));
    await ctx.close();
  }

  /* ------------- 3.6: zakup ze sprzedażą bezpośrednią z lasu, flota własna / zewnętrzna, RiC, wysyłka e-mailem ------------- */
  {
    const ctx = await newCtx(browser);
    const page = await ctx.newPage(); watch(page, "3.6");
    await boot(page);
    check("3.6 Znak RiC w menu bocznym", nb(await page.textContent(".sb-head .mark")) === "RiC");
    check("3.6 Ikona strony RiC (SVG) i ikona ekranu głównego (PNG)", await page.evaluate(() => /^data:image\/svg\+xml;base64,/.test(document.querySelector('link[rel="icon"]').href) && /^data:image\/png;base64,/.test(document.querySelector('link[rel="apple-touch-icon"]').href)));
    await preset(page, "zakup");
    const order = await page.evaluate(() => { const a = document.querySelector("#f-production-enabled"), b = document.querySelector("#f-sale-direct"), c = document.querySelector("#f-skind-firma"); return !!(a && b && c) && !!(a.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(b.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING); });
    check("3.6 Zakup: opcje produkcji i sprzedaży bezpośredniej przed wyborem grupy dostawcy", order);
    check("3.6 Zakup: obie opcje dostępne od razu (nie wyszarzone)", !(await page.isDisabled("#f-production-enabled")) && !(await page.isDisabled("#f-sale-direct")));
    await page.selectOption("#f-purchase-productId", "pr_zr_tow"); await page.waitForTimeout(150);
    await tick(page, "f-sale-direct"); await page.waitForSelector("#f-production-kwit");
    const st = await page.evaluate(() => { const d = RIWForm.draft; return { p: d.purchase.productId, prod: d.production.enabled, sale: d.sale.enabled, direct: d.sale.direct }; });
    check("3.6 Zakup: „sprzedaż bezpośrednia z lasu” włącza produkcję i ustawia drewno", st.p === "pr_drewno" && st.prod && st.sale && st.direct, st);
    check("3.6 Zakup: przy produkcji lista produktów zawiera tylko drewno", await page.$$eval("#f-purchase-productId option", o => o.filter(x => x.value).every(x => RIW_DEBUG.R.byId(RIW_DEBUG.store.state.products, x.value).cat === "drewno")));
    check("3.6 Zakup: sekcja „Sprzedaż bezpośrednia z lasu”", nb(await page.textContent("#h-sale")) === "Sprzedaż bezpośrednia z lasu");
    await tick(page, "f-skind-nadlesnictwo"); await fillTab(page, "#f-purchase-supplierName", "Nadleśnictwo Rudy Raciborskie"); await page.waitForTimeout(100);
    await fillTab(page, "#f-purchase-lesnictwo", "Stanica");
    await fillTab(page, "#f-purchase-qty", "20"); await page.fill("#f-purchase-price", "230");
    await page.fill("#f-production-kwit", "KW 0900/09/2026");
    await page.selectOption("#f-sale-buyerId", "pa_ec_zab"); await page.waitForTimeout(100); await fillTab(page, "#f-sale-price", "90");
    const z0 = [await bal(page, "pr_drewno"), await bal(page, "pr_zr_lesna")];
    check("3.6 Zakup bezpośredni: zatwierdzenie z formularza", (await approve(page)) === 1);
    const zop = await page.evaluate(() => { const o = RIW_DEBUG.store.state.operations.at(-1); return { direct: o.direct, scope: o.scope, led: RIW_DEBUG.store.state.ledger.filter(l => l.opId === o.id).map(l => `${l.kind}:${l.qty}:${l.direct ? 1 : 0}`) }; });
    check("3.6 Zakup bezpośredni: PZ → RW → PW → WZ, produkcja i sprzedaż jako bezpośrednie", zop.direct && zop.led.join(",") === "ZAKUP:20:0,ZUZYCIE:-20:0,PRODUKCJA:80:1,SPRZEDAZ:-80:1", zop);
    check("3.6 Zakup bezpośredni: stan drewna i zrębki bez zmian (bez magazynowania)", JSON.stringify([await bal(page, "pr_drewno"), await bal(page, "pr_zr_lesna")]) === JSON.stringify(z0));
    await go(page, "operacje"); await page.waitForTimeout(150);
    check("3.6 Rejestr operacji: rodzaj „Zakup + produkcja + sprzedaż bezpośrednia z lasu”", nb(await page.textContent("body")).includes("Zakup + produkcja + sprzedaż bezpośrednia z lasu"));

    // flota: dwa pola wyboru — własna i zewnętrzna
    await go(page, "flota"); await page.waitForSelector("#fleet-scope");
    const tabs = async () => page.$$eval(".tabs [data-tab]", b => b.map(x => x.dataset.tab));
    check("3.6 Flota: oba zakresy zaznaczone — 4 zakładki floty własnej + 2 zewnętrznej (+ raporty 3.9)", JSON.stringify(await tabs()) === JSON.stringify(["vehicles", "drivers", "chippers", "operators", "ext_vehicles", "ext_chippers", "reports"]), await tabs());
    await page.click('label.opt:has(#fl-scope-own)'); await page.waitForTimeout(150);
    check("3.6 Flota: tylko zewnętrzna — samochody i rębaki firm zewnętrznych", JSON.stringify(await tabs()) === JSON.stringify(["ext_vehicles", "ext_chippers", "reports"]), await tabs());
    const extRows = await page.$$eval("#fleet-table tbody tr", r => r.map(x => x.textContent));
    check("3.6 Flota zewnętrzna: pojazdy ESI Logistics, DAP Trans, Transport Kowalski", extRows.length === 5 && extRows.some(x => x.includes("ESI 18734")) && extRows.some(x => x.includes("SPY 92FR")), extRows.length);
    await page.click('[data-tab="ext_chippers"]'); await page.waitForTimeout(120);
    check("3.6 Flota zewnętrzna: rębak firmy zewnętrznej", nb(await page.textContent("#fleet-table")).includes("Bandit 2590XP"));
    await page.click('[data-tab="ext_vehicles"]'); await page.waitForTimeout(120);
    await page.click("#fleet-add"); await page.waitForSelector("#fe-owner");
    check("3.6 Flota zewnętrzna: nowy pojazd ma ustawionego właściciela „firma zewnętrzna”", (await page.inputValue("#fe-owner")) === "external" && await page.isVisible("#fe-company") && !(await page.isVisible("#fe-driverId")));
    await page.fill("#fe-name", "Iveco S-Way"); await page.fill("#fe-company", "Trans-Bud"); await page.fill("#fe-reg", "WX 1234A"); await page.fill("#fe-driverName", "Jan Wiśniewski");
    await page.click(".modal [data-yes]"); await page.waitForTimeout(250);
    check("3.6 Flota zewnętrzna: zapis pojazdu bez kierowcy z kartoteki", await page.evaluate(() => RIW_DEBUG.store.state.fleet.vehicles.some(v => v.reg === "WX 1234A" && v.owner === "external" && v.company === "Trans-Bud" && !v.driverId)));
    await page.click('label.opt:has(#fl-scope-ext)'); await page.waitForTimeout(150);
    check("3.6 Flota: żaden zakres — podpowiedź zamiast tabeli", (await tabs()).length === 0 && nb(await page.textContent("body")).includes("Zaznacz flotę własną lub zewnętrzną"));
    await page.click('label.opt:has(#fl-scope-own)'); await page.waitForTimeout(150);
    check("3.6 Flota: tylko własna — samochody, kierowcy, rębaki, operatorzy", JSON.stringify(await tabs()) === JSON.stringify(["vehicles", "drivers", "chippers", "operators", "reports"]));
    check("3.6 Flota własna: bez pojazdów firm zewnętrznych", !nb(await page.textContent("#fleet-table")).includes("ESI 18734"));

    /* ------------- 3.10.1: zwijany panel boczny (Ctrl+B), szybki wpis „Powtórz ostatnią” ------------- */
    {
      const w0 = await page.$eval(".sidebar", e => e.getBoundingClientRect().width);
      await page.click("#sb-toggle"); await page.waitForTimeout(350);
      const mini = await page.evaluate(() => ({ cls: document.body.classList.contains("sb-mini"), w: document.querySelector(".sidebar").getBoundingClientRect().width, lbl: getComputedStyle(document.querySelector("#nav .nav-item .nl")).display, title: document.querySelector('#nav [data-nav="operacje"]').title, saved: localStorage.getItem("riw.sbMini") }));
      check("3.10.1 Panel boczny zwinięty: same ikony (72 px), podpowiedzi z nazwą, zapamiętany", mini.cls && mini.w < 90 && w0 > 200 && mini.lbl === "none" && mini.title === "Operacje" && mini.saved === "1", mini);
      await page.click('#nav [data-nav="operacje"]'); await page.waitForTimeout(250);
      check("3.10.1 Zwinięty panel: nawigacja działa", await page.evaluate(() => location.hash === "#/operacje"));
      await page.keyboard.press("Control+b"); await page.waitForTimeout(350);
      check("3.10.1 Ctrl+B rozwija panel", await page.evaluate(() => !document.body.classList.contains("sb-mini") && localStorage.getItem("riw.sbMini") === "" && document.querySelector(".sidebar").getBoundingClientRect().width > 200));
      await go(page, "nowa"); await page.waitForSelector("#opf");
      const rl = await page.$("#repeat-last");
      check("3.10.1 Nowa operacja: przycisk „Powtórz ostatnią” z numerem dokumentu", !!rl && /Powtórz ostatnią/.test(nb(await rl.textContent())));
      if (rl) {
        const src = await page.evaluate(id => { const o = RIW_DEBUG.store.state.operations.find(x => x.id === id); return { type: o.type, input: o.input }; }, await rl.getAttribute("data-op"));
        await rl.click(); await page.waitForSelector("#repeat-info");
        const d = await page.evaluate(() => RIW_DEBUG.app && window.RIWForm && RIWForm.draft);
        const runs = (d.transport.own && d.transport.own.runs) || [];
        check("3.10.1 Powtórz: kopia na dziś — ten sam rodzaj, dzisiejsza data, nowy klucz, bez numerów kwitów i dokumentów", d.type === src.type && d.date === TODAY && d.idemKey !== (src.input.idemKey || "") && runs.every(r => !r.kwit && !r.weightT) && Object.values(d.docNos).every(v => !v) && JSON.stringify(d.purchase.productId) === JSON.stringify(src.input.purchase.productId), { type: d.type, date: d.date });
        await page.click("#form-reset").catch(() => {}); await page.click(".modal [data-yes]").catch(() => {}); await page.waitForTimeout(200);
      }
      await go(page, "operacje"); await page.waitForSelector("#ops-table tbody tr");
      await page.click("#ops-table tbody tr:first-child"); await page.waitForSelector("#op-detail");
      const rep = await page.$("#op-detail [data-repeat]");
      check("3.10.1 Szczegóły operacji: przycisk „Powtórz”", !!rep);
      if (rep) { await rep.click(); await page.waitForSelector("#repeat-info", { timeout: 4000 }).catch(() => {}); check("3.10.1 „Powtórz” z rejestru otwiera kopię w Nowej operacji", await page.evaluate(() => location.hash === "#/nowa" && !!document.querySelector("#repeat-info"))); await page.click("#form-reset").catch(() => {}); await page.click(".modal [data-yes]").catch(() => {}); await page.waitForTimeout(200); }
      await page.keyboard.press("Escape").catch(() => {});
      await go(page, "flota"); await page.waitForSelector("#fleet-table"); await page.waitForTimeout(150);
    }

    /* ------------- 3.11: nowy pojazd / kierowca w operacji, „+1 kurs”, kwity z wagi, szablony, Enter, szybki kurs ------------- */
    {
      const fleetN = () => page.evaluate(() => ({ v: RIW_DEBUG.store.state.fleet.vehicles.length, d: RIW_DEBUG.store.state.fleet.drivers.length }));
      const f0 = await fleetN();
      await preset(page, "zakup");
      await fillTab(page, "#f-purchase-supplierName", "Lander Agro"); await fillTab(page, "#f-purchase-qty", "30"); await fillTab(page, "#f-purchase-price", "50");
      await tick(page, "f-mode-own"); await page.waitForSelector("#f-transport-own-runs-0-vehicleReg");
      check("3.11 Kurs: pole pojazdu i kierowcy „wybierz albo wpisz” z listą podpowiedzi", (await page.getAttribute("#f-transport-own-runs-0-vehicleReg", "list")) === "dl-own-veh" && (await page.getAttribute("#f-transport-own-runs-0-driverName", "list")) === "dl-drivers" && (await page.$$("#dl-own-veh option")).length >= 2);
      await fillTab(page, "#f-transport-own-runs-0-vehicleReg", "wgm 77001"); await fillTab(page, "#f-transport-own-runs-0-driverName", "Adam Nowicki");
      await fillTab(page, "#f-transport-own-runs-0-km", "12"); await fillTab(page, "#f-transport-own-runs-0-qty", "15");
      check("3.11 Nowy pojazd i nowy kierowca: oznaczenie „nowy … zostanie dopisany do Floty”", /nowy pojazd/.test(nb(await page.textContent('[data-calc="transport.own.runs.0.vehicleId"]'))) && /nowy kierowca/.test(nb(await page.textContent('[data-calc="transport.own.runs.0.driverId"]'))));
      await page.click("#own-run-plus"); await page.waitForTimeout(250);
      const r1 = await page.evaluate(() => ({ n: RIWForm.draft.transport.own.runCount, r: RIWForm.draft.transport.own.runs[1], act: document.activeElement && document.activeElement.id }));
      check("3.11 „+1 kurs jak poprzedni”: kurs 2 z tym samym pojazdem, kierowcą, km i ilością; fokus na kwicie", r1.n === "2" && r1.r.vehicleReg === "wgm 77001" && r1.r.driverName === "Adam Nowicki" && r1.r.km === "12" && !r1.r.kwit && r1.act === "f-transport-own-runs-1-kwit", r1);
      // Enter przechodzi do następnego pola
      await page.focus("#f-transport-own-runs-0-km"); await page.keyboard.press("Enter"); await page.waitForTimeout(80);
      const nx = await page.evaluate(() => document.activeElement && document.activeElement.id);
      check("3.11 Enter = następne pole (z km do stawki)", nx === "f-transport-own-runs-0-rate", nx);
      // kwity z wagi: dwa kody (czytnik / wklejenie) → kursy 1 i 2
      await page.click("#scale-import"); await page.waitForSelector("#sc-text");
      await page.fill("#sc-text", "KWIT=W1;NETTO=24000;REJ=WGM77001\nKWIT=W2;NETTO=23500"); await page.waitForTimeout(300);
      check("3.11 Kwity z wagi: podgląd 2 kwitów (kg → t), dopasowanie po nr rej.", (await page.$$("#sc-table tbody tr")).length === 2 && /24 t/.test(nb(await page.textContent("#sc-table"))) && /dopasowano po nr rej/.test(nb(await page.textContent("#sc-table"))));
      await page.click("#sc-apply"); await page.waitForTimeout(250);
      const rw = await page.evaluate(() => RIWForm.draft.transport.own.runs.map(r => [r.kwit, r.weightT]));
      check("3.11 Kwity z wagi: numer kwitu i waga netto wpisane do kursów", JSON.stringify(rw) === JSON.stringify([["W1", "24"], ["W2", "23,5"]]), rw);
      // zapis szablonu
      await page.click("#tpl-save"); await page.waitForSelector("#tpl-name");
      await page.fill("#tpl-name", "Lander → Zabrze, WGM 77001"); await page.click("#tpl-ok"); await page.waitForTimeout(300);
      check("3.11 Szablon zapisany: przycisk na pasku szablonów (Alt+1)", /Lander → Zabrze/.test(nb(await page.textContent("#tpl-bar"))) && await page.evaluate(() => RIW_DEBUG.store.state.templates.some(x => x.name === "Lander → Zabrze, WGM 77001" && x.draft.transport.own.runs.every(r => !r.kwit && !r.weightT))));
      // zatwierdzenie z klawiatury → nowy pojazd i kierowca w kartotece Floty
      await page.focus("#f-transport-own-runs-1-weightT"); await page.keyboard.press("Control+Enter"); await page.waitForSelector("#confirm-yes"); await page.click("#confirm-yes"); await page.waitForTimeout(500);
      const f1 = await fleetN();
      const nv = await page.evaluate(() => { const S = RIW_DEBUG.store.state, v = S.fleet.vehicles.find(x => x.reg === "WGM 77001"), d = S.fleet.drivers.find(x => x.name === "Adam Nowicki"), op = S.operations[S.operations.length - 1]; return { v: !!v, d: !!d, link: !!(v && d && op.transport.runs.every(r => r.vehicleId === v.id && r.driverId === d.id)), def: v && d && v.driverId === d.id }; });
      check("3.11 Zatwierdzenie: pojazd WGM 77001 i kierowca dopisani do Floty raz (dwa kursy), operacja wskazuje nowe pozycje", f1.v === f0.v + 1 && f1.d === f0.d + 1 && nv.v && nv.d && nv.link && nv.def, { f0, f1, nv });
      await closeModals(page);
      // szablon jednym kliknięciem
      await go(page, "nowa"); await page.waitForSelector("#tpl-bar");
      await page.click("#tpl-bar [data-tpl]"); await page.waitForTimeout(200);
      if (await page.$(".modal [data-yes]")) { await page.click(".modal [data-yes]"); await page.waitForTimeout(200); }
      await page.waitForSelector("#tpl-info", { timeout: 4000 }).catch(() => {});
      const td = await page.evaluate(() => ({ info: !!document.querySelector("#tpl-info"), date: RIWForm.draft.date, n: RIWForm.draft.transport.own.runs.length, kw: RIWForm.draft.transport.own.runs.map(r => r.kwit).join(""), veh: document.querySelector("#f-transport-own-runs-0-vehicleReg").value }));
      check("3.11 Szablon jednym kliknięciem: formularz na dziś, pojazd z szablonu, bez kwitów", td.info && td.date === TODAY && td.n === 2 && td.kw === "" && /WGM 77001/.test(td.veh), td);
      await page.click("#form-reset").catch(() => {}); await page.click(".modal [data-yes]").catch(() => {}); await page.waitForTimeout(200);
      // szybki kurs (telefon)
      await page.setViewportSize({ width: 390, height: 844 });
      await go(page, "kurs"); await page.waitForSelector("#qk-save");
      const bases = await page.$$eval("#qk-base option", o => o.map(x => x.textContent));
      check("3.11 Szybki kurs: wzorce — szablony i poprzednie operacje", bases.some(b => /Lander → Zabrze/.test(b)), bases);
      await page.selectOption("#qk-base", { label: "Lander → Zabrze, WGM 77001" }); await page.waitForTimeout(200);
      const opsBefore = await page.evaluate(() => RIW_DEBUG.store.state.operations.length);
      await page.fill("#qk-veh", "WGM 77001"); await page.fill("#qk-drv", "Adam Nowicki"); await page.fill("#qk-kwit", "Q-1"); await page.fill("#qk-qty", "15"); await page.fill("#qk-weight", "24,1");
      check("3.11 Szybki kurs (telefon): bez poziomego przewijania, duże pola, wyświetlacz wagi LED", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector("#qk-weight").getBoundingClientRect().height >= 60));
      await page.click("#qk-save"); await page.waitForTimeout(500);
      const qk = await page.evaluate(n => { const S = RIW_DEBUG.store.state, op = S.operations[S.operations.length - 1]; return { added: S.operations.length === n + 1, run: op.transport.runs[0], wm: op.purchase && op.purchase.weightMode, wt: op.purchase && op.purchase.weightT, last: !!document.querySelector("#qk-last .info-line"), kw: document.querySelector("#qk-kwit").value }; }, opsBefore);
      check("3.11 Szybki kurs: zapis operacji z jednym kursem (kwit, waga, auto z Floty), waga dokumentu z kwitu, pola kwitu i wagi wyczyszczone", qk.added && qk.run.kwit === "Q-1" && qk.run.weightT === 24.1 && qk.run.reg === "WGM 77001" && qk.wm === "manual" && qk.wt === 24.1 && qk.last && qk.kw === "", qk);
      // intro na telefonie: cały kadr filmu (contain), bez obcinania
      const fit = await page.evaluate(() => { const d = document.createElement("div"); d.className = "splash"; d.innerHTML = "<video></video>"; document.body.appendChild(d); const f = getComputedStyle(d.querySelector("video")).objectFit; d.remove(); return f; });
      check("3.11 Intro na telefonie: film w całości (object-fit: contain)", fit === "contain", fit);
      await page.setViewportSize({ width: 1440, height: 900 });
      await go(page, "flota"); await page.waitForSelector("#fleet-table"); await page.waitForTimeout(150);
    }

    /* ------------- 3.9: zabudowa i pojemność pojazdu, raporty floty i rębaków ------------- */
    check("3.9 Flota: kolumna Pojemność (MP) przy samochodach", (await page.$$eval("#fleet-table thead th", t => t.map(x => x.textContent))).includes("Pojemność") && nb(await page.textContent("#fleet-table")).includes("91,92 MP"));
    await page.click("#fleet-add"); await page.waitForSelector("#fe-body");
    await page.fill("#fe-name", "MAN TGS — hakowiec"); await page.fill("#fe-reg", "SK 4411H"); await page.selectOption("#fe-driverId", "dr_nowak");
    await page.selectOption("#fe-body", "hakowiec"); await page.waitForSelector("#fe-comp-1-h");
    check("3.9 Hakowiec: dwa kontenery z długością, szerokością i wysokością", (await page.$$("[data-comp]")).length === 2 && !!(await page.$("#fe-comp-0-l")) && !!(await page.$("#fe-comp-1-w")));
    for (const [i, l] of [[0, "6,5"], [1, "7"]]) { await page.fill(`#fe-comp-${i}-l`, l); await page.fill(`#fe-comp-${i}-w`, "2,4"); await page.fill(`#fe-comp-${i}-h`, "2,5"); }
    check("3.9 Pojemność liczona na żywo: 39 + 42 = 81 MP", nb(await page.textContent("#fe-cap")).includes("81 MP") && nb(await page.textContent('[data-comp-mp="0"]')).includes("39 MP"), nb(await page.textContent("#fe-cap")));
    await page.click(".modal [data-yes]"); await page.waitForTimeout(250);
    check("3.9 Zapis pojazdu z zabudową (pojemność 81 MP w kartotece)", await page.evaluate(() => { const v = RIW_DEBUG.store.state.fleet.vehicles.find(x => x.reg === "SK 4411H"); return !!v && v.body === "hakowiec" && v.capacityMP === 81 && v.compartments.length === 2; }));
    // 3.10.1: pojazd bez kierowcy domyślnego — opcja „—”
    await page.click('[data-tab="vehicles"]').catch(() => {}); await page.waitForTimeout(150);
    await page.click("#fleet-add"); await page.waitForSelector("#fe-driverId");
    check("3.10.1 Pojazd: kierowca domyślny opcjonalny — pierwsza opcja „—”", (await page.$eval("#fe-driverId option", o => o.value === "" && o.textContent.trim() === "—")));
    await page.fill("#fe-name", "Volvo FH — bez kierowcy"); await page.fill("#fe-reg", "SK 5500N"); await page.selectOption("#fe-driverId", "");
    await page.click(".modal [data-yes]"); await page.waitForTimeout(250);
    check("3.10.1 Zapis pojazdu bez kierowcy domyślnego", await page.evaluate(() => { const v = RIW_DEBUG.store.state.fleet.vehicles.find(x => x.reg === "SK 5500N"); return !!v && v.driverId === ""; }) && !(await page.$(".modal [data-yes]")));
    await page.click('[data-tab="reports"]'); await page.waitForSelector("#fr-view");
    check("3.9 Raporty floty: okres dzień / tydzień / miesiąc i 6 rodzajów raportu", (await page.$$eval("#fr-period option", o => o.map(x => x.value).join(","))) === "day,week,month" && (await page.$$eval("#fr-view option", o => o.length)) === 6);
    await page.selectOption("#fr-period", "month"); await page.waitForTimeout(150); await page.fill("#fr-date", "2026-09-15"); await page.dispatchEvent("#fr-date", "change"); await page.waitForTimeout(200);
    check("3.9 Raport pojazdów (miesiąc): kursy, MP, tony, zapełnienie", (await page.$$eval("#fleet-rep thead th", t => t.map(x => x.textContent))).includes("Śr. zapełnienie [%]") && (await page.$$("#fleet-rep tbody tr")).length >= 3 && nb(await page.textContent("#fr-range")).includes("01.09.2026"));
    await page.selectOption("#fr-view", "runs"); await page.waitForTimeout(200);
    check("3.9 Kursy i zapełnienie: procent zapełnienia każdego kursu", (await page.$$eval("#fleet-rep thead th", t => t.map(x => x.textContent))).includes("Zapełnienie [%]") && /\d+,\d%/.test(nb(await page.textContent("#fleet-rep tbody"))));
    await page.selectOption("#fr-view", "drivers"); await page.waitForTimeout(200);
    check("3.9 Raport kierowców: kursy i MP", nb(await page.textContent("#fleet-rep")).includes("Jan Kowalski"));
    await page.selectOption("#fr-view", "chippers"); await page.waitForTimeout(200);
    check("3.9 Raport rębaków: ile który rębak zrąbał (MP)", nb(await page.textContent("#fleet-rep")).includes("Jenz HEM 583") && (await page.$$eval("#fleet-rep thead th", t => t.map(x => x.textContent))).includes("Zrębka [MP]"));
    await page.selectOption("#fr-view", "operators"); await page.waitForTimeout(200);
    check("3.9 Raport operatorów rębaków", nb(await page.textContent("#fleet-rep")).includes("Krzysztof Lis"));
    const [frd] = await Promise.all([page.waitForEvent("download"), page.click("#fr-csv")]);
    check("3.9 Raport floty: eksport CSV", frd.suggestedFilename().startsWith("flota_operators_month_"), frd.suggestedFilename());
    await page.click('[data-tab="vehicles"]').catch(() => {}); await page.waitForTimeout(150);
    // transport: flota własna bez pojazdów zewnętrznych; kursy zewnętrzne z podpowiedzią numerów
    await preset(page, "zakup"); await tick(page, "f-mode-own"); await page.waitForSelector("#f-transport-own-runCount");
    await fillTab(page, "#f-transport-own-runCount", "1");
    const ownOpts = await page.$$eval("#dl-own-veh option", o => o.map(x => x.value).filter(Boolean));
    const extRegs = await page.evaluate(() => RIWUI.Store.state.fleet.vehicles.filter(v => v.owner === "external").map(v => v.reg));
    check("3.6 Transport własny: lista pojazdów bez floty zewnętrznej", ownOpts.length > 0 && ownOpts.every(l => !extRegs.some(r => l.startsWith(r + " ·"))), ownOpts);
    await tick(page, "f-mode-own"); await tick(page, "f-mode-external"); await page.waitForSelector("#f-transport-external-runCount");
    await fillTab(page, "#f-transport-external-runCount", "1");
    check("3.6 Transport zewnętrzny: podpowiedzi numerów z floty zewnętrznej", (await page.getAttribute("#f-transport-external-runs-0-reg", "list")) === "dl-ext-veh" && (await page.$$("#dl-ext-veh option")).length >= 5);
    await fillTab(page, "#f-transport-external-runs-0-reg", "ESI 18734"); await page.waitForTimeout(100);
    check("3.6 Transport zewnętrzny: numer z kartoteki uzupełnia kierowcę i firmę", (await page.inputValue("#f-transport-external-runs-0-driver")) === "Tomasz Lis" && (await page.inputValue("#f-transport-external-company")) === "ESI Logistics");

    /* ------------- 3.8: Data przyjęcia, Numeracja WZ, kilka firm transportu zewnętrznego ------------- */
    check("3.8 Zakup: pole „Data przyjęcia” z samouczkiem „Wprowadź datę przyjęcia produktu na magazyn.”", nb(await page.textContent('[data-field="date"] label')).startsWith("Data przyjęcia") && nb(await page.textContent('[data-field="date"] .help')) === "Wprowadź datę przyjęcia produktu na magazyn.");
    check("3.8 Zakup: „Numeracja WZ” zamiast „Numeracja PZ” (jedna seria)", !!(await page.$("#f-docNoMode-WZ")) && !(await page.$("#f-docNoMode-PZ")) && nb(await page.textContent('[data-field="docNoMode.WZ"] label')).startsWith("Numeracja WZ") && (await page.$eval("#f-docNoMode-WZ option", o => o.textContent)).includes("WZ/"));
    const coOpts = await page.$$eval("#f-transport-external-companyCount option", o => o.map(x => x.value).join(","));
    check("3.8 Transport zewnętrzny: lista „Liczba firm przewidzianych do transportu” 1–10 z samouczkiem", coOpts === "1,2,3,4,5,6,7,8,9,10" && nb(await page.textContent('[data-field="transport.external.companyCount"] label')).startsWith("Liczba firm przewidzianych do transportu") && nb(await page.textContent('[data-field="transport.external.companyCount"] .help')).includes("Wpisz ilość firm zewnętrznych, którym zlecono transport."), coOpts);
    check("3.8 Jedna firma: pole „Firma transportowa” wspólne, bez firmy w kursie", !!(await page.$("#f-transport-external-company")) && !(await page.$("#f-transport-external-runs-0-company")));
    await page.selectOption("#f-transport-external-companyCount", "2"); await page.waitForSelector("#f-transport-external-runs-0-company");
    check("3.8 Kilka firm: firma w każdym kursie (lista + nowa nazwa), dotychczasowa firma przeniesiona do kursu", !(await page.$("#f-transport-external-company")) && (await page.inputValue("#f-transport-external-runs-0-company")) === "ESI Logistics" && (await page.getAttribute("#f-transport-external-runs-0-company", "list")) === "dl-carriers" && (await page.$$("#dl-carriers option")).length >= 3);
    await fillTab(page, "#f-transport-external-runCount", "2"); await page.waitForSelector("#f-transport-external-runs-1-company");
    check("3.8 Nowy kurs przejmuje firmę z poprzedniego", (await page.inputValue("#f-transport-external-runs-1-company")) === "ESI Logistics");
    await fillTab(page, "#f-transport-external-runs-0-km", "40"); await fillTab(page, "#f-transport-external-runs-0-qty", "5");
    await fillTab(page, "#f-transport-external-runs-1-company", "Nowa Firma Testowa"); await fillTab(page, "#f-transport-external-runs-1-reg", "SK 12345");
    await fillTab(page, "#f-transport-external-runs-1-km", "60"); await fillTab(page, "#f-transport-external-runs-1-qty", "5"); await page.waitForTimeout(250);
    const sumTxt = nb(await page.textContent('[data-out="runs.summary"]'));
    check("3.8 Podsumowanie kursów: kolumna „Przewoźnik” i rozbicie na firmy", (await page.$$eval("#runs-summary thead th", t => t.map(x => x.textContent))).includes("Przewoźnik") && sumTxt.includes("ESI Logistics") && sumTxt.includes("Nowa Firma Testowa") && !!(await page.$("[data-runs-companies]")), sumTxt.slice(0, 300));
    await page.selectOption("#f-transport-external-companyCount", "1"); await page.waitForSelector("#f-transport-external-company");
    check("3.8 Powrót do jednej firmy: pole wspólne z pierwszą firmą z kursów", (await page.inputValue("#f-transport-external-company")) === "ESI Logistics");

    /* ------------- 3.8: ewidencja obrotu CSV (kolumny zestawienia firmy + planer) ------------- */
    const csvOf = async (route, btn, before) => {
      await go(page, route); await page.waitForTimeout(250); if (before) await before();
      const [d] = await Promise.all([page.waitForEvent("download"), page.click(btn)]);
      const file = path.join(TMP, d.suggestedFilename()); await d.saveAs(file);
      // parser CSV (średnik, pola w cudzysłowie mogą zawierać średnik i podwojony cudzysłów)
      const parse = txt => { const out = [[]]; let cell = "", q = false; for (let i = 0; i < txt.length; i++) { const ch = txt[i];
        if (q) { if (ch === '"' && txt[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
        else if (ch === '"') q = true; else if (ch === ";") { out[out.length - 1].push(cell); cell = ""; } else if (ch === "\r" && txt[i + 1] === "\n") { out[out.length - 1].push(cell); cell = ""; out.push([]); i++; } else cell += ch; }
        out[out.length - 1].push(cell); return out.filter(r => r.length > 1 || r[0] !== ""); };
      const lines = parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
      return { name: d.suggestedFilename(), head: lines[0], rows: lines.slice(1) };
    };
    const HEAD8 = ["Data załadunku do klienta końcowego", "Miejsce załadunku", "Data operacji", "Dostawca", "Zakup/Sprzedaż", "Nr. WZ", "Czy magazynowane (TAK / NIE)", "Deklaracja/KZR"];
    const ops38 = await csvOf("operacje", "#ops-csv");
    check("3.8 CSV Operacje: ewidencja z kolumnami zestawienia (Zakup/Sprzedaż, Nr. WZ, Volumen, transport, Wolumen_MP/t/GJ, Miesiąc_tekst, Rok)", ops38.name.startsWith("ewidencja_operacje_") && HEAD8.every((h, i) => ops38.head[i] === h) && ["Volumen", "Transport: Firma", "Nr. Rejestracyjny", "Odległość km", "Koszt transportu", "Wolumen_GJ", "Ruch_magazyn_MP", "Typ_transportu_heurystyka", "Koszt_rąbania_total", "Miesiąc_tekst", "Rok"].every(h => ops38.head.includes(h)) && ops38.rows.length > 5 && ops38.rows.every(r => r.length === ops38.head.length), { name: ops38.name, n: ops38.rows.length });
    const kinds = new Set(ops38.rows.map(r => r[4]));
    check("3.8 CSV Operacje: wiersze Zakup, Produkcja, Sprzedaż, MM; numery WZ; liczby z przecinkiem", ["Zakup", "Produkcja", "Sprzedaż", "MM"].every(k => kinds.has(k)) && ops38.rows.every(r => /^WZ\//.test(r[5])) && ops38.rows.some(r => /^\d+,\d+$/.test(r[ops38.head.indexOf("Wolumen_t")])), [...kinds]);
    check("3.8 CSV Operacje: kolumny planera (plan dnia, plan i wykonanie miesiąca)", ["Plan_dnia_MP", "Uwagi_planu", "Plan_miesiąca_MP", "Wykonanie_miesiąca_MP", "Realizacja_miesiąca_%", "Wykonanie_planera_MP"].every(h => ops38.head.includes(h)) && ops38.rows.some(r => Number(r[ops38.head.indexOf("Plan_miesiąca_MP")]) > 0));
    const docs38 = await csvOf("dokumenty", "#reg-csv");
    check("3.8 CSV Dokumenty: ta sama ewidencja dla dokumentów z filtra", docs38.name.startsWith("ewidencja_dokumenty_") && docs38.head.join(";") === ops38.head.join(";") && docs38.rows.length > 0);
    const rep38 = await csvOf("raporty", "#rep-trade");
    check("3.8 CSV Raporty: „CSV ewidencji” za okres raportu", rep38.name.startsWith("ewidencja_") && rep38.head.join(";") === ops38.head.join(";"), rep38.name);
    const pl38 = await csvOf("planer", "#pl-trade");
    check("3.8 CSV Planer: „CSV ewidencji” za tydzień planera, obok „CSV planera”", pl38.name.startsWith("ewidencja_planer_") && pl38.head.join(";") === ops38.head.join(";") && !!(await page.$("#pl-csv")), pl38.name);

    // wysyłka e-mailem (OFFLINE: zapis PDF + program pocztowy)
    await go(page, "raporty"); await page.waitForSelector('[data-mail="rep"]');
    check("3.6 Raport miesiąca: przycisk „Wyślij e-mailem”", nb(await page.textContent('[data-mail="rep"]')) === "Wyślij e-mailem");
    await page.click('[data-mail="rep"]'); await page.waitForSelector("#mail-dialog #ml-to");
    check("3.6 Okno e-mail: temat z tytułem raportu, załącznik PDF, informacja OFFLINE", (await page.inputValue("#ml-subject")).includes("ResInvest ERP") && nb(await page.textContent("#mail-dialog")).includes("PDF") && !!(await page.$("#ml-offline")));
    await page.fill("#ml-to", "biuro@odbiorca, x"); await page.click("#ml-send"); await page.waitForTimeout(100);
    check("3.6 Okno e-mail: błędny adres zatrzymany przed wysyłką", nb(await page.textContent('[data-fmsg="to"]')).includes("Nieprawidłowy adres e-mail"));
    await page.fill("#ml-to", "biuro@odbiorca.pl, ksiegowosc@odbiorca.pl");
    const [mdl] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }), page.click("#ml-send")]);
    const lm = await page.evaluate(() => RIW_DEBUG.lastMail);
    check("3.6 OFFLINE: PDF zapisany i program pocztowy z adresami, tematem i treścią", mdl.suggestedFilename().startsWith("raport_") && mdl.suggestedFilename().endsWith(".pdf") && lm.mode === "offline" && lm.to.length === 2 && lm.href.startsWith("mailto:biuro%40odbiorca.pl,ksiegowosc%40odbiorca.pl?subject="), lm);
    for (const [route, sel, label] of [["kwit", '[data-mail="kwit"]', "Kwit produkcji dnia"], ["historia", '[data-mail="hist"]', "Historia"], ["planer", "#pl-mail", "Planer zakupów"], ["dokumenty", '[data-mail="reg"]', "Dokumenty"]]) {
      await go(page, route); await page.waitForTimeout(200);
      check(`3.6 ${label}: przycisk „Wyślij e-mailem”`, !!(await page.$(sel)));
    }
    await page.click('#docs-table [data-view="0"]'); await page.waitForSelector('.modal [data-mail="doc"]');
    check("3.6 Podgląd dokumentu: przycisk „Wyślij e-mailem”", !!(await page.$('.modal [data-mail="doc"]')));
    await page.click('.modal [data-mail="doc"]'); await page.waitForSelector("#mail-dialog");
    check("3.6 Podgląd dokumentu: okno e-mail z numerem dokumentu w treści", /\(.+\/.+\)/.test(await page.inputValue("#ml-msg")));
    await closeModals(page);
    // telefon: flota i okno e-mail bez poziomego przewijania
    await page.setViewportSize({ width: 390, height: 844 });
    for (const r2 of ["flota", "raporty"]) { await go(page, r2); await page.waitForTimeout(200); check(`3.6 Telefon: ${r2} bez poziomego przewijania`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)); }
    await page.click('[data-mail="rep"]'); await page.waitForSelector("#mail-dialog");
    check("3.6 Telefon: okno e-mail mieści się na ekranie", await page.evaluate(() => { const r = document.querySelector("#mail-dialog").getBoundingClientRect(); return r.width <= window.innerWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1; }));
    await ctx.close();
  }

  /* ------------- 3.1: ramka z zablokowanym magazynem przeglądarki (podgląd pliku) ------------- */
  {
    const wrap = path.join(TMP, "podglad.html");
    fs.writeFileSync(wrap, `<!doctype html><body style="margin:0"><iframe sandbox="allow-scripts allow-forms allow-popups allow-modals" src="${FILE}" style="width:1400px;height:880px;border:0"></iframe></body>`);
    const ctx = await newCtx(browser); const page = await ctx.newPage(); watch(page, "sandbox");
    await page.goto("file://" + wrap); await page.waitForTimeout(1500);
    const f = page.frames().find(x => x.url().endsWith(process.env.RIW_HTML || "ResInvest_ERP.html"));
    await f.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))).catch(() => {});
    await f.waitForSelector("#login-form", { timeout: 8000 });
    // ramka bez pamięci przeglądarki = czysta baza: konto startowe administratora (hasło z konfiguracji, wymuszona zmiana)
    await f.fill("#lg-login", LOGINS.u_admin); await f.fill("#lg-pass", "Admin1234"); await f.click("#lg-submit");
    await f.waitForSelector("#force-form", { timeout: 8000 }).catch(() => {});
    await f.fill("#fc-old", "Admin1234"); await f.fill("#fc-new", "Biomasa2027"); await f.fill("#fc-new2", "Biomasa2027"); await f.click('#force-form [type="submit"]');
    await f.waitForSelector("#nav .nav-item", { timeout: 8000 }).catch(() => {});
    check("3.1 Logowanie działa także w ramce bez dostępu do pamięci przeglądarki", (await f.$$("#nav .nav-item")).length > 10 && !!(await f.$("#kpis")));
    await ctx.close();
  }
  await browser.close();

  /* ------------- intro i muzyka ------------- */
  {
    const b1 = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
    const p = await b1.newPage(); watch(p, "intro");
    await p.goto(FILE, { waitUntil: "commit" });
    await p.waitForSelector("#splash .splash-poster", { state: "visible", timeout: 5000 });
    const fcp = await p.evaluate(() => { const e = performance.getEntriesByName("first-contentful-paint")[0]; return e ? e.startTime : null; });
    check("Intro: pierwsza klatka filmu na pierwszym malowaniu (przed skryptami programu)", fcp !== null && (await p.evaluate(() => !!document.querySelector("#splash .splash-poster").complete)), fcp);
    await p.waitForTimeout(700);
    check("Intro: muzyka domyślnie włączona i gra", await p.evaluate(() => RIW_DEBUG.intro.music && RIW_DEBUG.intro.audible));
    check("Intro 3.8: nowy film wbudowany w program (MP4 H.264 + AAC, ok. 3,8 MB)", await p.evaluate(() => typeof INTRO_SRC === "string" && INTRO_SRC.startsWith("data:video/mp4;base64,") && INTRO_SRC.length > 4.9e6 && INTRO_SRC.length < 5.3e6));
    await p.click(".splash [data-music]");
    check("Intro: „Wycisz” działa (tylko dla bieżącego odtworzenia)", await p.evaluate(() => !RIW_DEBUG.intro.audible && localStorage.getItem("riw.music") === null));
    await p.click(".splash [data-skip]"); await p.waitForSelector(".splash", { state: "detached" });
    // wyciszenie z poprzedniej wersji (riw.music = 0) nie wyłącza muzyki przy kolejnym starcie
    const p0 = await b1.newPage(); watch(p0, "intro-2");
    await p0.goto(FILE, { waitUntil: "commit" }); await p0.evaluate(() => localStorage.setItem("riw.music", "0"));
    await p0.reload(); await p0.waitForSelector("#splash .splash-poster", { state: "visible", timeout: 5000 }); await p0.waitForTimeout(700);
    check("Intro 3.8: muzyka włączona od razu przy każdym starcie (także po wcześniejszym wyciszeniu)", await p0.evaluate(() => RIW_DEBUG.intro.music && RIW_DEBUG.intro.audible));
    await p0.close();
    check("Intro: „Pomiń intro”", (await p.evaluate(() => RIW_DEBUG.intro.result)) === "skip");
    const disp = await p.evaluate(() => ({ d: RIW_DEBUG.intro.disposed, media: document.querySelectorAll("video,audio").length, blob: RIW_DEBUG.introModule._blob, login: !!document.querySelector("#login-form") }));
    check("Intro: po pominięciu odtwarzacz odmontowany, zasoby zwolnione, ekran logowania", disp.login && disp.media === 0 && disp.blob === null && Object.values(disp.d).every(Boolean), disp);
    await b1.close();
    const b2 = await chromium.launch({ args: ["--autoplay-policy=document-user-activation-required"] });
    const q = await b2.newPage(); watch(q, "intro-blocked");
    await q.goto(FILE); await q.waitForTimeout(800);
    check("Intro (blokada autoplay): komunikat, aplikacja działa pod spodem", await q.evaluate(() => RIW_DEBUG.intro.blocked) && !!(await q.$("#login-form, #nav .nav-item")));
    await q.mouse.click(400, 400); await q.waitForTimeout(500);
    check("Intro (blokada autoplay): pierwsze kliknięcie włącza muzykę", await q.evaluate(() => RIW_DEBUG.intro.audible));
    await b2.close();
  }

  check("Konsola przeglądarki bez wyjątków", consoleErrors.length === 0, consoleErrors);
  const bad = results.filter(r => !r.ok).length;
  console.log(`\nWYNIK: ${results.length - bad}/${results.length} OK`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
