/* =========================================================================
   ResInvest ERP Serwer — silnik SQLite (tryb OFFLINE / jednostanowiskowy / awaryjny).

   Cienka otoczka na `node:sqlite` (DatabaseSync): te same polecenia SQL, ten sam schemat
   i te same ustawienia (WAL, synchronous=FULL) co w wersjach 3.10–3.14. Zapytania
   wykonuje bezpośrednio wbudowany sterownik — bez warstwy pośredniej i bez narzutu.
   ========================================================================= */
import { DatabaseSync } from "node:sqlite";
import { SQLITE_PRAGMAS, SQLITE_DDL, OUTBOX_EXTRA } from "./schema.mjs";

export class SqliteDb {
  constructor(file, opts = {}) {
    this.dialect = "sqlite";
    this.file = file;
    this.raw = new DatabaseSync(file, opts.readOnly ? { readOnly: true } : {});
  }
  exec(sql) { return this.raw.exec(sql); }
  prepare(sql) { return this.raw.prepare(sql); }
  close() { this.raw.close(); }
  hasTable(name) { return !!this.raw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name); }
  /** Schemat i ustawienia — identycznie jak dotychczas (kolumny kolejki 3.5 dodawane do istniejącej tabeli). */
  ensureSchema() {
    this.raw.exec(SQLITE_PRAGMAS + SQLITE_DDL);
    const cols = new Set(this.raw.prepare("PRAGMA table_info(outbox)").all().map(c => c.name));
    for (const [c, def] of OUTBOX_EXTRA) if (!cols.has(c)) this.raw.exec(`ALTER TABLE outbox ADD COLUMN ${c} ${def}`);
    this.raw.exec("CREATE INDEX IF NOT EXISTS outbox_due ON outbox(status, next_at)");
  }
  /** Spójna kopia całej bazy do pliku (bez zatrzymywania pracy). */
  snapshotTo(file) { this.raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); }
  /** Jeden proces serwera na plik bazy — SQLite pilnuje tego blokadami pliku; bez dodatkowej blokady. */
  acquireWriterLock() { return { ok: true }; }
  /** Błąd połączenia nie dotyczy pliku lokalnego. */
  recover() { return false; }
  describe() { return `SQLite · ${this.file}`; }
}
