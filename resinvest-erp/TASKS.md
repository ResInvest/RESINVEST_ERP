# TASKS — ResInvest ERP

## 3.10.0 — zapis przyrostowy, synchronizacja przeglądarek zmianami

| Kryterium | Status | Dowód |
|---|---|---|
| zapis tylko zmienionych rekordów, suma kontrolna każdego wiersza, jedna transakcja z wpisem dziennika | DONE | `storage.test` „zapis przyrostowy…”, „sumy kontrolne wierszy…”, „nieudana komenda…” |
| wszystkie komendy na szybkiej ścieżce; stan po ponownym otwarciu identyczny (z kolejnością) | DONE | `storage.test` „pełny scenariusz pracy…” (20 rodzajów komend), E2E serwera „komendy na szybkiej ścieżce” |
| przeniesienie bazy 3.9.x bez utraty danych, kopia przed aktualizacją | DONE | `storage.test` „baza sprzed 3.10…”; 3000 operacji: 1,5 s, stan identyczny |
| przeglądarki pobierają tylko zmiany; izolacja magazynów; pełny stan przy zmianie uprawnień | DONE | `server.test` „synchronizacja samymi zmianami…”, E2E serwera „3.10: …” (2 sprawdzenia) |
| obciążenie: baza 2 lata pracy, 25 i 40 stanowisk, stan każdego stanowiska = widok serwera | DONE | `tools/loadtest.mjs` — wyniki w progress.md |
| aktualizacja instalatorem 3.9.1 → 3.10.0 na istniejącej instalacji | DONE | Wine: kopia przed podmianą plików, kopia „przed-aktualizacja-3_9_1”, przeniesienie do wierszy, `--check` OK, ponowny start bez kopii, instalator 3.9.1 na 3.10.0 zablokowany |

## 3.9.1 — poczta SMTP firmowa, bezpieczne aktualizacje, test obciążeniowy

| Kryterium | Status | Dowód |
|---|---|---|
| SMTP dowolnego dostawcy: SSL 465 / STARTTLS 587, AUTH PLAIN/LOGIN, weryfikacja certyfikatu, brak hasła bez szyfrowania | DONE | `smtp.test` (8 testów na lokalnym serwerze SMTP) |
| opis konfiguracji SMTP w panelu administratora bez haseł | DONE | `smtp.test` „domyślne ustawienia…”, `admin.js` |
| kopia bazy przed aktualizacją (serwer) i przed podmianą plików (instalator), blokada instalacji starszej wersji | DONE | `update.test` (4 testy); instalator 3.9.1 → 3.9.2 i 3.9.0 na 3.9.1 sprawdzone w Wine |
| test obciążeniowy: wiele stanowisk, fala zapisów, spójność, kontrola dziennika | DONE | `tools/loadtest.mjs` — 0 utraconych / zdublowanych zapisów; czasy odpowiedzi — patrz progress.md |

## 3.9.0 — pojemność pojazdów, zapełnienie kursów, raporty floty i rębaków

| Kryterium | Status | Dowód |
|---|---|---|
| zabudowa pojazdu (ruchoma podłoga, kontener, hakowiec — zestaw kontenerów) z wymiarami; pojemność = dł. × szer. × wys. | DONE | `features39.test` (2 testy), E2E „3.9 Hakowiec…”, „3.9 Pojemność liczona na żywo…” |
| zapełnienie % każdego kursu (flota własna i zewnętrzna), średnia operacji, ostrzeżenie o przeładowaniu | DONE | `features39.test` „kurs floty własnej…”, „kurs zewnętrzny…” |
| raporty tygodniowe i miesięczne floty: pojazdy, kursy, kierowcy (kursy, MP, tony, km) | DONE | `features39.test` „raport pojazdów i kierowców…”, E2E „3.9 Raport…” |
| raporty dzienne, tygodniowe, miesięczne rębaków i operatorów (ile zrąbali) | DONE | `features39.test` „raport rębaków i operatorów…”, E2E |
| eksport raportów floty CSV / XLSX / PDF | DONE | E2E „3.9 Raport floty: eksport CSV” |

## 3.8.1 — ewidencja obrotu CSV + dane planera

| Kryterium | Status | Dowód |
|---|---|---|
| kolumny CSV w kolejności zestawienia firmy (35 kolumn) + jednostki cen, magazyn i 6 kolumn planera | DONE | `features38.test` „ewidencja CSV: kolumny…” |
| wiersz na ruch towaru (Zakup / Produkcja / Sprzedaż / MM), transport w ostatnim wierszu — suma = raporty | DONE | `features38.test` (4 testy ewidencji) |
| magazynowanie TAK/NIE i ruch magazynu w MP i t; rąbanie własne/wynajęte; rodzaj zrębki a/b | DONE | `features38.test` |
| pobieranie z Operacji, Dokumentów, Raportów i Planera (UTF-8 z BOM, średnik, przecinek dziesiętny) | DONE | E2E „3.8 CSV …” (6 sprawdzeń) |

## 3.8.0 — kilka firm transportu zewnętrznego, data przyjęcia, jedna seria WZ

