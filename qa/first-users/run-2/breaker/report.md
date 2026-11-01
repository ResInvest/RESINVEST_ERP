# Usability test — run-2 — persona "breaker" (Michał Lewandowski, Kierownik, RiC Rokitki)
> Saved by the QA lead from the subagent's returned report; content unchanged, condensed formatting.

## 1. Think-aloud log
1. Landing → intro with music + login; credentials listed in plain text; 404 /api/health → 01-landing.png
2. "Pomiń intro →" → closed
3. Empty e-mail/password, dblclick "Zaloguj się" → "Podaj e-mail służbowy i hasło" → 02-login-empty.png
4. E-mail SQLi, password 5,000×A, dblclick → "Podaj adres e-mail" → 03-login-sqli.png
5. E-mail o'brien🔥<img onerror>@…, Arabic password → "Podaj adres e-mail", no dialog → 04-login-xss-email.png
6. Real login, dblclick → "Dobry wieczór, Michał", RiC Rokitki, one session → 05-after-login.png
7. Tile "Zakup — dostawca → magazyn (PZ)" → Zakup selected; required "Numeracja WZ" = "Automatycznie — WZ/001/11/2026" → 06-pz-form.png
8. Junk supplier (tags + O'Brien + emoji + Arabic + SQLi), Ilość -5, Cena 99999999999999999999, dblclick "Zatwierdź…" → "Podaj ilość większą od 0", "Wartość jest za duża — maksymalnie 100 000 000"; preview "odczytano: 100 000 000 000 000 032 768", after blur "…016 384"; supplier junk accepted → 07-pz-junk-submit.png
9. Ilość 10, Cena 230, dblclick "Zatwierdź…" → no modal visible (opens and immediately closes) → 08-pz-summary.png
10. Single click → summary; junk supplier escaped; "WZ = wspólna seria…" → 09-pz-click-confirm.png
11. Dblclick "Zatwierdź dokument" → one document WZ/001/11/2026, +10 m³ → 10-pz-junk-committed.png
12. Historia → one row; junk supplier escaped but now permanently in Kontrahent filter → 11-historia-after-junk.png
13. Historia search 5,000×A, <img onerror>, "((" → no crash, "Brak ruchów…"; one fill timed out after re-render → 12, 13
14. New operation: Lander Agro, Drewno opałowe, 12,5 × 230; "Miejsce transportu / dostawy" = 5,000×A; Nr dok. zewn. = SQLi; Uwagi = emoji/Arabic/O'Brien/<b>bold</b> → accepted; product not preselected at first → 14-pz-valid-long-place.png
15. Second tab on #/nowa → login page again (e-mail prefilled, password needed) → 15, 16
16. Tab 2: Lander Agro, 5 × 200 → WZ/002/11/2026 committed → 17, 18
17. Tab 1 (still shows "Automatycznie — WZ/002/11/2026") "Zatwierdź…" → summary broken: 5,000-char place pushes all values off-screen; stock "Przed 15 m³" correct → 19, 20
18. "Wróć do edycji", place = RiC Rokitki → summary correct → 21
19. "Zatwierdź dokument" + reload ~150 ms later → exactly one document WZ/003/11/2026; form empty after reload → 22
20. Historia → WZ/001, WZ/002, WZ/003, notes escaped, no duplicates — FIRST SUCCESS → 23-historia-final.png
21. "Przyjęcia" → page says "zakupy (PZ)", button "Nowy zakup (PZ)", every row Typ = WZ → 24-przyjecia.png
22. WZ/001 "Podgląd" → printable titled "Dokument WZ WZ/001/11/2026"; junk escaped → 25-podglad-junk-doc.png

## 2. Friction table (all 404s = GET /api/health)
| # | severity | quote | URL / screen | screenshot | console | failed req | what happened |
|---|---|---|---|---|---|---|---|
| 1 | 3 | „Chciałem PZ, a system każe wybierać »Numerację WZ« i drukuje »Dokument WZ«. Księgowa mnie zabije." | #/nowa, summary, #/przyjecia, Podgląd | 06, 09, 10, 24, 25 | none | none | Receipt numbered WZ; list Typ = WZ; print "Dokument WZ"; only a small note explains. |
| 2 | 3 | „Wkleiłem długi tekst w miejsce dostawy i podsumowanie zrobiło się puste." | summary | 20 | none | none | Unbroken 5,000-char "Miejsce transportu / dostawy" overflows the summary; no length limit on this field. |
| 3 | 2 | „Śmieciowa nazwa dostawcy… trafiła na stałe do kartoteki." | #/nowa → Historia filter | 09, 11 | none | none | Any string auto-added to Kontrahenci on commit; escaped everywhere (no XSS). |
| 4 | 2 | „Dwuklik na »Zatwierdź…« i nic się nie dzieje." | #/nowa | 08 | none | none | Double-click opens then immediately closes the summary modal. |
| 5 | 2 | „Druga karta znowu każe się logować." | new tab | 15 | 404 | 404 | Session per tab; numbering stayed correct; tab 1 showed stale suggested number until commit. |
| 6 | 1 | „»odczytano: 100 000 000 000 000 032 768« — skąd te 32 768?" | Cena | 07 | none | none | Float echo of 20-digit input; correctly rejected. |
| 7 | 1 | „Na ekranie logowania wiszą hasła do konta admina." | login | 01 | 404 | 404 | Test admin + demo credentials listed. |
| 8 | 1 | „Intro z muzyką przy pracy biurowej." | landing | 01 | none | none | Intro before login. |

Held up: no XSS (no dialogs; script/img/b rendered as text in summary, Historia, Przyjęcia, Podgląd); no duplicates (dblclick commit/login); validation of negative/oversized numbers; reload mid-submit; two-tab numbering.

## 3. Result
Reached first success: yes
Actions taken: ~59

Replay: index.html → "Pomiń intro →" → "E-mail służbowy" michal.lewandowski@resinvest.group, "Hasło" demo1234 → "Zaloguj się" → tile "Zakup — dostawca → magazyn (PZ)" → "Dostawca (firma)" Lander Agro → "Produkt / surowiec" Drewno opałowe (m³) → "Ilość" 12,5 → "Cena jednostkowa (zł/m³)" 230 → single-click "Zatwierdź…" → "Zatwierdź dokument" → "Zamknij" → "Historia".
