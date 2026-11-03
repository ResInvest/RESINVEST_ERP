# ResInvest ERP 3.11 (3.11.0)

*Program stworzony przez Roesner Mateusz dla ResInvest Commodities.*

> Wersja 3.7.0 to wersja startowa dla firmy: **czysta baza danych** (bez danych przykładowych), konto startowe
> administratora **`magazyn@resinvest.group`** z hasłem startowym **`Admin1234`** (zmiana wymagana przy pierwszym
> logowaniu), gotowa **rejestracja użytkowników** (e-mail firmowy, potwierdzenie adresu, zatwierdzenie przez
> administratora z rolą i magazynem) oraz nowy motyw **Szkło** — pastelowe tło, szklane karty, kolorowe ikony menu.
>
> Wersja 3.6.0 porządkuje **Zakup** (najpierw zakres: „+ Produkcja z automatycznym zużyciem” i „+ Sprzedaż bezpośrednia
> z lasu (bez magazynowania)”, potem grupa dostawcy), dzieli **Flotę** na **własną** i **zewnętrzną** (dwa pola wyboru,
> pojazdy firm zewnętrznych), dodaje **wysyłkę e-mailem** (PDF w załączniku) raportu miesiąca, kwitu produkcji dnia,
> planera, historii, dokumentów i raportów oraz nowy znak aplikacji **RiC** (ResInvest Commodities).
>
> Wersja 3.5.0 dodaje **Planer zakupów** (plan dnia [MP] wpisywany ręcznie, wykonanie, tony, ceny, transport i kursy
> liczone z zatwierdzonych dokumentów), **Powiadomienia** (skrzynka w programie i dzwonek w pasku górnym, zgody
> administratora, ustawienia użytkownika) oraz **Pocztę** — e-maile z powiadomieniami wysyłane przez serwer z kolejki
> z automatycznym ponawianiem i dziennikiem wysyłki. Wygląd, menu i mechanizmy operacji pozostają takie jak w 3.4.
>
> Wersja 3.4.0 dodaje **operacje dodatkowe** w produkcji (holowanie, pryzmy, ładowarka… — z kartoteką
> „Kartoteki → Dodatkowe operacje” i kafelkiem na pulpicie z wyborem miesiąca), **rębaki firm zewnętrznych**,
> **tonaż sprzedaży AUTO / RĘCZNY** ze źródłem na dokumencie, **ręczne numery PZ / WZ** z osobną datą dokumentu,
> **usuwanie dokumentu** (soft delete — z odwróceniem ruchów, dokument zostaje w historii) oraz **eksport XLSX i DOCX**.
>
> Wersja 3.3.0 przebudowała **przesunięcia międzymagazynowe (MM)**: dowolny wybór magazynu źródłowego i docelowego,
> tryb **dwuetapowy** (wysłanie → „W drodze” → **Przyjmij MM** z ilością faktyczną) przełączany w Administracji
> oraz **tonaż** automatyczny lub ręczny z kwitu wagowego. Szczegóły: [`docs/MM_PRZESUNIECIA.md`](docs/MM_PRZESUNIECIA.md).
>
> Wersja 3.2.0 wprowadziła **pełny system kont firmowych**: logowanie e-mailem `@resinvest.group` sprawdzanym
> po stronie serwera, dodawanie pracowników **zaproszeniem e-mail** (Resend), reset hasła linkiem, role
> ADMINISTRATOR / MANAGER / MAGAZYNIER / OBSERWATOR / AUDYTOR z edytowalnymi uprawnieniami, statusy kont,
> **izolację danych magazynów** i dziennik audytu z adresem IP. Instalator Windows: Inno Setup 7 (`installer\build-installer.ps1`).

System ERP do **obrotu i magazynowania biomasy drzewnej**: zakupy, produkcja zrębki, sprzedaż, przesunięcia MM,
transport (flota własna, przewoźnicy, kolej), inwentaryzacja z zamknięciem miesiąca, korekty i anulowania,
historia każdej zmiany, raporty dzienne / tygodniowe / miesięczne / roczne, druk i PDF.

Jeden interfejs — plik **`ResInvest_ERP.html`** — działa w dwóch trybach:

| Tryb | Dla kogo | Dane | Logowanie |
|---|---|---|---|
| **Serwer — FIRMOWY** (zalecany do pracy) | wiele stanowisk w sieci firmy, także telefon / tablet | baza **SQLite** na serwerze (transakcje, dziennik zmian z łańcuchem skrótów SHA-256, kopie codzienne) | konta na serwerze, hasła **scrypt**, sesja w ciasteczku HttpOnly, blokada po 5 próbach |
| **Lokalny — OFFLINE** | jedno stanowisko, szkolenie, pokaz | przeglądarka (`localStorage`), kopia JSON na żądanie | konta lokalne, hasła **PBKDF2-SHA256**, wylogowanie po bezczynności |

Program nie korzysta z bibliotek zewnętrznych pobieranych z sieci (CDN) — wszystko jest w pliku HTML
(dołączony dekoder kodów QR jsQR 1.4.0, licencja Apache-2.0: `app/vendor/jsQR.LICENSE`). Internet jest potrzebny tylko
serwerowi do wysyłki e-maili (Resend); bez poczty zaproszenia zapisują się jako pliki `.eml`.

## Nowe w 3.11.0
* **Nowy pojazd, kierowca, rębak i operator wprost z operacji** — jak przy firmach zewnętrznych: pole „wybierz z listy
  albo wpisz” (pozycje na stanie i wcześniej używane, także wycofane). Nowa pozycja trafia do kartoteki Floty **przy
  zatwierdzeniu, w tej samej zmianie co operacja** (wpis w historii „dodany przy operacji …”); ta sama nowa pozycja
  w kilku kursach — dopisana raz; numer rejestracyjny bez względu na spacje i wielkość liter („wgm 77001” = „WGM77001”);
  pozycja wycofana / w serwisie wybrana w operacji wraca do pracy (ostrzeżenie w podsumowaniu, wpis w historii).
  Działa także w korekcie. Sprawdzanie w silniku (serwer), nie tylko w formularzu.
* **Szablony operacji** — „Zapisz jako szablon” (np. „Las Rybnik → Zabrze, Scania, Kowalski”), pasek szablonów nad
  formularzem, użycie **jednym kliknięciem albo Alt+1…9**. Szablon: wspólny dla magazynu / wszystkich magazynów albo
  prywatny; zmienia i usuwa autor lub kierownik; każda zmiana w historii. Daty, numery, kwity i wagi wpisuje się zawsze.
* **„+1 kurs jak poprzedni” / „+1 jak ten”** — kolejny kurs z tym samym pojazdem, kierowcą, km, stawką i ilością,
  fokus od razu na numerze kwitu.
* **Obsługa samą klawiaturą** — Enter przechodzi do następnego pola (Shift+Enter — do poprzedniego), na ostatnim polu
  Enter otwiera podsumowanie; Ctrl+Enter zatwierdza z dowolnego miejsca. Przełącznik „Enter = następne pole”.
* **Kwity z wagi** — „Wczytaj kwity z wagi”: plik z programu wagowego (CSV / TXT / JSON, kilogramy → tony, brutto − tara),
  kod QR / kod kreskowy z **czytnika USB / Bluetooth** (działa jak klawiatura), **zdjęcie kodu QR** albo **aparat**
  (telefon). Numer kwitu, waga netto i nr rejestracyjny wpisują się do kursów (dopasowanie po numerze rejestracyjnym,
  potem kolejno), brakujące kursy są dopisywane; ostrzeżenie, gdy kwit był już użyty w innej operacji.
  Format kodu QR: `KWIT=7096;NETTO=7780;REJ=SGL 4T821` (także JSON). Przykładowy plik z wagi: `data/kwity_waga_przyklad.csv`. Pole „Nr kwitu wagowego” jest teraz w każdym kursie.
* **Szybki kurs (telefon)** — menu „Szybki kurs”: kierowca przy załadunku wybiera wzorzec (szablon albo poprzednia
  operacja), auto, kwit (skan), waga (wyświetlacz LED) → **Zapisz kurs**. Waga z kwitu = tonaż dokumentu. Po zapisie
  formularz czeka na kolejny kurs tego samego auta.
* **Motyw „Stacja wagowa”** — klasyczny przemysłowy: granatowe belki tytułowe, stalowa szarość, podświetlenie
  aktywnego pola, czerwony wyświetlacz LED (kontrast WCAG sprawdzony).
* **Intro na telefonie** — film pokazany w całości (bez rozciągania i obcinania kadru) na ekranach pionowych,
  małych i bardzo szerokich.
* **Poczta Microsoft 365** — gotowy wzór `server.env` (smtp.office365.com:587, STARTTLS, skrzynka
  magazyn@resinvest.group, hasło do uzupełnienia na serwerze); test: `riw-server.mjs --mail-test <adres>`.
* Testy: jednostkowe 188, serwer 68, przeglądarka 363 (standard i Premium), serwer w przeglądarce 32, intro 15,
  test obciążenia 40 stanowisk — zaliczony.

## Nowe w 3.10.1
* **Zwijany panel boczny** — przycisk w nagłówku menu albo **Ctrl+B**: same ikony (więcej miejsca na tabele),
  nazwa zakładki w podpowiedzi, liczniki zostają; ustawienie zapamiętywane w tej przeglądarce.
