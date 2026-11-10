#!/usr/bin/env node
/* =========================================================================
   ResInvest ERP — narzędzie migracji bazy: SQLite → PostgreSQL, kontrola, wycofanie.

   Użycie (serwer ResInvest ERP zatrzymany):
     node tools/db-migrate.mjs plan     [--data <katalog danych>] [--from <plik.sqlite>]
     node tools/db-migrate.mjs migrate  [--data …] [--from …] --confirm [--replace]
     node tools/db-migrate.mjs verify   [--data …] [--from …]
     node tools/db-migrate.mjs rollback [--data …] [--to <plik.sqlite>]

   plan     — tylko odczyt: stan źródła i celu, kroki migracji. Niczego nie zmienia.
   migrate  — kopiuje dane do PostgreSQL (jedna transakcja, kontrola zgodności przed zatwierdzeniem).
              Wymaga --confirm. Plik SQLite pozostaje nietknięty. Serwer NIE jest przełączany —
              przełączenie to osobna decyzja: DB_DRIVER=postgres w server.env.
   verify   — porównuje plik SQLite z bazą PostgreSQL tabela po tabeli (liczba wierszy, SHA-256).
   rollback — zapisuje aktualną bazę PostgreSQL do pliku .sqlite (format serwera) z kontrolą zgodności;
              powrót do SQLite: DB_DRIVER=sqlite i ten plik jako <dane>\resinvest.sqlite (docs/POSTGRESQL.md).

   Połączenie z PostgreSQL: DATABASE_URL albo DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD
   w <dane>\server.env (albo w zmiennych środowiskowych). Hasło nie jest wypisywane.
   Kody wyjścia: 0 — powodzenie, 1 — błąd / niezgodność, 2 — błędne wywołanie.
   ========================================================================= */
import { join } from "node:path";
import { loadConfig, loadEnv } from "../server/core.mjs";
import { databaseConfig } from "../server/db/index.mjs";
import { TABLES } from "../server/db/schema.mjs";
import { planMigration, migrateToPostgres, verifyAgainstPostgres, exportToSqlite } from "../server/migrate.mjs";

const argv = process.argv.slice(2), cmd = argv[0];
const arg = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true) : def; };
const usage = () => { console.log("Użycie: node tools/db-migrate.mjs plan|migrate|verify|rollback [--data <katalog>] [--from <plik.sqlite>] [--to <plik.sqlite>] [--confirm] [--replace] [--json]"); process.exit(2); };
if (!["plan", "migrate", "verify", "rollback"].includes(cmd)) usage();

const cfg = loadConfig(arg("--data") ? { dataDir: String(arg("--data")) } : {});
cfg.backup.copyTo = [];
const { env } = loadEnv(cfg.dataDir);
let pgCfg = null, pgError = "";
try { const c = databaseConfig(Object.assign({}, env, { DB_DRIVER: "postgres" })); pgCfg = c; } catch (e) { pgError = e.message; }
const from = String(arg("--from") || join(cfg.dataDir, "resinvest.sqlite"));
const asJson = !!arg("--json");
const say = m => { if (!asJson) console.log(m); };
const finish = (obj, ok) => { if (asJson) console.log(JSON.stringify(obj, null, 1)); process.exit(ok ? 0 : 1); };
const table = (title, a, b) => {
  say(`\n${title}`);
  say("  tabela      " + (b ? "SQLite      PostgreSQL  zgodność" : "wierszy"));
  for (const t of TABLES) {
    const x = a[t.name], y = b && b[t.name];
    say("  " + t.name.padEnd(12) + String(x ? x.count : "—").padEnd(12) + (b ? String(y ? y.count : "—").padEnd(12) + (x && y && x.count === y.count && x.sha256 === y.sha256 ? "OK" : "RÓŻNICA") : ""));
  }
};
const needPg = () => { if (!pgCfg) { console.error("Brak konfiguracji PostgreSQL: " + pgError); process.exit(2); } };

