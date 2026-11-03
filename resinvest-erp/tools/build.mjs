#!/usr/bin/env node
/* Składa aplikację w jeden plik: ResInvest_ERP.html
   (ten sam plik działa samodzielnie — tryb lokalny — i jest serwowany przez ResInvest ERP Serwer).
   Użycie:  node tools/build.mjs                     (z katalogu resinvest-erp)
            node tools/build.mjs --no-video          (bez filmu intro — tylko muzyka syntezowana)
            node tools/build.mjs --edition premium   (edycja Premium: film intro i zdjęcie ekranu startowego
                                                      z app/assets/premium, motyw „Złota biomasa” domyślnie
                                                      → ResInvest_ERP_Premium.html; silnik i dane bez zmian) */
import { readFileSync, writeFileSync, statSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadPdfFonts } from "./pdf-fonts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "app", "src");
const noVideo = process.argv.includes("--no-video");
const edArg = process.argv.indexOf("--edition");
export const EDITION = edArg >= 0 ? String(process.argv[edArg + 1] || "") : "standard";
if (!["standard", "premium"].includes(EDITION)) throw new Error(`Nieznana edycja: ${EDITION} (standard | premium)`);
const OUT = join(ROOT, EDITION === "premium" ? "ResInvest_ERP_Premium.html" : "ResInvest_ERP.html");
const ASSETS = join(ROOT, "app", "assets", EDITION === "premium" ? "premium" : "");

/** Kolejność ładowania warstw (zależności: i18n + słowniki → silnik → usługa → interfejs). */
export const DICTS = readdirSync(SRC).filter(f => /^i18n\.d\d+\.js$/.test(f)).sort();
// intro.js jako pierwszy — buforowanie filmu rusza, zanim przeglądarka przeczyta resztę programu
export const SCRIPTS = ["intro.js", "i18n.js", ...DICTS, "engine.js", "planner.js", "trade.js", "fleetrep.js", "notify.js", "service.js", "seed.js", "pdf.js", "office.js", "auth.js", "core.js", "form.js", "quick.js", "views.js", "dashboard.js", "admin.js", "planner-view.js", "notify-view.js"];

const read = f => readFileSync(join(SRC, f), "utf8");
for (const f of SCRIPTS.concat(["styles.css"])) {
  const v = read(f);
  if (/<\/(script|style)/i.test(v)) throw new Error(`${f} zawiera </script> lub </style>`);
  if (f.endsWith(".js")) {
    // identyfikatory przestrzeni nazw XML (SVG, OOXML, Dublin Core) nie są pobierane — to tylko nazwy
    const XML_NS = ["http://www.w3.org/", "http://schemas.openxmlformats.org/", "http://purl.org/dc/"];
    const external = (v.match(/https?:\/\/[^\s"'`)]+/g) || []).filter(u => !XML_NS.some(ns => u.startsWith(ns)));
    if (external.length) throw new Error(`${f} odwołuje się do zasobów zewnętrznych: ${external.join(", ")}`);
  }
}

const require = createRequire(import.meta.url);
require(join(SRC, "i18n.js"));
const { VERSION } = require(join(SRC, "engine.js"));

let media = "", poster = "";
if (!noVideo) {
  const jpg = join(ASSETS, "intro-poster.jpg");
  if (existsSync(jpg)) poster = "data:image/jpeg;base64," + readFileSync(jpg).toString("base64");
  const mp4 = join(ASSETS, "intro.mp4");
  media = "data:video/mp4;base64," + readFileSync(mp4).toString("base64");
  console.log(`intro.mp4: ${(statSync(mp4).size / 1024).toFixed(0)} kB`);
}

export function loadConfig() {
  const raw = JSON.parse(readFileSync(join(ROOT, "config", "app.config.json"), "utf8"));
  const cfg = {};
  for (const k of ["m3_mp", "mp_t", "woodTPerM3", "t_gj", "kmRateDefault", "chipRateDefault", "wagonMPDefault", "maxWagons"]) {
    if (!(typeof raw[k] === "number" && raw[k] > 0)) throw new Error(`config/app.config.json: „${k}” musi być liczbą > 0`);
    cfg[k] = raw[k];
  }
  cfg.currency = String(raw.currency || "zł");
  // pierwsze uruchomienie (tryb OFFLINE): konto administratora z hasłem startowym, rejestracja; dane przykładowe — tylko gdy wskazano
  const st = raw.startup || {};
  if (st.adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(st.adminEmail))) throw new Error("config/app.config.json: „startup.adminEmail” — nieprawidłowy adres");
  if (st.adminPassword && !(String(st.adminPassword).length >= 8 && /\d/.test(st.adminPassword) && /[A-Za-z]/.test(st.adminPassword))) throw new Error("config/app.config.json: „startup.adminPassword” — co najmniej 8 znaków, litery i cyfry");
  cfg.startup = { adminEmail: String(st.adminEmail || ""), adminName: String(st.adminName || "Administrator"), adminPassword: String(st.adminPassword || ""), allowSelfRegistration: st.allowSelfRegistration !== false };
  const ta = st.testAdmin || null;
  if (ta && ta.email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(ta.email)) || !(String(ta.password || "").length >= 8)) throw new Error("config/app.config.json: „startup.testAdmin” — podaj email i hasło (min. 8 znaków)");
    cfg.startup.testAdmin = { email: String(ta.email).trim().toLowerCase(), name: String(ta.name || "Administrator testowy"), password: String(ta.password) };
  }
  cfg.sampleData = raw.sampleData === true;
  cfg.edition = EDITION;
  cfg.defaultTheme = EDITION === "premium" ? "aurum" : "pearl";
  return cfg;
}
const cfg = loadConfig();

