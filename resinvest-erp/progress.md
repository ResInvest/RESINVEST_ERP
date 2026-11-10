# ResInvest ERP — stan prac

Ostatnia aktualizacja: 2026-10-11 · etap: **ResInvest ERP 3.10.0 — zapis przyrostowy, synchronizacja przeglądarek zmianami**

## Wykonane — 3.10.0

- [x] Zapis przyrostowy: rekordy kolekcji w tabeli `rows` (suma SHA-256 każdego wiersza), zapis tylko zmienionych
      rekordów + rdzeń + wpis dziennika w jednej transakcji; łańcuch skrótów dziennika z sumą zmian
- [x] Szybka ścieżka komend: kopia robocza bez kopiowania historii (rekordy zamrożone i współdzielone, kopia przy
      zapisie `R.own`); komenda zmieniająca rekord w miejscu wykonywana awaryjnie na pełnej kopii (ten sam wynik)
- [x] Automatyczne przeniesienie bazy 3.9.x do wierszy (kopia „przed-aktualizacja”, wpis `system.storage`)
- [x] Synchronizacja przeglądarek samymi zmianami (`/api/state?since=`, `haveRev` w komendach, `R.applyDelta`),
      pełny stan przy zmianie kont / uprawnień, braku historii zmian lub niezgodności
- [x] Testy: jednostkowe 171, serwer 68 (w tym `storage.test` 7), E2E 340, E2E serwera 32 — zaliczone

### Wyniki testu obciążeniowego 3.10 (`tools/loadtest.mjs`, 4 rdzenie 2,8 GHz)

| Baza | Profil | Zmiany od rewizji p50 / p95 | Zapis p50 / p95 | Otwarcie strony p50 | Spójność |
|---|---|---|---|---|---|
| dane przykładowe (11 → 93 operacji) | 25 stanowisk, przerwy 3–10 s | 6 / 15 ms | 13 / 25 ms | 75 ms | OK, 25/25 stanów zgodnych |
| ok. 2 lata pracy (3011 → 3095 operacji) | 25 stanowisk, przerwy 3–10 s | 8 / 180 ms | 34 / 55 ms | 0,4 s (7 MB) | OK, 25/25 stanów zgodnych |
| ok. 2 lata pracy (3011 → 3782 operacji) | przeciążenie: 40 stanowisk bez przerw (50–300 ms), 50 żądań/s, fala 60 zapisów | 371 ms / 1,5 s | 390 ms / 1,6 s | 0,9 s | OK, 40/40 stanów zgodnych |

Porównanie z 3.9.1 (ta sama baza 3011 operacji, 25 stanowisk): odczyt 2,5 s → 8 ms, zapis 1,7 s → 34 ms,
odpowiedź 7–14 MB → 26–39 kB. We wszystkich przebiegach: 0 błędów, 0 utraconych / zdublowanych zapisów,
kontrola bazy (`--check`) OK, wszystkie komendy na szybkiej ścieżce.

## Wykonane — 3.9.1

- [x] Klient SMTP dla poczty firmowej (SSL / STARTTLS, AUTH PLAIN / LOGIN), opis w panelu i w docs/EMAIL_SETUP.md
- [x] Kopia bazy przed aktualizacją (serwer + instalator), blokada instalacji starszej wersji, docs/AKTUALIZACJE.md
- [x] Test obciążeniowy `tools/loadtest.mjs`; widok stanu zapamiętywany per rewizja
- [x] Testy: jednostkowe 171, serwer 60, E2E 340, E2E serwera 29 — zaliczone

### Wyniki testu obciążeniowego 3.9.1 (rozwiązane w 3.10)

| Baza | Profil | Odczyt stanu p50 / p95 | Zapis p50 | Spójność |
|---|---|---|---|---|
| dane przykładowe (11 → 107 operacji) | 25 stanowisk, przerwy 3–10 s | 11 / 27 ms | 30 ms | OK |
| ok. 2 lata pracy (3011 operacji) | 25 stanowisk, przerwy 3–10 s | 2,5 / 8,2 s | 1,7 s | OK |