| Kryterium | Status | Dowód |
|---|---|---|
| lista „Liczba firm przewidzianych do transportu” 1–10 z samouczkiem; firma w każdym kursie (lista lub nowa nazwa) | DONE | E2E „3.8 Transport zewnętrzny…”, „3.8 Kilka firm…” |
| silnik: firma per kurs, kontrola liczby firm, podsumowanie per firma, transport mieszany, dane sprzed 3.8 | DONE | `features38.test` (5 testów transportu) |
| nowe firmy dopisują się do listy przewoźników; raport transportu per firma | DONE | `features38.test` „nowe firmy z kursów…” |
| „Data przyjęcia” + samouczek „Wprowadź datę przyjęcia produktu na magazyn.” | DONE | E2E „3.8 Zakup: pole Data przyjęcia…” |
| „Numeracja WZ”; jedna seria WZ dla wszystkich dokumentów, jeden numer na transakcję; stare numery bez zmian | DONE | `features38.test` (numeracja), E2E „3.8 Rejestr…” |
| przełącznik trybu numeracji w Administracji (audyt) | DONE | `features38.test` „administrator przełącza tryb…” |
| formularz bez przewijania w bok na telefonie (390 px) | DONE | pomiar Playwright: szerokość strony 390 px |

## 3.7.3 — kanał poczty AgentMail

| Kryterium | Status | Dowód |
|---|---|---|
| AgentMail jako transport poczty (klucz tylko na serwerze, skrzynka nadawcy, załączniki PDF, Reply-To, kolejka z ponowieniami) | DONE | `mail36.test` „kanał AgentMail…” (atrapa API) |
| wysyłka na prawdziwe konto AgentMail | NIEPOTWIERDZONE | wymaga klucza i skrzynki użytkownika |

## 3.7.2 — konto testowe administratora

| Kryterium | Status | Dowód |
|---|---|---|
| konto testowe test@resinvest.group / Test1234 działa przy dowolnych danych w przeglądarce (obcy administrator, konto zablokowane / nieaktywne) | DONE | E2E „3.7.2 Konto testowe…”, scenariusze ręczne 1–4 |
| hasło ze spacją na końcu (klawiatura telefonu) przyjęte; błędne hasło odrzucone | DONE | E2E „3.7.2 Hasło ze spacją…”, „błędne hasło odrzucone” |

## 3.7.1 — nowy film startowy, muzyka od razu, poprawka logowania administratora

| Kryterium | Status | Dowód |
|---|---|---|
| nowy film startowy (z nagrania użytkownika, 1280×720, H.264 + AAC) | DONE | E2E „Intro 3.8: nowy film…”, `e2e-intro` 15/15 (odtwarzanie z dźwiękiem) |
| muzyka włączona przy każdym starcie (także po wcześniejszym wyciszeniu) | DONE | E2E „Intro 3.8: muzyka włączona od razu…” |
| logowanie Admin1234 przy danych demonstracyjnych zapisanych przez starą kartę / koncie z hasłem demo | DONE | E2E „3.8 Logowanie Admin1234…” (2 scenariusze) |

## 3.7.0 — motyw Szkło, rejestracja użytkowników, czysta baza z kontem startowym administratora

| Kryterium | Status | Dowód |
|---|---|---|
| motyw „Szkło” w stylu wzoru (pastelowe tło, szklane karty, kolorowe kafelki ikon, zielone przyciski) | DONE | E2E „3.7 Szkło…”, `npm run themes` (WCAG) |
| czysta baza na start: administrator, 3 magazyny, katalog produktów; bez danych przykładowych | DONE | E2E „3.7 Czysta baza…”, `reg37.test` „czysta baza…” |
| administrator `magazyn@resinvest.group` / hasło startowe `Admin1234` z konfiguracji (nie z kodu), zmiana wymagana | DONE | E2E „3.7 Administrator…”, `reg37.test` |
| jednorazowe usunięcie danych demonstracyjnych poprzednich wersji z przeglądarki (z kopią) | DONE | E2E „3.7 Czysta baza… kopia danych demonstracyjnych” |
| rejestracja: domena na serwerze, hasło, duplikaty, limit prób, brak samodzielnego nadania roli | DONE | `reg37.test`, E2E „3.7 Rejestracja…” |
| rejestracja FIRMOWY: potwierdzenie adresu linkiem, powiadomienie administratorów, zatwierdzenie po potwierdzeniu, e-mail o zatwierdzeniu, audyt | DONE | `reg37.test`, `server.test` „rejestracja samodzielna…” |
| rejestracja OFFLINE: zgłoszenie → powiadomienie → zatwierdzenie z rolą i magazynem → logowanie | DONE | E2E „3.7 Zatwierdzenie…”, „Zatwierdzony użytkownik loguje się…” |
| usunięcie obcych plików bazowych repozytorium; brak śladów w plikach instalatora | DONE | `grep` repozytorium i `ResInvest_ERP.html`, `node.exe` |
| tłumaczenia CS / EN | DONE | `npm run i18n`: 0 braków, 0 nieużywanych |
| instalator 3.7.0 | OCZEKUJE na decyzję użytkownika | — |

## 3.6.0 — zakup (produkcja / sprzedaż bezpośrednia z lasu), flota własna i zewnętrzna, wysyłka e-mailem, znak RiC