* **Pojazd bez kierowcy domyślnego** — w polu „Kierowca domyślny” opcja **„—”**. Auto zapisuje się bez kierowcy,
  a kierowcę wybiera się w każdym kursie (program tego pilnuje).
* **Szybki wpis operacji:**
  * **„Powtórz ostatnią”** (Nowa operacja) i **„Powtórz”** (szczegóły dowolnej operacji) — kopia na dziś: te same
    strony, produkty, ilości, ceny, pojazdy, km i stawki; bez numerów dokumentów (numeracja automatyczna), kwitów,
    wag rzeczywistych i uwag. Kolejne auto z tego samego lasu = numer kwitu + Ctrl+Enter.
  * wybór auta w kursie podpowiada kierowcę domyślnego oraz **km i stawkę z ostatniego kursu tego auta**;
  * **Ctrl+Enter** (i Ctrl+S) — zatwierdzenie z podsumowaniem; m³ z kwitu × 4 = MP na aucie liczone od razu.

## Edycja Premium (od 3.10.0)
Druga odmiana programu w jednym pliku — **`ResInvest_ERP_Premium.html`** (`npm run build:premium`). Silnik, dane,
logowanie i kopie są te same co w edycji standardowej (oba pliki działają na tych samych danych w przeglądarce).
Różnice:
* **Intro** — film ResInvest Commodities „clean energy straight from nature” (10 s, z dźwiękiem; `app/assets/premium/intro.mp4`).
* **Ekran startowy** — zdjęcie produkcji i logistyki biomasy, hasło „Produkcja i logistyka biomasy”, panel logowania
  z logo, polami E-mail / Hasło, „Zapamiętaj mnie” (zapamiętuje tylko adres e-mail, nigdy hasła), „Nie pamiętasz hasła?”,
  przyciskiem „Zaloguj się do systemu”, rejestracją (gdy administrator ją włączył) i stopką praw autorskich.
  Informacje o trybie pracy pokazują stan rzeczywisty (OFFLINE / serwer firmowy / HTTPS).
* **Motyw „Złota biomasa”** (granat i złoto, kość słoniowa, nagłówki szeryfowe, granatowe menu ze złotym zaznaczeniem) —
  domyślny w edycji Premium, dostępny też w edycji standardowej (Mój profil → Motyw, Ctrl+D).

## Nowe w 3.10.0
* **Zapis przyrostowy bazy** — każdy rekord (operacja, wpis księgi, dziennika, powiadomienie, plan, wersja robocza,
  inwentaryzacja) w osobnym wierszu z własną sumą kontrolną SHA-256; komenda zapisuje tylko to, co zmieniła,
  jedną transakcją z wpisem dziennika. Czas zapisu nie rośnie z historią (baza 2 lata pracy: ok. 35 ms zamiast 1,7 s).
  Baza z poprzedniej wersji jest przenoszona automatycznie przy pierwszym starcie (wcześniej kopia „przed-aktualizacja”).
* **Synchronizacja przeglądarek samymi zmianami** — po zmianie innego użytkownika i po własnej komendzie przeglądarka
  pobiera tylko nowe / zmienione rekordy (kilkadziesiąt kB zamiast kilku MB); pełny stan tylko przy otwarciu strony,
  po zmianie kont / uprawnień albo gdy zmian nie da się nałożyć. Izolacja magazynów bez zmian (widok liczony na serwerze).
* **Test obciążeniowy** w trybie przeglądarki (pełny stan + zmiany) z kontrolą, że stan każdego stanowiska jest
  identyczny z widokiem serwera. Wyniki: [progress.md](progress.md).