Przyczyna: cały stan zapisywany i przesyłany jako jeden dokument (koszt rośnie z historią). Plan 3.10: zapis
przyrostowy (tylko zmienione rekordy), szybka ścieżka komend bez kopiowania historii, synchronizacja przeglądarek zmianami.

## Wykonane — 3.9.0

- [x] Zabudowa i pojemność pojazdów (ruchoma podłoga, kontener, hakowiec — zestaw kontenerów)
- [x] Zapełnienie naczepy / kontenerów w każdym kursie
- [x] Raporty floty (pojazdy, kursy, kierowcy) i rębaków (rębaki, operatorzy, produkcje): dzień / tydzień / miesiąc
- [x] Testy: jednostkowe 171, serwer 48, E2E 340, E2E serwera 29 — zaliczone

## Wykonane — 3.8.1

- [x] Ewidencja obrotu CSV (kolumny zestawienia firmy + dane planera) w Operacjach, Dokumentach, Raportach i Planerze
- [x] Testy: jednostkowe 163, E2E 329 — zaliczone

## Wykonane — 3.8.0

- [x] Kilka firm transportu zewnętrznego (lista 1–10, firma w każdym kursie), podsumowanie i PDF per firma
- [x] „Data przyjęcia” w zakupie, produkcji i MM; „Numeracja WZ” — jedna seria dla wszystkich dokumentów
- [x] Poprawka przewijania w bok na telefonie (formularz z transportem zewnętrznym)
- [x] Testy: jednostkowe 159, serwer 48, E2E 323, E2E serwera 29, intro 15 — wszystkie zaliczone

## Wykonane — 3.7.2

- [x] Konto testowe administratora test@resinvest.group / Test1234 (przycisk na ekranie logowania), odporne na stare dane w przeglądarce
- [x] Pomijanie spacji na brzegach hasła; testy: jednostkowe 149, serwer 47, E2E 315, E2E serwera 29

## Wykonane — 3.7.1

- [x] Nowy film startowy, muzyka włączona przy każdym starcie
- [x] Poprawka logowania administratora (dane demonstracyjne poprzednich wersji, konto z hasłem demo)
- [x] Testy: jednostkowe 149, serwer 47, E2E 311, E2E serwera 29, intro 15 — wszystkie zaliczone

## Wykonane — 3.7.0

- [x] Motyw „Szkło” (6. motyw) w stylu wzoru: pastelowe tło, szklane karty, kolorowe kafelki ikon menu
- [x] Czysta baza na start (OFFLINE i serwer); konto startowe administratora magazyn@resinvest.group z hasłem z konfiguracji (Admin1234, zmiana wymagana)
- [x] Rejestracja użytkowników: e-mail firmowy (serwer), potwierdzenie adresu, powiadomienie administratorów, zatwierdzenie z rolą i magazynem, e-mail o zatwierdzeniu, audyt
- [x] Usunięcie obcych plików bazowych z repozytorium
- [x] Testy: jednostkowe 149, serwer 47, E2E 307, E2E serwera 29 — wszystkie zaliczone; i18n 0 braków
- [ ] Instalator 3.7.0 — po akceptacji wersji HTML

## Wykonane — 3.6.0

- [x] Zakup: zakres (produkcja, sprzedaż bezpośrednia z lasu) przed grupą dostawcy; księgowanie bezpośrednie PW + WZ bez zmiany stanu
- [x] Flota: „Flota własna” / „Flota zewnętrzna” (pola wyboru), pojazdy firm zewnętrznych, podpowiedzi w kursach zewnętrznych
- [x] Wysyłka e-mailem z PDF: raport miesiąca, kwit produkcji dnia, planer, historia, dokumenty, raporty (FIRMOWY: serwer z walidacją, limitem, audytem; OFFLINE: PDF + program pocztowy)
- [x] Znak RiC: aplikacja, PDF, ikona przeglądarki / telefonu / instalatora
- [x] Testy: jednostkowe 149, serwer 44, E2E 291, E2E serwera 29 — wszystkie zaliczone; i18n 0 braków
- [ ] Instalator 3.6.0 — po akceptacji wersji HTML

