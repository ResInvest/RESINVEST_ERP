# Run-1 — merged findings (one item per root cause)

Ranking: blockers first, then number of users hit, then severity. No item blocked first success (all 5/5 reached it).
Users: I = impatient, S = skeptic, M = mobile, N = non-native, B = breaker. Line numbers refer to `index.html` at commit 0dc6da4 (3.12.0-EUDR-DEMO).

| ID | Users | Sev | Problem (users' words → fact) | Root cause (file:line) | Plan |
|---|---|---|---|---|---|
| R1 | I S M N B (5) | 3 | "Robię przyjęcie, a system wystawia WZ? WZ to wydanie!" — PZ saved as WZ/001/11/2026 | Deliberate since 3.8: one shared WZ series for all docs. `index.html:5922-5934` (`DOC_SERIES="WZ"`, `unifiedNumbering`), default `docNumbering:"wz"` `index.html:4991`; series shown as badge `index.html:12966-12970`; field has `help:false`, nothing explains the series `index.html:11557` | **Needs a human** (bookkeeping rule). Fix now: explain the shared series right at the numbering field and in the summary (where to switch to separate PZ/WZ series). |
| R2 | I S M N B (5) | 3 (M) / 2 / 1 | Full-screen intro with music before login; replays on every reload / new tab; 149 s to first screen on Slow 3G; Skip button vanishes under the finger | Intro plays on every page load `index.html:27439` (+ head flag `index.html:17-19`); 5.1 MB inline video `index.html:1186` sits **before** the app scripts, so the app cannot start until it is downloaded | Move the video data after the boot script; skip intro if the video isn't there within 1.5 s; replay at most once per 8 h (work shift) — still on demand in Profile. |
| R3 | I S M N (4) | 2 / 1 | Language/theme toolbar covers the "Zaloguj się" heading; 12 targets < 44 px on phone | `.auth-tools{position:absolute…}` `index.html:577` over the form; no touch sizing | Toolbar in normal flow above the card; 44 px targets on coarse pointers. |
| R4 | S N B (3) | 2 / 1 | EN/CS UI half Polish: dashboard "Obrót miesiąca…", EUDR module, "Administrator testowy" | 70 keys missing in the CS/EN dictionary (3.12 dashboard widget `index.html:26886-27075`, EUDR module `index.html:27076-27435`); config name not passed through `t()` `index.html:10803` | Add CS/EN dictionary part for 70 keys; translate config default name. Verified with `qa/tools/i18n-scan.cjs` (missing must be 0). |
| R5 | N M (2) | 2 | Approve button invisible at 1366×860 (bottom of a scrolling side panel); on phone toast covers "Zamknij" | `.summary{max-height…;overflow:auto}` `index.html:421` with the button at its end; `.save-bar{display:none}` on desktop `index.html:433`; toasts bottom-right `index.html:453` | Sticky save bar at all widths; toasts at top on phones. |
| R6 | B (1) | 3 | 999 999 999 999 m³ × 10^20 zł approved; precision loss, total "9,99e+31 zł" | `num()` validator has no upper bound `index.html:5190-5198` | Upper bound 100 000 000 for every numeric field of an operation. |
| R7 | B (1) | 2 | 5 000-char "Nr dokumentu zewnętrznego" pushes the document dialog off-screen | `textIn` has no `maxlength` `index.html:11069`; notes textarea unbounded `index.html:11710` | `maxlength` 200 (text), 60 (ext. doc no.), 2000 (notes). |
| R8 | M (1) | 2 | History: ~2 screens of filters before any result on a phone | All filters always expanded `index.html:13987-13996` | Collapse secondary filters + export behind "Filtry i eksport" on ≤720 px. |
| R9 | M (1) | 2 | Top-bar title truncated to "P"; header icons 36 px | `.topbar h1` squeezed `index.html:246,673`; icon buttons 36 px | Hide the truncated title on ≤720 px (page heading is on the page); 44 px targets on coarse pointers. |
| R10 | S (1) | 2 | "Tylko korekta lub anulowanie" — but a "Usuń…" button is offered | Confirm text omits permitted deletion (audited, reversing) `index.html:12520` vs `canDelete` `index.html:13277` | Correct the wording. |
| R11 | S (1) | 2 | Kierownik sees "Przywróć dane przykładowe" | Rendered disabled without explanation `index.html:15284` | Hide for users without `data.import`. |
| R12 | S (1) | 2 | Profile says settings work "na każdym komputerze" while in browser-only mode | Static text `index.html:15214` ignores offline mode | Mode-aware text. |
| R13 | S (1) | 1 | "Moja ostatnia aktywność" not in date order | `slice(-10).reverse()` relies on insertion order `index.html:15213` | Sort by timestamp. |
| R14 | N (1) | 1 | "1 movements" | `t()` instead of plural `tp()` `index.html:14001` | Plural forms PL/CS/EN. |
| R15 | N (1) | 2 | "Choose from the list" — no list visible | Message refers to a datalist the user may not see `index.html:5372` | Message says how to proceed. |
| R16 | B (1) | 1 | `o'brien@resinvest.group` rejected | `EMAIL_RE` without `'` `index.html:4969` | Allow apostrophe (RFC 5322 atext). |
| R17 | S (1) | 3 | Test admin password + demo accounts printed on the login page | Demo build config `startup.testAdmin` `index.html:1193`, list `index.html:10753-10806` | **Needs a human** — intended for the demo; must be removed before production. |
| R18 | S (1) | 3 | No terms / privacy / RODO / pricing; trust | Not present in product | **Needs a human** (legal wording) — suggested text in report. |
| R19 | S (1) | 3 | Data only in this browser; backup manual & admin-only; login promises "kopie zapasowe" | Offline edition by design; hero text `index.html:10721` | **Needs a human** (product claim) — suggested rewrite in report. |
| R20 | B (1) | 2 | Second tab asks to log in again | Session kept per tab (sessionStorage) — security choice | **Needs a human** (security vs convenience). |
| R21 | N (1) | 2 | Product names Polish in EN UI | Master data (names entered by the company), not UI text | No change — data, not translation. |
| R22 | N B M (3) | 1 | Date shown mm/dd/yyyy; month picker "November 2026" | Native date/month inputs follow the **test browser's** UI locale (headless en-US) | Environment — not an app defect. |
| R23 | all (5) | 1 | Console 404 `GET /api/health` | Offline/server mode detection probe; static test server has no API | By design; no user-visible effect. Not changed. |
| R24 | I N (2) | 2 | Long form, help under every field; unexplained abbreviations (KZR, MP, GJ…) | Tutorial help on by default; glossary absent | Not changed in this pass (help is the explanation the non-native relied on; abbreviation glossary = content work) — listed for a human. |
| R25 | B (1) | 1 | Double-click selects toast text | Native browser selection | No change. |