## Nowe w 3.9.1
* **Poczta firmowa przez SMTP** — dowolny serwer poczty firmy (Microsoft 365, Google Workspace, home.pl, OVH, własny):
  SSL (port 465) albo STARTTLS (port 587), logowanie AUTH PLAIN / LOGIN, weryfikacja certyfikatu, TLS 1.2+.
  Hasło nigdy nie idzie bez szyfrowania. Konfiguracja w `server.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
  `SMTP_USER`, `SMTP_PASS`), szczegóły i tabela dostawców: [docs/EMAIL_SETUP.md](docs/EMAIL_SETUP.md) punkt 3a.
  IMAP nie jest potrzebny — program tylko wysyła wiadomości.
* **Bezpieczne aktualizacje** ([docs/AKTUALIZACJE.md](docs/AKTUALIZACJE.md)): instalator nowej wersji zatrzymuje
  serwer i robi kopię bazy przed podmianą plików, blokuje instalację starszej wersji na nowszej bazie; serwer przy
  pierwszym starcie nowej wersji robi drugą kopię „przed-aktualizacja-<wersja>” i dopiero potem migruje dane.
* **Test obciążeniowy** (`node tools/loadtest.mjs`) — wiele stanowisk jednocześnie, fala równoczesnych zapisów,
  kontrola spójności i dziennika; widok stanu zapamiętywany dla każdej rewizji (mniej obliczeń przy wielu użytkownikach).

## Nowe w 3.9.0
* **Zabudowa i pojemność pojazdu** (Flota → Dodaj / Edytuj pojazd, własny i firmy zewnętrznej): naczepa z ruchomą
  podłogą, solówka z kontenerem albo **hakowiec — zestaw kontenerów** (kontener na samochodzie + na przyczepie).
  Dla każdej przestrzeni wpisujesz długość, szerokość i wysokość w metrach; **pojemność maksymalna = długość ×
  szerokość × wysokość** (m³ = MP), dla zestawu — suma kontenerów. Pojemność liczy się na żywo w formularzu
  i widać ją w tabeli pojazdów.
* **Zapełnienie każdego kursu** = MP w kursie ÷ pojemność pojazdu (kursy floty własnej po pojeździe, kursy
  zewnętrzne po numerze rejestracyjnym z floty zewnętrznej). Kolumna „Zapełnienie” w podsumowaniu kursów i na
  karcie transportu (PDF), średnia operacji; ładunek ponad pojemność daje ostrzeżenie przed zatwierdzeniem.
* **Raporty floty i rębaków** (Flota → „Raporty floty i rębaków”), okres **dzień / tydzień / miesiąc**:
  pojazdy (kursy, MP, tony, km, średnie i maksymalne zapełnienie, koszt), kursy i zapełnienie każdego kursu,
  kierowcy (kursy, dni pracy, MP, tony, km), **rębaki** i **operatorzy rębaków** (ile zrąbali MP, m³ drewna, tony,
  dni pracy, średnio MP / dzień, koszt rąbania) oraz lista produkcji. Eksport CSV, XLSX i PDF.

## Nowe w 3.8.1
* **Ewidencja obrotu w CSV** — kolumny według zestawienia firmy: data załadunku do klienta końcowego, miejsce
  załadunku, data operacji, dostawca, Zakup/Sprzedaż, Nr. WZ, czy magazynowane, Deklaracja/KZR, volumen i jednostka,
  ceny zakupu/produkcji i sprzedaży, wartość, produkt, rodzaj zrębki a/b, rąbanie własne/wynajęte i jego koszt,
  transport (firma, nr rejestracyjny, km, koszt), odbiorca, uwagi, miejsce pochodzenia, data dodania wpisu,
  Wolumen_MP/t/GJ, Ruch_magazyn_MP/t, wartości *_calc, typ transportu, koszt rąbania, miesiąc i rok —
  **plus dane z planera zakupów** (plan dnia, plan i wykonanie miesiąca, realizacja %, udział transakcji w planie).
  Jeden wiersz = jeden ruch towaru w transakcji WZ. Pobierasz go przyciskiem **CSV** w Operacjach i w rejestrach
  dokumentów, **CSV ewidencji** w Raportach i w Planerze. Opis każdej kolumny: [`docs/EWIDENCJA_CSV.md`](docs/EWIDENCJA_CSV.md).

## Nowe w 3.8.0
* **Kilka firm transportu zewnętrznego w jednej operacji.** Po zaznaczeniu „Transport zewnętrzny” pojawia się lista
  **„Liczba firm przewidzianych do transportu”** (1–10) z samouczkiem „Wpisz ilość firm zewnętrznych, którym zlecono
  transport.” Przy jednej firmie — jak dotąd, jedno pole „Firma transportowa” dla wszystkich kursów. Przy kilku firmach
  pod każdym numerem kursu jest pole **„Firma transportowa”**: wybór z listy (firmy z tej operacji, kartoteka
  przewoźników, właściciele pojazdów floty zewnętrznej) albo wpisanie nowej nazwy. Nowa firma dopisuje się do listy
  przewoźników przy zatwierdzeniu. Numer rejestracyjny z floty zewnętrznej podpowiada firmę kursu.
  Silnik kontroluje: firma w każdym kursie, liczba firm w kursach nie większa niż zadeklarowana (mniejsza —
  ostrzeżenie). Podsumowanie kursów, karta transportu (PDF) i raport transportu pokazują koszt, km i ilość per firma.
  Operacje zapisane wcześniej (jedna firma) działają bez zmian.
* **„Data przyjęcia”** zamiast „Data operacji” w zakupie, produkcji i MM — samouczek: „Wprowadź datę przyjęcia
  produktu na magazyn.” (W sprzedaży pole nadal nazywa się „Data operacji”.)
* **Jedna seria numeracji WZ.** „Numeracja PZ” → **„Numeracja WZ”**. Wszystkie dokumenty magazynowe — zakup, sprzedaż,
  produkcja (RW / PW), MM, transport, korekty, anulowania, inwentaryzacja, bilans otwarcia — są numerowane w jednej
  serii **WZ/NNN/MM/RRRR**. Jedna transakcja = jeden numer WZ, wspólny dla wszystkich jej dokumentów; rodzaj ruchu
  (przychód / rozchód) zostaje tylko jako opis pomocniczy i w danych do stanów i raportów. Numer ręczny jest unikalny
  w magazynie i roku (także wobec numerów korekt, anulowań, inwentaryzacji). **Numery nadane wcześniej nie zmieniają
  się.** Administracja → Konfiguracja dostępu → „Numeracja dokumentów magazynowych” pozwala wrócić do osobnych serii
  (PZ, WZ, RW, PW, MM…) — zmiana zapisuje się w audycie.
* Poprawka: na telefonie formularz z transportem zewnętrznym nie przewija się już w bok (tabela kursów przewija się
  we własnym polu).

## Nowe w 3.7.3
* **AgentMail** jako kanał wysyłki poczty (obok Resend, SMTP i plików .eml): `AGENTMAIL_API_KEY` i `AGENTMAIL_INBOX`
  w `server.env` — wszystkie wiadomości programu, także dokumenty z PDF. Konfiguracja:
  [`docs/EMAIL_SETUP.md`](docs/EMAIL_SETUP.md) (punkt 4a).

## Nowe w 3.7.2
* **Konto testowe administratora** (tryb OFFLINE, okres testów): **`test@resinvest.group`**, hasło **`Test1234`** —
  przycisk „Konto testowe administratora” na ekranie logowania wpisuje dane. Logowanie działa niezależnie od danych
  zapisanych wcześniej w przeglądarce: gdy e-mail i hasło zgadzają się z konfiguracją (`config/app.config.json` →
  `startup.testAdmin`), program odtwarza konto (rola administrator, aktywne, odblokowane) i zapisuje to w audycie
  (`CONFIG_ACCOUNT_RESTORED`). Przed wdrożeniem usuń `startup.testAdmin` z konfiguracji i zbuduj program ponownie.
* `magazyn@resinvest.group` / `Admin1234` działa tak samo (dopóki administrator nie ustawi własnego hasła).
* Spacje na początku i końcu hasła (dopisywane przez klawiatury telefonów) są pomijane przy logowaniu, rejestracji
  i zmianie hasła.

## Nowe w 3.7.1
* **Nowy film startowy** (las, rębak i samochód ResInvest Commodities; 1280×720, 10 s, z dźwiękiem). Muzyka jest
  **włączona przy każdym starcie** — „Wycisz” dotyczy tylko bieżącego odtworzenia. Gdy przeglądarka blokuje automatyczny
  dźwięk (pliki otwierane bezpośrednio w Chrome / Edge), film gra i dźwięk włącza się przy pierwszym kliknięciu lub klawiszu;
  skrót „ResInvest ERP — otwórz” z instalatora uruchamia program z dźwiękiem od razu.
* **Poprawka logowania** `magazyn@resinvest.group` / `Admin1234`: dane demonstracyjne zapisane w przeglądarce przez
  wcześniejsze wersje (także przez otwartą jeszcze starą kartę programu) są przy każdym starcie przenoszone do kopii,
  a konto administratora z hasłem demonstracyjnym dostaje hasło startowe z konfiguracji. Dane przykładowe wczytane
  świadomie w Administracji nie są ruszane.

## Nowe w 3.7.0

### Czysta baza i konto startowe administratora
* Pierwsze uruchomienie (OFFLINE i serwer) tworzy **pustą bazę**: konto administratora, magazyny RiC Zabrze, RiC Brąszewice,
  RiC Rokitki, katalog produktów i rodzaje operacji dodatkowych. Bez operacji, kontrahentów, floty i kont demonstracyjnych.
* Administrator: **`magazyn@resinvest.group`**, hasło startowe **`Admin1234`** — przy pierwszym logowaniu program wymusza
  ustawienie własnego hasła. Hasło startowe nie jest zapisane w kodzie programu, tylko w konfiguracji instalacji:
  `config/app.config.json` → `startup` (tryb OFFLINE, wbudowywane do `ResInvest_ERP.html`) i
  `config/server.config.json` → `initialAdmin` (serwer). Konto powstaje **tylko raz** — przy pustej bazie; zmiana
  konfiguracji nie nadpisuje istniejącego hasła.
* Dane demonstracyjne z poprzednich wersji zapisane w przeglądarce są jednorazowo usuwane (kopia zostaje pod kluczem
  `riw.v3.state.demo-przed-3.7`); dane firmy nie są ruszane. Dane przykładowe do nauki: *Administracja → Przywróć dane
  przykładowe* albo plik `data/sample_data.json` (*Wczytaj kopię*); serwer — pole „dane przykładowe” na ekranie pierwszej
  konfiguracji (gdy `initialAdmin` jest pusty).

### Rejestracja użytkowników
* Zakładka **Rejestracja** na ekranie logowania (włączona w nowej bazie; wyłącza się w *Administracja → Konfiguracja*).
* Wymagany adres w domenie firmy (`@resinvest.group`) — sprawdzany **po stronie serwera**; hasło wg polityki (min. 8 znaków,
  litery i cyfry); ten sam adres nie zarejestruje się dwa razy; limit prób (3 na godzinę na adres, limit na adres IP).
* Osoba rejestrująca **nie wybiera roli ani magazynu** — dane przesłane z przeglądarki (np. `role`, `status`, `whId`) są
  ignorowane; konto czeka ze statusem „zaproszony”.
* Tryb FIRMOWY: **potwierdzenie adresu** linkiem z e-maila (ważny 48 h, jednorazowy). Dopiero po potwierdzeniu
  administratorzy dostają **powiadomienie** (w programie i e-mailem), a zgłoszenie można zatwierdzić; przycisk
  „Wyślij link ponownie”. Tryb OFFLINE: powiadomienie administratora od razu.
* Zatwierdzenie: *Użytkownicy → Zgłoszenia rejestracji → Nadaj rolę i aktywuj* (rola, magazyn domyślny, dostęp do magazynów);
  użytkownik dostaje e-mail „Konto zatwierdzone”. Odrzucenie usuwa zgłoszenie (konto bez historii). Każdy krok w audycie:
  `USER_REGISTERED`, `EMAIL_CONFIRMATION_SENT`, `EMAIL_CONFIRMED`, zmiana statusu i roli, `REGISTRATION_APPROVED_SENT`.

### Motyw „Szkło”
* Szósty motyw (Mój profil → Wygląd, Ctrl+D): pastelowe tło z miękkimi plamami koloru, półprzezroczyste karty z rozmyciem,
  pływający panel menu z kolorowymi kafelkami ikon, duże zaokrąglenia, zielone przyciski w kształcie pigułki, ciemny pas
  powitalny. Kontrast tekstu spełnia WCAG 2.1 (`npm run themes`); przeglądarki bez rozmycia dostają pełne białe karty.

### Repozytorium
* Gałąź zawiera wyłącznie ResInvest ERP (3.x i 4.0) — usunięto obce pliki bazowe repozytorium.

### Testy 3.7
* `reg37.test.mjs` (3, serwer: konto startowe z konfiguracji, rejestracja z potwierdzeniem adresu, zatwierdzenie,
  e-mail o zatwierdzeniu, limit prób), E2E 307/307 (w tym 22 scenariusze 3.7: czysta baza, rejestracja, zatwierdzenie,
  motyw Szkło), E2E serwera 29/29; tłumaczenia CS / EN: 0 braków.

## Nowe w 3.6.0

### Zakup — zakres przed wyborem dostawcy
* W sekcji **Zakup** jako pierwsze są dwie opcje (obie dostępne od razu):
  **+ Produkcja z automatycznym zużyciem** (RW drewna + PW zrębki w tej samej operacji) oraz
  **+ Sprzedaż bezpośrednia z lasu (bez magazynowania)** (las → produkcja → odbiorca; włącza produkcję).
  Dopiero niżej wybiera się grupę dostawcy: **firma branży drzewnej / zewnętrzna** albo **nadleśnictwo (Lasy Państwowe)**.
* Zaznaczenie produkcji lub sprzedaży bezpośredniej ustawia produkt zakupu na drewno (lista produktów pokazuje wtedy tylko drewno).
* Księgowanie sprzedaży bezpośredniej z lasu: **PZ → RW → PW → WZ**, gdzie PW i WZ są oznaczone jako bezpośrednie —
  stan drewna i zrębki w magazynie się nie zmienia; raporty liczą przychód jako „sprzedaż bezpośrednia”, historia pokazuje
  typ „Sprzedaż bezpośrednia”. Ostrzeżenia: niepełne zużycie drewna lub niepełna sprzedaż produkcji (reszta trafia na stan).
* Operacje sprzed 3.6 („+ Sprzedaż wyniku produkcji” przez magazyn) działają i korygują się bez zmian.
  Korekta nie zmienia rodzaju sprzedaży (bezpośrednia ↔ przez magazyn) — w takim wypadku anuluj i wprowadź nową operację.

### Flota własna i zewnętrzna (menu **Kartoteki → Flota**)
* Dwa pola wyboru: **Flota własna** (samochody, kierowcy, rębaki, operatorzy) i **Flota zewnętrzna** (samochody i rębaki
  firm zewnętrznych). Zakładki pokazują się według zaznaczenia.
* Pojazd ma właściciela: **własny** (kierowca domyślny z kartoteki) albo **firma zewnętrzna** (firma, kierowca opisowo).
  Istniejące pojazdy bez tego pola są traktowane jako własne — bez migracji danych.
* „Nowa operacja”: transport własny pokazuje tylko flotę własną (pojazd zewnętrzny jest odrzucany po stronie silnika);
  w kursach transportu zewnętrznego numer rejestracyjny podpowiada się z floty zewnętrznej, a wybór numeru z kartoteki
  uzupełnia kierowcę i firmę przewozową (wpisanych ręcznie nie nadpisuje).

### Wysyłka e-mailem (PDF w załączniku)
* Przycisk **Wyślij e-mailem** obok „Generuj PDF”: Raporty (raport miesiąca), Kwit produkcji dnia, Planer zakupów,
  Historia, podgląd dokumentu oraz rejestry Dokumenty / Przyjęcia / Wydania / MM (zestawienie wg filtrów).
  Dostępny dla uprawnienia `reports.export`. Okno: adresy (do 10), temat, treść, informacja o załączniku.
* **FIRMOWY**: PDF trafia do serwera (`POST /api/mail-document`), który **sprawdza** uprawnienie, adresy, temat, rozmiar
  (maks. 8 MB) i nagłówek pliku PDF, opcjonalnie domeny odbiorców (`mail.documentDomains` w `server.config.json`),
  limit **40 wiadomości na godzinę** na użytkownika; wiadomość idzie przez kolejkę poczty z ponowieniami, odpowiedź trafia
  do nadawcy (Reply-To), wpis **MAIL_DOCUMENT** w audycie. Po wysłaniu treść i załącznik są usuwane z kolejki.
* **OFFLINE**: brak serwera poczty — program zapisuje PDF i otwiera program pocztowy z adresami, tematem i treścią;
  plik dołącza się ręcznie (komunikat w oknie mówi to wprost).

### Znak RiC
* Znak aplikacji **RiC** (ResInvest Commodities): menu, logowanie, intro, nagłówek PDF i wydruku, ikona karty
  przeglądarki (SVG) i ekranu głównego telefonu (PNG), ikona instalatora i skrótów Windows (`ric.ico`).
  Ikony generuje `tools/make-icons.mjs` z `app/assets/icons/ric.svg`.

### Dane i testy
* Schemat danych bez zmian (9). Tłumaczenia CS / EN: 2401 tekstów, 0 braków, 0 nieużywanych.
* Testy: `features36.test.mjs` (9), `mail36.test.mjs` (5, serwer: załącznik w .eml i w API Resend, walidacja, domeny,
  limit), E2E 291/291 (w tym 36 scenariuszy 3.6), E2E serwera 29/29 (wysyłka raportu z okna programu).
* Poprawka: na telefonie karty raportów nie poszerzają już strony (siatka `minmax(0,1fr)`).

## Nowe w 3.5.0

### Planer zakupów (menu **Praca → Planer zakupów**)
* **Ręcznie wpisuje się tylko plan dnia [MP]** (magazyn × dzień): pole w tabeli tygodnia, zapis po wyjściu z pola
  lub Enter (Enter przechodzi do następnego dnia). Plan wpisuje Kierownik lub Administrator (uprawnienie
  `planner.edit`); każda zmiana trafia do dziennika audytu jako **PLAN_UPDATED** z wartością było / jest.
  Ochrona przed nadpisaniem: jeśli w międzyczasie plan zmienił ktoś inny, zapis jest odrzucany z komunikatem.
* **Wszystko inne liczy się automatycznie** z zatwierdzonych operacji (wartości tylko do odczytu — błąd poprawia się
  korektą dokumentu, więc planer zawsze zgadza się ze stanami i raportami):

  | Pole | Źródło | Reguła |
  |---|---|---|
  | Wykonanie [MP] | zakup z produkcją (PW), produkcja w lesie (sprzedaż bezpośrednia), zakup zrębki (PZ) | bez anulowanych i usuniętych |
  | Tony [t] | kursy transportu | waga zważonych kursów + niezważona reszta × przelicznik MP → t (`mp_t`, domyślnie 0,33) |
  | Cena [zł/MP] | operacja | (wartość zakupu + koszt surowca) ÷ wykonanie |
  | Miejsce | produkcja / transport | nadleśnictwo i leśnictwo, miejsce wycinki albo miejsce dostawy |
  | Km, transport, kursy | karta transportu (TR) | sumy kursów własnych i zewnętrznych |
  | Realizacja | wyliczana | wykonanie ÷ plan **do dziś** (przyszłe dni nie zaniżają wyniku) |

* Widoki: **Tydzień** (wskaźniki, tabela dni, dokumenty źródłowe dnia), **Miesiące i rok** (wykres plan / wykonanie,
  tabela 12 miesięcy), **Kierowcy i kursy** (kierowca × dzień, lista kursów), **Skąd są dane**. Zakres: jeden magazyn
  albo „Wszystkie magazyny” (suma, bez edycji). Eksport **CSV, XLSX, PDF**.

### Powiadomienia (menu **System → Powiadomienia** i dzwonek w pasku górnym)
* Zdarzenia: przyjęcie / zakup (PZ), wydanie / sprzedaż (WZ), produkcja (PW), przesunięcie MM (wysłanie i przyjęcie),
  operacje dodatkowe, do zatwierdzenia, decyzja o mojej operacji, korekta (BYŁO → JEST), anulowanie, usunięcie.
* Odbiorca: konto aktywne, dostęp do magazynu operacji (przy MM — źródło lub cel), zdarzenie **dozwolone przez
  administratora** (zakładka „Zgody użytkowników”) i **włączone przez użytkownika** („Moje ustawienia”). Autor nie
  dostaje powiadomienia o własnej zmianie. Zmiany zgód i ustawień — w dzienniku audytu.
* Powiadomienie powstaje **w tej samej zmianie danych co operacja** (zapis „wszystko albo nic”) i trafia do skrzynki
  w programie w obu trybach pracy. Kliknięcie otwiera operację i oznacza powiadomienie jako przeczytane.

### Poczta (menu **System → Poczta**, administrator — uprawnienie `notifications.manage`)
* Tryb FIRMOWY: e-mail z powiadomieniem (temat, magazyn, dokumenty, pozycja, kwoty, autor, przycisk
  „Otwórz w ResInvest ERP”) trafia do **kolejki w bazie** i jest wysyłany w tle (Resend / SMTP / pliki `.eml`).
  Błąd poczty **nie cofa operacji**: wiadomość dostaje status „nieudana” i kolejne próby po 1 min, 5 min, 15 min, 1 h,
  6 h, potem „porzucona”. Ekran pokazuje kanał wysyłki, liczniki, dziennik z błędami i terminem następnej próby,
  przyciski **Ponów**, **Wyślij test do mnie**, **Wyślij kolejkę teraz**. Treść wysłanej wiadomości jest usuwana z bazy.
* Tryb OFFLINE: e-maile nie są wysyłane — ekran pokazuje powiadomienia przygotowane w programie.

### Dane i zgodność
* Schemat danych **9** (migracja automatyczna z 8: plany, skrzynka powiadomień, ustawienia kont; rola z edycją kartotek
  dostaje `planner.edit`). Tabela `outbox` serwera rozszerzona o kolumny kolejki — istniejące dane bez zmian.
* Tłumaczenia CS / EN: 2344 teksty, 0 braków. Testy: `features35.test.mjs` (13), `mail35.test.mjs` (4, serwer z atrapą
  awarii poczty), E2E 255/255 (w tym 21 scenariuszy 3.5, telefon 390 px bez poziomego przewijania).

## Nowe w 3.4.1

* **Operacje dodatkowe w każdej operacji** — zakup (PZ), sprzedaż z magazynu i bezpośrednia (WZ), produkcja, MM.
  W zestawieniu i na kaflu pulpitu kolumna „Dokument” wskazuje dokument główny operacji (PZ / WZ / MM / PW).
* **Numeracja z listy rozwijanej** przy PZ, WZ i **MM**: „Automatycznie — PZ/004/09/2026” (domyślnie) albo
  „Ręcznie — wpisz numer”. Numer ręczny jest unikalny dla typu + magazynu + roku (dla MM: magazynu źródłowego).
* **Rejestry dokumentów — tylko PZ, WZ i MM** (jak dawniej), w mocnych kolorach: PZ zielony, WZ pomarańczowy,
  MM niebieski (pełne tło, kolorowy numer i pasek wiersza). Dokumenty pomocnicze (PW, RW, TR, KOR, AN, IN, BO)
  po zaznaczeniu „Pokaż dokumenty pomocnicze” — szare, neutralne.

## Nowe w 3.4

* **Operacje dodatkowe (produkcja):** pole wyboru **„Dodaj operację dodatkową”** w produkcji na magazynie, w zakupie z
  produkcją i w produkcji ze sprzedażą bezpośrednią. Każda pozycja: rodzaj z kartoteki, opcjonalnie pojazd z Floty,
  ilość × stawka albo kwota, opis. Pozycje są **osobnymi rekordami** powiązanymi z operacją (`extras[].opId`);
  koszt obniża wynik operacji, stan magazynu się nie zmienia. Korekta pokazuje zmianę BYŁO / JEST.
* **Kartoteki → Dodatkowe operacje:** rodzaje zapisane w bazie (ID, nazwa, opis, aktywna, jednostka, stawka domyślna,
  data utworzenia i zmiany). Rodzaju użytego w dokumentach nie można usunąć — tylko dezaktywować.
* **Pulpit — kafel OPERACJE DODATKOWE:** wybór miesiąca, koszt łączny, liczba, lista (data, rodzaj, pojazd, magazyn,
  dokument / produkcja, koszt); kliknięcie wiersza otwiera operację. Te same liczby w raporcie miesięcznym (sekcja
  „Operacje dodatkowe”) i w kosztach pulpitu.
* **Rębaki firm zewnętrznych:** we Flocie rębak ma właściciela (własny / firma zewnętrzna), firmę, nr rejestracyjny,
  operatora opisowo i informacje dodatkowe. W produkcji lista rębaków ma dwie grupy; dla rębaka zewnętrznego
  operator jest polem tekstowym.
* **Sprzedaż — tonaż AUTO / RĘCZNY:** AUTO z przelicznika produktu, RĘCZNY z wagi rzeczywistej (nigdy nie nadpisywany
  automatycznie). Na formularzu, WZ, PDF i w rejestrze: np. **„60 MP | 20,35 t | RĘCZNY”**.
* **Ręczne numery PZ / WZ:** pole numeru z podpowiedzią kolejnego numeru; numer unikalny dla typu + magazynu + roku
  (bez względu na wielkość liter i spacje). Osobno: **data dokumentu**, **data przyjęcia / wydania** (data operacji)
  i **data i godzina utworzenia** (system).
* **Usuwanie dokumentu („Usuń”):** soft delete z obowiązkowym powodem — ruchy odwracane dokumentem AN, dokument
  znika z rejestrów (filtr „Pokaż usunięte”), ale zostaje w historii i dzienniku audytu. Zablokowane, gdy towar z
  dokumentu został już wydany/zużyty lub MM przyjęto. Uprawnienie `documents.delete` (Kierownik, Administrator).
* **Rejestry dokumentów:** akcje **Otwórz / Podgląd / Koryguj / Usuń** (kolumna przypięta do prawej krawędzi).
* **Eksport XLSX i DOCX:** rejestry, operacje, raporty i podgląd dokumentu — pliki Office tworzone w programie
  (bez bibliotek zewnętrznych), liczby w XLSX zapisane jako liczby.
* **Schemat danych 8:** migracja 7 → 8 automatyczna przy pierwszym uruchomieniu (kartoteka operacji dodatkowych,
  właściciel rębaków, uprawnienie `documents.delete`). Dane nie są kasowane.

## Nowe w 3.3

* **MM — wybór magazynu źródłowego:** pole „Magazyn źródłowy” jest aktywne i zawiera magazyny, do których użytkownik
  ma dostęp (lista z danych programu). Magazyn docelowy — dowolny aktywny magazyn firmy. Wybranie tego samego
  magazynu w obu polach zwraca błąd „Magazyn źródłowy i docelowy nie mogą być takie same”. Dostęp do magazynu
  źródłowego sprawdza **serwer** — pole `fromWhId` z przeglądarki nie daje uprawnień.
* **MM dwuetapowe (domyślnie):** zatwierdzenie = **wysłanie** — towar schodzi ze stanu źródła w tej samej transakcji,
  dokument ma status **W DRODZE**. Stan magazynu docelowego rośnie dopiero, gdy użytkownik tego magazynu kliknie
  **Przyjmij MM** i wpisze **ilość faktycznie przyjętą** (dowolna dozwolona jednostka), datę i tonaż. Różnica
  (ubytek / nadwyżka) wymaga przyczyny i trafia do dokumentu, audytu i raportu MM (wysłano / przyjęto / różnica).
  Nowe uprawnienie **`mm.receive`** (Kierownik, Magazynier). Lista „Przesunięcia w drodze” w module MM, alerty
  na pulpicie („MM do przyjęcia”, „MM wysłane — w drodze”).
* **Przełącznik w Administracji** (*Konfiguracja dostępu → Przesunięcia międzymagazynowe*): tryb jednoetapowy
  (rozchód i przychód jednym zatwierdzeniem) albo dwuetapowy. Zmiana dotyczy nowych dokumentów.
* **Tonaż MM:** automatyczny z przelicznika produktu albo ręczny (kwit wagowy) — przy wysłaniu i przy przyjęciu;
  tonaż nie zmienia ilości na stanie, ostrzeżenie przy rozbieżności > 25%.
* Anulowanie MM w drodze przywraca stan źródła (przyjęcie zablokowane); po przyjęciu — cofa oba magazyny.
  Korekta MM zmienia ilość wysłaną (przyjęcie zostaje, różnica jest przeliczana); magazynów i towaru korektą się nie zmienia.
* Schemat danych **7** (migracja 6 → 7 automatyczna: tryb MM, uprawnienie `mm.receive` dla ról z `mm.create`).

## Nowe w 3.2

* **Logowanie e-mailem służbowym** — domena sprawdzana **na serwerze** (`validateCompanyEmail`: dokładnie `@resinvest.group`,
  bez subdomen i podobnych domen), komunikaty bez szczegółów technicznych („Nieprawidłowy e-mail lub hasło.”,
  „Twoje konto jest nieaktywne.”, „Twoje konto nie zostało jeszcze aktywowane.”).
* **Tylko zaproszenia** — *Użytkownicy → Dodaj użytkownika*: imię, nazwisko, e-mail, rola, magazyn domyślny,
  dostępne magazyny → **Wyślij zaproszenie**; pracownik klika link, ustawia hasło, konto staje się aktywne.
  Samodzielna rejestracja domyślnie wyłączona (można ją włączyć w *Administracji*).
* **Nie pamiętam hasła** — link resetu (1 h, jednorazowy), zawsze ta sama odpowiedź; zmiana adresu e-mail wymaga
  potwierdzenia linkiem; powiadomienia „hasło zmienione” i „konto dezaktywowane”. Szablony PL z marką ResInvest ERP.
* **Poczta Resend** (API lub SMTP) konfigurowana w `server.env` (wzór `.env.example`) — klucz tylko na serwerze.
* **Role** ADMINISTRATOR · MANAGER (Kierownik) · MAGAZYNIER · OBSERWATOR · **AUDYTOR** (nowa: odczyt wszystkich
  magazynów i audytu) i **edytor uprawnień ról** (`#/admin/roles`); statusy kont **INVITED / ACTIVE / SUSPENDED / DISABLED**.
