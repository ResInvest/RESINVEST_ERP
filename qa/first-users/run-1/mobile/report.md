# First-user test — persona "mobile" (run-1)
Emulation: 375×812 touch, DPR 3, Slow 3G, CPU 4× (confirmed in daemon.log), port 9303. Persona: Paweł Kaczmarek, Magazynier, RiC Brąszewice.
> Note: written by the QA lead from the subagent's returned report (its Write call was refused by the tool environment); content unchanged.

## 1. Think-aloud log
1. goto index.html — expect slow login page → 149 s load, then full-screen intro video, "Wycisz"/"Pomiń intro", "autoplay sound blocked, click for music". Console 404 /api/health → 01-landing.png
2. tap "Pomiń intro →" — expect skip → tap timed out (15 s) because intro auto-closed. Login form; language/theme toolbar overlaps "Zaloguj się" + OFFLINE line; 12 tap targets < 44 px → 02-login.png
3. fill "E-mail służbowy" = pawel.kaczmarek@resinvest.group → OK → 03-login-filled.png
4. fill "Hasło" = demo1234 → OK
5. tap "Zaloguj się" → "Pulpit — RiC Brąszewice" in ~0.6 s; "Zakup — dostawca → magazyn (PZ)" tile on first screen; logo cut to "P", header icons 36 px → 04-after-login.png
6. tap the PZ tile → #/nowa, "Zakup" preselected, sticky footer "3 do poprawy · 0,00 zł · Zatwierdź…", very long form, help under every field, 17 px checkboxes → 05-pz-form.png
7. tap "Dostawca (firma)" → focused
8. fill "Tartak Kowalski" → "nowy dostawca zostanie dopisany do kartoteki… przy zatwierdzeniu" (clear) → 06-supplier.png
9. select "Produkt / surowiec" = Drewno opałowe (m³)
10. fill "Ilość" = 20 → 07-qty-price.png
11. fill "Cena jednostkowa (zł/m³)" = 230 → "Koszt całkowity zakupu 4 600,00 zł", footer "Gotowe"
12. scroll → "Numeracja WZ * — Automatycznie — WZ/001/11/2026" in a purchase form; date placeholder mm/dd/yyyy → 08-form-bottom.png
13. tap "Zatwierdź…" → "Podsumowanie przed zatwierdzeniem"; buttons 36 px tall → 09-summary.png
14. tap "Zatwierdź dokument" — expect PZ number → "WZ/001/11/2026 — Zakup · ZATWIERDZONY"; toast covers "Zamknij"; "Podgląd" off screen at x=412 → 10-after-save.png
15. tap "Zamknij" → closed → 11-modal-closed.png
16. tap "Menu" (☰) → 12-menu.png
17. tap "Historia" → ~2 screens of filters first → 13-history.png
18. scroll → row 01.11.2026 18:50 · Paweł Kaczmarek · Zakup · WZ/001/11/2026 · Drewno opałowe 20 m³ · 30 → +20 → 50 · Tartak Kowalski · ZATWIERDZONY; table scrolls sideways inside its card → 14-history-row.png
19. scroll → "1 ruchów w zakresie LISTOPAD 2026" — FIRST SUCCESS

## 2. Friction table
| # | severity | quote | URL / screen | screenshot | console errors | failed requests | what exactly happened |
|---|---|---|---|---|---|---|---|
| F1 | 3 | „Dwie i pół minuty czekam na telefonie i dostaję film z rębakiem zamiast logowania." | landing | 01 | 404 (File not found) | GET /api/health 404 | 149 s load on Slow 3G + 4× CPU, then autoplay full-screen intro + "enable music" notice before login. |
| F2 | 2 | „Kliknąłem «Pomiń intro» i nic — sam zniknął." | intro | 01→02 | none | none | Skip button disappeared under the finger (intro auto-dismissed), tap timed out. |
| F3 | 2 | „Ikonki na górze nachodzą na napis i są malutkie." | login | 02 | none | none | Language + 8-theme toolbar overlaps heading/OFFLINE line; 12 targets < 44 px (38×31, 39–41×30, eye 32×32). |
| F4 | 2 | „Wszystkie przyciski na górze takie małe, a logo to samo «P»." | logged-in screens | 04, 13 | none | none | Header icons 36×36; unlabelled "+" link 41×30; titles truncated; buttons 36 px; checkboxes 17×17. |
| F5 | 3 | „Robię przyjęcie od dostawcy, a system daje mi numer WZ? To wydanie!" | #/nowa, result, #/historia | 08, 10, 14 | none | none | "Numeracja WZ"; purchase saved WZ/001/11/2026; help text promises PZ; "Powtórz ostatnią" shows WZ/008/09/2026. |
| F6 | 2 | „Dymek «Dokument zatwierdzony» zasłania mi «Zamknij»." | result modal | 10 | none | none | Toast overlaps primary Zamknij; documents table overflows, "Podgląd" at x=412. |
| F7 | 2 | „Gdzie jest moja operacja? Same filtry." | #/historia | 13, 14 | none | none | ~2 screens of filters before results; 16-column table needs sideways scroll in card. Page scrollWidth stays 375. |
| F8 | 1 | „Data w formacie mm/dd/yyyy, a reszta po polsku." | #/nowa, #/historia | 08, 13 | none | none | Native date inputs in US format — likely the headless browser UI locale (environment), not the app. |

Worked well: login ~0.6 s after load; PZ tile on first screen; new supplier accepted inline; live total; footer counter; clear summary; all modals closed; no console errors after login.

## 3. Result
Reached first success: yes
Actions taken: 19

Replay: goto index.html (~150 s) → (optional) tap "Pomiń intro →" → "E-mail służbowy" pawel.kaczmarek@resinvest.group → "Hasło" demo1234 → "Zaloguj się" → tile "Zakup — dostawca → magazyn (PZ)" → "Dostawca (firma)" Tartak Kowalski → "Produkt / surowiec" Drewno opałowe (m³) → "Ilość" 20 → "Cena jednostkowa (zł/m³)" 230 → "Zatwierdź…" → "Zatwierdź dokument" → "Zamknij" → "Menu" → "Historia" → scroll to row.

Not tested: real device, on-screen keyboard covering fields, real (non-emulated) network/CPU, intro audio, Polish browser UI locale, Print/PDF/CSV export, "Podgląd" preview.
