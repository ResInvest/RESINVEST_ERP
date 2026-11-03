#!/usr/bin/env node
/* =========================================================================
   ResInvest ERP 3.12 — pliki wariantu instalacji (firma / gmail / otwarta).
   Użycie:  node tools/make-edition.mjs <id> [--out <katalog>]
   Wejście: installer/editions/<id>.json, config/app.config.json, config/server.config.json, .env.example
   Wyjście (domyślnie installer/build/<id>/):
     edition.env         — COMPANY_DOMAINS i nazwa wariantu (instalator nadpisuje przy każdej instalacji),
     server.env          — szablon poczty SMTP dla wariantu (instalator kopiuje tylko przy pierwszej instalacji),
     app.config.json     — domeny kont dla nowej bazy,
     server.config.json  — konto startowe administratora wariantu (tylko przy pierwszej instalacji),
     edition.iss         — definicje dla Inno Setup (#define).
   Sekretów (hasła SMTP, klucze API) generator nigdy nie wpisuje.
   ========================================================================= */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const EDITIONS = ["firma", "gmail", "otwarta"];

/** Domeny wariantu → lista (pusta = dowolna); ta sama reguła co serwer (parseDomains). */
function domainList(v) { const x = String(v || "").trim().toLowerCase(); return x === "*" ? [] : x.split(/[\s,;]+/).filter(Boolean); }

/** Podmiana wartości KEY= w pliku .env (pierwsze wystąpienie wiersza „KEY=”); brak wiersza → dopisanie na końcu. */
function setEnv(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, "m");
  return re.test(text) ? text.replace(re, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
}

export function makeEdition(id, outDir) {
  if (!EDITIONS.includes(id)) throw new Error(`Nieznany wariant „${id}” — dostępne: ${EDITIONS.join(", ")}`);
  const ed = JSON.parse(readFileSync(join(ROOT, "installer", "editions", id + ".json"), "utf8"));
  const out = resolve(outDir || join(ROOT, "installer", "build", id));
  mkdirSync(out, { recursive: true });
  const domains = domainList(ed.companyDomains);

  writeFileSync(join(out, "edition.env"), [
    "# ResInvest ERP Serwer — wariant instalacji (plik nadpisywany przy każdej instalacji / aktualizacji).",
    "# NIE edytuj tego pliku. Zmiany wpisuj w C:\\ProgramData\\ResInvestERP\\server.env — ma pierwszeństwo.",
    `# Wariant: ${ed.name}`,
    `RIW_EDITION=${ed.id}`,
    "# Domeny adresów e-mail kont: lista po przecinku albo * (dowolna domena).",
    `COMPANY_DOMAINS=${ed.companyDomains}`,
    ""].join("\r\n"));

  let env = readFileSync(join(ROOT, ".env.example"), "utf8");
  for (const [k, v] of Object.entries(ed.mail)) env = setEnv(env, k, v);
  env = setEnv(env, "SMTP_PASS", "");
  env = env.replace(/^# =+\n#  ResInvest ERP Serwer — zmienne środowiskowe \(PRZYKŁAD, bez sekretów\)/m,
    m => `${m}\n#  Wariant instalacji: ${ed.name}\n#  Domeny kont: ${domains.length ? domains.map(d => "@" + d).join(", ") : "dowolne"} (COMPANY_DOMAINS — odkomentuj niżej, aby zmienić)`);
  env += `\n# --- Domeny adresów e-mail kont (wariant: ${ed.id}) ---\n# Domyślnie z wariantu instalacji. Aby zmienić: odkomentuj i wpisz listę domen po przecinku albo * (dowolna domena).\n# COMPANY_DOMAINS=${ed.companyDomains}\n`;
  writeFileSync(join(out, "server.env"), env.replace(/\r?\n/g, "\r\n"));

  const app = JSON.parse(readFileSync(join(ROOT, "config", "app.config.json"), "utf8"));
  app.companyDomains = domains;
  if (app.startup) {
    app.startup.adminEmail = ed.initialAdminEmail || app.startup.adminEmail;
    if (!domains.length || domains.includes(String(app.startup.adminEmail).split("@")[1])) { /* zgodny z domenami */ }
    else delete app.startup.adminEmail;
    delete app.startup.testAdmin;            // konto testowe trybu OFFLINE nie trafia do instalacji serwera
  }
  writeFileSync(join(out, "app.config.json"), JSON.stringify(app, null, 2) + "\n");

  const srv = JSON.parse(readFileSync(join(ROOT, "config", "server.config.json"), "utf8"));
  srv.initialAdmin = Object.assign({}, srv.initialAdmin, { email: ed.initialAdminEmail || "" });
  if (!ed.initialAdminEmail) srv.initialAdmin.password = "";
  writeFileSync(join(out, "server.config.json"), JSON.stringify(srv, null, 2) + "\n");

  const q = s => String(s).replace(/"/g, "'");
  // UTF-8 z BOM — plik dołączany do ResInvestERP.iss (Inno Setup 7 wymaga zgodnego kodowania)
  writeFileSync(join(out, "edition.iss"), "\ufeff" + [
    `#define EditionId "${ed.id}"`, `#define EditionSuffix "${ed.suffix}"`, `#define EditionName "${q(ed.name)}"`,
    `#define EditionDomains "${q(domains.length ? domains.map(d => "@" + d).join(", ") : "dowolne")}"`, ""].join("\r\n"));
  return { id: ed.id, out, domains, initialAdmin: srv.initialAdmin.email };
}

if (process.argv[1] && process.argv[1].endsWith("make-edition.mjs")) {
  const id = process.argv[2], i = process.argv.indexOf("--out");
  const ids = id === "all" ? EDITIONS : [id];
  for (const x of ids) { const r = makeEdition(x, i > 0 && ids.length === 1 ? process.argv[i + 1] : null); console.log(`${r.id}: ${r.out} · domeny: ${r.domains.length ? r.domains.join(", ") : "dowolne"} · konto startowe: ${r.initialAdmin || "ekran pierwszej konfiguracji"}`); }
}
