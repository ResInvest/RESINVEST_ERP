#!/usr/bin/env node
// @ts-check
/* global document -- kod w page.evaluate() wykonuje się w przeglądarce */
/* =========================================================================
   Generator przykładowych dokumentów testowych (samples/*.png + samples/fixtures/*.json)

   Dokumenty są FIKCYJNE (dane wymyślone / z kartotek przykładowych ERP) i służą
   wyłącznie do testów modułu. Każda odczytywana wartość jest w znaczniku
   <span data-f="pole">, więc ramki (bbox) w fixture odpowiadają rzeczywistemu
   położeniu tekstu na obrazie — provider mock może pokazać podświetlenia.

   Wymaga Playwright + Chromium (narzędzie deweloperskie; nie jest potrzebne do
   działania modułu). Uruchomienie: npm run samples
   ========================================================================= */
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { MODULE_ROOT } from "../src/config.mjs";
import { FIELD_KEYS } from "../src/schema.mjs";

export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const id of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
    try { return require(id); } catch { /* następna ścieżka */ }
  }
  throw new Error("Brak Playwright (npm i -D playwright albo globalna instalacja).");
}

const W = 1240, H = 1754; // A4 @ 150 dpi

const BASE_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${W}px; height: ${H}px; background: #6f6a62; font-family: "DejaVu Sans", Arial, sans-serif; color: #1b1b1b; }
.paper { position: absolute; left: 60px; top: 50px; width: ${W - 120}px; height: ${H - 100}px; background: #fbfaf6; box-shadow: 0 8px 30px rgba(0,0,0,.45); padding: 70px 80px; }
h1 { font-size: 40px; letter-spacing: 1px; margin-bottom: 8px; }
h2 { font-size: 22px; font-weight: normal; color: #444; margin-bottom: 30px; }
.row { display: flex; gap: 40px; margin-bottom: 26px; font-size: 24px; }
.box { border: 2px solid #333; padding: 18px 22px; flex: 1; min-height: 120px; }
.lbl { font-size: 17px; color: #555; text-transform: uppercase; letter-spacing: .5px; display: block; margin-bottom: 6px; }
table { width: 100%; border-collapse: collapse; font-size: 24px; margin: 24px 0 34px; }
th, td { border: 2px solid #333; padding: 14px 16px; text-align: left; }
th { background: #ecebe5; font-size: 18px; text-transform: uppercase; }
.hand { font-family: "DejaVu Serif", Georgia, serif; font-style: italic; color: #1d3a8a; font-size: 30px; }
.sign { margin-top: 70px; display: flex; justify-content: space-between; font-size: 17px; color: #555; }
.sign div { border-top: 2px dotted #555; width: 300px; padding-top: 8px; text-align: center; }
.mono { font-family: "DejaVu Sans Mono", "Courier New", monospace; }
.stamp { position: absolute; right: 120px; top: 220px; border: 4px solid rgba(160,20,40,.55); color: rgba(160,20,40,.55); padding: 10px 18px; font-size: 26px; transform: rotate(-12deg); }
`;

/**
 * Specyfikacja dokumentu: html + pewności pól (symulowane) + typ.
 * @type {{ file: string, docType: string, typeConfidence: number, evidence: string, rotate: number, html: string, conf: Record<string, number>, notes: string|null, values?: Record<string, string> }[]}
 */
const SAMPLES = [
  {
    file: "wz-458-10-2026.png", docType: "WZ", typeConfidence: 0.98, evidence: "Nagłówek „WZ — WYDANIE ZEWNĘTRZNE”.", rotate: -0.6, notes: "Podpis kierowcy odręczny.",
    conf: { docNumber: 0.99, docDate: 0.99, warehouse: 0.95, recipient: 0.96, product: 0.97, quantity: 0.99, vehicleReg: 0.91, trailerReg: 0.86, driver: 0.78 },
    html: `<div class="paper">
      <h1>WZ — WYDANIE ZEWNĘTRZNE</h1>
      <h2>Nr <b><span data-f="docNumber">458/10/2026</span></b> &nbsp;·&nbsp; Data wystawienia: <span data-f="docDate">03.10.2026</span></h2>
      <div class="row">
        <div class="box"><span class="lbl">Wystawca / magazyn</span>ResInvest Commodities<br>Magazyn: <span data-f="warehouse">RiC Zabrze</span><br>ul. Gwarecka 16, 41-800 Zabrze</div>
        <div class="box"><span class="lbl">Odbiorca</span><b><span data-f="recipient">XYZ Sp. z o.o.</span></b><br>ul. Przemysłowa 7<br>44-100 Gliwice</div>
      </div>
      <table><tr><th style="width:70px">Lp.</th><th>Nazwa towaru</th><th style="width:120px">J.m.</th><th style="width:220px">Ilość</th></tr>
        <tr><td>1</td><td><span data-f="product">Zrębka drzewna</span></td><td>MP</td><td><b><span data-f="quantity">68,40 MP</span></b></td></tr></table>
      <div class="row"><div class="box"><span class="lbl">Transport</span>
        Samochód: <b class="mono"><span data-f="vehicleReg">WI12345</span></b> &nbsp;&nbsp; Naczepa: <b class="mono"><span data-f="trailerReg">W12345</span></b><br>
        Kierowca: <span class="hand"><span data-f="driver">Jan Kowalski</span></span></div></div>
      <div class="sign"><div>Wydał</div><div>Odebrał (kierowca)</div></div>
    </div>`
  },
  {
    file: "pz-014-09-2026.png", docType: "PZ", typeConfidence: 0.97, evidence: "Nagłówek „PZ — PRZYJĘCIE ZEWNĘTRZNE”.", rotate: 0.4, notes: null,
    conf: { docNumber: 0.98, docDate: 0.97, warehouse: 0.94, supplier: 0.95, product: 0.96, quantity: 0.97, vehicleReg: 0.93, driver: 0.88, carrier: 0.92 },
    html: `<div class="paper">
      <h1>PZ — PRZYJĘCIE ZEWNĘTRZNE</h1>
      <h2>Nr <b><span data-f="docNumber">PZ/014/09/2026</span></b> &nbsp;·&nbsp; Data: <span data-f="docDate">28.09.2026</span></h2>
      <div class="row">
        <div class="box"><span class="lbl">Dostawca</span><b><span data-f="supplier">Usługi Leśne Drwal sp. z o.o.</span></b><br>ul. Leśna 3, 44-100 Gliwice</div>
        <div class="box"><span class="lbl">Magazyn przyjmujący</span><span data-f="warehouse">RiC Zabrze</span><br>ResInvest Commodities</div>
      </div>
      <table><tr><th style="width:70px">Lp.</th><th>Towar</th><th style="width:120px">J.m.</th><th style="width:220px">Ilość</th></tr>
        <tr><td>1</td><td><span data-f="product">Drewno opałowe</span></td><td>m3</td><td><b><span data-f="quantity">24,50 m3</span></b></td></tr></table>
      <div class="row"><div class="box"><span class="lbl">Dostawa</span>
        Przewoźnik: <span data-f="carrier">Transport Kowalski</span><br>
        Nr rej.: <b class="mono"><span data-f="vehicleReg">SGL 7Z412</span></b> &nbsp;&nbsp; Naczepa: —<br>
        Kierowca: <span data-f="driver">Zbigniew Kos</span></div></div>
      <div class="sign"><div>Przyjął</div><div>Dostawca</div></div>
    </div>`
  },
  {
    file: "kwit-wywozowy-3-202640017-0871.png", docType: "KWIT_WYWOZOWY", typeConfidence: 0.95, evidence: "Tytuł „Kwit wywozowy”, pola nadleśnictwo / leśnictwo.", rotate: 0.6, notes: null,
    conf: { docNumber: 0.97, docDate: 0.96, forestDistrict: 0.97, forestRange: 0.93, recipient: 0.92, vehicleReg: 0.9, quantity: 0.96 },
    values: { quantity: "31,20 m3" }, // jednostka z nagłówka kolumny „Masy [m3]” (tak odczytuje ją model AI)
    // układ jak wydruk kwitu wywozowego z systemu leśnego: „Etykieta : wartość”, tabela, masy łączne
    html: `<div class="paper" style="left:170px; width:900px; padding:60px 50px; font-size:23px; line-height:1.55">
      <div style="text-align:center; font-size:30px; font-weight:bold">Kwit wywozowy</div>
      <div style="text-align:center; margin-bottom:22px">nr <span data-f="docNumber">3/202640017/0871</span></div>
      <table style="font-size:23px; margin:0 0 16px; border:0"><tbody>
        <tr><td style="border:0; padding:2px 8px 2px 0; width:250px">Nadleśnictwo</td><td style="border:0; padding:2px 0">: <span data-f="forestDistrict">PGL LP NADLEŚNICTWO RUDY RACIBORSKIE</span></td></tr>
        <tr><td style="border:0; padding:2px 8px 2px 0">Nazwa leśnictwa</td><td style="border:0; padding:2px 0">: <span data-f="forestRange">KUŹNIA</span></td></tr>
        <tr><td style="border:0; padding:2px 8px 2px 0">Klient</td><td style="border:0; padding:2px 0">: <span data-f="recipient">RESINVEST COMMODITIES PL S.A.</span></td></tr>
        <tr><td style="border:0; padding:2px 8px 2px 0">Data wystawienia</td><td style="border:0; padding:2px 0">: <span data-f="docDate">01/10/2026</span> 07:40:12</td></tr>
        <tr><td style="border:0; padding:2px 8px 2px 0">Pozycja planu</td><td style="border:0; padding:2px 0">: 202640017</td></tr>
        <tr><td style="border:0; padding:2px 8px 2px 0">Przewoźnik</td><td style="border:0; padding:2px 0">: Przewoźnik odbiorcy</td></tr>
        <tr><td style="border:0; padding:2px 8px 2px 0">Nr rej. pojazdu</td><td style="border:0; padding:2px 0">: <span data-f="vehicleReg">SGL 4T821</span></td></tr>
        <tr><td style="border:0; padding:2px 8px 2px 0">Wydano dnia</td><td style="border:0; padding:2px 0">: 01/10/2026 r.</td></tr>
      </tbody></table>
      <table style="font-size:20px; margin:10px 0"><tr><th>Lp</th><th>Artykuł</th><th>Długość</th><th>Ilość</th><th>Masa[m3]</th></tr>
        <tr><td>1</td><td>S2AP</td><td>2,40</td><td>1</td><td>31,20</td></tr></table>
      <div style="margin-top:14px">Masy [m3] i ilości łączne wg artykułów</div>
      <div>S2AP / <span data-f="quantity">31,20</span> / 1</div>
      <div class="sign" style="margin-top:50px"><div>Wydający dokument</div><div>Odbierający</div></div>
    </div>`
  },
  {
    file: "kwit-wagowy-2026-10-0387.png", docType: "KWIT_WAGOWY", typeConfidence: 0.97, evidence: "Wydruk z wagi: brutto / tara / netto.", rotate: -0.3, notes: null,
    conf: { docNumber: 0.98, docDate: 0.98, time: 0.97, supplier: 0.9, recipient: 0.94, product: 0.93, grossWeight: 0.98, tareWeight: 0.98, netWeight: 0.98, vehicleReg: 0.96, trailerReg: 0.9 },
    html: `<div class="paper mono" style="left:300px; width:640px; padding:60px 50px; font-size:24px; line-height:1.6">
      <div style="text-align:center; font-size:30px; font-weight:bold">KWIT WAGOWY</div>
      <div style="text-align:center">Elektrociepłownia Zabrze S.A. — waga samochodowa nr 2</div>
      <div style="border-top:2px dashed #333; margin:18px 0"></div>
      Nr kwitu: <span data-f="docNumber">2026/10/0387</span><br>
      Data: <span data-f="docDate">2026-10-02</span> &nbsp; Godz.: <span data-f="time">14:12</span><br>
      Dostawca: <span data-f="supplier">ResInvest Commodities</span><br>
      Odbiorca: <span data-f="recipient">Elektrociepłownia Zabrze S.A.</span><br>
      Towar: <span data-f="product">Zrębka drzewna</span><br>
      Pojazd: <span data-f="vehicleReg">SZA 12345</span><br>
      Naczepa: <span data-f="trailerReg">SZA 5521N</span><br>
      <div style="border-top:2px dashed #333; margin:18px 0"></div>
      BRUTTO: &nbsp;<b><span data-f="grossWeight">39 860 kg</span></b><br>
      TARA: &nbsp;&nbsp;&nbsp;<b><span data-f="tareWeight">15 420 kg</span></b><br>
      NETTO: &nbsp;&nbsp;<b><span data-f="netWeight">24 440 kg</span></b><br>
      <div style="border-top:2px dashed #333; margin:18px 0"></div>
      <div style="font-size:18px">Ważący: ......................</div>
    </div>`
  },
  {
    file: "kwit-wagowy-uszkodzony.png", docType: "KWIT_WAGOWY", typeConfidence: 0.88, evidence: "Wydruk z wagi (brutto / tara), dolna część zalana.", rotate: 1.4,
    notes: "Dolna część kwitu jest zalana — masa netto nieczytelna. Brak kierowcy na kwicie.",
    conf: { docNumber: 0.9, docDate: 0.93, time: 0.62, recipient: 0.85, product: 0.81, grossWeight: 0.94, tareWeight: 0.87, vehicleReg: 0.72 },
    html: `<div class="paper mono" style="left:300px; width:640px; padding:60px 50px; font-size:24px; line-height:1.6">
      <div style="text-align:center; font-size:30px; font-weight:bold">KWIT WAGOWY</div>
      <div style="text-align:center">Ciepłownia Rybnik — waga najazdowa</div>
      <div style="border-top:2px dashed #333; margin:18px 0"></div>
      Nr: <span data-f="docNumber">CR/1187/26</span><br>
      Data: <span data-f="docDate">29.09.2026</span> &nbsp; Godz.: <span data-f="time" style="opacity:.55">9:5?</span><br>
      Odbiorca: <span data-f="recipient">Ciepłownia Rybnik</span><br>
      Towar: <span data-f="product">zrębka leśna</span><br>
      Nr rej.: <span data-f="vehicleReg" style="opacity:.7">SZA 7K9O1</span><br>
      <div style="border-top:2px dashed #333; margin:18px 0"></div>
      BRUTTO: &nbsp;<b><span data-f="grossWeight">40 120 kg</span></b><br>
      TARA: &nbsp;&nbsp;&nbsp;<b><span data-f="tareWeight">14 980 kg</span></b><br>
      NETTO: &nbsp;&nbsp;<b>24 ### kg</b><br>
      <div style="position:absolute; left:-20px; right:-30px; top:455px; height:260px; background:radial-gradient(ellipse at 45% 40%, rgba(120,85,40,.92), rgba(140,100,50,.75) 55%, rgba(160,120,70,0) 75%)"></div>
    </div>`
  }
];

async function main() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }).catch(() => chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const outDir = join(MODULE_ROOT, "samples"), fxDir = join(outDir, "fixtures");
  mkdirSync(fxDir, { recursive: true });
  for (const s of SAMPLES) {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body><div id="rot" style="position:absolute; inset:0; transform: rotate(${s.rotate}deg); transform-origin: 50% 50%">${s.html}</div></body></html>`);
    const boxes = await page.evaluate(() => {
      /** @type {Record<string, { text: string, box: number[] }>} */
      const out = {};
      for (const el of Array.from(document.querySelectorAll("[data-f]"))) {
        const r = el.getBoundingClientRect();
        out[/** @type {HTMLElement} */ (el).dataset.f || ""] = { text: (el.textContent || "").trim(), box: [r.left, r.top, r.right, r.bottom] };
      }
      return out;
    });
    const png = await page.screenshot({ type: "png" });
    writeFileSync(join(outDir, s.file), png);
    const pad = 4, r4 = x => Math.round(x * 10000) / 10000;
    const fields = Object.fromEntries(FIELD_KEYS.map(k => {
      const b = boxes[k];
      if (!b) return [k, { value: null, confidence: null, bbox: null }];
      if (s.conf[k] == null) throw new Error(`${s.file}: brak pewności dla pola ${k}`);
      return [k, { value: (s.values && s.values[k]) || b.text, confidence: s.conf[k], bbox: [r4((b.box[0] - pad) / W), r4((b.box[1] - pad) / H), r4((b.box[2] + pad) / W), r4((b.box[3] + pad) / H)] }];
    }));
    const rawText = await page.evaluate(() => (document.querySelector(".paper")?.textContent || "").replace(/[ \t]+/g, " ").replace(/\n\s*/g, "\n").trim());
    const sha = createHash("sha256").update(readFileSync(join(outDir, s.file))).digest("hex");
    const fixture = {
      _opis: "Fixture providera MOCK — wynik symulowany dla przykładowego obrazu (dokument fikcyjny). Pewności są przykładowe; ramki = rzeczywiste położenie tekstu.",
      file: s.file, sha256: sha,
      raw: { docType: { value: s.docType, confidence: s.typeConfidence, evidence: s.evidence }, fields, rawText, notes: s.notes }
    };
    writeFileSync(join(fxDir, s.file.replace(/\.png$/, ".json")), JSON.stringify(fixture, null, 1) + "\n");
    console.log(`${s.file}  ${png.length} B  pól: ${Object.values(fields).filter(f => f.value != null).length}`);
  }
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
