/* Testy E2E ResInvest ERP 3.12 (Playwright + Chromium) — tryb lokalny, dane przykładowe, interfejs PL.
   * menu: grupa „Ustawienia” (Użytkownicy, Role i uprawnienia, Dziennik audytu) i „System” (Mój profil, Administracja,
     Poczta, Powiadomienia); grupa bez dostępnych pozycji (magazynier) jest ukryta,
   * przeliczniki miesiąca: zamknięcie sierpnia → okno decyzji na wrzesień → nowe przeliczniki zapisane,
     karta w Inwentaryzacji, przypomnienie na pulpicie znika, telefon bez przewijania poziomego.
   Uruchomienie z katalogu resinvest-erp:  node tests/e2e312.cjs   (zrzuty: SHOTS=<katalog>) */
"use strict";
const path = require("path");
const { chromium } = require("playwright");

const FILE = "file://" + path.resolve(__dirname, "..", process.env.RIW_HTML || "ResInvest_ERP.html");
const SHOTS = process.env.SHOTS || "";
const TODAY = "2026-09-23";
const results = [], errors = [];
const check = (name, cond, detail) => { results.push(!!cond); console.log(`${cond ? "✔" : "✘"} ${name}${!cond && detail !== undefined ? "  → " + JSON.stringify(detail) : ""}`); };
const shot = (page, name) => SHOTS ? page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: false }) : null;

async function session(browser, email, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 }, locale: "pl-PL" }, opts));
  await ctx.addInitScript(d => { try { sessionStorage.setItem("riw.today", d); localStorage.setItem("riw.lang", "pl"); localStorage.setItem("riw.sample", "1"); localStorage.setItem("riw.intro", "0"); } catch (e) {} }, TODAY);
  const page = await ctx.newPage();
  page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(FILE);
  await page.waitForSelector(".splash", { timeout: 4000 }).catch(() => {});
  await page.keyboard.press("Escape");
  await page.waitForSelector("#login-form", { timeout: 15000 });
  await page.fill("#lg-login", email); await page.fill("#lg-pass", "demo1234"); await page.click("#lg-submit");
  await page.waitForSelector("#nav .nav-item", { timeout: 10000 });
  return { ctx, page };
}
/** Menu jako lista: „#Grupa” albo identyfikator pozycji. */
const navList = page => page.$$eval("#nav > *", els => els.map(e => e.classList.contains("sb-group") ? "#" + e.textContent.trim() : e.dataset.nav));
const go = (page, r) => page.evaluate(x => { location.hash = "#/" + x; }, r).then(() => page.waitForTimeout(200));