## Wykonane — 3.1.0 (prototyp końcowy)

- [x] Naprawa logowania: w ramce z zablokowaną pamięcią / Web Locks (podgląd pliku) ekran po zalogowaniu pozostawał pusty
- [x] Logowanie i rejestracja e-mailem firmowym (@resinvest.group), administrator magazyn@resinvest.group, zgłoszenia rejestracji zatwierdzane przez administratora
- [x] Role: Administrator / Kierownik / Magazynier / Obserwator; obieg zatwierdzania (DO ZATWIERDZENIA → zatwierdzenie lub odrzucenie z powodem)
- [x] Magazyny RiC Zabrze, RiC Brąszewice, RiC Rokitki; ludzie i flota przypisani do magazynów; dodawanie, edycja, usuwanie (bez historii) i dezaktywacja
- [x] Administrator: magazyn roboczy, start pracy na czysto; Użytkownicy: filtry, opis ról, usuwanie kont bez historii
- [x] Nowe intro, stopka „Program stworzony przez Roesner Mateusz dla ResInvest Commodities”, LICENSE (autor / licencjobiorca), wersja 3.1.0
- [x] Tłumaczenia CS/EN: 1 669 tekstów, 0 braków; schemat danych 5 z migracją
- [x] Testy: silnik 68, PDF 4, platforma 28, serwer 9, E2E 164 — wszystkie zaliczone


## Wykonane — 3.0.0 (faza 2)

- [x] Restrukturyzacja: `demo/` → `app/`, jeden plik `ResInvest_ERP.html` dla trybu lokalnego i serwera; warstwa usług `RIW.Service` (komendy, uprawnienia, „wszystko albo nic”)
- [x] Logowanie: ekran logowania, pierwsze uruchomienie serwera, wymuszona zmiana hasła, zmiana hasła w profilu, blokady, limit prób IP, wylogowanie po bezczynności, dziennik logowań
- [x] Moduł Użytkownicy: konta, role, magazyn, dezaktywacja, reset hasła, odblokowanie, macierz uprawnień
- [x] ResInvest ERP Serwer: Node.js + SQLite (WAL, transakcje), dziennik append-only z łańcuchem SHA-256, sesje HttpOnly, CSRF, CSP, SSE, kopie codzienne, `--check`, `--restore`, `--reset-password`, HTTPS
- [x] Nowy pulpit: sekcja powitalna, szybkie akcje, 8 wskaźników z porównaniem miesiąc do miesiąca, wykres 6 miesięcy z tabelą, obroty, kafle stanów, aktywność, „Do załatwienia”
- [x] Języki PL/CS/EN — 1 542 teksty, 0 braków (test pokrycia); formaty liczb i dat wg języka; PDF w języku użytkownika
- [x] Motywy Perła / Grafit / Graphite Azure (tokeny CSS, palety wykresów zwalidowane)
- [x] Kartoteki z edycją: produkty, kontrahenci (NIP), magazyny; schemat danych 4 z migracją
- [x] Instalator Windows 3.0 (program + serwer + Node.js, PL/CS/EN), skrypty .cmd, dokumentacja, dane przykładowe
- [x] Testy: silnik 68, PDF 4, platforma 19, serwer 8, E2E 147 — wszystkie zaliczone

## Wykonane — Demo v2.6

- [x] Kwity wywozowe w każdym kursie (nr, m³, MP = m³ × 4, tony); limit sumy kursów względem produkcji i zużytego drewna

