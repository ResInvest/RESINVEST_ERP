# First-user test — run-2 — persona "mobile" (375 px, Slow 3G, CPU 4×) — Paweł Kaczmarek, Magazynier, RiC Brąszewice
> Saved by the QA lead from the subagent's returned report; content unchanged, condensed formatting.

## 1. Think-aloud log
1. goto (waitUntil=commit) — commit 2.5 s; observe returned empty text / no elements every 2 s from +5 s to +45 s; login form first seen ≈47 s (readable observe ≈50 s). GET /api/health 404. → 01-landing-blank.png (shows the form)
2. Login screen clear (Polish, OFFLINE badge); lists demo accounts, test admin password Test1234, shared demo1234. Tap targets: only "Pokaż hasło" < 44 px (32×32). → 02-login.png
3–4. Fill e-mail pawel.kaczmarek@resinvest.group, password demo1234 — OK
5. "Zaloguj się" → "Dobry wieczór, Paweł — Pulpit — RiC Brąszewice" in ~1 s → 03-after-login.png
6. tapTargets dashboard < 44 px: hero "Nowa operacja" 151×36, "Raport miesiąca" 158×36, warehouse button 351×34, avatar 42×40, header "+" 41 wide, menu items 36 tall
7. Tile "Zakup — dostawca → magazyn (PZ)" → Nowa operacja, Zakup preselected; sticky bar "3 do poprawy · 0,00 zł · Zatwierdź…"; header layout differs from dashboard ("+" gone, avatar moved) → 04-zakup-form.png
8. "Firma branży drzewnej / przedsiębiorstwo drzewne" → Podstawa KZR auto
9. "Dostawca (firma)" Tartak Las-Drew → "nowy dostawca zostanie dopisany do kartoteki" → 05-dostawca.png
10. Product already Drewno opałowe (m³); required "Numeracja WZ" = "Automatycznie — WZ/001/11/2026" on a purchase form — confused
11. "Ilość" 20 (first try stale index — tool artefact) → 06-ilosc-cena.png
12. "Cena jednostkowa (zł/m³)" 150 → "Koszt całkowity zakupu 3 000,00 zł"; the price field just filled sits under the sticky "Zatwierdź" bar → 07-cena-pod-paskiem.png
13. "Zatwierdź…" → clear summary; buttons "Wróć do edycji" 127×36, "Zatwierdź dokument" 187×36 → 08-podsumowanie.png
14. "Zatwierdź dokument" → toast "Dokument zatwierdzony WZ/001/11/2026"; modal "WZ/001/11/2026 — Zakup · ZATWIERDZONY"; "Dokumenty PZ / WZ: WZ/001/11/2026"; toast overlaps top of modal header; no console errors → 09-po-zatwierdzeniu.png
15. Scroll inside modal — body did not move; documents table cut off, "Podgląd" at x=412; page scrollWidth 375 → 10-dokumenty-w-modalu.png
16. "Zamknij" → closed → 11-modal-zamkniety.png
17. ☰ Menu → drawer; items 36 px → 12-menu.png
18. "Historia" → row 01.11.2026 19:11 · Paweł Kaczmarek · Zakup · WZ/001/11/2026 · RiC Brąszewice · Drewno opałowe · 20 m³ · 30 → +20 → 50 · Tartak Las-Drew · ZATWIERDZONY — FIRST SUCCESS; 16-column table scrolls sideways in its card; month picker "November 2026" → 13-historia.png
19. tapTargets Historia < 44 px: warehouse button 34, avatar 40, tabs 42, "Zakres" select / month / search 40, "Filtry i eksport" 36

## 2. Friction table
| # | severity | quote | URL / screen | screenshot | console errors | failed requests | what exactly happened |
|---|---|---|---|---|---|---|---|
| 1 | 3 | „Biały ekran prawie minutę — myślałem, że link nie działa.” | first load | 01 | 404 | GET /api/health 404 | Nothing readable for ≥45 s; login at ≈47 s (run-1: 149 s); no loader/skeleton. |
| 2 | 3 | „Robię przyjęcie od dostawcy, a dostaję numer WZ? Gdzie moje PZ?” | #/nowa → result → Historia | 06, 09, 13 | none | none | Tile "(PZ)", help "trafia na dokument PZ", but "Numeracja WZ" and WZ/001/11/2026; series note found only in page text, not near the result. |
| 3 | 2 | „Wpisałem cenę i nie widzę, co wpisałem — zasłania to zielone «Zatwierdź».” | #/nowa | 07 | none | none | Focused field (y 784–824) under sticky bar (y ≈745–812); form doesn't scroll it above the bar. |
| 4 | 2 | „Przyciski małe, trafiam palcem obok.” | dashboard, form, summary, Historia | 03, 08, 13 | none | none | Many targets < 44 px: buttons 36, warehouse chip 34, avatar 42×40, "+" 41 wide, menu 36, summary buttons 36, "Filtry i eksport" 36, tabs 42, inputs/selects 40, "Pokaż hasło" 32×32. |
| 5 | 2 | „W historii widzę tylko datę, godzinę i kto — resztę przewijam w bok.” | #/historia, result modal | 13, 10 | none | none | 16-column table not adapted to mobile; modal documents table pushes "Podgląd" past screen edge. |
| 6 | 1 | „Raz plus jest na górze, raz go nie ma, a kółko PK skacze.” | dashboard / #/nowa / #/historia | 03, 04, 13 | none | none | Header layout changes between screens; content jumps (warehouse bar y=60 → 108). |
| 7 | 1 | „Dymek zakrywa tytuł okienka.” | result modal | 09 | none | none | Toast overlaps modal header for a few seconds; close reachable. |
| 8 | 1 | „Czemu «November»?” | #/historia | 13 | none | none | Native month input in browser locale. |
| 9 | 2 | „Każdy widzi hasła wszystkich kont na stronie logowania.” | login | 02 | none | none | Demo accounts, test admin password and shared demo password listed. |

No stuck modal; no page-level sideways scroll (scrollWidth 375 everywhere); screens responded in ~0.5–1 s after first load.

## 3. Result
Reached first success: yes
Actions taken: 20

Replay: open index.html (~50 s) → "E-mail służbowy" pawel.kaczmarek@resinvest.group → "Hasło" demo1234 → "Zaloguj się" → tile "Zakup — dostawca → magazyn (PZ)" → "Firma branży drzewnej / przedsiębiorstwo drzewne" → "Dostawca (firma)" Tartak Las-Drew → "Produkt / surowiec" Drewno opałowe (m³) → "Ilość" 20 → "Cena jednostkowa (zł/m³)" 150 → "Zatwierdź…" (sticky bar) → "Zatwierdź dokument" → "Zamknij" → ☰ Menu → "Historia".

Not tested: real phone (soft keyboard, gestures, iOS/Android), sideways swipe on tables, PDF/"Podgląd", real network beyond DevTools throttling.
