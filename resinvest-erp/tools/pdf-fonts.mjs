/* Czcionki PDF dla builda i testów: metryki z app/assets/fonts/metrics.json + plik TTF skompresowany zlib (FlateDecode). */
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "assets", "fonts");
export function loadPdfFonts() {
  const m = JSON.parse(readFileSync(join(DIR, "metrics.json"), "utf8"));
  const out = {};
  for (const k of ["regular", "bold"]) {
    const ttf = readFileSync(join(DIR, m[k].file));
    out[k] = Object.assign({}, m[k], { length: ttf.length, data: deflateSync(ttf, { level: 9 }).toString("base64") });
  }
  return out;
}
