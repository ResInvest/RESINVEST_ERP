/* Proces potomny: baza z danymi przykładowymi i znanymi hasłami kont demonstracyjnych (testy HTTP).
   Użycie: node seed-db.mjs <katalog danych> <sqlite|postgres> [adres bazy] */
const [dataDir, driver, url] = process.argv.slice(2);
const { Store, loadConfig, R } = await import("../../server/core.mjs");
const cfg = loadConfig({ dataDir, todayOverride: "2026-11-09" });
cfg.backup.copyTo = [];
cfg.database = driver === "postgres" ? { driver: "postgres", client: { connectionString: url } } : { driver: "sqlite" };
const store = new Store(cfg, () => {});
const r = store.setup({ name: "Administrator Testowy", email: "magazyn@resinvest.group", password: "Test-Admin#2026", sample: true, lang: "pl" });
if (!r.ok) { console.error(r.error); process.exit(1); }
for (const u of store.state.users) if (u.id !== "u_admin" && R.statusOf(u) === "ACTIVE") store.setPassword(u.id, "Test-User#2026", false);
console.log(JSON.stringify({ rev: store.state.rev, users: store.state.users.map(u => ({ id: u.id, login: u.login, role: u.role })) }));
store.close();
