// Skan pokrycia tłumaczeń: logowanie (EN/CS), przejście przez wszystkie zakładki, zebranie RIW_I18N.missing.
"use strict";
const { chromium } = require("playwright");
const URL = process.argv[2] || "http://127.0.0.1:8080/index.html";
const ROUTES = ["pulpit","kurs","operacje","przyjecia","wz","produkcja","kwit","mm","transport","planer","eudr","stany","dokumenty","historia","raporty","inwentaryzacja","flota","produkty","dodatkowe","kontrahenci","magazyny","uzytkownicy","role","audyt","powiadomienia","poczta","administracja","profil","nowa"];
(async () => {
  const b = await chromium.launch();
  const out = {};
  for (const lang of ["en", "cs"]) {
    const ctx = await b.newContext({ locale: lang === "en" ? "en-GB" : "cs-CZ", viewport: { width: 1366, height: 860 } });
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", e => errs.push(String(e.message)));
    await p.addInitScript(() => { try { localStorage.setItem("riw.intro", "0"); } catch (e) {} });
    await p.goto(URL); await p.waitForTimeout(1500);
    await p.fill("input[type=email]", "magazyn@resinvest.group"); await p.fill("input[type=password]", "demo1234");
    await p.click("button[type=submit]"); await p.waitForTimeout(1500);
    for (const r of ROUTES) { await p.evaluate(r => { location.hash = "#/" + r; }, r); await p.waitForTimeout(700); }
    out[lang] = { missing: await p.evaluate(() => [...window.RIW_I18N.missing]), errors: errs };
    await ctx.close();
  }
  await b.close();
  console.log(JSON.stringify(out, null, 1));
})();
