#!/usr/bin/env node
/* Generuje data/sample_data.json — kopię zapasową z danymi przykładowymi,
   gotową do wczytania w module „Administracja → Wczytaj kopię”
   (tryb lokalny i serwer). Hasła nie są częścią kopii. */
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
globalThis.RIW_CONFIG = JSON.parse(readFileSync(join(ROOT, "config", "app.config.json"), "utf8"));
require(join(ROOT, "app", "src", "i18n.js"));
const R = require(join(ROOT, "app", "src", "engine.js"));
require(join(ROOT, "app", "src", "service.js"));   // planer i powiadomienia (dane przykładowe 3.5)
require(join(ROOT, "app", "src", "seed.js"));
const s = R.Seed.build("2026-09-23");
const errs = R.validateStateShape(s);
if (errs.length) throw new Error(errs.join("; "));
writeFileSync(join(ROOT, "data", "sample_data.json"), JSON.stringify(s, null, 1));
console.log(`data/sample_data.json: ${s.operations.length} operacji, ${s.ledger.length} zapisów księgi`);
