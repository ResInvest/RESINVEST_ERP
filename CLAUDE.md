# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Three independent projects, each with its own `package.json`, README and LICENSE:

- `resinvest-erp/` — **the product**: ResInvest ERP, a warehouse/ERP system for wood biomass trading (purchases, wood-chip production, sales, MM transfers, transport, inventory, reports). All the work described below is here unless noted.
- `eudr-demo/` — a frozen 3.12 demo build (EUDR deforestation tab, monthly turnover dashboard). Not developed further.
- `ai-document-scanner-test/` — experimental document scanner (OCR of PZ/WZ/weighbridge tickets). Has its own scripts (`npm test`, `npm run lint`, `npm run typecheck`).

User-facing text, comments, docs and commit messages are written in **Polish**.

## Commands (run in `resinvest-erp/`, Node ≥ 22.13; the only npm dependency is `pg`, loaded only in PostgreSQL mode — `npm ci`)

```bash
npm run build          # app/src/* → ResInvest_ERP.html (single self-contained file, ~7 MB)
npm test               # full gate: check, i18n, themes, build, unit, server, e2e
npm run check          # node --check of every source file (new src files must be added to this script)
npm run i18n           # translation coverage: must report 0 missing / 0 unused for cs and en
npm run themes         # WCAG contrast of every [data-theme] in styles.css
npm run test:unit      # node --test on engine/service tests
npm run test:server    # spawns real servers on free ports
npm run test:e2e       # Playwright (Chromium pre-installed) against the built HTML and a live server
npm run server         # run the server locally (data in data-server/)
node --test tests/scans314.test.mjs                 # single test file
node --test --test-name-pattern="wczytanie" tests/scans314.test.mjs
node tests/e2e314.cjs                               # single e2e suite (needs npm run build first)
FFMPEG=/usr/bin/ffmpeg node tests/e2e-intro.cjs     # intro/splash e2e (not part of npm test)
node tools/loadtest.mjs --users 40 --seconds 30     # load test (add --preload 3000 --think 3000,10000 for a realistic old database)
RIW_TEST_PG_URL=postgres://postgres:<pw>@127.0.0.1:5432/postgres npm run test:pg   # PostgreSQL suites (create/drop their own riw_t_* databases; skipped without the variable; not part of npm test)
node tools/db-migrate.mjs plan|migrate --confirm|verify|rollback --data <dir>      # SQLite → PostgreSQL migration, check, rollback
node tools/export-sample-data.mjs                   # regenerate data/sample_data.json (IDs are random; diff churn is expected)
```

E2E suites load the **built** `ResInvest_ERP.html` — rebuild after changing `app/src`, or tests run stale code. New test files must be added to the matching `test:*` script in `package.json` and, if they should run on Windows, to `installer/build-installer*.{sh,ps1}` and `installer/test-windows/make-test-pack.py`.

## Architecture

**One engine, two runtimes.** `app/src/engine.js` (+ `planner.js`, `trade.js`, `fleetrep.js`, `notify.js`) is the pure domain core: state shape (`SCHEMA`), `migrate()`, `validateStateShape()`, operation planning/commit/correction, stock ledger, permissions (`PERMS`, roles), themes registry, scans rules. `app/src/service.js` maps named commands (`"op.commit"`, `"scan.remove"`, `"data.import"`…) to engine calls with a permission per command. The **same files** run in the browser (local/offline mode, state in localStorage) and in the Node server (`server/riw-server.mjs` loads `app/src/*.js` via `require`). Business rules belong in the engine, never only in UI or server.

**Browser app.** `tools/build.mjs` concatenates `index.template.html` + `styles.css` + scripts in the fixed order of `SCRIPTS` (i18n → dictionaries `i18n.dNN.js` → engine → service → UI) and inlines fonts, icons and the intro video. The build fails on external URL literals in JS (everything must be offline-capable). UI modules: `core.js` (Store, LocalBackend/ServerBackend, App, router, Prefs/themes, NAV, Auth screens), `form.js` (operation form), `views.js` (module screens, registers, op details), `admin.js` (administration, settings/appearance), `scans.js`, `dashboard.js`, `planner-view.js`, `notify-view.js`, `intro.js` (splash). They share the `root.RIWUI` object; each file destructures what it needs at the top — a name used but not destructured is a runtime error only in the code path that hits it.

