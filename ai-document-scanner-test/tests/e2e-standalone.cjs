/* =========================================================================
   Test E2E programu próbnego standalone/AI_Skaner_Dokumentow.html
   Otwarcie z dysku (file://) przy ZABLOKOWANEJ sieci: OCR offline, przykłady, numer ręczny,
   korekta i historia, eksport CSV, kartoteki ERP, telefon 390 px. Gdy w eval/real są zdjęcia
   prawdziwych dokumentów — pomiar jakości względem wzorców (*.expected.json).
   Uruchomienie: npm run test:standalone   (zrzuty: E2E_SHOTS=<katalog>)
   ========================================================================= */
"use strict";
/* global document, window */
const path = require("path");
const fs = require("fs");

function loadPlaywright() {
  for (const id of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
    try { return require(id); } catch { /* następna ścieżka */ }
  }
  throw new Error("Brak Playwright.");
}

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "standalone", "AI_Skaner_Dokumentow.html");
const EVAL = path.join(ROOT, "eval", "real");
const SHOTS = process.env.E2E_SHOTS || null;
let passed = 0, failed = 0;
const check = (name, cond, extra) => { if (cond) { passed++; console.log("  ok  " + name); } else { failed++; console.log("  BŁĄD " + name + (extra ? " — " + extra : "")); } };
// komunikaty diagnostyczne silnika Tesseract (nie są błędami programu)
const TESS_NOISE = /Image too small to scale|Line cannot be recognized|Empty page|Estimating resolution|Warning: Invalid resolution|Detected \d+ diacritics/i;

