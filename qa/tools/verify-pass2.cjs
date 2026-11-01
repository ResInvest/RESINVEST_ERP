// Weryfikacja drugiej rundy poprawek (po run-2 i werdykcie sędziego). Uruchom: node qa/tools/verify-pass2.cjs [URL]
"use strict";
const { chromium } = require("playwright");
const URL = process.argv[2] || "http://127.0.0.1:8080/index.html";
const results = [];
const check = (id, ok, info) => { results.push({ id, ok: !!ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${info || ""}`); };

async function login(p, email) {
  await p.fill("#lg-login", email); await p.fill("input[type=password]", "demo1234"); await p.click("#lg-submit");
  await p.waitForFunction(() => { const h = document.getElementById("title"); return h && h.textContent.trim().length > 0; }, null, { timeout: 20000 });
}
async function newPurchase(p, { supplier = "Lander Agro", qty = "20", price = "230" } = {}) {
  await p.evaluate(() => { location.hash = "#/nowa"; }); await p.waitForSelector('[data-bind="purchase.supplierName"]');
  await p.fill('[data-bind="purchase.supplierName"]', supplier);
  const opt = await p.evaluate(() => { const s = document.querySelector('[data-bind="purchase.productId"]'); const o = s && [...s.options].find(o => /Drewno opałowe/.test(o.text)); return o ? o.value : null; });
  if (opt) { await p.selectOption('[data-bind="purchase.productId"]', opt); await p.waitForTimeout(400); }
  await p.fill('[data-bind="purchase.qty"]', qty); await p.fill('[data-bind="purchase.price"]', price);
  await p.locator('[data-bind="purchase.price"]').blur(); await p.waitForTimeout(500);
}

(async () => {
  const b = await chromium.launch();
  const errors = [];
  let ctx = await b.newContext({ viewport: { width: 1366, height: 860 }, locale: "pl-PL" });
  let p = await ctx.newPage(); p.on("pageerror", e => errors.push(e.message));
  await p.addInitScript(() => localStorage.setItem("riw.intro", "0"));
  const html = await (await p.request.get(URL)).text();
  check("N2-static-boot-message", /class="boot-msg"[\s\S]{0,200}Wczytywanie programu/.test(html), "komunikat w statycznym HTML (widoczny przed skryptami)");
  await p.goto(URL); await p.waitForSelector("#lg-login");
  await p.fill("#lg-login", "o'brien@resinvest.group"); await p.fill("input[type=password]", "x"); await p.click("#lg-submit"); await p.waitForTimeout(600);
  check("R16-plain-apostrophe-email", !/Podaj adres e-mail/.test(await p.locator("#lg-err").innerText()), "o'brien@resinvest.group przechodzi walidację formatu");
  await login(p, "anna.gorska@resinvest.group");

  // N7 (supplier): podobna nazwa z kartoteki
  await newPurchase(p, { supplier: "Lander" });
  const pick = p.locator('[data-pick-supplier="Lander Agro"]');
  check("N2/R15-similar-supplier-offered", await pick.count() === 1, "„Czy chodzi o: Lander Agro”");
  if (await pick.count()) { await pick.click(); await p.waitForTimeout(500); }
  check("N2/R15-pick-uses-master-data", /z kartoteki ✓/.test(await p.locator('[data-calc="purchase.supplierName"]').innerText()), "");

  // N8/N12: numer zewnętrzny w podsumowaniu; N3: dwuklik nie zamyka okna
  await p.fill('[data-bind="extDoc"]', "FV 12/11/2026"); await p.waitForTimeout(300);
  await p.locator(".save-bar [data-save]").dblclick(); await p.waitForTimeout(900);
  check("N3-dblclick-keeps-summary-open", await p.locator("#confirm-op").count() === 1, "");
  check("N12-extdoc-in-summary", /FV 12\/11\/2026/.test(await p.locator("#confirm-op").innerText().catch(() => "")), "");
  const sumText = await p.locator("#confirm-op").innerText().catch(() => "");
  check("N1-no-contradiction", !/nie oznacza wydania/.test(sumText) && /Numer z serii WZ/.test(sumText), "");
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);

  // R7/N5: tekst 5000 znaków wklejony skryptem (omija maxlength) — silnik odrzuca, podsumowanie się nie otwiera
  await p.evaluate(() => { const i = document.querySelector('[data-bind="transport.place"]'); i.value = "A".repeat(5000); i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); });
  await p.waitForTimeout(500); await p.locator(".save-bar [data-save]").click(); await p.waitForTimeout(800);
  check("R7-engine-length-limit", /Tekst jest za długi/.test(await p.locator('[data-msg="transport.place"]').innerText().catch(() => "")) && await p.locator("#confirm-op").count() === 0, "");

  // N6: powiadomienia u góry — nie zasłaniają paska zapisu
  const toast = await p.locator(".toasts").boundingBox().catch(() => null), bar = await p.locator(".save-bar").boundingBox();
  check("N6-toast-not-over-save-bar", !toast || toast.y + toast.height < bar.y, JSON.stringify({ toast, barY: bar && bar.y }));

  // N8: nagłówek Historii; R13: aktywność od najnowszej
  await p.evaluate(() => { location.hash = "#/historia"; }); await p.waitForTimeout(800);
  const hh = await p.locator(".page-head p").first().innerText();
  check("N8-history-header-consistent", !/nie edytuje się i nie usuwa/.test(hh) && /USUNIĘTY/.test(hh), "");
  await p.evaluate(() => { location.hash = "#/profil"; }); await p.waitForTimeout(800);
  const ts = await p.evaluate(() => [...document.querySelectorAll(".timeline li b")].slice(0, 10).map(b => b.textContent.trim()));
  const key = s => { const m = /(\d{2})\.(\d{2})\.(\d{4})\D+(\d{2}):(\d{2})/.exec(s); return m ? `${m[3]}${m[2]}${m[1]}${m[4]}${m[5]}` : s; };
  check("R13-activity-newest-first", ts.length > 1 && ts.every((s, i) => i === 0 || key(ts[i - 1]) >= key(s)), JSON.stringify(ts.slice(0, 4)));
  await p.evaluate(() => { location.hash = "#/administracja"; }); await p.waitForTimeout(800);
  check("N9-no-orphan-reset-text", !/Przywraca dane przykładowe/.test(await p.locator("#page").innerText()), "");
  await ctx.close();

  // --- telefon ---
  ctx = await b.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: "pl-PL" });
  p = await ctx.newPage(); p.on("pageerror", e => errors.push(e.message));
  await p.addInitScript(() => localStorage.setItem("riw.intro", "0"));
  await p.goto(URL); await p.waitForSelector("#lg-login"); await login(p, "pawel.kaczmarek@resinvest.group"); await p.waitForTimeout(1000);
  const rows = async () => p.evaluate(() => { const ys = [...document.querySelectorAll(".topbar > .icon-btn, .topbar > .user-btn, .topbar > .new-op-btn")].filter(e => e.offsetParent).map(e => Math.round(e.getBoundingClientRect().top)); return new Set(ys).size; });
  check("N7-header-one-row-dashboard", await rows() === 1, "");
  const smallOn = async () => p.evaluate(() => [...document.querySelectorAll("a[href],button,input,select,textarea,[role=button]")].filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && cs.visibility !== "hidden" && !e.closest(".tbl") && e.type !== "checkbox" && e.type !== "radio"; }).filter(e => { const r = e.getBoundingClientRect(); return r.height < 44; }).map(e => (e.getAttribute("aria-label") || e.innerText || e.id || e.tagName).trim().slice(0, 30)));
  const s1 = await smallOn();
  check("N4/R9-tap-targets-dashboard", s1.length === 0, JSON.stringify(s1.slice(0, 8)));
  await newPurchase(p, { supplier: "Tartak Las-Drew", qty: "20", price: "150" });
  check("N7-header-one-row-form", await rows() === 1, "");
  await p.locator('[data-bind="purchase.price"]').focus(); await p.evaluate(() => document.querySelector('[data-bind="purchase.price"]').scrollIntoView({ block: "nearest" })); await p.waitForTimeout(400);
  const f = await p.locator('[data-bind="purchase.price"]').boundingBox(), sb = await p.locator(".save-bar").boundingBox();
  check("N4-focused-field-above-save-bar", f.y + f.height <= sb.y, JSON.stringify({ fieldBottom: f.y + f.height, barTop: sb.y }));
  await ctx.close();

  check("no-page-errors", errors.length === 0, JSON.stringify(errors.slice(0, 5)));
  await b.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