**Server.** `server/riw-server.mjs` — plain `node:http`, cookie sessions (scrypt passwords), CSRF header `X-RIW: 1`, SSE for live updates, per-user state projections (warehouse isolation) and delta sync (`?since=<rev>` / `haveRev`). `server/core.mjs` — `Store`: SQLite via `node:sqlite` (WAL), rows-based incremental persistence, journal with SHA-256 hash chain (`--check` verifies), backups (daily + pre-update, mirrored to `BACKUP_COPY_TO`), scan files (`<data>/skany/SKANY <MIESIĄC> <ROK>/`, copied to `backups/skany`). `server/db/*` — database layer behind `Store`: `sqlite.mjs` (default, unchanged behaviour) and `postgres.mjs` (`DB_DRIVER=postgres` in `server.env`; synchronous bridge to the `pg` driver running in `pg-worker.mjs`, SQL translated by `toPg`), `schema.mjs` (single source of both schemas — keep SQLite DDL, PG DDL and `TABLES` in sync), `transfer.mjs` (import/export/fingerprints). `server/migrate.mjs` — migration, restore to PostgreSQL, rollback. PostgreSQL backups are `.sqlite` files in the server format. Details: `resinvest-erp/docs/POSTGRESQL.md`. `server/mail.mjs` — SMTP/Resend/file transports, configurable from the app (writes `<data>/server.env`). CLI flags: `--port`, `--data`, `--check`, `--backup-now`, `--restore`, `--mail-setup`.

State is immutable on the server (deep-frozen, copy-on-write); `state.rev` increments on every change and drives memoization and delta sync.

**i18n.** Source strings are Polish, wrapped in `t()`, `tp()` (plurals `a|b|c`), `th()` (HTML-escaped) or `N_()` (deferred). Czech/English pairs live in `app/src/i18n.dNN.js`; add new strings to the newest dictionary (or a new `i18n.dNN.js`, picked up by the build automatically but must be added to `npm run check`). `npm run i18n` and the platform test fail on missing **and** unused keys, and placeholders `{x}` must match.

**Themes.** Each theme is a `[data-theme="id"]{…}` token block in `styles.css`, registered in `THEME_REGISTRY` (engine.js) and in the pre-paint regex in `index.template.html`. Custom and gradient themes generate their tokens at runtime (`customThemeVars` / `gradientThemeVars` in core.js). Removed theme ids are mapped in `THEME_ALIASES`.

## Windows installers (`installer/`)

`ResInvestERP.iss` (Inno Setup, **UTF-8 with BOM**) is compiled once per edition: `installer/editions/{firma,gmail,otwarta}.json` → `tools/make-edition.mjs` → `installer/build/<id>/edition.iss` (defines included by the .iss). Outputs `installer/Output/ResInvestERP_SerwerFirma.exe`, `ResInvestERP_GoogleSerwer.exe`, `ResInvestERP_SerwerNoLimit.exe`. All editions share one AppId (upgrade in place, data in `C:\ProgramData\ResInvestERP` is never removed).

Build on Linux: `export PATH=/usr/lib/wine:$PATH LANG=C.UTF-8; xvfb-run -a bash installer/build-installer-wine.sh --skip-tests` (`EDITIONS="gmail"` for one edition). `LANG=C.UTF-8` is required for shortcut names with Polish characters. Pascal `[Code]` comments must not contain `{…}` (e.g. `{tmp}`) — braces close the comment. Inno 6.4 Pascal Script has no `WindowState`; the full-screen wizard uses a WinAPI timer (`FullScreenTick`).

## Rules specific to this project

- Never commit or embed secrets: `SMTP_PASS` and API keys stay empty in `.env.example`, edition files and installers; passwords are entered on the installer's "Poczta" page or in the app.
- The program, installers and installed folders must not contain references to AI tooling.
- Version is kept in sync in `app/src/engine.js` (`VERSION`), `package.json` and `installer/ResInvestERP.iss` (`AppVersion`); release notes go to `README.md` ("Nowe w X.Y.Z").