| Kryterium | Status | Dowód |
|---|---|---|
| zakup: opcje „+ Produkcja z automatycznym zużyciem” i „+ Sprzedaż bezpośrednia z lasu (bez magazynowania)” przed grupą dostawcy, obie dostępne od razu | DONE | E2E „3.6 Zakup: opcje … przed wyborem grupy dostawcy”, „obie opcje dostępne” |
| zakup bezpośredni: PZ → RW → PW → WZ, PW i WZ bezpośrednie, stan bez zmian, raport / historia | DONE | `features36.test` (6 testów), E2E „Zakup bezpośredni: zatwierdzenie z formularza…” |
| zakup: dotychczasowa sprzedaż wyniku produkcji przez magazyn bez zmian; korekta nie zmienia rodzaju | DONE | `features36.test`, `engine.test` §22 TEST 4 |
| flota: pola wyboru „Flota własna” / „Flota zewnętrzna”, zakładki wg zaznaczenia | DONE | E2E „3.6 Flota: …” (7 scenariuszy) |
| flota zewnętrzna: pojazdy firm (firma, kierowca opisowo), dane przykładowe ESI / DAP / Kowalski | DONE | `features36.test` „flota: …” (3 testy) |
| transport: własny tylko z floty własnej (walidacja w silniku), zewnętrzny z podpowiedzią numerów i uzupełnieniem kierowcy | DONE | `features36.test`, E2E „3.6 Transport …” |
| wysyłka e-mailem: raport miesiąca, kwit produkcji dnia, planer, historia, dokumenty (podgląd i rejestry), raporty | DONE | E2E „3.6 … przycisk „Wyślij e-mailem””, E2E serwera „3.6 FIRMOWY …” |
| wysyłka: walidacja po stronie serwera (uprawnienie, adresy, temat, PDF, 8 MB, domeny, 40/h), audyt MAIL_DOCUMENT, załącznik usuwany z kolejki | DONE | `mail36.test` (5 testów) |
| wysyłka OFFLINE: zapis PDF + program pocztowy (jawny komunikat) | DONE | E2E „3.6 OFFLINE: PDF zapisany…” |
| znak RiC: menu, logowanie, intro, PDF, ikona przeglądarki i telefonu, ikona instalatora | DONE | E2E „3.6 Znak RiC…”, „Ikona strony RiC…”; `pdf.test` |
| tłumaczenia CS / EN | DONE | `npm run i18n`: 2401 tekstów, 0 braków, 0 nieużywanych |
| telefon 390 px bez poziomego przewijania (flota, raporty, okno e-mail) | DONE | E2E „3.6 Telefon…” (naprawiona siatka raportów) |
| instalator 3.6.0 | OCZEKUJE na decyzję użytkownika | — |

## 3.5.0 — planer zakupów, powiadomienia, poczta (na bazie 3.4.1 — ten sam wygląd i mechanizmy)

| Kryterium | Status | Dowód |
|---|---|---|
| planer: plan dnia [MP] wpisywany ręcznie (magazyn × dzień), zapis Enter / wyjście z pola | DONE | `features35.test` „zapis planu…”, E2E „3.5 Planer: plan dnia zapisany…” |
| planer: wykonanie, tony (waga + przelicznik), cena, km, transport, kursy z zatwierdzonych operacji | DONE | `features35.test` „wykonanie z operacji…”, „tony = waga…”, E2E „wykonanie 15.09 = 600 MP” |
| planer: realizacja do dziś, miesiące i rok, kierowcy i kursy, źródła danych, eksport CSV/XLSX/PDF | DONE | `features35.test`, E2E „miesiące i rok”, „eksport XLSX” |
| planer: uprawnienie `planner.edit`, dostęp do magazynu, wersja (konflikt), audyt PLAN_UPDATED | DONE | `features35.test` „uprawnienia…”, `mail35.test` „planer przez API…” |
| powiadomienia: zdarzenia z operacji, odbiorcy (dostęp, zgoda, włączone), bez autora | DONE | `features35.test` (6 testów), E2E „PZ magazyniera → kierownik” |
| powiadomienia: zgody administratora, ustawienia użytkownika, audyt | DONE | `features35.test` „zgody administratora…”, E2E „Zgody…” |
| powiadomienia: skrzynka, dzwonek, przeczytane, otwarcie operacji | DONE | E2E „kliknięcie otwiera operację…” |
| poczta: kolejka w bazie, wysyłka w tle, ponowienia 1 min…6 h, porzucenie, ponowienie ręczne | DONE | `mail35.test` „awaria poczty nie cofa operacji…” |
| poczta: ekran administratora, test, kanał bez sekretów, uprawnienie `notifications.manage` | DONE | `mail35.test` „Poczta: tylko administrator…” |
| migracja danych 8 → 9 | DONE | `features35.test` „migracja 8 → 9…” |
| tłumaczenia CS / EN | DONE | `npm run i18n`: 0 braków, 0 nieużywanych |
| telefon 390 px bez poziomego przewijania (planer, powiadomienia, poczta) | DONE | E2E „3.5 Telefon…” |
| instalator 3.5.0 | DONE (Inno Setup 6.4.1 w Wine) | `ResInvestERP_Setup_3.5.0.exe` (SHA-256 99face1a…af17): instalacja cicha w Wine 9 (win64), pliki 3.5 na miejscu, `--check` serwera na dołączonym Node.js — OK; prawdziwy Windows — NIEPOTWIERDZONE |

## 3.4.1 — zgłoszenie po 3.4.0