(async () => {
  if (!fs.existsSync(FILE)) { console.error("Brak pliku programu — uruchom: npm run build:standalone"); process.exit(1); }
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  const net = [], errors = [];
  const newPage = async opts => {
    const ctx = await browser.newContext(opts);
    await ctx.route("**/*", r => { const u = r.request().url(); if (/^(https?|wss?|ftp):/i.test(u)) { net.push(u); return r.abort(); } return r.continue(); });
    const p = await ctx.newPage();
    p.on("console", m => { if (m.type() === "error" && !TESS_NOISE.test(m.text())) errors.push(m.text()); });
    p.on("pageerror", e => errors.push(String(e)));
    p.on("dialog", d => d.accept());
    await p.goto("file://" + FILE);
    await p.waitForFunction(() => /gotowy|niedostępny/.test(document.getElementById("engineState").textContent || ""), null, { timeout: 120000 });
    return p;
  };
  /** Czeka na NOWY wynik (inny identyfikator skanu niż przed akcją). */
  const lastId = p => p.evaluate(() => document.getElementById("resultForm").dataset.scanId || "");
  const waitResult = (p, prev) => p.waitForFunction(id => { const f = document.getElementById("resultForm"); return !f.hidden && document.getElementById("busy").hidden && (f.dataset.scanId || "") !== id; }, prev ?? "", { timeout: 240000 });
  const keys = p => p.$$eval("#fields .frow", rows => rows.map(r => /** @type {HTMLElement} */ (r).dataset.key));
  const val = (p, k) => p.inputValue("#f_" + k);
  const sample = async (p, label) => { const prev = await lastId(p); await p.click(`#samples button:text-is("${label}")`); await waitResult(p, prev); };

  try {
    console.log("Komputer 1366×900 (file://, sieć zablokowana)");
    const p = await newPage({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
    check("silnik OCR gotowy offline", (await p.textContent("#engineState")).includes("gotowy"));

    // 1. kwit wywozowy
    await sample(p, "Kwit wywozowy");
    check("kwit wywozowy rozpoznany", (await p.inputValue("#docType")) === "KWIT_WYWOZOWY");
    check("pola kwitu: nr, data, nadleśnictwo, leśnictwo | nr rej., ilość m3", JSON.stringify(await keys(p)) === JSON.stringify(["docNumber", "docDate", "forestDistrict", "forestRange", "vehicleReg", "quantity"]), JSON.stringify(await keys(p)));
    check("sekcje Kwit / Transport", JSON.stringify(await p.$$eval("#fields .fsection-title", h => h.map(x => x.textContent))) === JSON.stringify(["Kwit", "Transport"]));
    const kw = { docNumber: "3/202640017/0871", docDate: "01.10.2026", forestDistrict: "PGL LP NADLEŚNICTWO RUDY RACIBORSKIE", forestRange: "KUŹNIA", vehicleReg: "SGL 4T821", quantity: "31,20 m3" };
    for (const [k, v] of Object.entries(kw)) check(`OCR ${k} = ${v}`, (await val(p, k)) === v, await val(p, k));
    check("numer z OCR zawsze „do sprawdzenia” (≤ 85%)", Number((await p.textContent('.frow[data-key="docNumber"] .conf .val')).replace("%", "")) <= 85);
    check("kartoteka ERP: leśnictwo Kuźnia", (await p.textContent('.frow[data-key="forestRange"] .meta')).includes("Kuźnia — Nadleśnictwo Rudy Raciborskie"));
    check("ramki z rzeczywistych współrzędnych OCR", (await p.locator("#overlay .bbox").count()) >= 5);
    await p.hover('.frow[data-key="quantity"]');
    check("najechanie podświetla fragment zdjęcia", await p.isVisible('#overlay .bbox.active[data-key="quantity"]'));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, "standalone-kwit.png"), fullPage: true });

    // 2. WZ — numer ręcznie, uzupełnienie, zapis
    await sample(p, "WZ");
    check("WZ rozpoznana", (await p.inputValue("#docType")) === "WZ");
    check("WZ: numer wpisywany ręcznie (pusty, podpowiedź)", (await val(p, "docNumber")) === "" && (await p.getAttribute("#f_docNumber", "placeholder")) === "wpisz ręcznie");
    check("komunikat „Wpisz ręcznie: Numer”", (await p.textContent("#alerts")).includes("Wpisz ręcznie: Numer (ręcznie)"));
    check("WZ: data, nr rej., ilość z OCR", (await val(p, "docDate")) === "03.10.2026" && (await val(p, "vehicleReg")) === "WI 12345" && (await val(p, "quantity")) === "68,40 MP");
    check("lista podpowiedzi odbiorcy z kartotek ERP", (await p.locator("#dl_recipient option").count()) > 3);
    await p.fill("#f_docNumber", "WZ/458/10/2026");
    await p.fill("#f_recipient", "Elektrociepłownia Zabrze S.A.");
    await p.fill("#reviewer", "Tester E2E");
    await p.click("#btnSave");
    await p.waitForFunction(() => (document.getElementById("scanMeta").textContent || "").includes("zapisano"));
    check("zapis: pola oznaczone „ręcznie”", (await p.textContent('.frow[data-key="docNumber"] .meta')).includes("ręcznie"));
    check("historia korekt: 2 wpisy", (await p.locator("#corrTable tbody tr").count()) === 2);
    check("kartoteka ERP dla wpisanego odbiorcy", (await p.textContent('.frow[data-key="recipient"] .meta')).includes("Kartoteka ERP: Elektrociepłownia Zabrze S.A."));
    check("historia testów: numer i nr rej.", (await p.textContent("#histTable tbody")).includes("WZ/458/10/2026") && (await p.textContent("#histTable tbody")).includes("WI 12345"));

    // 3. eksport CSV
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btnExportCsv")]);
    const csv = fs.readFileSync(await dl.path(), "utf8");
    check("eksport CSV (nagłówek + wiersz)", csv.includes("Numer") && csv.includes("WZ/458/10/2026"));

    // 4. kwit wagowy (uszkodzony) — brak zgadywania
    await sample(p, "Kwit wagowy (uszkodzony)");
    check("kwit wagowy: netto zalane → puste", (await p.inputValue("#docType")) === "KWIT_WAGOWY" && (await val(p, "netWeight")) === "");
    check("kwit wagowy: numer ręcznie", (await val(p, "docNumber")) === "" && (await p.getAttribute("#f_docNumber", "placeholder")) === "wpisz ręcznie");
    check("kwit wagowy: brutto z OCR", (await val(p, "grossWeight")).replace(/\s/g, " ") === "40 120 kg");

    // 5. zmiana typu i obrót
    await p.selectOption("#docType", "PZ");
    check("zmiana typu → pola PZ (z tonami)", JSON.stringify(await keys(p)) === JSON.stringify(["docNumber", "docDate", "supplier", "recipient", "vehicleReg", "quantity", "netWeight"]));
    const beforeRot = await lastId(p);
    await p.click("#btnRotR");
    await waitResult(p, beforeRot);
    check("obrót zdjęcia uruchamia ponowny odczyt", (await p.textContent("#scanMeta")).includes("OCR"));

    // 6. kartoteki z pliku ERP
    await p.setInputFiles("#masterFile", path.join(ROOT, "samples", "erp-master-data.sample.json"));
    await p.waitForFunction(() => (document.getElementById("masterInfo").textContent || "").includes("wczytane z ERP"));
    check("wczytanie kartotek z JSON ERP", (await p.textContent("#masterInfo")).includes("10 kontrahentów"));

    // 7. historia po ponownym otwarciu pliku
    await p.reload();
    await p.waitForFunction(() => document.querySelectorAll("#histTable tbody tr[data-id]").length > 0, null, { timeout: 30000 });
    check("historia zachowana po ponownym otwarciu", (await p.textContent("#histTable tbody")).includes("WZ/458/10/2026"));

    // 8. telefon
    console.log("Telefon 390×844");
    const m = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await sample(m, "Kwit wywozowy");
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("brak poziomego przewijania (390 px)", overflow <= 0, overflow + " px");
    check("aparat telefonu (capture=environment)", (await m.getAttribute("#cameraInput", "capture")) === "environment");
    if (SHOTS) await m.screenshot({ path: path.join(SHOTS, "standalone-mobile.png"), fullPage: true });

    // 9. prawdziwe zdjęcia (tylko lokalnie — nie ma ich w repozytorium)
    const specs = fs.existsSync(EVAL) ? fs.readdirSync(EVAL).filter(f => f.endsWith(".expected.json")) : [];
    const real = specs.map(f => JSON.parse(fs.readFileSync(path.join(EVAL, f), "utf8"))).filter(s => fs.existsSync(path.join(EVAL, s.image)));
    if (real.length) {
      console.log(`Prawdziwe dokumenty (${real.length}) — pomiar jakości`);
      const { scoreDocument, summarize } = await import(path.join(ROOT, "src", "evaluate.mjs"));
      const docs = [];
      await p.selectOption("#hintType", "AUTO");
      await p.waitForFunction(() => document.getElementById("busy").hidden, null, { timeout: 240000 });
      for (const s of real) {
        const prev = await lastId(p);
        await p.setInputFiles("#fileInput", path.join(EVAL, s.image));
        await waitResult(p, prev);
        const result = await p.evaluate(() => {
          const type = /** @type {HTMLSelectElement} */ (document.getElementById("docType")).value;
          const fields = {};
          for (const r of Array.from(document.querySelectorAll("#fields .frow"))) {
            const inp = /** @type {HTMLInputElement} */ (r.querySelector("input"));
            const c = (r.querySelector(".conf .val") || {}).textContent || "";
            fields[/** @type {HTMLElement} */ (r).dataset.key || ""] = { value: inp.value || null, confidence: /%$/.test(c) ? Number(c.replace("%", "")) / 100 : null };
          }
          return { docType: { value: type, confidence: null }, fields };
        });
        const sc = scoreDocument(s, result);
        docs.push(sc);
        console.log(`  ${s.image}: typ ${sc.docTypeGot} (${sc.docTypeCorrect ? "OK" : "oczek. " + sc.docTypeExpected}), pola z dokumentu ${sc.present.correct}/${sc.present.total}, brak zgadywania ${sc.absent.correct}/${sc.absent.total}`);
        for (const r of sc.rows) if (r.status !== "correct") console.log(`      ${r.status.padEnd(12)} ${r.key.padEnd(14)} oczek. ${String(r.expected)}  jest ${String(r.got)}`);
      }
      const sum = summarize(docs);
      console.log("  PODSUMOWANIE:", JSON.stringify({ typ: sum.docTypeAccuracy, pola: sum.presentFieldAccuracy, bezZgadywania: sum.nullDiscipline, licznik: sum.counts }));
      check("prawdziwe dokumenty: typ rozpoznany we wszystkich", sum.docTypeAccuracy === 1);
      check("prawdziwe dokumenty: brak wpisów „zgadniętych”", sum.counts.hallucinated === 0);
    } else console.log("(brak zdjęć prawdziwych dokumentów w eval/real — pomiar pominięty)");

    check("zero prób połączenia z siecią", net.length === 0, net.slice(0, 3).join(", "));
    check("brak błędów JS / CSP", errors.length === 0, errors.slice(0, 3).join(" | "));
  } catch (e) {
    failed++; console.error("E2E przerwany:", e);
  } finally {
    await browser.close();
  }
  console.log(`\nE2E (program HTML): ${passed} ok, ${failed} błędów`);
  process.exit(failed ? 1 : 0);
})();
