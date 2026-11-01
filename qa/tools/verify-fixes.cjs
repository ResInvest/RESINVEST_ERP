// Weryfikacja poprawek run-1 (QA lead, nie persona). Uruchom: node qa/tools/verify-fixes.cjs [URL]
"use strict";
const { chromium } = require("playwright");
const URL = process.argv[2] || "http://127.0.0.1:8080/index.html";
const results = [];
const check = (id, ok, info) => { results.push({ id, ok: !!ok, info }); console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${info || ""}`); };
const overlap = (a, b) => a && b && !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);

async function login(p, email) {
  await p.fill("#lg-login", email); await p.fill("#lg-pass, input[type=password]", "demo1234");
  await p.click("#lg-submit"); await p.waitForSelector("#title", { state: "attached", timeout: 20000 }); await p.waitForFunction(() => document.getElementById("title").textContent.trim().length > 0, null, { timeout: 20000 });
}

(async () => {
  const b = await chromium.launch();
  const errors = [];

  // --- desktop ---
  let ctx = await b.newContext({ viewport: { width: 1366, height: 860 }, locale: "pl-PL" });
  let p = await ctx.newPage(); p.on("pageerror", e => errors.push(e.message));
  await p.goto(URL); await p.waitForSelector("#lg-login", { timeout: 30000 });
  const introShown = await p.$(".splash:not(.boot)");
  check("R2-first-visit-intro-still-plays", !!introShown, "pierwsze uruchomienie: intro jest (zamierzone)");
  await p.keyboard.press("Escape"); await p.waitForTimeout(600);
  const tools = await p.locator(".auth-tools").boundingBox(), h3 = await p.locator(".auth-box h3").boundingBox();
  check("R3-toolbar-not-over-heading", !overlap(tools, h3), JSON.stringify({ tools, h3 }));
  await p.reload(); await p.waitForSelector("#lg-login"); await p.waitForTimeout(800);
  check("R2-reload-no-intro", !(await p.$(".splash")), "odświeżenie w ciągu 8 h");
  await p.fill("#lg-login", "o'brien@resinvest.group"); await p.fill("input[type=password]", "x"); await p.click("#lg-submit"); await p.waitForTimeout(800);
  const err = await p.locator("#lg-err").innerText();
  check("R16-apostrophe-email", !/Podaj adres e-mail/.test(err), err);
  await login(p, "anna.gorska@resinvest.group");
  await p.evaluate(() => { location.hash = "#/nowa"; }); await p.waitForTimeout(1200);
  const sb = await p.locator(".save-bar [data-save]").boundingBox();
  check("R5-approve-visible-desktop", sb && sb.y + sb.height <= 860 && sb.y >= 0, JSON.stringify(sb));
  const help = await p.locator('[data-field="docNoMode.WZ"] .help').innerText().catch(() => "");
  check("R1-series-explained", /wspólnej serii WZ/.test(help), help.slice(0, 80));
  const ml = await p.locator('[data-bind="extDoc"]').getAttribute("maxlength");
  check("R7-extdoc-maxlength", ml === "60", ml);
  await p.fill('[data-bind="purchase.supplierName"]', "Lander Agro");
  await p.fill('[data-bind="purchase.qty"]', "999999999999"); await p.fill('[data-bind="purchase.price"]', "230");
  await p.locator('[data-bind="purchase.price"]').blur(); await p.waitForTimeout(500);
  await p.locator(".save-bar [data-save]").click(); await p.waitForTimeout(700);
  const qmsg = await p.locator('[data-msg="purchase.qty"]').innerText().catch(() => "");
  check("R6-qty-upper-bound", /za duża/.test(qmsg), qmsg);
  await p.evaluate(() => { location.hash = "#/profil"; }); await p.waitForTimeout(800);
  check("R12-profile-offline-text", /w tej przeglądarce \(tryb OFFLINE\)/.test(await p.locator(".page-head p").first().innerText()), "");
  await p.evaluate(() => { location.hash = "#/administracja"; }); await p.waitForTimeout(800);
  check("R11-reset-hidden-for-manager", !(await p.$("#dm-reset")), "");
  await ctx.close();

  // --- EN ---
  ctx = await b.newContext({ viewport: { width: 1366, height: 860 }, locale: "en-GB" });
  p = await ctx.newPage(); p.on("pageerror", e => errors.push(e.message));
  await p.addInitScript(() => localStorage.setItem("riw.intro", "0"));
  await p.goto(URL); await p.waitForSelector("#lg-login");
  check("R4-test-admin-translated", /Test administrator/.test(await p.locator("#test-admin").innerText().catch(() => "")), "");
  await login(p, "tomasz.zajac@resinvest.group"); await p.waitForTimeout(1200);
  const dash = await p.locator("#page").innerText();
  check("R4-dashboard-english", !/Obrót miesiąca|Ten magazyn|Rozwiń całość/.test(dash) && /Monthly turnover/.test(dash), "");
  await ctx.close();

  // --- mobile, Slow 3G, CPU 4× ---
  ctx = await b.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: "pl-PL" });
  p = await ctx.newPage(); p.on("pageerror", e => errors.push(e.message));
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 2000, downloadThroughput: 500 * 1024 / 8 * 0.8, uploadThroughput: 500 * 1024 / 8 * 0.8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const t0 = Date.now();
  p.goto(URL, { timeout: 400000 }).catch(() => {});
  await p.waitForSelector("#lg-login", { state: "visible", timeout: 400000 });
  await p.waitForFunction(() => !document.querySelector(".splash"), null, { timeout: 60000 }).catch(() => {});
  const tLogin = (Date.now() - t0) / 1000;
  const splash = await p.$(".splash");
  check("R2-mobile-login-usable-sooner", tLogin < 100 && !splash, `logowanie dostępne po ${tLogin.toFixed(0)} s (run-1: 149 s); splash=${!!splash}`);
  const small = await p.evaluate(() => [...document.querySelectorAll(".auth-tools button")].filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).length);
  check("R3-login-tap-targets-44", small === 0, `${small} przycisków < 44 px`);
  const tools2 = await p.locator(".auth-tools").boundingBox(), h32 = await p.locator(".auth-box h3").boundingBox();
  check("R3-mobile-toolbar-not-over-heading", !overlap(tools2, h32), "");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await login(p, "pawel.kaczmarek@resinvest.group"); await p.waitForTimeout(1500);
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  check("R9-no-horizontal-scroll", sw <= 375, `scrollWidth=${sw}`);
  const iconSmall = await p.evaluate(() => [...document.querySelectorAll(".topbar .icon-btn")].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 44 || r.height < 44); }).length);
  check("R9-header-icons-44", iconSmall === 0, `${iconSmall} ikon < 44 px`);
  await p.evaluate(() => { location.hash = "#/historia"; }); await p.waitForTimeout(1500);
  const hiddenFilters = await p.evaluate(() => [...document.querySelectorAll(".f-collapsible .f-more")].every(e => getComputedStyle(e).display === "none"));
  check("R8-history-filters-collapsed-mobile", hiddenFilters, "");
  await ctx.close();

  check("no-page-errors", errors.length === 0, JSON.stringify(errors.slice(0, 5)));
  await b.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
