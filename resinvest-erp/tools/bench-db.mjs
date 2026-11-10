#!/usr/bin/env node
/* Pomiar wydajności zapisu i odczytu rdzenia serwera na wybranym silniku bazy (dane przykładowe + N zakupów).
   Użycie: node tools/bench-db.mjs <katalog roboczy> <sqlite|postgres> [adres bazy] [liczba operacji=500]
   Baza wskazana adresem musi być pusta, jednorazowa — narzędzie zapisuje do niej dane testowe. */
import { Store, loadConfig, R } from "../server/core.mjs";
const [dir, driver, url, nArg] = process.argv.slice(2);
if (!dir || !driver) { console.error("Użycie: node tools/bench-db.mjs <katalog> <sqlite|postgres> [adres bazy] [liczba operacji]"); process.exit(2); }
const N = Number(nArg) || 500, TODAY = "2026-11-09";
const cfg = loadConfig({ dataDir: dir, todayOverride: TODAY }); cfg.backup.copyTo = [];
cfg.database = driver === "postgres" ? { driver: "postgres", client: { connectionString: url } } : { driver: "sqlite" };
const store = new Store(cfg, () => {});
if (store.state) { console.error("Baza nie jest pusta — pomiar przerwany."); process.exit(1); }
store.setup({ name: "Pomiar", email: "magazyn@resinvest.group", password: "Test-Admin#2026", sample: true });
const token = store.createSession("u_admin", "127.0.0.1", "bench");
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const w = [], r = [];
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  const d = R.Seed.draftOf(TODAY, { purchase: { supplierId: "pa_drwal", basis: "DEKL", productId: "pr_zr_tow", qty: String(1 + i % 7), unit: "MP", price: "56" }, transport: { mode: "none", place: "RiC Zabrze" } });
  let a = performance.now();
  const res = store.execute("u_admin", "op.commit", { draft: d }, "pl", {});
  w.push(performance.now() - a);
  if (!res.ok) { console.error(res.error); process.exit(1); }
  a = performance.now(); store.session(token); store.account("u_admin"); r.push(performance.now() - a);
}
const sec = (performance.now() - t0) / 1000;
let a = performance.now(); const b = store.backup("pomiar"); const backupMs = performance.now() - a;
store.close();
a = performance.now(); const again = new Store(cfg, () => {}); const loadMs = performance.now() - a;
const out = { silnik: driver, operacje: N, czas_s: +sec.toFixed(2), zapisy_na_s: +(N / sec).toFixed(0),
  zapis_ms: { srednia: +(w.reduce((x, y) => x + y, 0) / N).toFixed(2), mediana: +pct(w, 0.5).toFixed(2), p95: +pct(w, 0.95).toFixed(2), pierwsze_100: +(w.slice(0, 100).reduce((x, y) => x + y, 0) / 100).toFixed(2), ostatnie_100: +(w.slice(-100).reduce((x, y) => x + y, 0) / 100).toFixed(2) },
  sesja_ms: { mediana: +pct(r, 0.5).toFixed(3), p95: +pct(r, 0.95).toFixed(3) }, kopia_ms: +backupMs.toFixed(0), start_serwera_ms: +loadMs.toFixed(0),
  rekordy: again.db.prepare("SELECT COUNT(*) AS n FROM rows").get().n, spojnosc: again.integrity.ok, kopia: b.name };
again.close();
console.log(JSON.stringify(out));