* **Wiele magazynów na osobę** (magazyn domyślny + dostępne) i **izolacja danych**: serwer wysyła przeglądarce
  tylko dane dostępnych magazynów; korekty, anulowania i zatwierdzenia tylko w dostępnych magazynach.
* **Dziennik audytu** (`#/admin/audit`): kody zdarzeń (USER_INVITED, ROLE_CHANGED, WAREHOUSE_ACCESS_CHANGED,
  PASSWORD_RESET_REQUESTED…), adres IP i przeglądarka, dziennik logowań, dziennik wysyłek e-mail, CSV.
* **Obieg zatwierdzania wyłączony domyślnie** — magazynier zatwierdza operację sam; włączenie w *Administracji*.
* **Zakup: jednostka ilości i jednostka ceny osobno** — np. drewno kupowane w **m³** (ilość z kwitu), cena **za MP**
  (koszt = 10 m³ = 40 MP × cena/MP). Zmiana jednostki ilości przelicza wpisaną ilość (stan się nie zmienia) —
  także w **korekcie** (np. PZ z m³ na MP). Dokument PZ pokazuje cenę jednostkową z jednostką.
* **Transport w cenie zakupu — zapewnia dostawca (firma)** — nowy rodzaj transportu w zakupie: bez kursów,
  bez kosztu i bez dokumentu TR; na dokumentach widać, że dostawę zapewnia dostawca.