## Wykonane — Demo v2.5

- [x] Transport własny i zewnętrzny razem w jednej operacji (np. 3 kursy własne + 2 zewnętrzne), wspólne podsumowanie i podział kosztu

## Wykonane — Demo v2.4

- [x] Transport zewnętrzny: liczba kursów → rubryki (nr rej., kierowca, km, stawka, ilość, waga, opcjonalny fracht kursu) + podsumowanie

## Wykonane — Demo v2.3

- [x] Dostawca (firma) i nadleśnictwo wpisywane ręcznie z podpowiedziami; nowa nazwa dopisywana do kartoteki przy zatwierdzeniu

## Wykonane — Demo v2.2

- [x] Dostawca: grupa „Firma branży drzewnej / przedsiębiorstwo drzewne” (KZR) lub „Nadleśnictwo” (Deklaracja + leśnictwo z listy lub nowe), podstawa zmienialna
- [x] Transport własny: liczba kursów → osobne rubryki (pojazd, kierowca, km, stawka, ilość, waga rzeczywista) + podsumowanie
- [x] Poprawka powielających się opisów wyliczeń w formularzu

## Wykonane — Demo v2.1

- [x] Silnik 2.1 (schemat 3): przeliczniki centralne z GJ, precyzja 6 miejsc, produkcja na magazyn „podaj MP → zużycie liczy system”, MM, statusy, wersje robocze
- [x] Walidacja produkcji §31 (braki, surowiec ≠ produkt, przelicznik, precyzja, atomowość, podwójne kliknięcie, podsumowanie przed zatwierdzeniem)
- [x] Anulowanie z analizą zależności w czasie i korekty (ilościowe, produkcji, bezpośrednie, wartościowe, opisowe, odwrócenie) — §32
- [x] Historia: rejestr ruchów ze stanem przed / zmiana / po + dziennik audytu, pełne filtry
- [x] Raporty dzień / tydzień / miesiąc / rok / zakres; bilans ze spójnością; drill-down; widok biznesowy i audytowy; wycena z „brak wyceny”
- [x] Druk i prawdziwy PDF (czcionka osadzona, polskie znaki) — raporty, historia, kwit, dokumenty; zapis w audycie
- [x] Kwit produkcji dnia
- [x] Pulpit: KPI, stany graficznie z linią 30 dni, OBROTY WEDŁUG TYPU OPERACJI z zakresem
- [x] Menu §20: Operacje, Przyjęcia, Wydania/WZ, Produkcja, Kwit, MM, Transport, Stany, Dokumenty, Historia, Raporty, Inwentaryzacja, Flota, Produkty, Kontrahenci, Magazyny, Administracja
- [x] Dane przykładowe z MM, korektą i anulowaniem; instalator 2.1.0; dokumentacja; TASKS.md

## Testy (3.0.0 — historycznie; 3.1.0 powyżej)

| Zestaw | Wynik |
|---|---|
| `npm run check`, `npm run i18n` | OK · CS/EN: 0 braków, 0 błędnych parametrów |
| `node --test tests/engine.test.mjs tests/pdf.test.mjs tests/platform.test.mjs` | 91/91 |
| `node --test tests/server.test.mjs` (HTTP + SQLite, restart serwera) | 8/8 |
| `node tests/e2e.cjs` — Chromium: desktop 1440 px, telefon 390 px, 2 karty, 2 profile autoplay | 147/147, konsola bez błędów |
| Skan interfejsu EN i CS (wszystkie moduły, szczegóły dokumentu) | 0 brakujących tłumaczeń; polskie pozostają tylko dane (nazwy produktów, firm, osób) |

## Znane problemy / ograniczenia

