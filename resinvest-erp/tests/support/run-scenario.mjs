/* Proces potomny: scenariusz na wskazanym silniku bazy → podsumowanie JSON na stdout.
   Użycie: node run-scenario.mjs <katalog danych> <sqlite|postgres> [adres bazy] */
import "./determinism.mjs";
const [dataDir, driver, url] = process.argv.slice(2);
const { Store, loadConfig, R } = await import("../../server/core.mjs");
const { runScenario, stockTable, TODAY, ADMIN } = await import("./scenario.mjs");
const { storeSummary } = await import("../../server/migrate.mjs");
const { fingerprintSqlite, fingerprintPg } = await import("../../server/db/transfer.mjs");
const cfg = loadConfig({ dataDir, todayOverride: TODAY });
cfg.backup.copyTo = [];
cfg.database = driver === "postgres" ? { driver: "postgres", client: { connectionString: url }, statementTimeoutMs: 60000 } : { driver: "sqlite" };
const store = new Store(cfg, () => {});
const setup = store.setup(Object.assign({ sample: true, lang: "pl" }, ADMIN));
const steps = runScenario(store, R);
const bak = store.backup("test");
const summary = storeSummary(store);
const fp = store.pg ? fingerprintPg(store.db) : fingerprintSqlite(store.db);
const pick = k => fp.tables[k];
console.log(JSON.stringify({ setup, steps, summary, stock: stockTable(store.state, R), fallbacks: store.fallbacks || 0,
  tables: { state: pick("state"), rows: pick("rows"), journal: pick("journal") }, counts: Object.fromEntries(Object.entries(fp.tables).map(([k, v]) => [k, v.count])), backup: bak.name }));
store.close();
