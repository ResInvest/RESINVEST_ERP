# Usability test — run-2 — persona "non-native" (Tomasz Zając account; no Polish, English 2nd language)
> Saved by the QA lead from the subagent's returned report; content unchanged, condensed formatting.

## 1. Think-aloud log
| # | Action | Expectation → Result | Screenshot |
|---|---|---|---|
| 1 | goto index.html | Expect login → full-screen forest video; Polish-only "Wycisz", "Pomiń intro →", "Przeglądarka zablokowała automatyczny dźwięk…"; no English choice; console 404 /api/health | 01-landing.png |
| 2 | click "EN" (under the intro) | ~6.7 s, then intro gone, login in English ("Sign in", "Work e-mail", "Password"); 8 theme buttons icon-only | 02-login-en.png |
| 3–4 | fill Work e-mail / Password | OK; visible label + placeholder | — |
| 5 | "Sign in" | "Good evening, Tomasz", Dashboard — RiC Brąszewice; unexplained MM, WZ, MP, EUDR, PKS, KZR; Polish product names | 03-after-login.png |
| 6 | card "Purchase — supplier → warehouse (PZ)" | "New operation", Purchase ticked; but "WZ numbering * — Automatic — WZ/001/11/2026" and "Repeat last WZ/008/09/2026" | 04-pz-form.png |
| 7 | scroll to "Supplier (company)" | supplier group preselected, "Default basis: KZR" unexplained | — |
| 8 | type "Lander" | no suggestion list; badge "new supplier will be added to master data … on approval" (worried) | 05-supplier-typing.png |
| 9 | type " Agro" | "from master data ✓" | 06-supplier-full.png |
| 10 | Product "Drewno opałowe (m³)" | guessed from m³ | — |
| 11–12 | Quantity 20, Unit price 230 | "Total purchase cost 4,600.00 zł" | — |
| 13–14 | scroll | "Operation flow" says PZ; "Document plan" lists WZ — contradiction; status "Ready · result -4,600.00 zł" | 07-form-lower.png |
| 15 | "Approve…" | Summary; Documents: "WZ = the shared number series for all documents, not a goods issue. Document type: External receipt (purchase)" | 08-approve-summary.png |
| 16 | "Approve document" | "WZ/001/11/2026 — Purchase · APPROVED"; row labelled "PZ / WZ documents" | 09-after-approve.png |
| 17 | "Close" | back on form | — |
| 18 | sidebar "History" | row "01/11/2026 19:10 Tomasz Zając Purchase WZ/001/11/2026 … Lander Agro APPROVED" — FIRST SUCCESS. Type filter lists Purchase, Receipt (PW), WZ — no PZ | 10-history.png |

## 2. Friction table
| # | Sev | Quote | URL / screen | Screenshot | Console | Failed req | What happened |
|---|---|---|---|---|---|---|---|
| 1 | 2 | "I land on a video and every word is Polish… I don't know how to leave." | intro | 01 | 404 | GET /api/health 404 | Intro overlay in the browser's language (pl-PL test browser), no EN switch on it; clicking "EN" underneath worked after ~6.7 s. |
| 2 | 1 | "The top-right buttons are only pictures." | login + header | 02 | none | none | 8 theme buttons icon-only (names in tooltips); header Language/Theme/Play intro/Notifications icon-only. |
| 3 | 3 | "Dashboard says 'Sale from stock (WZ)'. My purchase form says 'WZ numbering'. Am I making a sale?" | #/nowa | 04, 07 | none | none | "WZ numbering", Document plan WZ; Operation flow PZ. |
| 4 | 3 | "'WZ = … not a goods issue'. But the menu says 'Issues / WZ'. Which is true?" | summary | 08 | none | none | New explanation contradicts dashboard card and menu "Issues / WZ"; History filter has no PZ. |
| 5 | 2 | "'Drewno opałowe', 'Zrębka towar'… I guessed from m³." | product select, dashboard, History | 03, 04 | none | none | Master-data names Polish in EN UI (also supplier names). |
| 6 | 2 | "What is MM? MP? KZR? RW? PW? EUDR? PKS?" | dashboard, sidebar, #/nowa | 03, 04 | none | none | Abbreviations never expanded; "zł" instead of PLN. |
| 7 | 2 | "I type 'Lander' and no list comes… I'm scared I create a wrong partner." | Supplier field | 05 | none | none | No visible suggestion dropdown on partial name; "new supplier" badge until exact name. |
| 8 | 1 | "'Quick trip'? 'pile pushing'? 'Good evening' at work?" | sidebar, #/nowa sec. 3 | 03, 07 | none | none | Idiomatic/unclear terms. |
| 9 | 1 | "Help text is very long." | #/nowa | 04 | none | none | Tutorial on by default; helps understanding, lengthens form. |

Validation messages were clear ("Quantity: Enter quantity", "Unit price (zł/m³): Enter price").

## 3. Result
Reached first success: yes
Actions taken: 18

Replay: index.html → "EN" → "Work e-mail" tomasz.zajac@resinvest.group → "Password" demo1234 → "Sign in" → card "Purchase — supplier → warehouse (PZ)" → "Supplier (company)" Lander Agro → "Product / raw material" Drewno opałowe (m³) → "Quantity" 20 → "Unit price (zł/m³)" 230 → "Approve…" → "Approve document" → "Close" → "History".