let html = read("index.template.html");
const put = (marker, value) => {
  if (!html.includes(marker)) throw new Error("Brak znacznika " + marker);
  html = html.split(marker).join(value);
};
put("/*@@STYLES@@*/", read("styles.css"));
/* Biblioteki zewnętrzne dołączone do pliku (bez pobierania z sieci): jsQR 1.4.0 — dekoder kodów QR (Apache-2.0),
   używany przy wczytywaniu kwitów z wagi, gdy przeglądarka nie ma wbudowanego BarcodeDetector (np. Safari / iOS). */
export const VENDOR = ["jsQR.js"];
const vendor = VENDOR.map(f => { const v = readFileSync(join(ROOT, "app", "vendor", f), "utf8"); if (/<\/(script|style)/i.test(v)) throw new Error(`vendor/${f} zawiera </script>`); return `<script>\n/* vendor/${f} — licencja: app/vendor/${f.replace(/\.js$/, "")}.LICENSE */\n${v}\n</script>`; });
put("<!--@@SCRIPTS@@-->", SCRIPTS.map(f => `<script>\n/* ${f} */\n${read(f)}\n</script>`).concat(vendor).join("\n"));
put("@@FONTS@@", JSON.stringify(loadPdfFonts()));
put("@@INTRO_MEDIA@@", media);
put("@@INTRO_POSTER@@", poster);
put("@@ICON_SVG@@", "data:image/svg+xml;base64," + readFileSync(join(ROOT, "app", "assets", "icons", "ric.svg")).toString("base64"));
put("@@ICON_PNG@@", "data:image/png;base64," + readFileSync(join(ROOT, "app", "assets", "icons", "ric-180.png")).toString("base64"));
put("@@CONFIG@@", JSON.stringify(cfg));
put("@@VERSION@@", VERSION);
put("@@EDITION@@", EDITION);
put("@@DEFAULT_THEME@@", cfg.defaultTheme);
const hero = join(ROOT, "app", "assets", "premium", "hero.jpg");
put("@@HERO@@", EDITION === "premium" && existsSync(hero) ? "data:image/jpeg;base64," + readFileSync(hero).toString("base64") : "");
put("@@BUILT@@", new Date().toISOString().slice(0, 10));

writeFileSync(OUT, html, "utf8");
console.log(`Zapisano ${OUT} (${(Buffer.byteLength(html) / 1024).toFixed(0)} kB)`);