| Kryterium | Status | Dowód |
|---|---|---|
| operacje dodatkowe w każdej operacji (zakup, sprzedaż, produkcja, MM) | DONE | `features34.test` „3.4.1: operacje dodatkowe w każdej operacji…”, E2E „3.4.1 WZ: operacja dodatkowa…” |
| rejestry: typy zminimalizowane do PZ, WZ, MM; pozostałe pod „Pokaż dokumenty pomocnicze” | DONE | E2E „3.4.1 Rejestr: domyślnie tylko PZ, WZ, MM” |
| mocniejsze kolory PZ / WZ / MM | DONE | E2E „3.4.1 Rejestr: PZ, WZ, MM w różnych, mocnych kolorach” |
| lista rozwijana numeracji: automatycznie / ręcznie dla PZ, WZ, MM | DONE | `features34.test` „3.4.1: numeracja z listy…”, E2E „3.4.1 Numeracja WZ…” |

## 3.4.0 — operacje dodatkowe, rębaki zewnętrzne, tonaż, numery ręczne, usuwanie, XLSX/DOCX

| Kryterium | Status | Dowód |
|---|---|---|
| §13 pole „Dodaj operację dodatkową” w produkcji; rodzaj z kartoteki, pojazd z Floty (opcjonalnie), koszt, opis | DONE | `features34.test` „§13…”, E2E „3.4 Produkcja…” |
| §13 osobne rekordy powiązane z operacją, koszt obniża wynik, korekta BYŁO/JEST | DONE | `features34.test` |
| §14 kartoteka „Dodatkowe operacje” w bazie (ID, nazwa, opis, aktywna, jednostka, stawka, daty) | DONE | `features34.test` „§14…”, E2E „Kartoteki → Dodatkowe operacje” |
| §15 rębaki firm zewnętrznych (firma, nr rej., operator opisowo) | DONE | `features34.test` „§15…”, E2E |
| §16 kafel pulpitu z wyborem miesiąca (koszt, liczba, lista) | DONE | `features34.test` „§16…”, E2E „3.4 Pulpit…” |
| §8 tonaż sprzedaży AUTO / RĘCZNY ze źródłem („60 MP \| 20,35 t \| RĘCZNY”) | DONE | `features34.test` „§8…”, E2E |
| §10 ręczne numery PZ/WZ (unikalne: typ + magazyn + rok), data dokumentu / przyjęcia / utworzenia | DONE | `features34.test` „§10…”, E2E „WZ/27…” |
| §11 Otwórz / Podgląd / Koryguj / Usuń; „Usuń” = soft delete z powodem; PZ zielone, WZ złote | DONE | `features34.test` „§11…”, `engine.test` TEST 9, E2E |
| §12 eksport XLSX i DOCX | DONE | `features34.test` „§12…”, E2E (pobranie plików) |
| migracja danych 7 → 8 | DONE | `features34.test` „Migracja 7 → 8” |
| tłumaczenia CS / EN | DONE | `npm run i18n`: 0 braków, 0 nieużywanych |
| §17 powiadomienia e-mail o zdarzeniach (kolejka, ponowienia) | NIE ZROBIONE | poza zakresem 3.4 — planowane w 4.0 |
| instalator 3.4.0 | DONE (Inno Setup 6.4.1 w Wine) | instalacja cicha + `--check` serwera w Wine 9; prawdziwy Windows — NIEPOTWIERDZONE |

## 3.3.0 — przesunięcia MM: magazyn źródłowy, tryb dwuetapowy, przyjęcie, tonaż

| Kryterium | Status | Dowód |
|---|---|---|
| pole „Magazyn źródłowy” aktywne, lista magazynów dostępnych użytkownikowi (z danych) | DONE | E2E „MM: pole magazynu źródłowego aktywne…”, „listy magazynów z danych…” |
| magazyn docelowy — dowolny aktywny magazyn firmy | DONE | E2E, `engine.test` „wybór magazynu źródłowego” |
| walidacja: źródło ≠ cel (błąd, kod SAME_WH) | DONE | `engine.test`, E2E „ten sam magazyn…” |
| dostęp do magazynu źródłowego sprawdzany na serwerze (manipulacja `fromWhId`) | DONE | `engine.test`, `auth.test` „MM dwuetapowe przez serwer” |
| rozchód w źródle i przychód w celu w jednej transakcji (tryb jednoetapowy) | DONE | `engine.test` „MM jednoetapowe…” |
| tryb dwuetapowy: W DRODZE → „Przyjmij MM” (magazyn docelowy, `mm.receive`) | DONE | `engine.test` (8 testów MM), `auth.test`, E2E |
| przyjęcie z ilością faktyczną, przyczyna różnicy, raport wysłano / przyjęto / różnica | DONE | `engine.test` „przyjęcie z ilością faktyczną…”, E2E |
| przełącznik trybu w Administracji (+ audyt) | DONE | `engine.test` „przełącznik trybu…” |
| tonaż automatyczny / ręczny (wysłanie i przyjęcie) | DONE | `engine.test` „tonaż…”, E2E |
| anulowanie i korekta MM w obu stanach | DONE | `engine.test` |
| migracja danych 6 → 7 | DONE | `engine.test` „…migracja 6 → 7” |
| tłumaczenia CS / EN | DONE | `npm run i18n`: 0 braków, 0 nieużywanych |
| instalator 3.3.0 | DONE (Inno Setup 6.4.1 w Wine) | aktualizacja 3.2 → 3.3 w Wine 9 (win64) zakończona sukcesem; prawdziwy Windows / Inno Setup 7 — NIEPOTWIERDZONE |

