# First-user walkthrough — persona "breaker" (run-1)
Account: michal.lewandowski@resinvest.group (Kierownik, RiC Rokitki). OFFLINE mode (data in the browser). Port 9305.
> Note: written by the QA lead from the subagent's returned report (its Write call was refused by the tool environment); content unchanged. The tester read only the `switchTab` line of the QA tool (qa/tools/browser-daemon.cjs) to fix a call — no app code.
> Test data left in this isolated browser context (discarded with it): WZ/001–WZ/004 incl. one of 1e31 zł / ~1e12 m³, and 4 junk supplier names.

## 1. Think-aloud log
| # | Expectation | Result | Screenshot |
|---|---|---|---|
| 1 | Landing → login form | Intro overlay, music-autoplay notice, demo account list; console GET /api/health 404 | 01-landing.png |
| 2 | Double-click "Zaloguj się" empty → validation | "Podaj e-mail służbowy i hasło" | 02-login-empty.png |
| 3–5 | E-mail `<img src=x onerror=alert(1)>@x.pl`, password SQLi, dblclick → rejected, no alert | "Podaj adres e-mail", no dialog (first fills timed out: element indexes changed after intro closed) | 03-login-junk.png |
| 6–7 | `o'brien@resinvest.group` + SQLi → wrong password | Rejected as invalid e-mail | 04-login-sqli.png |
| 8–10 | Unknown e-mail + 5,000-char password → generic error | "Nieprawidłowy e-mail lub hasło." | 05-login-long.png |
| 11–13 | Real credentials, dblclick → dashboard | "Pulpit — RiC Rokitki", no errors | 06-after-login.png |
| 14–15 | Tile "Zakup (PZ)" → purchase form | #/nowa; field "Numeracja WZ" = WZ/001/11/2026 | 07, 08 |
| 16–19 | Supplier = script/img payload, Ilość -5, Cena 99999999999999999999, dblclick "Zatwierdź…" | Negative qty blocked; price silently read as 100…032 768; payload shown as text; dblclick selected toast text | 09-pz-junk1.png |
| 20–21 | Ilość 999999999999 → blocked as unrealistic | Accepted; total 9,99e+31 zł; "gotowe do zatwierdzenia"; plan says WZ | 10-pz-junk-summary.png |
| 22 | Summary should show PZ | "WZ — Przyjęcie zewnętrzne (zakup)" | 11-confirm-dialog.png |
| 23 | Dblclick "Zatwierdź dokument" → duplicate? | One document (WZ/001); next WZ/002 | 12-after-dblclick-confirm.png |
| 24–28 | New tab on same form | Login page again; after re-login offers WZ/002 | 13-tab2-login.png |
| 29–34 | Tab 2: emoji/Arabic supplier, 10 m³ × 200 zł, 5,000×"X" in Nr dok. zewn., junk Uwagi | Accepted, no length limit | 14-tab2-filled.png |
| 35–39 | Tab 1: Tartak O'Brien, 20 m³ × 230 zł | 4 600 zł; also offers WZ/002 | 15-tab1-filled.png |
| 40–42 | Submit tab 2 | WZ/002; 5,000-char value pushes all detail values off screen | 16, 17 |
| 43–45 | Submit tab 1 | WZ/003 (renumbered at save, no collision) — the valid receipt | 18, 19 |
| 46–53 | "Refresh Test" 5 m³ × 100 zł, approve, reload ~50 ms later | Saved once (WZ/004); form reset; intro replays | 20-after-reload.png |
| 54–55 | "Pomiń intro" (timed out — already gone), nav "Historia" | Four Zakup rows WZ/001–004, junk shown as text, no dialogs | 21-historia.png |

## 2. Friction table
| # | sev | quote | URL | shot | console | failed req | what happened |
|---|---|---|---|---|---|---|---|
| 1 | 3 | "Szukam PZ, a system wystawia WZ?!" | #/nowa, Historia | 07, 10–12, 21 | – | – | Purchase numbered WZ/00n; "Numeracja WZ"; "WZ — Przyjęcie zewnętrzne (zakup)"; help text says PZ. |
| 2 | 3 | "Bilion m³ po 10^20 zł i zatwierdzone." | #/nowa | 10–12, 21 | – | – | No upper limit on quantity/price; absurd purchase booked to stock. |
| 3 | 2 | "Która to cena, …032 768 czy …049 152?" | #/nowa | 09, 10, 21 | – | – | Precision loss on large numbers; total in e+31 notation; Stan po ≠ przed + zmiana. |
| 4 | 2 | "Gdzie się podziały dane dokumentu?" | saved-document dialog | 17 | – | – | 5,000 chars accepted in Nr dok. zewn.; detail values pushed off screen; Historia rows very tall. |
| 5 | 2 | "Śmieci od razu w kartotece kontrahentów." | Historia filter / Kontrahenci | 21 | – | – | Any typed supplier name added to master data on approval; only a small "nowy dostawca" badge. |
| 6 | 2 | "Druga karta i znowu logowanie." | new tab | 13 | 404 | GET /api/health 404 | Session doesn't carry over to a second tab. |
| 7 | 1 | "O'Brien to normalny adres." | login | 04 | – | – | Apostrophe in e-mail rejected. |
| 8 | 1 | "Po odświeżeniu znowu intro z muzyką." | after reload | 20 | 404 | /api/health | Intro replays on every load. |
| 9 | 1 | "Konsola sypie 404." | every load | 01 | 404 | GET /api/health 404 | Health check 404 in offline mode. |
| 10 | 1 | "Dwuklik zaznaczył słowo." | toast, Historia | 09, 21 | – | – | Dblclick selects toast text; month picker "November 2026" in English in Polish UI. |

Held up: no XSS (all payloads as text, no dialogs), no JS errors/crashes, no duplicates from double-clicks, two-tab collision renumbered safely, reload during save neither lost nor duplicated, negative quantity blocked, failed-login message doesn't reveal which field.

## 3. Result
Reached first success: yes
Actions taken: 55

Replay: open index.html → "E-mail służbowy" michal.lewandowski@resinvest.group, "Hasło" demo1234 → "Zaloguj się" → tile "Zakup — dostawca → magazyn (PZ)" → "Dostawca (firma)" Tartak O'Brien Sp. z o.o. → "Produkt / surowiec" Drewno opałowe (m³) → "Ilość" 20 → "Cena jednostkowa (zł/m³)" 230 → "Zatwierdź…" → "Zatwierdź dokument" → "Zamknij" → "Historia".