* **Produkty — pełna elastyczność jednostek:** każdy produkt ma własną jednostkę magazynową (m³, MP lub t),
  listę jednostek dozwolonych na dokumentach i przeliczniki (masa jednostki, MP z 1 m³, gęstość t/m³ dla produktów
  w tonach). Można np. dodać łupinę liczoną w MP albo kupować PKS także w m³. Jednostki magazynowej nie zmienia się
  po pierwszym ruchu w księdze; dozwolone jednostki i przeliczniki — zawsze.
* **Nowe intro** — film startuje natychmiast (plakat pierwszej klatki widoczny przed wczytaniem skryptów,
  film wczytywany z wyprzedzeniem jako Blob), dźwięk razem z obrazem; u góry przycisk **Wycisz / Wyłącz wyciszenie**
  (ikona stanu) i **Pomiń intro** (od razu logowanie). Po końcu lub pominięciu odtwarzacz jest usuwany z drzewa DOM,
  a zasoby zwalniane (źródło wideo, adres Blob, AudioContext, słuchacze zdarzeń). Gdy przeglądarka blokuje dźwięk bez
  kliknięcia, film gra wyciszony i włącza dźwięk przy pierwszym kliknięciu. Skróty *ResInvest ERP* w Windows otwierają
  program w oknie Edge / Chrome (`ResInvestERP-Otworz.cmd`), w którym dźwięk intro działa od startu.