(async () => {
  const browser = await chromium.launch();
  try {
    /* ---------------- menu ---------------- */
    const a = await session(browser, "magazyn@resinvest.group");
    const nav = await navList(a.page);
    const i = nav.indexOf("#Ustawienia");
    check("administrator: „Ustawienia” → Wygląd i język (3.13), Użytkownicy, Role i uprawnienia, Dziennik audytu; „System” → Mój profil, Administracja, Poczta, Powiadomienia",
      i > 0 && JSON.stringify(nav.slice(i)) === JSON.stringify(["#Ustawienia", "wyglad", "uzytkownicy", "role", "audyt", "#System", "profil", "administracja", "poczta", "powiadomienia"]), nav.slice(i));
    await shot(a.page, "312-menu-admin");
    await a.ctx.close();
    const m = await session(browser, "adrian.wojciechowski@resinvest.group");
    const navM = await navList(m.page);
    // 3.13: każdy użytkownik ma „Ustawienia → Wygląd i język” (język i motyw); konta, role i audyt — tylko z uprawnieniem
    check("magazynier: „Ustawienia” tylko z „Wygląd i język” (bez kont, ról i audytu), „System” zostaje", JSON.stringify(navM.slice(navM.indexOf("#Ustawienia"), navM.indexOf("#System"))) === JSON.stringify(["#Ustawienia", "wyglad"]) && navM.includes("profil"), navM);
    await m.ctx.close();

    /* ---------------- przeliczniki miesiąca ---------------- */
    const k = await session(browser, "anna.gorska@resinvest.group");
    const p = k.page;
    await go(p, "inwentaryzacja");
    check("Inwentaryzacja: karta „Przeliczniki miesiąca” z bieżącymi wartościami", (await p.textContent("#inv-factors")).includes("Przeliczniki miesiąca") && (await p.textContent('[data-factor="m3_mp"]')).trim() === "4");
    check("przed zamknięciem miesiąca nie ma przycisku decyzji", !(await p.$("#inv-factors-go")));
    await p.fill("#inv-ym", "2026-08"); await p.click("#inv-open"); await p.waitForSelector("#inv-gen");
    await p.click("#inv-gen"); await p.waitForSelector("[data-count]");
    // każdy zapis pozycji odświeża ekran — pole wyszukiwane na nowo po identyfikatorze produktu
    for (const pid of await p.$$eval("[data-count]", els => els.map(e => e.dataset.count))) {
      const book = await p.evaluate(id => RIW_DEBUG.R.Inventory.find(RIW_DEBUG.store.state, "wh_zab", "2026-08").lines.find(l => l.productId === id).bookQty, pid);
      const sel = `[data-count="${pid}"]`;
      await p.fill(sel, String(book).replace(".", ",")); await p.press(sel, "Enter");
      await p.waitForFunction(id => RIW_DEBUG.R.Inventory.find(RIW_DEBUG.store.state, "wh_zab", "2026-08").lines.find(l => l.productId === id).countQty !== null, pid, { timeout: 4000 });
    }
    await p.click("#inv-close"); await p.waitForSelector(".scrim [data-yes]"); await p.click(".scrim [data-yes]");
    await p.waitForSelector("#factors-dialog", { timeout: 5000 }).catch(() => {});
    check("po zamknięciu sierpnia otwiera się okno „Przeliczniki na wrzesień 2026”", !!(await p.$("#factors-dialog")) && (await p.textContent("#factors-dialog")).includes("wrzesień 2026"));
    await shot(p, "312-przeliczniki-okno");
    await p.fill("#fx-m3_mp", "45"); await p.click("#factors-dialog [data-save]"); await p.waitForTimeout(250);
    check("wartość spoza zakresu: komunikat w oknie, nic nie zapisano", (await p.textContent("#fx-msg")).includes("dozwolone") && await p.evaluate(() => RIW_DEBUG.store.state.config.m3_mp) === 4);
    await p.fill("#fx-m3_mp", "3,8"); await p.fill("#fx-note", "pomiar wilgotności — partia wrześniowa");
    await p.click("#factors-dialog [data-save]");
    await p.waitForSelector("#factors-dialog", { state: "detached", timeout: 4000 }).catch(() => {});
    const st = await p.evaluate(() => ({ m3: RIW_DEBUG.store.state.config.m3_mp, h: RIW_DEBUG.store.state.config.factorHistory.slice(-1)[0], a: RIW_DEBUG.store.state.audit.slice(-1)[0].code }));
    check("„Zapisz nowe przeliczniki”: 1 m³ = 3,8 MP, historia (zmiana, uwagi), audyt FACTORS_CHANGED", st.m3 === 3.8 && st.h.ym === "2026-09" && st.h.decision === "change" && st.h.note.includes("wilgotności") && st.a === "FACTORS_CHANGED", st);
    check("karta pokazuje nową wartość i ostatnią decyzję", (await p.textContent('[data-factor="m3_mp"]')).trim() === "3,8" && (await p.textContent("#inv-factors")).includes("2026-09"));
    await go(p, "pulpit");
    check("pulpit: brak przypomnienia o przelicznikach po decyzji", !(await p.textContent("#dash-todo")).includes("Przeliczniki na"));
    await k.ctx.close();

    /* ---------------- telefon ---------------- */
    const t = await session(browser, "anna.gorska@resinvest.group", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await go(t.page, "inwentaryzacja");
    const over = await t.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check("telefon 390 px: Inwentaryzacja z kartą przeliczników bez przewijania poziomego", over <= 1 && !!(await t.page.$("#inv-factors")), over);
    await t.ctx.close();

    check("konsola przeglądarki bez błędów", errors.length === 0, errors.slice(0, 3));
  } catch (e) { check("przebieg bez wyjątku", false, e.message); }
  finally { await browser.close(); }
  const ok = results.filter(Boolean).length;
  console.log(`\nWYNIK: ${ok}/${results.length} OK`);
  process.exitCode = ok === results.length ? 0 : 1;
})();
