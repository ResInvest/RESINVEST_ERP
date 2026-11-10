# EUDR w ResInvest Commodities — analiza, plan wdrożenia i projekt zakładki w ResInvest ERP

Stan wiedzy: 28.10.2026. Dokument opisuje obowiązki i sposób ich obsługi w programie. **To nie jest porada prawna.** Przed 30.12.2026 trzeba potwierdzić szczegóły z doradcą i z aktualnymi wytycznymi Komisji oraz polskiej ustawy wdrażającej.

## 1. Czym jest EUDR

Rozporządzenie (UE) 2023/1115 w sprawie produktów niepowiązanych z wylesianiem („EUDR”), zmienione rozporządzeniem (UE) 2025/2650 (w mocy od 26.12.2025).

Najważniejsze dla ResInvest:

| Sprawa | Stan |
|---|---|
| Od kiedy | **30.12.2026** — duże i średnie firmy oraz mikro i małe firmy sektora drzewnego objęte wcześniej EUTR. **30.06.2027** — pozostałe mikro i małe firmy. Źródła różnią się w odczytaniu przepisu dla małych firm, dlatego przyjmujemy wcześniejszy termin. |
| Czy drewno i zrębka są objęte | **Tak.** Dział 44 załącznika I zostaje w zakresie (pakiet upraszczający Komisji z 04.05.2026 nie usunął drewna). Poz. **4401** obejmuje drewno opałowe (4401 11/12), zrębki (4401 21/22) i trociny / odpady; poz. **4403** — drewno okrągłe. |
| PKS (łupina palmowa) | Do sprawdzenia kodu CN z agencją celną. Jeśli to 2306 60 (makuchy z orzechów palmowych), produkt należy do załącznika I (palma olejowa). Łupina nerkowca jest poza zakresem. |
| Kto składa oświadczenie (DDS) | Po zmianie z 2025 r. obowiązek **złożenia DDS ma tylko podmiot, który pierwszy wprowadza towar do obrotu w UE** (np. nadleśnictwo sprzedające drewno, importer). |
| Co robią podmioty dalsze i handlowcy | **Pierwszy** podmiot dalszy / handlowiec po operatorze zbiera i przechowuje **numery referencyjne DDS** (albo identyfikatory deklaracji uproszczonych) oraz dane dostawców i odbiorców. Przechowywanie 5 lat. |
| Mikro i mali producenci pierwotni | Np. prywatny właściciel lasu w kraju niskiego ryzyka: zamiast DDS — **jednorazowa deklaracja uproszczona**, z której system UE nadaje identyfikator. |
| Ryzyko kraju | Kraje UE, w tym Polska, mają klasyfikację „niskie ryzyko” → uproszczona należyta staranność: informacje trzeba zebrać, ale ocena i ograniczanie ryzyka nie są wymagane (chyba że są sygnały nieprawidłowości). |
| Polska ustawa (projekt) | Projekt przewiduje dodatkowy obowiązek: **podawanie numeru referencyjnego DDS / identyfikatora deklaracji w ofertach i dokumentach handlowych**. Organ dla drewna: Inspekcja Ochrony Środowiska. Do śledzenia — treść może się zmienić. |

## 2. Jak to wygląda dla ResInvest Commodities

ResInvest kupuje drewno i zrębkę, rąbie drewno na zrębkę (we własnym magazynie albo w lesie) i sprzedaje zrębkę do elektrociepłowni i ciepłowni. W zależności od transakcji firma ma różną rolę:

