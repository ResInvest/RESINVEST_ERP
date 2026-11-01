# First-user test — run-2 — persona "impatient" (Adrian Wojciechowski, Magazynier)
> Saved by the QA lead from the subagent's returned report (subagents return reports as text); content unchanged, condensed formatting.

## 1. Think-aloud log
| # | Expectation → Result | Screenshot |
|---|---|---|
| 1 | Expect login → full-screen intro video with music + "browser blocked sound" toast; "Wycisz", "Pomiń intro →"; console 404 /api/health | 01-landing.png |
| 2 | "Pomiń intro →" → login form (hero + demo accounts) | 02-login.png |
| 3–5 | Fill e-mail, password, "Zaloguj się" → Pulpit "Dobry wieczór, Adrian"; tile "Zakup — dostawca → magazyn (PZ)" | 03-after-login.png |
| 6 | Click Zakup (PZ) tile → #/nowa, Zakup preselected; footer "3 do poprawy" | 04-pz-form.png |
| 7 | Click green "Zatwierdź…" with empty form → good validation: scrolls to "Dostawca (firma)", red fields, toast "Nie można zatwierdzić — popraw formularz" | 05-submit-empty.png |
| 8 | "Dostawca (firma)" = Lander Agro → "z kartoteki ✓" | 06-supplier-typed.png |
| 9–10 | Ilość 20, Cena 230 → 4 600,00 zł, footer "Gotowe". Confusion: required "Numeracja WZ *" = "Automatycznie — WZ/001/11/2026"; plan badge WZ while "Przebieg operacji" says PZ; skimmed past | 07-filled-numbering-wz.png |
| 11 | "Zatwierdź…" → clear summary, stock 986 → 1 006 m³; small print "WZ = wspólna seria numerów…, nie oznacza wydania" | 08-summary.png |
| 12 | "Zatwierdź dokument" → "Dokument zatwierdzony: WZ/001/11/2026. Status: ZATWIERDZONY." | 09-after-confirm.png |
| 13 | "Zamknij" → "Historia" → first row: 01.11.2026 19:09 · Adrian Wojciechowski · Zakup · WZ/001/11/2026 · Drewno opałowe · 20 m³ · 986/+20/1 006 · Lander Agro · ZATWIERDZONY — FIRST SUCCESS | 10-historia.png |

## 2. Friction table
| # | severity | quote | URL / screen | screenshot | console errors | failed requests | what exactly happened |
|---|---|---|---|---|---|---|---|
| 1 | 3 | „Chciałem PZ, a system mi daje WZ? To przecież wydanie… dobra, nie czytam, klikam.” | #/nowa, summary, confirmation, #/historia | 07, 08, 09, 10 | none | none | Tile and "Przebieg" say PZ; required "Numeracja WZ *", WZ badge, saved WZ/001/11/2026. Help explains shared series, but a skimmer reads WZ as goods issue; would have quit if a decision were needed there. |
| 2 | 2 | „Film? Muzyka? Ja chcę się tylko zalogować.” | landing | 01 | 404 (File not found) | GET /api/health 404 | Intro video + music + blocked-sound toast covers login; one extra click. |
| 3 | 1 | „Ściana tekstu pod każdym polem.” | #/nowa | 04, 07 | none | none | Tutorial help on by default makes the form long; only 3 fields needed. Sensible defaults kept him going. |

No endless spinner, no crash, no failed requests after login.

## 3. Result
Reached first success: yes
Actions taken: 13

Replay: index.html → "Pomiń intro →" → "E-mail służbowy" adrian.wojciechowski@resinvest.group → "Hasło" demo1234 → "Zaloguj się" → tile "Zakup — dostawca → magazyn (PZ)" → "Dostawca (firma)" Lander Agro → "Ilość" 20 → "Cena jednostkowa (zł/m³)" 230 → "Zatwierdź…" (footer) → "Zatwierdź dokument" → "Zamknij" → "Historia".
