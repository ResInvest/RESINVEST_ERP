# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

The repository holds two independent things. Docs, UI text and code comments are in **Polish**; keep new ones in Polish too.

1. **`index.html` (root, ~6 MB): ResInvest ERP 3.5.0 as a single-file *build output*.** It is the offline/local mode of the ERP (wood-biomass trading and warehousing: PZ/WZ/PW/RW/MM documents, chip production, transport, stocktaking, reports, purchase planner, notifications, audit; PL/CS/EN). **The ERP sources are not in this repo.** Its build script (`tools/build.mjs`), `config/app.config.json`, `engine.js`, `i18n*.js`, `tools/theme-contrast.mjs`, the Node + SQLite server and the Inno Setup installer (`ResInvestERP.iss`) all live elsewhere. Big inlined blobs (intro video `INTRO_SRC`, PDF fonts `RIW_FONTS`) are generated, so don't edit them by hand. Prefer reading this file with `grep -n` and `sed -n` over opening it whole.
2. **`ai-document-scanner-test/`: an isolated, experimental document scanner** that reads PZ, WZ, kwit wywozowy and kwit wagowy from photos. It never writes to the ERP. All tooling and tests live here.

## ERP architecture (read from `index.html`)

The `<script>` blocks are concatenated source files, each starting with a `/* ===` header that names its layer. Everything hangs off the global `RIW` namespace:

- **Warstwa 0, `i18n`:** Polish text is both the source language and the translation key. CS/EN pairs come from `addPairs({ "pl": ["cs", "en"] })` dictionary parts (`i18n.d01.js`, …).
- **Warstwa E, domain engine:** has no DOM and runs in the browser, on the server and in tests. Key functions: `RIW.planOperation`, `commitOperation`, `correctOperation`, `cancelOperation`, `RIW.Stock`, `RIW.Reports`, `RIW.Dates`. Modules use a UMD-style pattern (`root.X || require("./x.js")`).
- **Warstwa S, application service (commands):** this is the *only* way data changes, and it behaves the same in local mode (browser, `localStorage`) and server mode (Node + `node:sqlite`). Also in this layer: purchase planner (`RIW.Planner`), notifications (`RIW.Notify`) and seed data (`RIW.Seed`, which goes through the same engine).
- **Warstwa P:** document generator. One content model produces both the vector PDF and the print HTML. There is also a dependency-free XLSX/DOCX exporter (ZIP STORE + CRC-32).
- **Warstwa A0/A, UI:** local login (PBKDF2), `Store` (one data interface for both modes; writes only via `Store.exec`), the operation and correction form, module screens, dashboard, master data, users and roles, audit, planner and notification screens.

Invariants to preserve: every number shown on the dashboard, reports, PDFs and stock screens comes from the engine (`RIW.Reports`/`RIW.Stock`). Colors only come from theme tokens (5 themes, registry `RIW.THEME_REGISTRY`). The ERP uses no external libraries or CDNs.

## Scanner module: commands

Run these inside `ai-document-scanner-test/`. It needs Node ≥ 22.13.

```bash
npm install
npm test                                  # unit + API tests (node --test, no network; works without node_modules)
node --test tests/normalize.test.mjs      # single test file
node --test --test-name-pattern="daty" tests/normalize.test.mjs   # single test by name
npm run lint                              # ESLint flat config
npm run typecheck                         # tsc, checkJs + strict on JS sources (no TS files)
npm run build                             # pre-build checks + dist/ + standalone HTML
npm run build:standalone                  # rebuild standalone/AI_Skaner_Dokumentow.html only
npm run test:e2e                          # Playwright/Chromium: server UI + standalone file (desktop + 390 px phone)
npm run test:standalone                   # E2E of the standalone file only (file://, network blocked)
npm run verify                            # lint → typecheck → test → build → e2e
npm run start:mock                        # server on http://127.0.0.1:8095 with the mock provider
node tools/eval.mjs [--only kwit]         # accuracy eval against eval/real/*.expected.json
npm run samples                           # regenerate sample PNGs + mock fixtures
```

`AI_Skaner_Dokumentow.html` is a committed build artifact. After you change `src/`, `standalone/src/` or `public/styles.css`, rebuild it with `npm run build:standalone` and commit it together with `standalone/build-info.json`.

## Scanner module: architecture

There are two front ends over one shared core (`src/*.mjs`):

- **Standalone trial program** (`standalone/src/main.mjs` + `ocr-engine.mjs`): esbuild bundles it into one offline HTML file with Tesseract.js, the WASM core and Polish language data inlined as gzip/base64. It has a CSP that blocks the network. Pipeline: free in-browser OCR → `ocr-extract.mjs` (`extractFromOcr`, then `mergeExtractions` across two OCR passes) → normalize → manual correction. History is kept in `localStorage` (`riw.scanner.*`) and never stores images.
- **Server module** (`server/scanner-server.mjs`, port 8095, plain `node:http`) with the `public/` UI (no libraries, CSP `'self'`, no inline scripts). Pipeline: `image.mjs` checks the image → a provider (`src/providers/`) → `analyze.mjs` → `normalize.mjs` → `store.mjs`.

Shared core:
- `schema.mjs` is the single source of truth for document types, the per-type field lists (`FIELDS_BY_TYPE`, `TYPE_SECTIONS`, manual-only fields) and the JSON schema the AI must return. The UI, tests, fixtures and `tools/build.mjs` all validate against it. **Only fields listed for a type are shown or stored. Don't add fields that aren't on that list.**
- `normalize.mjs`: Polish number, date and time formats, units (MP/m3/t/kg), registration plates, confidence caps, and cross-checks (e.g. netto vs brutto − tara). Cross-checks only produce **warnings**. Values are never inferred or computed: missing means `null`.
- Providers implement the contract in `providers/provider.mjs` and return `RawExtraction`. `mock` matches sample images by SHA-256 against `samples/fixtures/*.json`. `anthropic` loads `@anthropic-ai/sdk` lazily, sends the image plus a forced JSON schema, and falls back to another model if configured. `provider: "auto"` picks Anthropic when `ANTHROPIC_API_KEY` is set.
- `store.mjs`: an isolated JSON store in `data-test/`. Writes are atomic (tmp → fsync → rename), each result has revisions with conflict detection (`rev`), the original AI result `aiResult` is frozen, and corrections are kept as was → is history.
- `config.mjs`: the server **refuses to start** if the data dir looks like the ERP's (`resinvest.sqlite`, `data-server`), and refuses to listen beyond localhost without `SCANNER_ACCESS_TOKEN`.
- `master-data.mjs` reads an ERP master-data JSON file **read-only**. It only offers "Kartoteka ERP: …" suggestions and never changes the extracted value.

Config: `config/scanner.config.json`, overridden by `config/server.env` (template: `.env.example`), which is overridden by system environment variables. API keys stay on the server only. `tools/build.mjs` fails the build if `public/` contains secrets, CDN/external URLs or inline scripts, if an `getElementById` id is missing from `index.html`, or if a fixture doesn't match its image hash or the schema.

## Rules carried over from the module's docs

- Test mode: the scanner never posts anything to the ERP. Future integration (`docs/INTEGRACJA_ERP.md`) must go through ERP **drafts** and the ERP engine, never direct posting.
- Real document photos (`eval/real/*.jpg|png`), eval reports, `data-test/`, `dist/` and `server.env` are git-ignored and must stay out of the repo.
- E2E tests `require("playwright")`, falling back to `/opt/node22/lib/node_modules/playwright`. Set `E2E_SHOTS=<dir>` to save screenshots.
