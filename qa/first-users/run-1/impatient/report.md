# First-user test — persona "impatient" (run-1)
User: Adrian Wojciechowski (Magazynier, RiC Zabrze). App ResInvest ERP (OFFLINE mode), desktop 1366×860.
> Note: written by the QA lead from the subagent's returned report (its Write call was refused by the tool environment); content unchanged.

## 1. Think-aloud log
| # | Expectation → Result | Screenshot |
|---|---|---|
| 0 | Expect login page → full-screen forest video + music, "sound blocked" toast; /api/health 404 | 01-landing.png |
| 1 | Click "Pomiń intro →", expect login form → login form; toolbar overlaps heading | 02-login.png |
| 2 | Fill "E-mail służbowy" → OK | — |
| 3 | Fill "Hasło" = demo1234 → OK | — |
| 4 | Click "Zaloguj się", expect dashboard → Pulpit with tile "Zakup — dostawca → magazyn (PZ)" | 03-after-login.png |
| 5 | Click PZ tile, expect PZ form → "Nowa operacja", Zakup preselected; very long, help text everywhere | 04-pz-form.png |
| 6 | Click "Dostawca (firma)" → focused | 05-supplier-field.png |
| 7 | Type "Lander Agro" → "z kartoteki ✓"; product defaulted Drewno opałowe (m³) | 06-supplier-typed.png |
| 8 | Ilość = 20 → side panel "PZ 1. Zakup — przyjęcie +20 m³" | — |
| 9 | Cena jedn. = 230 → total 4 600,00 zł; BUT "Plan dokumentów" shows WZ badge and field "Numeracja WZ" = WZ/001/11/2026. Confusing, status ready, continue | 07-filled.png |
| 10 | Click "Zatwierdź…" → summary modal; stock 986 → 1 006 correct; DOKUMENTY "WZ — Przyjęcie zewnętrzne (zakup)" | 08-confirm-dialog.png |
| 11 | Click "Zatwierdź dokument", expect PZ number → "Dokument zatwierdzony: WZ/001/11/2026" | 09-after-save.png |
| 12 | Click "Zamknij" → modal closed, form reset | — |
| 13 | Click "Historia" → 1 row: Adrian Wojciechowski · Zakup · WZ/001/11/2026 · RiC Zabrze · Drewno opałowe · 20 m³ · 986 → +20 → 1 006 · Lander Agro · ZATWIERDZONY | 10-history.png |

## 2. Friction table
| # | severity | quote | URL / screen | screenshot | console errors | failed requests | what exactly happened |
|---|---|---|---|---|---|---|---|
| F1 | 3 | "I wanted a PZ and got a WZ — that's an issue document!" | #/nowa → confirm → #/historia | 07, 08, 09, 10 | none | none | Purchase receipt numbered WZ/001/11/2026; field "Numeracja WZ", WZ badge, summary "WZ — Przyjęcie zewnętrzne (zakup)". Dashboard tile & Przebieg panel say PZ. |
| F2 | 2 | "A movie with music? I just want to log in." | index.html landing | 01 | Failed to load resource: 404 | GET /api/health → 404 | Full-screen intro video before login + sound-blocked toast; must find "Pomiń intro →". |
| F3 | 2 | "Wall of text, not reading all that." | #/nowa | 04, 07 | none | none | Form ~2 400 px tall, help under every field (on by default); only 3 inputs needed; submit is in the side panel. |
| F4 | 1 | "Something's covering the heading." | login | 02 | none | none | Language/theme toolbar overlaps "Zaloguj się" heading. |

## 3. Result
Reached first success: yes (saved, ZATWIERDZONY, in Historia — but numbered WZ, see F1)
Actions taken: 13

Replayable path: open index.html → "Pomiń intro →" → fill "E-mail służbowy" adrian.wojciechowski@resinvest.group → "Hasło" demo1234 → "Zaloguj się" → tile "Zakup — dostawca → magazyn (PZ)" → "Dostawca (firma)" type "Lander Agro" → "Ilość" 20 → "Cena jednostkowa (zł/m³)" 230 → "Zatwierdź…" → "Zatwierdź dokument" → "Zamknij" → sidebar "Historia".