- GJ liczone z masy dokładnej (6 611 GJ dla 817 m³), przykład w specyfikacji używa masy zaokrąglonej (6 613 GJ) — do decyzji firmy.
- Masa drewna 0,952 t/m³ (z przykładu 817 m³ ≈ 778 t) — do potwierdzenia przez firmę.
- Instalator nie był jeszcze kompilowany (wymaga Windows z Inno Setup 6) — skrypt i plik .iss gotowe; NIEPOTWIERDZONE na Windows.
- Film intro nie jest odtwarzany w testowym Chromium (brak H.264) — NIEPOTWIERDZONE w Chrome/Edge.
- Serwer trzyma stan jako dokument JSON (+ dziennik) — wystarczające dla skali firmy; przy setkach tysięcy operacji rozbicie na tabele.

## Następny krok

Wdrożenie pilotażowe serwera w sieci firmy (instalator 3.0.0), przeniesienie danych kopią JSON, szkolenie na kontach demonstracyjnych.
Kolejna faza: pełna wycena magazynowa (FIFO / średnia ruchoma), archiwum PDF z sumą kontrolną, wiele magazynów na użytkownika.


## 3.2.0 — konta firmowe, role, izolacja magazynów (2026-09-25)

| Zestaw | Wynik |
|---|---|
| `npm run check`, `npm run i18n` | OK · CS/EN: 0 braków, 0 błędnych parametrów, 0 nieużywanych (1 826 tekstów) |
| `node --test tests/engine.test.mjs tests/pdf.test.mjs tests/platform.test.mjs` | 101/101 |
| `node --test tests/server.test.mjs tests/auth.test.mjs` (HTTP + SQLite, poczta `file`) | 34/34 (w tym §34 1–20, §35 1–5) |
| `node tests/e2e.cjs` — Chromium, tryb OFFLINE | 178/178, konsola bez błędów |
| `node tests/e2e-server.cjs` — Chromium + serwer, zaproszenie i reset linkiem z .eml | 24/24, konsola bez błędów |
| Wysyłka przez Resend (API/SMTP) | NIEPOTWIERDZONE — brak klucza API i dostępu do DNS w środowisku budowy |
| Instalator 3.2.0 | skompilowany Inno Setup 6.4.1 w Wine 9; w Wine (win64): instalacja cicha, start serwera przez `ResInvestERP-Serwer.cmd`, API i strona, zakup / korekta / zaproszenie / kopia, aktualizacja na danych, deinstalacja (dane zostają). Na prawdziwym Windows i w Inno Setup 7 — NIEPOTWIERDZONE |

### 3.2.0 — poprawki po zgłoszeniu (jednostki zakupu, transport dostawcy, produkty)

| Zestaw | Wynik |
|---|---|
| unit (engine, pdf, platform) | 105/105 |
| server + auth | 34/34 |
| E2E OFFLINE | 187/187 |
| E2E FIRMOWY | 24/24 |

## 3.5.0 — planer zakupów, powiadomienia, poczta (2026-10-02)

Na życzenie użytkownika rozwój wraca do 3.4.1 jako bazy (architektura, wygląd i mechanizmy operacji bez zmian);
z 4.0 przeniesiono funkcje planera zakupów i powiadomień e-mail w konwencji 3.x (silnik wspólny dla przeglądarki i serwera).

| Zestaw | Wynik |
|---|---|
| `npm run check`, `npm run i18n`, `npm run themes` | OK · CS/EN: 2344 teksty, 0 braków · kontrast motywów OK |
| `npm run test:unit` (silnik, 3.4, 3.5, PDF, platforma) | 140/140 |
| `npm run test:server` (HTTP + SQLite, konta, poczta 3.5) | 39/39 |
| `node tests/e2e.cjs` (Chromium, desktop + telefon) | 255/255, konsola bez błędów |
| `node tests/e2e-server.cjs` | 24/24 |
| Instalator 3.5.0 | Inno Setup 6.4.1 (Wine): instalacja cicha i `--check` serwera — OK. Prawdziwy Windows — NIEPOTWIERDZONE |

