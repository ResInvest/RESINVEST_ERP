/* Kontrola kontrastu motywów (WCAG 2.1): tekst ≥ 4,5:1, elementy interfejsu / duży tekst ≥ 3:1.
   Uruchomienie: node tools/theme-contrast.mjs   (kod wyjścia 1 przy niespełnionym progu) */
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../app/src/styles.css", import.meta.url), "utf8");
const themes = {};
for (const m of css.matchAll(/(?:^|\n)(?::root,)?\[data-theme="(\w+)"\]\{([\s\S]*?)\n\}/g)) {
  const vars = {}; for (const v of m[2].matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)) vars[v[1]] = v[2]; themes[m[1]] = vars;
}
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const PAIRS = [
  ["text", "surface", 4.5], ["text", "bg", 4.5], ["text-head", "surface", 4.5], ["text-2", "surface", 4.5], ["text-2", "surface-2", 4.5], ["text-3", "surface", 4.5],
  ["brand-2", "surface", 4.5], ["brand-ink", "brand", 4.5], ["gold", "surface", 4.5],
  ["ok", "ok-soft", 4.5], ["warn", "warn-soft", 4.5], ["err", "err-soft", 4.5], ["info", "info-soft", 4.5],
  ["tip-ink", "tip-bg", 4.5], ["focus", "surface", 3], ["chart-a", "surface", 3], ["chart-b", "surface", 3], ["chart-c", "surface", 3]
];
let bad = 0;
for (const [id, v] of Object.entries(themes)) {
  const rows = PAIRS.map(([a, b, min]) => { const r = ratio(v[a], v[b]); if (r < min) bad++; return `${r < min ? "✘" : "✔"} ${a}/${b} ${r.toFixed(2)}`; });
  console.log(`== ${id}\n  ` + rows.join("\n  "));
}
console.log(bad ? `\nNiespełnione progi: ${bad}` : "\nWszystkie motywy spełniają progi kontrastu.");
process.exit(bad ? 1 : 0);