## 3.2.0 — konta firmowe, role, uprawnienia, izolacja magazynów (kryteria gotowości §44)

| Kryterium | Status | Dowód |
|---|---|---|
| logowanie działa | DONE | `auth.test` §34.1, E2E (oba tryby) |
| logout działa (sesja unieważniona, stan wyczyszczony, `#/login`) | DONE | `server.test`, `e2e-server` „Wylogowanie” |
| reset hasła działa | DONE (transport `file`) | `auth.test` §34.7, `e2e-server` |
| zaproszenie działa | DONE (transport `file`) | `auth.test` §34.5–6, `e2e-server` |
| potwierdzenie e-mail działa (zmiana adresu) | DONE (transport `file`) | `auth.test` „Zmiana adresu e-mail” |
| `@resinvest.group` wymuszane po stronie serwera | DONE | `auth.test` §34.4, `platform.test` |
| `magazyn@resinvest.group` jest administratorem | DONE | seed, pierwsze uruchomienie |
| administrator tworzy użytkowników, nadaje / odbiera role, tworzy administratorów | DONE | `auth.test` §34.8, §34.17 |
| blokada usunięcia / degradacji ostatniego administratora | DONE | `auth.test` §34.17 / §35.5, `platform.test` |
| role i uprawnienia działają na backendzie | DONE | `auth.test` §34.8–12, §35.1–2 |
| dostęp do magazynów i izolacja danych | DONE | `auth.test` §34.13–14, §35.3–4, `e2e-server` |
| audit log (kody, IP, User-Agent) | DONE | `auth.test` §34.5, E2E „Dziennik audytu” |
| e-maile z marką ResInvest ERP (PL) | DONE | `server/mail.mjs`, `auth.test` (treść .eml) |
| sekrety poza frontendem i Gitem | DONE | `auth.test` „Sekrety”, `.gitignore`, `.env.example` |
| testy przechodzą | DONE | 101 + 34 + 178 + 24 (progress.md) |
| TypeScript przechodzi | NIE DOTYCZY | projekt w JavaScript (bez TypeScript); `npm run check` — składnia OK |
| build przechodzi | DONE | `npm run build` |
| dokumentacja gotowa | DONE | `docs/AUTHENTICATION.md`, `USERS_AND_ROLES.md`, `EMAIL_SETUP.md`, `SECURITY.md`, `SUPABASE_SETUP.md` |
| istniejące moduły ERP działają | DONE | `engine.test` 68/68, E2E 178/178 |
| wysyłka przez Resend na prawdziwym koncie | NIEPOTWIERDZONE | wymaga klucza API i weryfikacji domeny (DNS) — `docs/EMAIL_SETUP.md` |
| kompilacja instalatora 3.2.0 | DONE (Inno Setup 6.4.1 w Wine) | `ResInvestERP_Setup_3.2.0.exe`; instalacja cicha, start serwera, aktualizacja na danych i deinstalacja sprawdzone w Wine 9 (win64). Inno Setup 7 na prawdziwym Windows — NIEPOTWIERDZONE |
| zakup: ilość w m³, cena za MP; korekta m³ ↔ MP | DONE | `platform.test` (3.2), E2E „3.2 Zakup”, „3.2 Korekta” |
| transport w cenie zakupu — zapewnia dostawca | DONE | `platform.test`, E2E |
| produkty: dowolna jednostka magazynowa, dozwolone jednostki, przeliczniki | DONE | `platform.test`, E2E „3.2 Produkty” |
| intro: natychmiastowy start (plakat + preload Blob), dźwięk, Wycisz / Pomiń intro, zwolnienie zasobów | DONE | `e2e-intro.cjs` 15/15 (film WebM), `e2e.cjs` (plakat, dispose); odtwarzanie H.264 w Edge/Chrome na Windows — NIEPOTWIERDZONE |
| motywy Ultra Dark (OLED) i Light Premium + rejestr motywów | DONE | `npm run themes` (WCAG), E2E „Motywy” (5 motywów, zapis w profilu, Ctrl+D) |
| plan architektury: VPN, dysk sieciowy, AES-256, kopie A/B, klient i instalator | PLAN | `docs/ARCHITECTURE_WINDOWS_PLAN.md` — do realizacji etapami 1–8 |

## 3.1.0 — prototyp końcowy

| Wymaganie | Status | Dowód |
|---|---|---|
| Logowanie działa (także w podglądzie pliku bez dostępu do pamięci) | DONE | E2E „ramka bez pamięci”, logowanie formularzem we wszystkich testach E2E |
| Rejestracja i logowanie e-mailem firmowym; admin magazyn@resinvest.group | DONE | platform + server + E2E (rejestracja → aktywacja → logowanie) |
| Admin dodaje adminów, kierowników, magazynierów, obserwatorów | DONE | platform („Administrator dodaje innych administratorów”) |
| Role: admin wszystko, obserwator podgląd, magazynier dodaje, kierownik zatwierdza | DONE | platform (role, obieg zatwierdzania), server, E2E |
| 3 magazyny: RiC Zabrze, RiC Brąszewice, RiC Rokitki | DONE | platform, E2E |
| Flota, ludzie, rębaki, magazynierzy i kierownicy przypisani do magazynów; dodawanie / edycja / usuwanie | DONE | platform (flota wg magazynu, usuwanie), E2E (rębaki w formularzu) |
| Nowe intro | DONE | `app/assets/intro.mp4` (10 s, 1280×720, H.264 + AAC, 2,8 MB) |
| Stopka autorska, pliki licencyjne | DONE | `.app-foot`, ekran logowania, `LICENSE`, instalator (AppCopyright) |
| Usunięcie śladów narzędzi w programie i plikach | DONE | przegląd plików projektu |
| Kompilacja instalatora Windows | NIEPOTWIERDZONE — następny krok (Windows + Inno Setup 6) | `installer\build-installer.ps1` |

