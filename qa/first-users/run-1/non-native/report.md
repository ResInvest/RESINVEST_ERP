# First-user test — persona "non-native" (no Polish, English second language) — run-1
App: http://127.0.0.1:8080/index.html · Login tomasz.zajac@resinvest.group / demo1234 · desktop 1366×860
> Note: written by the QA lead from the subagent's returned report (its Write call was refused by the tool environment); content unchanged.

## 1. Think-aloud log
| # | Expectation | Result | Screenshot |
|---|---|---|---|
| 1 | Login page | Full-screen video, Polish-only "Wycisz", "Pomiń intro →", "Przeglądarka zablokowała automatyczny dźwięk…"; no language choice; guessed "intro" + arrow = skip | 01-landing.png |
| 2 | Skip video | Login in Polish; PL/CS/EN switch overlaps heading "Zaloguj się" | 02-login-pl.png |
| 3 | Click "EN" | Nothing changed | 03-login-en.png |
| 4 | Click EN again | English; "Administrator testowy" still Polish | 04-login-en-2.png |
| 5 | Fill Work e-mail / Password | OK | 05-login-filled.png |
| 6 | Sign in → dashboard | "Good evening, Tomasz"; much Polish left (Obrót miesiąca, Ten magazyn, Wszystkie produkty, Zakupy od firm, Brak zakupów…, Rozwiń całość, Zwiń, Pełny widok, Razem 6 mies., 0 transakcje, EUDR — wylesianie); MP, MM, WZ, GJ, PKS unexplained | 06-after-login.png |
| 7 | Tile "Purchase — supplier → warehouse (PZ)" | Form, Purchase preselected; "What:/Why:" help good; date field "11/01/2026" vs dashboard 01/11/2026 | 07-purchase-form.png |
| 8 | Scroll to section 2 | "Basis: KZR" unexplained; "Check: 3 errors" helpful | 08-supplier-section.png |
| 9 | Type "Lander", expect suggestions | None; badge "new supplier will be added to master data" | 09-supplier-suggest.png |
| 10 | Clear + ArrowDown | Error "Enter the supplier name or choose from the list", no list visible | 10-supplier-list.png |
| 11 | Click ▼ (attempt 2) | Still no list; gave up | 11-supplier-arrow.png |
| 12 | Type "Lander Agro" | "from master data ✓" | 12-supplier-filled.png |
| 13–14 | Keep product "Drewno opałowe (m³)"; Quantity 20; Unit price 230 | Total 4,600.00 zł; Operation flow "PZ" but Document plan "WZ", field "WZ numbering — WZ/001/11/2026"; "≈161.8 GJ" unexplained; "Estimated (fa…" cut | 13-qty-price.png |
| 15 | Scroll to end | "pile pushing", "FV 123/09/2026" unexplained | 14-transport-section.png, 15-form-bottom.png |
| 16 | Find Approve | Right panel clipped; Approve not visible; page scroll doesn't help | 16-approve-visible.png |
| 17 | Scroll inside right panel (attempt 2) | "Approve…" and "Save as draft" visible | 17-right-panel-scroll.png |
| 18 | "Approve…" | Summary clear; Documents "WZ External receipt (purchase)" | 18-summary.png |
| 19 | "Approve document" | "Document approved: WZ/001/11/2026. Status: APPROVED"; "Viewer" button unclear | 19-after-approve.png |
| 20 | Close | Back on form | — |
| 21 | History | Row 01/11/2026 18:48 · Tomasz Zając · Purchase · WZ/001/11/2026 · Drewno opałowe · +20 · Lander Agro · APPROVED — FIRST SUCCESS. Type filter has no "PZ"; "1 movements"; table wider than screen | 20-history.png |

Console/network: only GET /api/health → 404 on first load.

## 2. Friction table
| # | sev | quote | URL / screen | screenshot | console | failed req | what happened |
|---|---|---|---|---|---|---|---|
| 1 | 3 | "I asked for a PZ receipt but get 'WZ/001/11/2026'. WZ is 'Sale from stock'. Did I sell wood?" | #/nowa, summary, result, #/historia | 13, 18, 19, 20 | none | none | Tile & flow say PZ; numbering field, plan, summary, saved number say WZ; History filter has WZ, no PZ. |
| 2 | 2 | "Where is the Approve button? I see 'ready for approval' and then nothing." | #/nowa bottom | 15, 16 | none | none | Right column clipped at page bottom; Approve only after scrolling inside the panel. |
| 3 | 2 | "Product names are Polish. I don't know what I'm buying." | product select, History filters | 08, 13, 20 | none | none | Master-data product names not translated / no English hint. |
| 4 | 2 | "Half of the dashboard is Polish." | dashboard, sidebar | 06 | none | none | Widgets, buttons, aria-labels ("Poprzedni miesiąc", "Następny miesiąc"), sidebar item untranslated. |
| 5 | 2 | "The intro video speaks only Polish." | intro | 01 | 404 | GET /api/health 404 | Polish-only overlay, no language switch; default UI Polish. |
| 6 | 2 | "It says 'choose from the list' but there is no list. A typo makes a 'new supplier'." | #/nowa Supplier | 09–11 | none | none | No visible suggestion list (native datalist?); error doesn't say where the list is; easy duplicate partners. |
| 7 | 2 | "Is it 11 January or 1 November?" | date field vs summary | 07, 18 | none | none | Date input MM/DD/YYYY (browser locale) vs app DD/MM/YYYY. |
| 8 | 2 | "MP? MM? KZR? GJ? PKS? RW? PW? FV?" | dashboard, #/nowa | 06, 08, 13, 14 | none | none | Abbreviations never expanded; sidebar "MM" no description. |
| 9 | 1 | "I clicked EN and nothing happened the first time." | login | 03 | none | none | First click no effect (possibly mis-hit); switcher overlaps heading. |
| 10 | 1 | "'Administrator testowy' is still Polish." | login EN | 04 | none | none | Untranslated account name. |
| 11 | 1 | "'pile pushing', 'master data', 'Viewer' — what?" | #/nowa sec. 3, result modal | 14, 19 | none | none | Idioms/jargon; Viewer button gives no hint. |
| 12 | 1 | "'1 movements', table goes off screen." | #/historia | 20 | none | none | Plural error; last columns clipped at 1366 px. |
| 13 | 1 | "'Estimated (fa…' — cut." | #/nowa Mass | 13 | none | none | Select too narrow for EN label. |

## 3. Result
Reached first success: yes
Actions taken: 27

Replay: "Pomiń intro →" → "EN" → "Work e-mail" tomasz.zajac@resinvest.group → "Password" demo1234 → "Sign in" → tile "Purchase — supplier → warehouse (PZ)" → "Supplier (company)" Lander Agro → keep product "Drewno opałowe (m³)" → "Quantity" 20 → "Unit price (zł/m³)" 230 → scroll right panel → "Approve…" → "Approve document" → "Close" → sidebar "History".
