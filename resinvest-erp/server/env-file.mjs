/* =========================================================================
   ResInvest ERP Serwer — zapis pliku ustawień KLUCZ=wartość (<dane>\server.env).
   Jedno miejsce dla zapisu z programu (Poczta → Konfiguracja poczty, --mail-setup) i z instalatora
   (--db-setup). Odczyt: core.mjs → parseEnv / loadEnv.
   ========================================================================= */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Wartość dla pliku .env — w cudzysłowie, gdy zawiera spację, # albo cudzysłów (parser server.env zdejmuje cudzysłowy). null = niedozwolona. */
export function envValue(v) {
  const x = String(v == null ? "" : v);
  if (/[\r\n]/.test(x)) return null;
  if (!/[\s#"']/.test(x)) return x;
  if (!x.includes('"')) return `"${x}"`;
  if (!x.includes("'")) return `'${x}'`;
  return null;
}
/** Ustawia KLUCZ w tekście pliku: zastępuje aktywny wpis, potem zakomentowany, inaczej dopisuje na końcu. */
export function setEnvLine(text, key, value) {
  const re = new RegExp(`^[ \\t]*(?:#[ \\t]*)?${key}[ \\t]*=.*$`, "m");
  const active = new RegExp(`^[ \\t]*${key}[ \\t]*=.*$`, "m");
  const line = `${key}=${value}`;
  if (active.test(text)) return text.replace(active, () => line);              // funkcja: „$” w haśle bez specjalnego znaczenia
  if (re.test(text)) return text.replace(re, () => line);
  return `${text.replace(/\s*$/, "")}\r\n${line}\r\n`;
}
/**
 * Zapis kluczy do <dane>\server.env: plik tymczasowy → zmiana nazwy (plik nigdy nie jest zapisany w połowie).
 * Wartość z niedozwolonymi znakami → wyjątek z polem `key` (nic nie zostaje zapisane).
 */
export function writeEnvKeys(dataDir, values, header = "# ResInvest ERP Serwer — ustawienia administratora\r\n") {
  const file = join(dataDir, "server.env");
  let text = existsSync(file) ? readFileSync(file, "utf8") : header;
  for (const [k, v] of Object.entries(values)) {
    const ev = envValue(v);
    if (ev === null) throw Object.assign(new Error(`Wartość ${k} zawiera niedozwolone znaki (znak nowej linii albo oba rodzaje cudzysłowów)`), { key: k });
    text = setEnvLine(text, k, ev);
  }
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file + ".tmp", text.replace(/\r?\n/g, "\r\n")); renameSync(file + ".tmp", file);
  return file;
}