| Scenariusz | Dostawca | Rola ResInvest | Co trzeba mieć |
|---|---|---|---|
| **A. Zakup drewna z nadleśnictwa** (Lasy Państwowe) | operator — składa DDS | pierwszy podmiot dalszy (gdy rąbie) albo pierwszy handlowiec | numer referencyjny DDS (+ numer weryfikacyjny) z dokumentu sprzedaży drewna, przypisany do PZ; dane nadleśnictwa i leśnictwa |
| **B. Zakup zrębki / drewna od firmy** | podmiot dalszy albo handlowiec | dalszy podmiot w łańcuchu | prawnie zbiera tylko pierwszy po operatorze, ale **odbiorcy energetyczni będą żądać numerów** — zalecane ich zbieranie |
| **C. Zakup od prywatnego właściciela lasu** | mikro / mały producent pierwotny | pierwszy podmiot dalszy / handlowiec | identyfikator deklaracji uproszczonej (raz w profilu dostawcy) |
| **D. Wycinka inwestycyjna, zakup drewna na pniu, import spoza UE** | dostawca nie składa DDS (np. inwestor) albo dostawca spoza UE | **operator** | **własne DDS w systemie UE przed wprowadzeniem do obrotu**: gatunek, ilość, kraj, geolokalizacja działek (punkt do 4 ha, powyżej — wielokąt), okres pozyskania, dokumenty legalności (np. zezwolenie na usunięcie drzew), ocena ryzyka |
| **E. Sprzedaż zrębki** | — | sprzedawca w łańcuchu | wskazanie odbiorcy numerów referencyjnych źródeł (z transakcji albo z puli magazynu) |

Uwaga do scenariusza D: wytyczne z maja 2026 r. dla lasów państwowych wskazują, że **przy sprzedaży drewna na pniu operatorem pozostaje właściciel lasu, chyba że własność drewna przechodzi na wykonawcę z chwilą pozyskania**. Zapis w umowie decyduje, kto składa DDS — warto go sprawdzić w każdej umowie wycinki.

## 3. Co wprowadzono w ResInvest ERP (wersja demonstracyjna 3.12.0)

### 3.1. Zakładka „EUDR — wylesianie”

| Ekran | Funkcje |
|---|---|
| Przegląd | odliczanie do 30.12.2026, wskaźnik gotowości (% transakcji objętych EUDR bez braków), zakupy i sprzedaż z kompletnymi danymi, dostawcy zweryfikowani, działki, lista „Do załatwienia”, opis scenariuszy A–E |
| Rejestr transakcji | każdy zakup i każda sprzedaż z rolą ResInvest, statusem (Kompletne / Uwagi / Braki / Poza zakresem), kodem CN, ilością w MP, m³ i t; edycja danych EUDR transakcji; filtry; CSV; import numerów (CSV z nadleśnictwa) |
| Okno transakcji — zakup | numery referencyjne DDS / identyfikatory deklaracji (z numerem weryfikacyjnym), gatunek, okres pozyskania, działki, kod CN; dla operatora: własne DDS (projekt / złożone), dokumenty legalności, ocena ryzyka, **projekt DDS w JSON** |
| Okno transakcji — sprzedaż | numery do przekazania odbiorcy, wskazanie źródeł, kopiowanie numerów, **„Informacja EUDR do WZ” (TXT)**, wskazanie ręczne |
| Dostawcy | rola w łańcuchu, kraj (ISO), ryzyko, identyfikator deklaracji, weryfikacja (kto i kiedy), liczba transakcji i braków |
| Działki | nadleśnictwo, leśnictwo, adres leśny, powierzchnia, współrzędne WGS84 albo wielokąt GeoJSON, „Moja lokalizacja” (telefon w lesie), podgląd na mapie, eksport GeoJSON |
| Raporty i eksport | zestawienie wg statusu (MP / m³ / t), zestawienie miesięczne roku z gotowością, CSV rejestru, GeoJSON, kopia danych EUDR (JSON) |
| Ustawienia | data stosowania, wielkość firmy, okres puli magazynu, identyfikator operatora (EORI), rejestracja w TRACES, zakres produktów i kody CN |
| Plan wdrożenia | lista kroków ze stanem liczonym z danych |

### 3.2. Pulpit — „Obrót miesiąca”

