# First-user walkthrough — persona "skeptic" (Anna Górska, Kierownik) — run-1
App: http://127.0.0.1:8080/index.html · desktop 1366×860 · port 9302
> Note: written by the QA lead from the subagent's returned report (its Write call was refused by the tool environment); content unchanged.

## 1. Think-aloud log
0. goto index.html. Expect login with terms/privacy/pricing → full-screen intro video + toast "Kliknij w dowolnym miejscu… aby włączyć muzykę"; console 404 GET /api/health → 01-landing.png
1. "Pomiń intro →" → login form, "OFFLINE — dane zapisywane w tej przeglądarce"; lang/theme bar overlaps heading → 02-login.png
2. Scroll to bottom, expect Regulamin / Polityka prywatności / RODO / Cennik → none (0 links). Page lists admin test credentials (Test1234), 9 employee e-mails + shared password demo1234 → 03-login-footer.png
3. Fill "E-mail służbowy" = anna.gorska@resinvest.group (only 2 fields; purpose clear)
4. Fill "Hasło" = demo1234
5. "Zaloguj się" → "Pulpit — RiC Zabrze", no consent/terms step → 04-after-login.png
6. "Mój profil", expect delete-account / privacy → neither; only "Zmień hasło", "Wyloguj". Says language/theme work "na każdym komputerze" while also "OFFLINE lokalny (ta przeglądarka)" → 05-profile.png
7. "Administracja", expect backup info → manual JSON backup (Administrator only); automatic backups only in "ResInvest ERP Serwer". "Przywróć dane przykładowe" and "Data systemowa" visible to Kierownik (not clicked) → 06-administracja.png
8. "Użytkownicy" → "Konto z historią dezaktywuje się — historia zostaje"; admin-only, me "tylko podgląd" → 07-uzytkownicy.png
9. "Nowa operacja" → Zakup preselected, tutorial hints → 08-nowa-operacja.png
10. Tile "Firma branży drzewnej / przedsiębiorstwo drzewne" → Podstawa KZR
11. "Dostawca (firma)" = Lander Agro → "z kartoteki ✓" → 09-dostawca.png
12. "Produkt / surowiec" = Drewno opałowe (m³)
13. "Ilość" = 20
14. "Cena jednostkowa (zł/m³)" = 230 → Koszt całkowity 4 600,00 zł → 10-produkt-ilosc-cena.png
15. Scroll: "Przebieg operacji" PZ +20 m³, but "Plan dokumentów" WZ; field "Numeracja WZ: WZ/001/11/2026" → 11-form-bottom.png
16. "Zatwierdź…" → summary correct except "WZ — Przyjęcie zewnętrzne (zakup)"; says changes only by "korekta lub anulowanie" → 12-podsumowanie.png
17. "Zatwierdź dokument" → "Dokument zatwierdzony: WZ/001/11/2026. Status: ZATWIERDZONY." Buttons: Anuluj, Usuń…, Koryguj…, Powtórz → 13-po-zatwierdzeniu.png
18. "Zamknij" → form reset; next number WZ/002/11/2026
19. "Historia" → "01.11.2026 18:48 Anna Górska Zakup WZ/001/11/2026 RiC Zabrze Drewno opałowe 20 m³ 986 +20 1 006 Lander Agro ZATWIERDZONY". Header: "Historii nie edytuje się i nie usuwa" → 14-historia.png

Console/network whole session: only GET /api/health → 404 on landing. No page errors, no dialogs.

## 2. Friction table
| # | sev | quote | URL / screen | screenshot | console | failed req | what happened |
|---|---|---|---|---|---|---|---|
| F1 | 3 | "Hasło administratora wypisane na stronie logowania? Danych firmy bym tu nie wpisała." | login | 02, 03 | – | – | Test admin login+password, 9 employee e-mails/roles and shared demo password shown publicly; "Konto działa niezależnie od danych" = anyone is admin. |
| F2 | 3 | "Gdzie regulamin, polityka prywatności, RODO? Ani jednego linku." | login footer, all pages | 03 | – | – | No terms, privacy, data controller, contact, pricing; no consent at first login; nothing says it is an internal tool. |
| F3 | 3 | "Dane tylko w przeglądarce i bez automatycznej kopii? Wyczyszczę cache i po magazynie." | #/administracja | 06 | – | – | Local-only storage; backup = manual JSON export, Administrator only; automatic only in Server edition; login page promises "kopie zapasowe". |
| F4 | 3 | "Robię przyjęcie od dostawcy, a system wystawia WZ? WZ to wydanie!" | #/nowa → #/historia | 11–14 | – | – | Required "Numeracja WZ"; Przebieg says PZ, Plan/summary "WZ Przyjęcie zewnętrzne"; saved as WZ/001/11/2026. |
| F5 | 2 | "Piszą 'tylko korekta lub anulowanie', a dają przycisk Usuń." | result dialog vs #/historia | 12–14 | – | – | Confirmed document offers "Usuń…", contradicting summary and Historia texts. Not clicked. |
| F6 | 2 | "Kierownik widzi 'Przywróć dane przykładowe' i 'Data systemowa'?" | #/administracja | 06 | – | – | Destructive / audit-sensitive tools visible to non-admin. Not clicked; effect not verified. |
| F7 | 2 | "Jak usunąć konto? Nigdzie w profilu." | #/profil, #/uzytkownicy | 05, 07 | – | – | No self-service deletion; only admin deactivation, explained on Użytkownicy. |
| F8 | 2 | "Na każdym komputerze… ale przecież wszystko jest w tej przeglądarce?" | #/profil | 05 | – | – | Contradictory statements about where profile settings live. |
| F9 | 1 | "Intro z muzyką w programie magazynowym?" | landing | 01 | 404 | GET /api/health 404 | Video intro with music prompt before login; health check 404. |
| F10 | 1 | – | login | 02 | – | – | Lang/theme bar overlaps "Zaloguj się" heading at 1366×860. |
| F11 | 1 | – | #/profil | 05 | – | – | "Moja ostatnia aktywność" not sorted by date. |

Skeptic checklist: pricing — none shown; login fields — justified; delete account — admin deactivation only (found, not used); trust — no (F1, F3, F4, F5); storage — browser-only, manual admin-only backup.

## 3. Result
Reached first success: yes
Actions taken: 19

Replay: "Pomiń intro →" → "E-mail służbowy" anna.gorska@resinvest.group → "Hasło" demo1234 → "Zaloguj się" → "Nowa operacja" → tile "Firma branży drzewnej / przedsiębiorstwo drzewne" → "Dostawca (firma)" Lander Agro → "Produkt / surowiec" Drewno opałowe (m³) → "Ilość" 20 → "Cena jednostkowa (zł/m³)" 230 → "Zatwierdź…" → "Zatwierdź dokument" → "Zamknij" → "Historia".