## 3.4.1 — operacje dodatkowe w każdej operacji, numeracja z listy (PZ/WZ/MM), rejestry PZ/WZ/MM (2026-10-01)

| Zestaw | Wynik |
|---|---|
| `npm run check`, `npm run i18n`, `npm run themes` | OK · CS/EN 0 braków / 0 nieużywanych |
| unit (engine, features34, pdf, platform) | 127/127 (2 nowe testy: operacje dodatkowe w PZ/WZ/MM, tryby numeracji i numer ręczny MM) |
| server + auth | 35/35 |
| E2E OFFLINE (`e2e.cjs`) | 234/234 (nowe: lista numeracji, operacja dodatkowa w WZ, kolory PZ/WZ/MM, dokumenty pomocnicze) |
| E2E FIRMOWY (`e2e-server.cjs`) | 24/24 |
| Instalator 3.4.1 | Inno Setup 6.4.1 (Wine): instalacja / aktualizacja cicha — OK. Prawdziwy Windows — NIEPOTWIERDZONE |

## 3.4.0 — operacje dodatkowe, rębaki zewnętrzne, tonaż AUTO/RĘCZNY, numery ręczne, usuwanie, XLSX/DOCX (2026-10-01)

| Zestaw | Wynik |
|---|---|
| `npm run check`, `npm run i18n`, `npm run themes` | OK · CS/EN 0 braków / 0 nieużywanych (172 nowe teksty) · kontrast 5 motywów OK |
| unit (engine, features34, pdf, platform) | 125/125 (w tym 12 nowych testów funkcji 3.4) |
| server + auth | 35/35 |
| E2E OFFLINE (`e2e.cjs`) | 229/229 (27 nowych kontroli 3.4), konsola bez błędów |
| E2E FIRMOWY (`e2e-server.cjs`) | 24/24 |
| Układ na telefonie (390 px): kafel „Operacje dodatkowe” | bez poziomego przewijania (kontrola E2E) |
| XLSX / DOCX | struktura ZIP/OOXML i sumy CRC sprawdzane w testach; pliki otwierane w openpyxl i python-docx |
| Instalator 3.4.0 | Inno Setup 6.4.1 (Wine); instalacja cicha w Wine 9 (win64) i `--check` serwera na dołączonym Node.js — OK. Prawdziwy Windows / Inno Setup 7 — NIEPOTWIERDZONE |

Naprawione w trakcie: raport okresowy wiązał tabele z nagłówkami po pozycji — po dodaniu sekcji „Operacje dodatkowe”
nagłówek „Wycena” trafiał nad niewłaściwą tabelę (wykryte przez E2E, poprawione przed wydaniem).

## 3.3.0 — przesunięcia MM: magazyn źródłowy, tryb dwuetapowy, przyjęcie MM, tonaż (2026-09-28)

| Zestaw | Wynik |
|---|---|
| `npm run check`, `npm run i18n`, `npm run themes` | OK · CS/EN 0 braków / 0 nieużywanych · kontrast 5 motywów OK |
| unit (engine, pdf, platform) | 113/113 (w tym 8 nowych testów MM) |
| server + auth | 35/35 (w tym MM przez HTTP) |
| E2E OFFLINE (`e2e.cjs`) | 202/202, konsola bez błędów |
| E2E FIRMOWY (`e2e-server.cjs`) | 24/24 |
| Intro (`e2e-intro.cjs`) | 15/15 |
| Układ na telefonie (390 px): formularz MM, lista „w drodze”, okno przyjęcia | bez poziomego przewijania (zrzuty ekranu sprawdzone) |
| Instalator 3.3.0 | Inno Setup 6.4.1 (Wine); aktualizacja istniejącej instalacji 3.2 w Wine 9 (win64) zakończona sukcesem. Prawdziwy Windows / Inno Setup 7 — NIEPOTWIERDZONE |
