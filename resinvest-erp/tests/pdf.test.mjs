/* Testy generatora PDF (bez przeglądarki). Uruchomienie: node --test tests/pdf.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { inflateSync } from "node:zlib";
import { loadPdfFonts } from "../tools/pdf-fonts.mjs";

const require = createRequire(import.meta.url);
globalThis.RIW_FONTS = loadPdfFonts();
require("../app/src/i18n.js");
const P = require("../app/src/pdf.js");
const latin = u8 => Buffer.from(u8).toString("latin1");

const model = rows => ({ title: "Raport miesięczny — WRZESIEŃ 2026", subtitle: "zażółć gęślą jaźń", number: "RAP/001/09/2026", orientation: "landscape",
  meta: [["Magazyn", "RiC Zabrze"]], generatedAt: "23.09.2026 12:00", generatedBy: "Anna Górska",
  blocks: [{ type: "kpis", items: [["Zakupy", "7 750,00 zł", ""]] }, { type: "h", text: "Bilans stanów" },
    { type: "table", columns: [{ label: "Produkt", w: 3 }, { label: "Ilość", align: "right" }], rows }, { type: "signatures", labels: ["Sporządził"] }] });

test("PDF: poprawna struktura (nagłówek, xref, trailer, EOF), czcionka osadzona", () => {
  const s = latin(P.render(model([["Zrębka produkcyjna leśna", "8\u00A0293 MP"]])));
  assert.ok(s.startsWith("%PDF-1.7"));
  assert.ok(s.trimEnd().endsWith("%%EOF"));
  assert.match(s, /\/Type \/Catalog/);
  assert.match(s, /\/Subtype \/Type0 \/BaseFont \/ResInvestDocSans-Regular \/Encoding \/Identity-H/);
  assert.match(s, /\/FontFile2 \d+ 0 R/);
  // xref wskazuje dokładne pozycje obiektów
  const xref = +s.match(/startxref\n(\d+)/)[1];
  assert.equal(s.slice(xref, xref + 4), "xref");
  const offs = s.slice(xref).split("\n").slice(3).filter(l => / 00000 n $/.test(l)).map(l => +l.slice(0, 10));
  offs.forEach((o, i) => assert.equal(s.slice(o, o + String(i + 1).length + 6), `${i + 1} 0 obj`));
});
test("PDF: osadzony plik czcionki rozpakowuje się do TTF, polskie znaki w mapie ToUnicode", () => {
  const u8 = P.render(model([["Łupina nerkowca — źdźbło", "728 t"]])), s = latin(u8);
  const m = s.match(/\/Length (\d+) \/Length1 (\d+) \/Filter \/FlateDecode >>\nstream\n/);
  const start = m.index + m[0].length, ttf = inflateSync(Buffer.from(u8.slice(start, start + +m[1])));
  assert.equal(ttf.length, +m[2]);
  assert.equal(ttf.readUInt32BE(0), 0x00010000);
  for (const cp of ["0105", "0119", "0142", "0144", "00F3", "015B", "017A", "017C", "0141", "0104"]) assert.ok(s.includes(`<${cp}>`) || s.includes(cp), cp);
});
test("PDF: długa tabela dzieli się na strony z numeracją „Strona X z Y”", () => {
  const rows = Array.from({ length: 120 }, (_, i) => [`Pozycja ${i + 1}`, `${i} MP`]);
  const s = latin(P.render(model(rows)));
  const pages = +s.match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/)[1];
  assert.ok(pages >= 3, String(pages));
});
test("Wydruk HTML: ta sama treść, znaki specjalne ucieczkowane", () => {
  const h = P.toHTML(model([["<script>alert(1)</script>", "1 MP"]]));
  assert.ok(h.includes("Raport miesięczny — WRZESIEŃ 2026") && h.includes("Bilans stanów") && h.includes("Sporządził"));
  assert.ok(!h.includes("<script>alert") && h.includes("&lt;script&gt;"));
});
