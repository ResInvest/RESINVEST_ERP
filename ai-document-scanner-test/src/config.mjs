// @ts-check
/* =========================================================================
   AI Document Scanner Test — konfiguracja

   Kolejność (ostatnie wygrywa): config/scanner.config.json → server.env
   (config/server.env lub server.env w katalogu modułu) → zmienne środowiskowe
   systemu → parametry wiersza poleceń.

   Ochrona izolacji: katalog danych testowych nie może być katalogiem danych
   ResInvest ERP (baza resinvest.sqlite / data-server) — serwer odmówi startu.
   ========================================================================= */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

export const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Prosty parser plików KEY=VALUE (# komentarze, opcjonalne cudzysłowy). */
export function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** @returns {{ env: Record<string, string|undefined>, files: string[] }} */
export function loadEnv(root = MODULE_ROOT) {
  const files = [join(root, "config", "server.env"), join(root, "server.env")].filter(f => existsSync(f));
  /** @type {Record<string, string|undefined>} */
  const env = {};
  for (const f of files) Object.assign(env, parseEnvFile(readFileSync(f, "utf8")));
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && v !== "") env[k] = v;
  return { env, files };
}

/**
 * @typedef {object} ScannerConfig
 * @property {number} port
 * @property {string} host
 * @property {"auto"|"mock"|"anthropic"} provider
 * @property {string} dataDir
 * @property {number} maxUploadBytes
 * @property {number} minSide
 * @property {number} maxSide
 * @property {number} rateLimitPerMinute
 * @property {string|null} erpMasterDataFile
 * @property {boolean} keepImages
 * @property {{ model: string, effort: "low"|"medium"|"high"|"xhigh"|"max", timeoutSec: number, useFallback: boolean }} anthropic
 * @property {string|null} accessToken
 * @property {string[]} envFiles
 */

/**
 * @param {Partial<ScannerConfig> & { root?: string }} [overrides]
 * @returns {{ cfg: ScannerConfig, env: Record<string, string|undefined> }}
 */
export function loadConfig(overrides = {}) {
  const root = overrides.root || MODULE_ROOT;
  const file = join(root, "config", "scanner.config.json");
  const j = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const { env, files } = loadEnv(root);
  const num = (v, d) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));
  const a = Object.assign({ model: "claude-opus-5-5", effort: "high", timeoutSec: 180, useFallback: true }, j.anthropic || {});
  /** @type {ScannerConfig} */
  const cfg = {
    port: num(env.SCANNER_PORT, num(j.port, 8095)),
    host: env.SCANNER_HOST || j.host || "127.0.0.1",
    provider: /** @type {any} */ (env.SCANNER_PROVIDER || j.provider || "auto"),
    dataDir: resolve(root, env.SCANNER_DATA_DIR || j.dataDir || "data-test"),
    maxUploadBytes: Math.round(num(j.maxUploadMB, 8) * 1024 * 1024),
    minSide: num(j.minSide, 400),
    maxSide: num(j.maxSide, 8000),
    rateLimitPerMinute: num(j.rateLimitPerMinute, 20),
    erpMasterDataFile: j.erpMasterDataFile === null ? null : resolve(root, env.SCANNER_ERP_MASTER_DATA || j.erpMasterDataFile || "samples/erp-master-data.sample.json"),
    keepImages: j.keepImages !== false,
    anthropic: {
      model: env.ANTHROPIC_MODEL || a.model,
      effort: /** @type {any} */ (env.ANTHROPIC_EFFORT || a.effort),
      timeoutSec: num(a.timeoutSec, 180),
      useFallback: a.useFallback !== false
    },
    accessToken: env.SCANNER_ACCESS_TOKEN || null,
    envFiles: files
  };
  for (const [k, v] of Object.entries(overrides)) if (k !== "root" && v !== undefined) /** @type {any} */ (cfg)[k] = v;
  if (overrides.dataDir) cfg.dataDir = resolve(overrides.dataDir);
  validateConfig(cfg);
  return { cfg, env };
}

/** @param {ScannerConfig} cfg */
export function validateConfig(cfg) {
  if (!["auto", "mock", "anthropic"].includes(cfg.provider)) throw new Error(`Nieznany provider „${cfg.provider}” (dozwolone: auto, mock, anthropic).`);
  if (!["low", "medium", "high", "xhigh", "max"].includes(cfg.anthropic.effort)) throw new Error(`Nieprawidłowy poziom effort „${cfg.anthropic.effort}”.`);
  assertIsolatedDataDir(cfg.dataDir);
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(cfg.host);
  if (!loopback && !cfg.accessToken) throw new Error("Nasłuch poza localhost wymaga SCANNER_ACCESS_TOKEN (server.env) — moduł testowy nie może być otwarty w sieci bez zabezpieczenia.");
}

/** Odmowa użycia katalogu danych ResInvest ERP jako katalogu testowego. */
export function assertIsolatedDataDir(dir) {
  const d = resolve(dir);
  const forbiddenNames = ["data-server", "ResInvestERP"];
  if (forbiddenNames.includes(basename(d)) || existsSync(join(d, "resinvest.sqlite"))) {
    throw new Error(`Katalog „${d}” wygląda na katalog danych ResInvest ERP. Moduł testowy musi używać osobnego katalogu (np. data-test).`);
  }
}