* **Pięć motywów** — Perła, Grafit, Azure oraz nowe **Ultra Dark (OLED)** (czysta czerń, grafit, stonowana zieleń)
  i **Light Premium** (kość słoniowa, granat, subtelne złoto). Jeden rejestr motywów (`THEME_REGISTRY` w silniku),
  przełączanie bez migotania (*Mój profil → Wygląd* lub Ctrl+D), wybór zapisany w profilu użytkownika. Kontrast WCAG
  wszystkich motywów sprawdza `npm run themes`.
* **Plan architektury Windows** (VPN FortiClient, dysk sieciowy, szyfrowanie AES-256, podwójna kopia A/B, klient
  .NET + WebView2, instalator): `docs/ARCHITECTURE_WINDOWS_PLAN.md`.
* Zabezpieczenia: brak zmiany własnej roli, rolę ADMINISTRATOR nadaje tylko administrator, ostatniego aktywnego
  administratora nie można zdegradować / zawiesić / dezaktywować / usunąć; magazyny zmienia tylko Administrator.
* Schemat danych **6** (migracja 5 → 6 automatyczna, bez utraty danych). Dokumentacja: `docs/AUTHENTICATION.md`,
  `docs/USERS_AND_ROLES.md`, `docs/EMAIL_SETUP.md`, `docs/SECURITY.md`, `docs/SUPABASE_SETUP.md`.

## Nowe w 3.1

* **Logowanie i rejestracja e-mailem firmowym** (`@resinvest.group`, lista domen w `config/app.config.json` → `companyDomains`).
  Konto administratora: **`magazyn@resinvest.group`**. Rejestracja z ekranu logowania tworzy konto „oczekuje na zatwierdzenie” —
  administrator nadaje rolę i magazyn (moduł Użytkownicy → *Zgłoszenia rejestracji*) albo odrzuca zgłoszenie.
* **Role:** *Administrator* — wszystko, w tym dodawanie innych administratorów, kierowników, magazynierów i obserwatorów;
  *Kierownik* — zatwierdza operacje swojego magazynu, korekty, anulowania, zamknięcia okresów, flota i kartoteki;
  *Magazynier* — wprowadza operacje i **przekazuje je do zatwierdzenia**; *Obserwator* — tylko podgląd.
* **Obieg zatwierdzania:** operacja magazyniera ma status **DO ZATWIERDZENIA** — bez numeru i bez wpływu na stany.
  Kierownik (lub administrator) widzi kolejkę w *Operacjach* i na pulpicie, sprawdza (może poprawić), **zatwierdza**
  (powstają dokumenty, stan sprawdzany w chwili zatwierdzenia) albo **odrzuca z powodem** (wraca do autora jako wersja robocza).
  Dokument zapisuje, kto wprowadził i kto zatwierdził.
* **Magazyny RiC Zabrze, RiC Brąszewice, RiC Rokitki** — ludzie (kierownicy, magazynierzy, obserwatorzy) oraz flota
  (pojazdy, kierowcy, rębaki, operatorzy) **przypisani do magazynów**; formularz podpowiada tylko zasoby magazynu operacji
  (lub „wspólne”). Administrator przełącza swój magazyn roboczy kliknięciem w znacznik magazynu na górnym pasku.
* **Dodawanie, edycja i usuwanie** użytkowników, magazynów, produktów, kontrahentów i floty — usunąć można rekord bez historii;
  rekord użyty w dokumentach się dezaktywuje (historia zostaje nienaruszona).
* **Start pracy na czysto** (Administracja, tylko Administrator): usuwa operacje i dokumenty po szkoleniu,
  zachowuje magazyny, kartoteki, flotę i konta.
* **Nowe intro wejściowe** (film ResInvest Commodities z dźwiękiem), **stopka autorska** w programie i na ekranie logowania.
* Poprawka: logowanie działa także w podglądzie pliku / ramce, w której przeglądarka blokuje pamięć i Web Locks
  (wcześniej po zalogowaniu ekran pozostawał pusty). Program pracuje wtedy w trybie „bez zapisu”.
* Schemat danych 5 (migracja 4 → 5 automatyczna: loginy → adresy e-mail, „Podgląd” → „Obserwator”, flota bez magazynu = wspólna).
  Dane przykładowe z 3.0 w tej samej przeglądarce są zastępowane nowymi (poprzednie zostają w kopii przeglądarki).

## Nowe w 3.0 (faza 2)

* **System logowania** — ekran logowania (PL / CS / EN, wybór motywu), pierwsze uruchomienie serwera z kontem administratora,
  wymuszona zmiana hasła tymczasowego, zmiana hasła w profilu, blokada konta po 5 nieudanych próbach na 15 min
  (odblokowanie przez administratora), limit prób z jednego adresu IP, wylogowanie po 30 min bezczynności,
  dziennik logowań. Autor każdej operacji pochodzi **wyłącznie z sesji** — nie z danych przesłanych przez przeglądarkę.
* **Moduł Użytkownicy** (Administrator) — zakładanie kont z hasłem startowym, role, przypisanie do magazynu,
  dezaktywacja (bez usuwania — historia zostaje), reset hasła, odblokowanie, macierz uprawnień, dziennik logowań.
  Ochrona: nie można odebrać sobie roli ani dezaktywować ostatniego administratora.
* **ResInvest ERP Serwer** — praca wielostanowiskowa: Node.js + SQLite (WAL, `synchronous=FULL`), każda zmiana
  w jednej transakcji, dziennik zmian tylko do dopisywania (wyzwalacze blokują UPDATE/DELETE) z łańcuchem skrótów,
  odświeżanie na żywo u innych użytkowników (SSE), kopie codzienne + przy starcie (30 dni), kontrola spójności,
  przywracanie kopii, reset hasła z konsoli, HTTPS (opcjonalnie), ochrona CSRF, nagłówki bezpieczeństwa (CSP).
* **Nowy pulpit** — sekcja powitalna z wynikiem miesiąca, szybkie akcje, 8 wskaźników z porównaniem do poprzedniego
  miesiąca i liniami trendu, wykres sprzedaży i zakupów z 6 miesięcy (z tabelą), obroty według typu operacji,
  kafle stanów z linią 30 dni, ostatnia aktywność, lista „Do załatwienia” (niezamknięte okresy, wersje robocze,
  pozycje bez wyceny).
* **Języki PL · CS · EN — kompletne** (1 542 teksty; w 3.1: 1 669): interfejs, komunikaty silnika i serwera, podpowiedzi formularza,
  dziennik audytu, raporty, wydruki i PDF. Liczby i daty wg języka (1 234,50 · 1,234.50; 23.09.2026 · 23/09/2026).
  Język i motyw zapisują się w profilu użytkownika.
* **Motywy Perła (jasny) · Grafit (ciemny) · Graphite Azure** — jak w 1.3.0; wszystkie kolory przez tokeny,
  palety wykresów sprawdzone pod kątem daltonizmu i kontrastu. Skrót: Ctrl+D.
* **Kartoteki z edycją** — Produkty (jednostka magazynowa zablokowana po pierwszym ruchu), Kontrahenci (NIP z sumą
  kontrolną), Magazyny (dezaktywacja tylko przy zerowych stanach).
* **Warstwa usług** — jedna ścieżka zmian danych (`Store.exec` → komendy `RIW.Service`) wspólna dla przeglądarki
  i serwera; komenda pracuje na kopii stanu i zapisuje wynik tylko przy powodzeniu („wszystko albo nic”).
* Schemat danych 4 (migracja 3 → 4 automatyczna; dane z Demo 2.x przenoszone przy pierwszym uruchomieniu).

## Instalacja (Windows)

Uruchom **`ResInvestERP_Setup_3.5.0.exe`** (budowanie — niżej) i wybierz:

* **Pełna instalacja** — program + serwer. Instalator dołącza środowisko Node.js (`runtime\node.exe`),
  tworzy folder danych `C:\ProgramData\ResInvestERP` i skróty w menu Start:
  *ResInvest ERP Serwer — uruchom*, *ResInvest ERP (serwer) — otwórz w przeglądarce*, *Kopia zapasowa bazy teraz*,
  *Kontrola spójności bazy*, *Folder danych serwera*, *Konfiguracja poczty i adresu (server.env)*, *Instrukcja*. Opcjonalnie: autostart serwera przy logowaniu
  do Windows i reguła zapory dla portu 8080 (dostęp z sieci lokalnej).
* **Tylko program** — sam plik HTML (tryb lokalny), bez serwera.