## 3.0.0 — FAZA 2 (logowanie, serwer, pulpit, języki, motywy)

| Wymaganie | Status | Dowód |
|---|---|---|
| Pulpit główny poprawiony graficznie (sekcja powitalna, szybkie akcje, wskaźniki z trendem, wykres 6 mies., obroty, kafle stanów, aktywność, do załatwienia) | DONE | E2E §13–§15, zrzuty 1440 / 390 px, 3 motywy |
| System logowania — tryb lokalny (PBKDF2, blokada, bezczynność, zmiana hasła) | DONE | `tests/platform.test.mjs` (LocalAuth), E2E (logowanie kontami demo) |
| System logowania — serwer (scrypt, sesje HttpOnly, CSRF, blokada, limit IP, wymuszona zmiana) | DONE | `tests/server.test.mjs` |
| Użytkownicy i uprawnienia (Administrator), ostatni administrator chroniony | DONE | platform + server + E2E (macierz tylko dla Administratora) |
| Praca wielostanowiskowa: SQLite, transakcje, dziennik z łańcuchem skrótów, SSE | DONE | server test (komendy, idempotencja, autor z sesji, restart, `--check`) |
| Kopie zapasowe (codzienne, przy starcie, ręczne), przywracanie, kontrola spójności | DONE | server test (kopia + `--check`) |
| Języki PL / CS / EN — kompletne (interfejs, silnik, serwer, audyt, PDF) | DONE | `npm run i18n` 0 braków; test pokrycia; skan EN/CS |
| Motywy Perła / Grafit / Graphite Azure | DONE | E2E (jasny motyw), zrzuty 3 motywów |
| Kartoteki z edycją (produkty, kontrahenci z NIP, magazyny) | DONE | platform test (NIP, unikalny kod) |
| Migracja schematu 3 → 4 i danych Demo 2.x | DONE | platform test (migracja), E2E |
| Instalator Windows z serwerem i Node.js (PL/CS/EN) | DONE (kod) · kompilacja NIEPOTWIERDZONA | `installer/ResInvestERP.iss`, `build-installer.ps1` |
| README, LICENSE, konfiguracja środowiska, dane przykładowe | DONE | `README.md`, `LICENSE`, `config/*.json`, `data/sample_data.json` |

---

# Demo v2 (domknięcie przed Production v1) — historia

Status: `TODO` · `IN PROGRESS` · `DONE` (= zaimplementowane **i** sprawdzone testem) · `BLOCKED` · `PRODUKCJA` (celowo na etap pełnego ERP)

## 0. Rozpoznanie istniejącego kodu (wykonane przed zmianami)

| Obszar | Stan zastany (Demo v2 2.0.0, commit `ac6d479`) | Plik |
|---|---|---|
| Operacje | `planOperation` / `commitOperation`, typy ZAKUP, SPRZEDAZ (z magazynu / `direct`), PRODUKCJA | `demo/src/engine.js` |
| Produkcja na magazyn | użytkownik wpisuje **zużycie** m³, wynik = zużycie × 4 — **odwrotnie niż wymaga §3/§6** (ma być: podaję MP, zużycie liczone) | engine `planProduction("stock")` |
| Produkcja na magazyn — transport | sekcja transportu **jest widoczna** — sprzeczne z §5 | `app.js` `transportHtml` zawsze renderowane |
| Produkt wyjściowy | wynika z „rodzaju produkcji”, brak jawnego wyboru; brak kontroli surowiec ≠ produkt | engine |
| Przeliczniki | m³↔MP (4), MP→t (0,33), drewno 0,952 t/m³; **brak GJ** (1 t = 8,5 GJ) | engine `Units` |
| Precyzja | ilości zaokrąglane do 0,001 **przed** walidacją — sprzeczne z §31.6 | engine `round(…,3)` |
| WZ | działa (stan przed/po, blokada ponad stan) | engine |
| Sprzedaż bezpośrednia | PW+WZ `direct`, surowiec opcjonalny — §31.10 wymaga walidacji surowca | engine |
| MM | **brak** | — |
| Statusy | `posted` / `storno` — brak DRAFT/CANCELLED/CORRECTED | engine |
| Anulowanie | `stornoOperation` (odwrócenie, blokada gdy stan < 0 **dziś**) — brak analizy zależności w czasie, brak potwierdzenia | engine |
| Korekty ilościowe/wartościowe/opisowe | **brak** | — |
| Historia | dziennik audytu (JSON przed/po) + rejestr operacji; brak rejestru ruchów ze stanem przed/zmiana/po per produkt | `app.js` Views.historia |
| Raport miesięczny | KPI + ruchy wg produktu; brak bilansu stan pocz. + ruchy = stan końc., brak MM, brak transportu, brak drill-down | engine `Reports.summary` |
| Druk | tylko pojedynczy dokument (okno + `window.print`) | `app.js` printDoc |
| PDF | **brak** | — |
| Kwit produkcji dnia | **brak** | — |
| Pulpit | KPI liczbowe, bez wykresów, bez obrotów wg typu | `app.js` Views.pulpit |
| Menu | 8 pozycji; brak Przyjęć, WZ, Produkcji, MM, Transportu, Produktów, Kontrahentów, Magazynów, Administracji | `app.js` NAV |
| Jasny motyw | wdrożony w 2.0.0 | `styles.css` |
| Uprawnienia | role → `op.create`, `op.storno`, … — brak `documents.cancel` itd. | engine `ROLES` |
| Zapis | localStorage + Web Locks + idempotencja (bez zmian) | `app.js` Store |

