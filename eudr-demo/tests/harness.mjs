/* Ładowanie warstwy silnika (bez DOM) z ZBUDOWANEGO pliku HTML do izolowanego kontekstu Node (vm).
   Testy sprawdzają dokładnie ten kod, który trafia do użytkownika. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DIST = join(ROOT, "dist", "ResInvest_ERP_3.12.0_EUDR_DEMO.html");

const ENGINE_MARKERS = [/^\/\* Konfiguracja z config\/app\.config\.json/, /^\/\* Konfiguracja EUDR/, /^\/\* i18n(\.d\d+)?\.js \*\//,
  /^\/\* engine\.js \*\//, /^\/\* planner\.js \*\//, /^\/\* trade\.js \*\//, /^\/\* fleetrep\.js \*\//, /^\/\* notify\.js \*\//, /^\/\* service\.js \*\//,
  /^\/\* seed\.js \*\//, /^\/\* tradestats\.js \*\//, /^\/\* eudr\.js \*\//, /^\/\* eudr-seed\.js \*\//];

/** Zwraca kontekst z RIW (silnik + moduły EUDR) załadowany z pliku `html`. */
export function loadEngine(html = DIST) {
  const text = readFileSync(html, "utf8");
  const blocks = [...text.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map(m => m[1]);
  const pick = blocks.filter(b => ENGINE_MARKERS.some(re => re.test(b.trimStart())));
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL });
  for (const code of pick) vm.runInContext(code.replace(/^var (RIW_CONFIG|RIW_EUDR_CONFIG) =/m, "globalThis.$1 ="), ctx, { filename: (code.match(/^\/\* ([\w.-]+\.js) \*\//) || [, "config"])[1] });
  if (!ctx.RIW || !ctx.RIW.EUDR || !ctx.RIW.TradeStats) throw new Error("Nie załadowano modułów EUDR — uruchom najpierw: npm run build");
  return ctx;
}

/** Dane przykładowe na dzień `today` (ten sam kod co przy pierwszym uruchomieniu demo). */
export function sample(ctx, today = "2026-10-28") { return ctx.RIW.Seed.build(today); }

/** Kontekst komendy jak w usłudze (użytkownik z sesji). */
export const ctxOf = (state, userId, today = "2026-10-28") => ({ user: state.users.find(u => u.id === userId), today, now: today + "T10:00:00.000Z", source: "Test" });