Instalator jest dostępny po polsku, czesku i angielsku. Odinstalowanie **nie usuwa** danych serwera, pliku
`config\server.config.json` ani `C:\ProgramData\ResInvestERP\server.env` (aktualizacja też ich nie nadpisuje).

### Pierwsze uruchomienie serwera

1. Menu Start → *ResInvest ERP Serwer — uruchom* (okno konsoli musi pozostać otwarte; przy autostarcie działa zminimalizowane).
2. Przeglądarka otworzy `http://localhost:8080/` → zaloguj się kontem **`magazyn@resinvest.group`** z hasłem startowym
   **`Admin1234`** i ustaw własne hasło (wymagane). Baza jest pusta: magazyny RiC Zabrze, RiC Brąszewice, RiC Rokitki,
   katalog produktów. (Gdy `initialAdmin` w `config\server.config.json` jest pusty — ekran **Pierwsze uruchomienie**
   z własnym adresem, hasłem i opcją danych przykładowych.)
3. **Poczta:** Menu Start → *Konfiguracja poczty i adresu* → uzupełnij `APP_URL` (adres programu w sieci, np.
   `http://192.168.1.20:8080`) i `RESEND_API_KEY`; uruchom serwer ponownie. Konfiguracja Resend i DNS (SPF, DKIM, DMARC):
   [`docs/EMAIL_SETUP.md`](docs/EMAIL_SETUP.md). Bez klucza zaproszenia zapisują się w `C:\ProgramData\ResInvestERP\mail-outbox`.
4. Administrator dodaje pracowników w **Użytkownicy → Dodaj użytkownika → Wyślij zaproszenie** (albo z hasłem
   tymczasowym, gdy poczta nie jest skonfigurowana).
5. Inne komputery / telefony w sieci: `http://<adres-serwera>:8080/` (adres IP pokazuje konsola serwera).

### Tryb lokalny (bez serwera)

Otwórz `ResInvest_ERP.html` w Chrome / Edge / Firefox (zapisany na dysku — podgląd pliku w komunikatorze lub poczcie
działa w trybie „bez zapisu”). Program startuje z **czystą bazą**: zaloguj się jako **`magazyn@resinvest.group`**
hasłem startowym **`Admin1234`** i ustaw własne hasło. Pracownicy rejestrują się zakładką **Rejestracja**, administrator
zatwierdza ich w *Użytkownicy*.

**Dane przykładowe (nauka, testy)** — *Administracja → Przywróć dane przykładowe*. Zawierają konta demonstracyjne — hasło **`demo1234`**
(zmień je w *Mój profil* przed pracą na prawdziwych danych; pulpit przypomina o tym w „Do załatwienia”):

| E-mail (login) | Osoba | Rola | Magazyn |
|---|---|---|---|
| `magazyn@resinvest.group` | Mateusz Roesner | Administrator | wszystkie (domyślny RiC Zabrze) |
| `anna.gorska@resinvest.group` | Anna Górska | Kierownik | RiC Zabrze + RiC Brąszewice |
| `adrian.wojciechowski@resinvest.group` | Adrian Wojciechowski | Magazynier | RiC Zabrze |
| `tomasz.zajac@resinvest.group` | Tomasz Zając | Kierownik | RiC Brąszewice |
| `pawel.kaczmarek@resinvest.group` | Paweł Kaczmarek | Magazynier | RiC Brąszewice |
| `michal.lewandowski@resinvest.group` | Michał Lewandowski | Kierownik | RiC Rokitki |
| `karolina.wisniewska@resinvest.group` | Karolina Wiśniewska | Magazynier | RiC Rokitki |
| `beata.nowak@resinvest.group` | Beata Nowak | Obserwator | RiC Zabrze |
| `ewa.krawczyk@resinvest.group` | Ewa Krawczyk | Audytor | wszystkie (odczyt) |
| `jan.mazur@resinvest.group` | Jan Mazur | Magazynier — **zaproszony** (nie loguje się do aktywacji) | RiC Rokitki |

Flota przykładowa: Zabrze — Scania R450, Volvo FH 500, rębak Jenz HEM 583; Brąszewice — MAN TGX (serwis),
rębak Eschlböck Biber 92; Rokitki — DAF XF 480, rębak Albach Diamant 2000 (z kierowcami i operatorami).

Dane przykładowe: bilans otwarcia 01.08.2026 (Zabrze: drewno 817 m³, zrębka leśna 8 173 MP, PKS i łupina po 728 t),
operacje każdego rodzaju, MM Zabrze → Brąszewice (dwuetapowe: wysłanie i przyjęcie z tonażem z wagi), korekta WZ i anulowany zakup; plik `data/sample_data.json`
(kopia do wczytania w *Administracja → Wczytaj kopię*).

## Funkcje

| Obszar | Zawartość |
|---|---|
| **Operacje** | Zakup (PZ, opcjonalnie łańcuch produkcja + sprzedaż) · Sprzedaż z magazynu (WZ) · Produkcja na magazynie (RW + PW) · Produkcja + sprzedaż bezpośrednia (PW + WZ) · Przesunięcie MM; transport własny / zewnętrzny / mieszany / kolej z kursami, kwitami wywozowymi i kosztami |
| **Zatwierdzanie** | podsumowanie przed zatwierdzeniem (stan przed / po, zużycie, masa, GJ, koszty, dokumenty); zapis atomowy; ochrona przed podwójnym kliknięciem i podwójnym zapisem (klucz idempotencji) |
| **Statusy** | ROBOCZY · ZATWIERDZONY · SKORYGOWANY · ANULOWANY |
| **Korekty i anulowania** | dokument KOR (ilościowe, produkcji, sprzedaży bezpośredniej, wartościowe, opisowe; podgląd oryginał / korekta / różnica / wpływ na stan; odwrócenie korekty) · dokument AN (nigdy nie usuwa dokumentu; analiza zależności w czasie; wymagana przyczyna) |
| **Historia** | rejestr ruchów ze stanem przed / zmianą / stanem po; dziennik audytu (kto, kiedy, co, powód, źródło); filtry: dzień / tydzień / miesiąc / rok / zakres, magazyn, produkt, typ, użytkownik, kontrahent, status |
| **Raporty** | dzienny / tygodniowy / miesięczny / roczny / zakres własny; magazyn lub wszystkie; widok biznesowy i audytowy; bilans stanów z kontrolą spójności z księgą; zakupy, produkcja, sprzedaż, MM, transport, korekty, anulowania, wycena; zestawienie miesięcy roku; drill-down do operacji; CSV |
| **Druk i PDF** | okno wydruku i prawdziwy PDF (osadzona czcionka z polskimi i czeskimi znakami, numer, strony „X z Y”, pola podpisu) — w języku użytkownika; każde wygenerowanie w audycie |
| **Inwentaryzacja** | okres miesięczny OTWARTA → ZAMKNIĘTA, lista spisowa, różnice dokumentem IN, blokada okresu; automatyczna kontrola przełomu miesiąca |
| **Import / eksport** | kopia JSON (pełny stan, bez haseł), import z kontrolą struktury i migracją, CSV stanów / historii / bilansu, kopie SQLite serwera |
| **Kartoteki** | Produkty, Kontrahenci, Magazyny, Flota (pojazdy, kierowcy, rębaki, operatorzy) |
| **Konta i dostęp** | zaproszenia e-mail, reset hasła, statusy kont, role z edytowalnymi uprawnieniami, magazyn domyślny + dostępne, izolacja danych magazynów, dziennik audytu z IP |
| **Bezpieczeństwo** | role i macierz uprawnień sprawdzane w silniku przy każdej komendzie (na serwerze — po stronie serwera), hasła z solą, blokady, sesje, CSRF, CSP, dziennik zmian z łańcuchem skrótów |

## Przeliczniki (`config/app.config.json`)

| Przelicznik | Wartość |
|---|---|
| 1 m³ drewna | 4 MP zrębki (1 MP = 0,25 m³) |
| 1 MP zrębki | 0,33 t (orientacyjnie) |
| 1 m³ drewna | 0,952 t (orientacyjnie; 817 m³ ≈ 778 t) |
| 1 t biomasy | 8,5 GJ (orientacyjnie) |
| PKS, łupina nerkowca | tylko t |

Masa i energia są orientacyjne i nie zmieniają ilości na stanie. Jednostek różnych produktów się nie sumuje.
Symbol **MP** (metr przestrzenny zrębki) jest taki sam we wszystkich językach — tak jak na dokumentach.

## Serwer — konfiguracja i obsługa