* **Zakupy od firm** i **Sprzedaż** — dwie karty obok siebie: sumy w MP, m³ i t, wartość, tony z wagi, najwięksi kontrahenci, słupki 6 miesięcy. Kliknięcie otwiera pełny widok: kontrahenci (rozwijani) i ich transakcje — data, nr dokumentu, towar, ilość z dokumentu, MP, m³, t (⚖ — waga z kwitu, ≈ — przelicznik), wartość, magazyn; przy sprzedaży także **miejsce dostawy** i rodzaj (WZ / bezpośrednia z lasu / łańcuch). Wyszukiwanie, „Rozwiń wszystko”, CSV.
* **Lasy Państwowe — zakupy z nadleśnictw** — tabela miesiąca: nadleśnictwo → leśnictwo → transakcje, rozwijana pojedynczo albo przyciskiem „Rozwiń całość”; pełny widok w oknie.
* **Rejestr ilości** — ostatnie 6 miesięcy: zakupy od firm, lasy i sprzedaż w MP, m³ i t; kliknięcie miesiąca przełącza cały pulpit.
* Przełączniki: miesiąc (◀ ▶), „Ten magazyn / Wszystkie”, grupa produktów.

Miary: **m³** dla zrębki to ekwiwalent drewna litego z przelicznika produktu (MP ÷ współczynnik, domyślnie 4); **t** — waga rzeczywista, gdy jest (waga ręczna, kwity wagowe kursów, wagony), w przeciwnym razie z przelicznika. Produkt bez przelicznika (np. PKS w MP) nie jest liczony jako zero — suma dostaje gwiazdkę „niepełna”.

## 4. Architektura

```
base/ResInvest_ERP_3.11.0_TEST.html   — program bez zmian (wejście budowy)
src/tradestats.js     silnik: zestawienia obrotu (bez DOM)
src/eudr.js           silnik: EUDR — ocena, śledzenie numerów, komendy z audytem (bez DOM)
src/eudr-seed.js      dane przykładowe obrotu i EUDR (przez silnik)
src/dashboard-premium.js  widok: sekcja „Obrót miesiąca” (dekorator pulpitu)
src/eudr-view.js      widok: zakładka EUDR
src/eudr.css          style (tokeny motywów programu, responsywność)
tools/build.mjs       budowa: punktowe zmiany pliku bazowego + moduły → dist/
```

Zasady:

* **Moduł nakładkowy.** EUDR nie zmienia księgi, dokumentów ani operacji. Dane są w `state.eudr`, ocena liczona na bieżąco — korekta albo anulowanie dokumentu od razu zmienia wynik w rejestrze i na pulpicie.
* **Jedna ścieżka zmian.** Komendy usługi `eudr.record.save`, `eudr.refs.import`, `eudr.supplier.save`, `eudr.plot.save`, `eudr.plot.remove`, `eudr.settings.save`. Zapis „wszystko albo nic”, wpis w dzienniku audytu, ten sam kod w trybie lokalnym i serwerowym.
* **Uprawnienia.** Nowe: `eudr.edit` (magazynier, kierownik) i `eudr.manage` (kierownik). Administrator ma wszystko. Odczyt wymaga `report.view`.
* **Izolacja magazynów.** Zmiana tylko dla operacji z dostępnego magazynu; widok serwera (`Service.project`) wysyła dane EUDR wyłącznie dla widocznych operacji.
* **Sprzedaż ze stanu — „pula magazynu”.** Źródła to przyjęcia, które zasiliły stan sprzedanego produktu (albo jego surowca przy produkcji na placu) w okresie puli (domyślnie 90 dni) przed datą WZ, oraz przyjęcia MM (pula magazynu źródłowego). Transakcja łańcuchowa sprzedana w całości nie trafia do puli. Wariant jest **zachowawczy**: odbiorca dostaje wszystkie numery, z których towar mógł pochodzić.
* **Wydajność.** Indeks księgi wg magazynu (budowany raz na wersję stanu) i jednorazowa ocena źródła w zestawieniu: ~2000 operacji — rejestr miesiąca ok. 6 ms, cały okres ok. 0,3 s.

## 5. Plan wdrożenia w firmie

