#!/usr/bin/env node
/* =========================================================================
   Budowa wersji demonstracyjnej ResInvest ERP 3.12.0 — EUDR + pulpit obrotu.

   Wejście:  base/ResInvest_ERP_3.11.0_TEST.html (plik programu bez zmian),
             src/*.js, src/eudr.css, config/eudr.config.json.
   Wyjście:  dist/ResInvest_ERP_3.12.0_EUDR_DEMO.html (jeden plik, offline).

   Zmiany w pliku bazowym są PUNKTOWE — każda kotwica musi wystąpić dokładnie
   raz, inaczej budowa przerywa się z błędem (bez cichych, masowych zamian):
     1. metka wersji, 2. dane przykładowe przy pierwszym uruchomieniu,
     3. osobne klucze pamięci przeglądarki (demo nie dotyka danych 3.11),
     4. ikony EUDR, 5. pozycja „EUDR” w menu, 6. eksport pomocników ewidencji,
     7. style, 8. moduły (przed startem aplikacji).
   ========================================================================= */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = join(ROOT, "base", "ResInvest_ERP_3.11.0_TEST.html");
const OUT = join(ROOT, "dist", "ResInvest_ERP_3.12.0_EUDR_DEMO.html");
const ENGINE = ["tradestats.js", "eudr.js", "eudr-seed.js"];
const UI = ["dashboard-premium.js", "eudr-view.js"];
const BUILD_DATE = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);

const read = p => readFileSync(join(ROOT, p), "utf8");
let html = readFileSync(BASE, "utf8");
const baseHash = createHash("sha256").update(html).digest("hex");

/** Zamiana dokładnie jednego wystąpienia `anchor` (tekst albo wyrażenie z flagą bez g). */
function once(label, anchor, replace) {
  const count = typeof anchor === "string" ? html.split(anchor).length - 1 : (html.match(new RegExp(anchor.source, anchor.flags + "g")) || []).length;
  if (count !== 1) throw new Error(`Kotwica „${label}”: oczekiwano 1 wystąpienia, jest ${count} — plik bazowy inny niż 3.11.0?`);
  html = html.replace(anchor, typeof replace === "function" ? replace : () => replace);
}
/** Tekst wstawiany do <script> nie może zamknąć znacznika. */
const scriptSafe = (name, code) => { if (/<\/script/i.test(code)) throw new Error(`${name}: zawiera „</script” — użyj <\\/script`); return code; };

// 0. nowe klasy CSS nie mogą pokrywać się z klasami programu 3.11 (inaczej style się mieszają)
{
  const baseCss = html.slice(0, html.indexOf("\n</head>"));
  const mine = [...new Set((read("src/eudr.css").match(/\.[a-z][a-z0-9-]*/gi) || []).map(c => c.slice(1)))];
  const own = mine.filter(c => /^(obr|eu|eudr)(-|$)/.test(c));
  const clash = own.filter(c => new RegExp(`\\.${c}(?![a-z0-9-])`).test(baseCss));
  if (clash.length) throw new Error(`Klasy CSS już istnieją w programie 3.11: ${clash.join(", ")}`);
}
// 1. metka wersji
once("metka wersji", /<meta name="generator" content="ResInvest ERP build [^"]*">/, `<meta name="generator" content="ResInvest ERP build 3.12.0-EUDR-DEMO · ${BUILD_DATE}">`);
// 2. dane przykładowe przy pierwszym uruchomieniu + konfiguracja EUDR
const eudrCfg = JSON.parse(read("config/eudr.config.json"));
once("konfiguracja", '"sampleData":false', '"sampleData":true');
once("konfiguracja EUDR", "/* Czcionki PDF (ResInvestDocSans", `/* Konfiguracja EUDR z config/eudr.config.json (demo 3.12) */\nvar RIW_EUDR_CONFIG = ${JSON.stringify(eudrCfg.engine)};\n/* Czcionki PDF (ResInvestDocSans`);
// 3. osobne klucze danych — demo nie odczytuje ani nie zapisuje danych programu 3.11 w tej samej przeglądarce
once("klucz stanu", '"riw.v3.state"', '"riw.v3.eudrdemo.state"');
once("klucz formularza", '"riw.v3.form"', '"riw.v3.eudrdemo.form"');
once("klucze kont", 'const AUTH_KEY = "riw.v3.auth", SESSION_KEY = "riw.v3.session";', 'const AUTH_KEY = "riw.v3.eudrdemo.auth", SESSION_KEY = "riw.v3.eudrdemo.session";');
// 4. ikony
once("ikony", "  const IC = {\n", `  const IC = {\n    chevR: "M9 6l6 6-6 6", chevL: "M15 6l-6 6 6 6",\n    leaf: "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10zM2 21c0-3 1.85-5.36 5.08-6", pin: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6",\n`);
// 5. menu
once("menu", '{ id: "planer", label: N_("Planer zakupów"), icon: "calendar", perm: "report.view" },', '{ id: "planer", label: N_("Planer zakupów"), icon: "calendar", perm: "report.view" },\n    { id: "eudr", label: N_("EUDR — wylesianie"), icon: "leaf", perm: "report.view" },');
// 6. pomocnicy ewidencji obrotu (pochodzenie, miejsce załadunku) — te same reguły na pulpicie i w EUDR
once("eksport ewidencji", "R.Trade = { COLUMNS, rows, transportType, CHIP_KIND };", "R.Trade = { COLUMNS, rows, transportType, CHIP_KIND, originOf, loadPlaceOf, volumes };");
// 7. style
once("style", /\n<\/head>\n<body>/, `\n<style>\n/* eudr.css — demo 3.12 */\n${read("src/eudr.css")}\n</style>\n</head>\n<body>`);
// 8. moduły: silnik (bez DOM) i widoki — przed startem aplikacji
const blocks = ENGINE.concat(UI).map(f => `<script>\n${scriptSafe(f, read("src/" + f))}\n</script>\n`).join("");
once("start aplikacji", /<script>\n"use strict";\n\/\* Start: intro/, `${blocks}<script>\n"use strict";\n/* Start: intro`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
const outHash = createHash("sha256").update(html).digest("hex");
console.log(`Baza 3.11.0  sha256 ${baseHash.slice(0, 16)}…  ${(Buffer.byteLength(readFileSync(BASE)) / 1048576).toFixed(2)} MB`);
console.log(`Wynik 3.12.0 sha256 ${outHash.slice(0, 16)}…  ${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB → ${OUT.replace(ROOT + "/", "")}`);