Plik `config/server.config.json` (w instalacji: `C:\Program Files\ResInvest ERP\config\`):

| Klucz | Znaczenie | Domyślnie |
|---|---|---|
| `port`, `host` | adres nasłuchu; `0.0.0.0` = sieć lokalna, `127.0.0.1` = tylko ten komputer | 8080, 0.0.0.0 |
| `dataDir` | baza, kopie, logi (instalator ustawia `%ProgramData%\ResInvestERP` przez `RIW_DATA`) | `data-server` |
| `session.idleMinutes` / `absoluteHours` | wylogowanie po bezczynności / maksymalny czas sesji | 30 / 12 |
| `security.maxFailed` / `lockMinutes` / `ipAttemptsPer15Min` | blokada konta i limit prób z adresu IP | 5 / 15 / 40 |
| `backup.hour` / `keepDays` / `dir` | godzina kopii codziennej, przechowywanie, folder | 2 / 30 / `<dataDir>/backups` |
| `tls.cert` / `tls.key` | pliki PEM — włączają HTTPS (zalecane poza siecią lokalną) | — |

Zmienne środowiskowe: `RIW_PORT`, `RIW_HOST`, `RIW_DATA`, `RIW_TODAY` (tylko testy), `RIW_CONFIG` (inna ścieżka pliku konfiguracji).

**Poczta i adres linków** — plik `server.env` (wzór [`.env.example`](.env.example); w instalacji:
`C:\ProgramData\ResInvestERP\server.env`): `APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`,
`EMAIL_TRANSPORT` (`resend` / `smtp` / `file`), `SMTP_*`, `INVITE_HOURS` (72), `RESET_HOURS` (1), `CONFIRM_HOURS` (48).
Plik z kluczem nie trafia do repozytorium (`.gitignore`).

```bash
npm run server                          # uruchomienie (Node.js ≥ 22.13)
node server/riw-server.mjs --open       # … i otwarcie przeglądarki
node server/riw-server.mjs --backup-now # kopia bazy teraz (działa także przy pracującym serwerze)
node server/riw-server.mjs --check      # kontrola spójności bazy i łańcucha skrótów dziennika
node server/riw-server.mjs --restore <plik.sqlite>      # przywrócenie kopii (serwer zatrzymany)
node server/riw-server.mjs --reset-password <login>     # hasło tymczasowe (serwer zatrzymany)
node server/riw-server.mjs --mail-test <adres>          # wiadomość próbna — sprawdzenie konfiguracji poczty
```

Folder danych: `resinvest.sqlite` (baza: stan, dziennik zmian, konta, sesje, tokeny e-mail, kolejka wysyłek),
`backups/` (kopie `VACUUM INTO`), `logs/` (dzienne logi serwera), `mail-outbox/` (transport `file`), `server.env`.
Przywrócenie zachowuje bieżącą bazę jako kopię bezpieczeństwa przed podmianą.

## Struktura projektu

```
resinvest-erp/
├── ResInvest_ERP.html             ← wynik budowania: jeden plik (tryb lokalny i interfejs serwera)
├── app/src/
│   ├── i18n.js · i18n.d01–d12.js  ← tłumaczenia (tekst PL = klucz; słowniki CS/EN), formaty liczb i dat
│   ├── engine.js                  ← silnik domenowy (bez DOM): walidacja, księga, korekty, anulowania, raporty, migracje
│   ├── service.js                 ← komendy zmieniające dane (wspólne: przeglądarka i serwer), uprawnienia
│   ├── seed.js                    ← dane przykładowe i minimalne (pierwsze uruchomienie)
│   ├── auth.js                    ← hasła (PBKDF2), polityka haseł, logowanie w trybie lokalnym
│   ├── pdf.js                     ← generator PDF + HTML do druku
│   ├── core.js                    ← rdzeń interfejsu: magazyn danych, logowanie, nawigacja, motywy, języki
│   ├── form.js                    ← formularz „Nowa operacja” i korekty
│   ├── views.js · dashboard.js · admin.js  ← ekrany modułów, pulpit, kartoteki, użytkownicy, role, audyt, administracja
│   └── intro.js · styles.css · index.template.html
├── app/assets/                    ← film intro (MP4 H.264/AAC) i plakat pierwszej klatki, czcionki PDF (SIL OFL 1.1)
├── server/core.mjs · riw-server.mjs ← ResInvest ERP Serwer (SQLite, sesje, tokeny, API, kopie)
├── server/mail.mjs                ← poczta: szablony PL, Resend (API / SMTP), zapis .eml
├── .env.example                   ← wzór zmiennych środowiskowych serwera (bez sekretów)
├── config/app.config.json         ← przeliczniki i wartości domyślne
├── config/server.config.json      ← konfiguracja serwera (środowisko)
├── data/sample_data.json          ← przykładowe dane testowe
├── tools/                         ← build.mjs, i18n-extract.mjs, theme-contrast.mjs, export-sample-data.mjs, czcionki PDF
├── installer/                     ← instalator Windows (Inno Setup 7 / 6.3+), skrypty uruchomieniowe .cmd
├── tests/                         ← engine, pdf, platform, server, auth (node:test) · e2e.cjs, e2e-server.cjs, e2e-intro.cjs (Playwright)
├── docs/                          ← uwierzytelnianie, użytkownicy i role, poczta, bezpieczeństwo, plan architektury Windows
├── TASKS.md · progress.md
└── LICENSE
```

## Budowanie i testy

Wymagany **Node.js ≥ 22.13** (moduł `node:sqlite`).

```bash
cd resinvest-erp
npm run check         # kontrola składni
npm run i18n          # pokrycie tłumaczeń CS/EN (kod wyjścia 1 przy brakach)
npm run themes        # kontrast WCAG wszystkich 6 motywów
npm run build         # → ResInvest_ERP.html (konfiguracja, słowniki, czcionki PDF, film intro)
npm run test:unit     # silnik (w tym MM dwuetapowe), PDF, platforma: jednostki, korekty, transport, i18n, hasła, role, funkcje 3.4: operacje dodatkowe, numery ręczne, tonaż, usuwanie, XLSX/DOCX (127)
npm run test:server   # serwer (9) + konta i bezpieczeństwo §34/§35, MM przez serwer: zaproszenia, reset, izolacja magazynów, 403 (26)
npm i --no-save playwright && npx playwright install chromium   # jednorazowo
npm run test:e2e      # przeglądarka: tryb OFFLINE (307 kontroli) + tryb FIRMOWY z serwerem i pocztą .eml (29 kontroli)
FFMPEG=ffmpeg node tests/e2e-intro.cjs   # intro na prawdziwym filmie (wariant WebM dla Chromium bez H.264)
```

### Instalator Windows

Wymaga [Inno Setup 7](https://jrsoftware.org/isdl.php) (lub 6.3+) i dostępu do nodejs.org (pobranie `node.exe`,
weryfikacja SHA-256). Skrypt odnajduje `ISCC.exe` w PATH, w `Program Files` (Inno Setup 7 i 6) i w rejestrze.
Plik `.iss` jest zapisany w UTF-8 z BOM (polskie i czeskie znaki w Inno Setup 7).

```powershell
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
# → installer\Output\ResInvestERP_Setup_3.5.0.exe   (skrypt uruchamia też testy; -SkipTests pomija)
```

Bez Windows (serwer budowania Linux): `bash installer/build-installer-wine.sh` — ten sam plik `.iss`,
kompilator Inno Setup 6.4 (pakiet npm `innosetup`) uruchamiany w Wine (wymaga `wine64` i `wine32:i386`).

## Kopie zapasowe i bezpieczeństwo danych

* **Serwer:** kopia przy każdym starcie i codziennie o `backup.hour`; przechowywanie `keepDays` dni; kopia ręczna
  (menu Start / *Administracja → Utwórz kopię teraz*). Każda zmiana danych to jedna transakcja SQLite: stan, rewizja
  i wpis dziennika zapisują się razem albo wcale. `--check` sprawdza sumy kontrolne stanu i łańcuch dziennika.
* **Tryb lokalny:** *Administracja → Pobierz kopię (JSON)*; zapis chroniony blokadą między kartami (Web Locks);
  uszkodzone dane są zachowywane pod kluczem `riw.v3.state.uszkodzone.<czas>`.
* **Import kopii** (oba tryby): kontrola struktury, migracja do bieżącego schematu (7), zachowanie zalogowanego administratora;
  hasła nigdy nie trafiają do kopii JSON.

## Migracja z Demo 2.x

Przy pierwszym uruchomieniu 3.0 w tej samej przeglądarce dane Demo 2.x (`riw.demo.state.v3`) są przenoszone do 3.0
(schemat 4, loginy tworzone z nazwisk). Konta demonstracyjne otrzymują hasło `demo1234`. Na serwer dane przenosi się
kopią JSON: *Administracja → Pobierz kopię* w trybie lokalnym → *Wczytaj kopię* na serwerze.

## Ograniczenia i dalszy rozwój

* Wycena stanu orientacyjna (średnia cena zakupu); pełna wycena magazynowa (FIFO / średnia ruchoma) — kolejna faza.
* Serwer przechowuje stan jako dokument JSON w jednej tabeli (+ dziennik zmian); przy bardzo dużej liczbie operacji
  (setki tysięcy) planowane jest rozbicie na tabele relacyjne — interfejs komend `RIW.Service` pozostaje bez zmian.
* Tryb lokalny chroni dostęp w obrębie programu, ale dane w przeglądarce może odczytać osoba z dostępem do konta
  Windows — do pracy na danych firmy używaj serwera.
* Przeglądarki bez kodeka H.264/AAC pokazują w intro planszę firmową z muzyką syntezowaną.
* Wysyłka e-mailem w trybie OFFLINE nie dołącza pliku automatycznie (przeglądarka nie może przekazać załącznika
  do programu pocztowego) — PDF zapisuje się na dysku i dołącza się go ręcznie.
