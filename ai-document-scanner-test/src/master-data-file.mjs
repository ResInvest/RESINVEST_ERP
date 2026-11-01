// @ts-check
/* Wczytanie kartotek ResInvest ERP z pliku JSON (Node.js; tylko odczyt). */
import { readFileSync, existsSync } from "node:fs";
import { loadMasterDataFromObject } from "./master-data.mjs";

/** Kartoteki z pliku JSON ERP. Zwraca null, gdy brak pliku. */
export function loadMasterData(file) {
  if (!file || !existsSync(file)) return null;
  return loadMasterDataFromObject(JSON.parse(readFileSync(file, "utf8")), file);
}