NIEPOTWIERDZONE (stan przed zmianami): zachowanie filmu intro w Chrome/Edge z kodekiem H.264 (środowisko testowe nie ma kodeka).

## 1. Zadania

Dowody: `U:` test jednostkowy w `tests/engine.test.mjs` / `tests/pdf.test.mjs`, `E:` kontrola w `tests/e2e.cjs` (nazwa testu).

| # | Wymaganie (§) | Status | Dowód |
|---|---|---|---|
| 1 | Przeliczniki centralne + GJ (§4) | DONE | U: „Przeliczniki centralne…”, „Stan startowy…”; E: „§4 Stany…”, „§13 Pulpit: KPI stanów z ≈ t i ≈ GJ” |
| 2 | Produkcja na magazyn: podaję MP → zużycie = MP ÷ 4, bez transportu (§3, §5, §6) | DONE | U: §22 TEST 1; E: „§5 Produkcja na magazyn: brak transportu…”, „§22 T1…” |
| 3 | Walidacja produkcji 31.1–31.15 | DONE | U: §31.16 A–J; E: §31.16 B, C, F, §31.15 |
| 4 | Sprzedaż bezpośrednia — surowiec, przelicznik, sprzedaż ≤ produkcja (§8, §31.10–31.11) | DONE | U: §22 TEST 3, §31.16 I; E: „§31.16 I”, „§22 T3” |
| 5 | WZ — stan dostępny / po WZ (§9) | DONE | U: §22 TEST 2; E: „§9 WZ…” |
| 6 | MM — przesunięcie międzymagazynowe | DONE | U: „MM…”, TEST 19–20; E: „MM: …” |
| 7 | Statusy DRAFT / POSTED / CANCELLED / CORRECTED (§32.1) | DONE | U: „§32: wersja robocza…”; E: „§32.1 Wersja robocza…”, „§32.1 Rejestr: kolumna Status…” |
| 8 | Anulowanie z analizą zależności (§32.2–32.4) | DONE | U: §32.23 TEST 1–3; E: „§32.23 T1”, „§32.4 Blokada…” |
| 9 | Korekty: ilościowe, wartościowe, opisowe, produkcji, bezpośredniej, odwrócenie (§32.5–32.17) | DONE | U: §32.23 TEST 4–9; E: „§32.5”, „§32.9 Podgląd…”, „§32.8”, „§32.16” |
| 10 | Uprawnienia `documents.cancel`, `documents.correct`, `*.correct` (§32.22) | DONE | U: §32.23 TEST 10; E: „§32.22 Magazynier…”, „Administracja: uprawnienia…” |
| 11 | Historia operacji (przed / zmiana / po) + filtry (§10, §23, §32.18) | DONE | U: TEST 41; E: „§10 Historia: kolumny…”, „§32.18…”, „§23 Historia: zakres dat” |
| 12 | Raport okresowy: sekcje, bilans, spójność, wiele magazynów, drill-down, wycena, zamknięty miesiąc (§11, testy 11–42) | DONE | U: TEST 11–42; E: „§11 Raport…”, „§11 Drill-down…”, „Test 31/33/35” |
| 13 | Druk + prawdziwy PDF (czcionka osadzona, polskie znaki) (§12) | DONE | U: `pdf.test.mjs` (4 testy); E: „§12 GENERUJ PDF…”, „§12 PDF: polskie znaki…” (pypdf), „§12 DRUKUJ…” |
| 14 | Kwit produkcji dnia + druk/PDF (§16) | DONE | U: TEST 40; E: „§16 Kwit…” (3 kontrole) |
| 15 | Pulpit: KPI, stany graficznie, obroty wg typu z zakresem (§13–15) | DONE | E: „§13”, „§14”, „§15” (5 kontroli) |
| 16 | Transport kolejowy — oba tryby (§17) | DONE | U: §22 TEST 5–6; E: „§22 T5”, „§22 T6”, „Pociąg: podsumowanie…” |
| 17 | Cena za rąbanie (§18) | DONE | U: §22 TEST 7; E: „§18…”, „§22 T7…” |
| 18 | Menu główne (§20) | DONE | E: „§20 Menu: wszystkie wymagane pozycje” |
| 19 | Formularze zależne od typu (§21) | DONE | E: „§5…”, „§6 Produkcja: …pola”, testy WZ / bezpośredniej / MM |
| 20 | Testy akceptacyjne (§22, §31.16, §32.23, testy 11–42) | DONE | `npm run test:unit` 56/56, `npm run test:e2e` 104/104 |
| 21 | Review końcowy diffu (§29) | DONE | sekcja 2 poniżej (znalezione i poprawione w trakcie) |