| Krok | Kto | Termin |
|---|---|---|
| 1. Rejestracja firmy w systemie informacyjnym UE (TRACES), numer EORI | zarząd / administrator | do 30.11.2026 |
| 2. Ustalenie z nadleśnictwami, jak przekazują numery DDS (dokument sprzedaży z SILP, e-mail, zestawienie CSV) | kierownik zakupów | do 30.11.2026 |
| 3. Profile EUDR wszystkich dostawców (rola, kraj, identyfikator deklaracji), weryfikacja | kierownik zakupów | do 15.12.2026 |
| 4. Sprawdzenie kodu CN dla PKS | księgowość / agencja celna | do 15.12.2026 |
| 5. Umowy wycinki i zakupu na pniu: kto jest operatorem; gotowe działki i dokumenty legalności | kierownik | przed pierwszą wycinką |
| 6. Procedura należytej staranności (opis, odpowiedzialni, przegląd raz w roku), szkolenie magazynierów | zarząd | do 20.12.2026 |
| 7. Próba na danych grudnia: numery przy każdej PZ, informacja dla odbiorców przy WZ | magazyn / sprzedaż | 01–29.12.2026 |
| 8. Start: 30.12.2026, przegląd gotowości co tydzień w zakładce EUDR | kierownik | od 30.12.2026 |
| 9. Archiwizacja 5 lat: kopie zapasowe danych i dokumentów źródłowych | administrator | stale |

### Wdrożenie w programie produkcyjnym (po akceptacji demo)

1. Przeniesienie modułów do źródeł ResInvest ERP (`app/*.js`), wpis do `tools/build.mjs` programu, numer wersji 3.12.0.
2. Serwer: obsługa gałęzi `eudr` w synchronizacji „samymi zmianami” (delta) i w SQLite. W demo działa tryb lokalny.
3. Formularz „Nowa operacja”: pole „Numer referencyjny DDS” przy zakupie (dziś — w zakładce EUDR) i wydruk numerów na WZ / w PDF.
4. Tłumaczenia CS / EN nowych tekstów (w demo teksty są po polsku).
5. Migracja ról zmienionych przez administratora (`state.rolePerms`) — dopisanie `eudr.edit` / `eudr.manage`.
6. Integracja z API systemu informacyjnego UE (TRACES) — po publikacji stabilnej specyfikacji.

## 6. Źródła

* [Rozporządzenie (UE) 2025/2650 — EUR-Lex](https://eur-lex.europa.eu/eli/reg/2025/2650/oj)
* [Andersen: zmiana EUDR opublikowana — terminy i uproszczenia](https://pl.andersen.com/en/newsletter/amendment-to-the-eudr-published-changes-to-deadlines-and-simplification-of-obligations-now-official/)
* [Stibbe: The amended EUDR — what has changed](https://www.stibbe.com/publications-and-insights/the-amended-eudr-what-has-changed-and-what-has-remained)
* [EUSTAFOR: pakiet upraszczający z 04.05.2026 — drewno i lasy państwowe](https://eustafor.eu/eudr-what-the-commissions-4-may-2026-simplification-package-means-for-wood-state-forests-and-non-eu-operators/)
* [Woodcentral: wood and paper stay in scope](https://woodcentral.com.au/eudr-cuts-leather-adds-coffee-wood-paper-stay-scope/)
* [EY: EUDR application postponed to 30 December 2026](https://taxnews.ey.com/news/2026-0237-eu-deforestation-regulation-application-postponed-to-30-december-2026)
* [Prawo.pl: polska ustawa o EUDR — dodatkowy obowiązek dla firm](https://www.prawo.pl/biznes/polska-ustawa-o-eudr-dodatkowy-obowiazek-dla-firm,1542703.html)
* [Lasy Państwowe: komunikat w sprawie EUDR (PDL)](https://drewno.lasy.gov.pl/wp-content/uploads/2025/08/Komunikat-na-PDL-ws.-EUDR.pdf)
* [kglegal.pl: nowe daty stosowania EUDR](https://kglegal.pl/en/new-dates-for-eudr-application)