if (cmd === "plan") {
  const p = planMigration(cfg, from, pgCfg);
  if (!p.ok) { console.error("Błąd: " + p.error); finish(p, false); }
  say(`PLAN MIGRACJI — ResInvest ERP ${p.appVersion} (tylko odczyt, nic nie zostało zmienione)`);
  say(`Źródło:  ${p.source.file}  (${p.source.files.db.size} B, SHA-256 ${p.source.files.db.sha256})`);
  say(`         kontrola pliku: ${p.source.quickCheck} · kontrola serwera: ${p.source.summary.integrity ? "OK" : p.source.summary.notes.join("; ")}`);
  say(`         rewizja ${p.source.summary.rev}, schemat danych ${p.source.summary.schema}, dziennik zmian ${p.source.summary.journalCount} wpisów, użytkownicy ${p.source.summary.users}, konta ${p.source.summary.accounts}`);
  say(`         kolekcje: ${Object.entries(p.source.summary.collections).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  table("Tabele źródła:", p.source.tables);
  if (p.source.nulCharacters) say(`\nUwaga: ${p.source.nulCharacters} wartości tekstowych zawiera znak NUL — przeniesiona zostanie część do znaku NUL (tak samo czyta ją serwer na SQLite; PostgreSQL nie przechowuje NUL).`);
  say(p.target ? `\nCel:     ${p.target.database}\n         ${p.target.empty ? "baza pusta — gotowa do importu" : "BAZA ZAWIERA DANE (" + Object.entries(p.target.counts).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ") + ") — import wymaga --replace"}` : `\nCel:     nie skonfigurowano (${pgError})`);
  say("\nKroki polecenia „migrate --confirm”:\n  1. skróty SHA-256 pliku źródłowego, kopia robocza, kontrola spójności\n  2. import wszystkich tabel do PostgreSQL w jednej transakcji\n  3. porównanie każdej tabeli ze źródłem przed zatwierdzeniem (różnica = wycofanie)\n  4. kontrola rdzeniem serwera: rewizja, stan, łańcuch dziennika\n  5. potwierdzenie, że plik SQLite nie został zmieniony\nPrzełączenie serwera (DB_DRIVER=postgres w server.env) jest osobnym krokiem po akceptacji raportu.");
  finish(p, p.source.summary.integrity && p.sourceUnchanged);
}

if (cmd === "migrate") {
  needPg();
  if (!arg("--confirm")) { console.error("Migracja zmienia bazę docelową PostgreSQL — uruchom z opcją --confirm (najpierw: plan)."); process.exit(2); }
  const r = migrateToPostgres(cfg, from, pgCfg, { replace: !!arg("--replace"), log: (lvl, m) => say(`  ${lvl === "INFO" ? "·" : lvl} ${m}`) });
  if (r.ok) {
    table("Zgodność danych:", r.source.tables, r.target.tables);
    say(`\nMIGRACJA ZAKOŃCZONA POMYŚLNIE — ${r.target.database}`);
    say(`Rewizja ${r.target.summary.rev}, dziennik zmian ${r.target.summary.journalCount} wpisów, stan identyczny ze źródłem. Plik SQLite bez zmian.`);
    say("Serwer nadal używa SQLite. Przełączenie: DB_DRIVER=postgres w server.env i ponowne uruchomienie serwera.");
  } else console.error("\nMIGRACJA NIEUDANA: " + r.error + "\nPlik SQLite nie został zmieniony.");
  say("Raport: " + r.reportFile);
  finish(r, r.ok);
}

if (cmd === "verify") {
  needPg();
  const r = verifyAgainstPostgres(cfg, from, pgCfg);
  if (r.error) { console.error("Błąd: " + r.error); finish(r, false); }
  table(`Porównanie ${from} ↔ ${r.database}`, r.source, r.target);
  say(r.ok ? "\nDane identyczne." : "\nRÓŻNICE: " + r.diff.map(d => d.table).join(", ") + " (po przełączeniu serwera na PostgreSQL różnice są oczekiwane — baza żyje dalej).");
  finish(r, r.ok);
}

if (cmd === "rollback") {
  needPg();
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const out = String(arg("--to") || join(cfg.backupDir, `resinvest-${stamp}-rollback.sqlite`));
  const r = exportToSqlite(cfg, pgCfg, out, { log: () => {} });
  if (!r.ok) { console.error("Eksport nieudany: " + r.error); finish(r, false); }
  say(`Baza ${r.database} zapisana do pliku SQLite:\n  ${r.file}\n  SHA-256 ${r.sha256}`);
  say(`  rewizja ${r.summary.rev}, dziennik zmian ${r.summary.journalCount} wpisów, kontrola spójności: OK, zgodność z PostgreSQL: OK`);
  say("\nPowrót do SQLite (serwer zatrzymany):\n  1. w server.env ustaw DB_DRIVER=sqlite\n  2. uruchom: riw-server.mjs --restore \"" + r.file + "\"   (dotychczasowy plik resinvest.sqlite zostanie zachowany jako „pre-restore”)\n  3. uruchom serwer. Baza PostgreSQL pozostaje nietknięta.");
  finish(r, true);
}