### Demo v2.2 (uwagi z oceny)

| # | Wymaganie | Status | Dowód |
|---|---|---|---|
| 22 | Dostawca: firma drzewna (KZR) / nadleśnictwo (Deklaracja + leśnictwo z listy lub nowe), podstawa ręcznie zmienialna | DONE | U: „2.2 Dostawca…”, „2.2 Zakup z nadleśnictwa + produkcja…”; E: „2.2 Dostawca…”, „2.2 Nadleśnictwo…”, „2.2 Leśnictwo…”, „2.2 Nowe leśnictwo zapisane…” |
| 23 | Transport własny: liczba kursów, rubryka na kurs (pojazd, kierowca domyślny, km, stawka, ilość MP, waga rzeczywista), podsumowanie MP / t / koszt | DONE | U: „2.2 Kursy…” (3 testy); E: „2.2 Liczba kursów 4…”, „2.2 Podsumowanie kursów: 400 MP, 132 t…”, „2.2 Zapisane…” |
| 24 | Błąd: opisy wyliczeń powielały się („0 km × 5,00 zł/km · 0 km × …”) | DONE | E: „Poprawka: opis wyliczenia nie powiela się…” |

### Demo v2.3

| # | Wymaganie | Status | Dowód |
|---|---|---|---|
| 25 | Dostawca (firma) i nadleśnictwo — możliwość wpisania ręcznie; nowy kontrahent dopisywany do kartoteki | DONE | U: „2.3 Dostawca wpisany ręcznie…” (2 testy); E: „2.3 …” (9 kontroli) |

### Demo v2.4

| # | Wymaganie | Status | Dowód |
|---|---|---|---|
| 26 | Transport zewnętrzny: liczba kursów, rubryka na kurs (pojazd przewoźnika, kierowca, km, stawka domyślna, ilość MP, waga rzeczywista), podsumowanie MP / t / koszt | DONE | U: „2.4 Zewnętrzny…” (3 testy); E: „2.4 …” (5 kontroli) |

### Demo v2.5

| # | Wymaganie | Status | Dowód |
|---|---|---|---|
| 27 | Jedna produkcja: kursy flotą własną i firmą zewnętrzną razem (np. 3 + 2), wspólne podsumowanie | DONE | U: „2.5 Mieszany…” (3 testy); E: „2.5 …” (6 kontroli) |

### Demo v2.6

| # | Wymaganie | Status | Dowód |
|---|---|---|---|
| 28 | Kwit wywozowy usunięty z produkcji (przy kursach) — w każdym kursie: nr kwitu, m³, MP, tony; m³ × 4 = MP automatycznie; suma kursów ≤ produkcja | DONE | U: „2.6 Kwit…” (3 testy); E: „2.6 …” (8 kontroli) |

## 2. Znalezione problemy

| Problem | Status |
|---|---|
| 2.0: produkcja na magazyn przyjmowała zużycie zamiast ilości produkcji; pokazywała transport | poprawione |
| 2.0: zaokrąglanie ilości do 0,001 przed walidacją | poprawione (6 miejsc) |
| Raport: operacja łańcuchowa (zakup + sprzedaż) przypisywała sprzedaż dostawcy i wartość zakupu odbiorcy | poprawione + test |
| Historia: wiersz sprzedaży z operacji łańcuchowej pokazywał dostawcę | poprawione |
| Anulowanie: dokument anulowany wcześniej (rozchód + odwrócenie w tym samym dniu) dawał fałszywą blokadę | poprawione (operacje anulowane pomijane w osi czasu) + test |
| Przykłady GJ ze specyfikacji (6 613 / 23 265 GJ) liczone z masy zaokrąglonej — system: 6 611 / 23 262 GJ | do decyzji firmy |
| Masa drewna 0,952 t/m³ vs 1,32 t/m³ w v1 | do decyzji firmy |
| Czas audytu (rzeczywisty) vs data operacji (data demo) — filtr dziennika audytu działa po czasie rzeczywistym | ograniczenie demo |
| Film intro w Chrome/Edge z H.264 | NIEPOTWIERDZONE (środowisko testowe bez kodeka) |
| Instalator Windows jeszcze niekompilowany | NIEPOTWIERDZONE (brak Windows / Inno Setup) |

## 3. Na etap produkcyjny

| Temat | Uwagi |
|---|---|
| Baza PostgreSQL, księga append-only, transakcje z blokadą sald, numeracja w transakcji | `docs/RESINVEST_CHANGE_PLAN.md` → „Architektura Production v1” |
| Logowanie, uprawnienia po stronie serwera | DONE w 3.0.0 |
| Wiele magazynów na użytkownika | kolejna faza |
| Wycena magazynu (średnia ruchoma / FIFO), koszty rąbania i transportu w wartości zapasu | wymaga decyzji biznesowej |
| Korekta daty / magazynu dokumentu | obecnie: anulowanie + nowy dokument |
| Edycja kartotek produktów i kontrahentów | DONE w 3.0.0 |
| Archiwum wygenerowanych PDF z sumą kontrolną | w demo: numer + wpis audytu |
| Migracja danych 1.3.0 | bilans otwarcia + archiwum dokumentów |
