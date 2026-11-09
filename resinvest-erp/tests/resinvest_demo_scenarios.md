# ResInvest ERP — Demo v2.1 — scenariusze walidacyjne

Scenariusze do ręcznego sprawdzenia w `ResInvest_ERP_demo.html`. Każdy ma odpowiednik automatyczny:
`tests/engine.test.mjs` (silnik, numeracja §22 / §31.16 / §32.23 / testy 11–42), `tests/pdf.test.mjs`
(generator PDF) i `tests/e2e.cjs` (przeglądarka).

## Przygotowanie

1. *Administracja → Data systemowa demo* = **2026-09-23** → *Zastosuj datę*.
2. *Administracja → Przywróć dane przykładowe*.
3. Użytkownik: **Anna Górska — Kierownik** (magazyn RiC Zabrze).
4. *Stany magazynowe*: drewno **817 m³ ≈ 778 t ≈ 6 611 GJ**, zrębka leśna **8 293 MP ≈ 2 737 t ≈ 23 262 GJ**, PKS **728 t ≈ 6 188 GJ**.

## §22 TEST 1 / §31.16 A — produkcja na magazynie

1. *Nowa operacja → Produkcja na magazynie*. Brak sekcji transportu, przewoźnika, odbiorcy i sprzedaży.
2. Surowiec: Drewno opałowe (stan 817 m³), produkt: Zrębka produkcyjna leśna, **Ilość produkcji 500 MP**.
3. Oczekiwane: zużycie **125 m³** (auto), stan po **692 m³**, masa ≈ 165 t, ≈ 1 402,5 GJ, cena za rąbanie **10,00 zł/MP**, koszt **5 000,00 zł** (§22 TEST 7).
4. *Zatwierdź…* → okno podsumowania (stan przed/po, RW + PW) → *Zatwierdź dokument* → szczegóły dokumentu, status ZATWIERDZONY.

## §31.16 B–J — walidacja produkcji

| Test | Kroki | Oczekiwane |
|---|---|---|
| B | użytkownik Paweł Kaczmarek (Pyskowice, 30 m³), produkcja 500 MP | „Brak wystarczającej ilości surowca. Dostępne: 30 m³. Wymagane: 125 m³. Brakuje: 95 m³.” — zatwierdzenie zablokowane |
| C | produkt wyjściowy = surowiec | „Surowiec i produkt wyjściowy muszą być różnymi produktami” |
| D | surowiec PKS (t) → zrębka (MP) | „Brak przelicznika t → MP dla wybranego produktu …” |
| E | stan 62,5 m³, produkcja 250,0001 MP | zużycie 62,500025 m³ → blokada (brak zaokrąglenia przed walidacją) |
| F | dwuklik „Zatwierdź dokument” | jedna operacja |
| G | operacja odrzucona | brak RW/PW, numeru i wpisu audytu |
| H | okno podsumowania | stan przed/po surowca i produktu, masa, GJ, koszt rąbania |
| I | sprzedaż bezpośrednia: produkcja 600 MP, sprzedaż 650 MP | „Nie można sprzedać 650 MP z produkcji 600 MP” |
| J | zapis z pominięciem formularza (test silnika) | ta sama blokada |

## §22 TEST 2 — WZ

*Sprzedaż z magazynu*: zrębka leśna 500 MP → „Stan dostępny” / „Stan po WZ”; 8 793,01 MP → „Nie można sprzedać 8 793,01 MP. Dostępny stan: 8 793 MP.”

## §22 TEST 3 — produkcja + sprzedaż bezpośrednia

Las → 600 MP → Elektrownia Łaziska: surowiec liczony 150 m³ (nie ze stanu), dokumenty PW + WZ, stan zrębki i drewna bez zmian.

## §22 TEST 5–6 — pociąg

Tonaż wspólny 20 × 60 t = **1 200 t**; tonaż każdego wagonu 58,4 / 60,1 / 59,7 / 61,2 / 59,8 = **299,2 t**.

## MM

*Nowa operacja → Przesunięcie MM*: Zabrze → Pyskowice, zrębka leśna 300 MP → źródło 8 293 → 7 993 MP, cel 220 → 520 MP. Stan firmy bez zmian.

## §32.23 — anulowanie i korekty

| Test | Kroki | Oczekiwane |
|---|---|---|
| 1 | *Operacje* → WZ → *Anuluj dokument…* bez przyczyny | komunikat; po wyborze przyczyny: dokument AN, status ANULOWANY, stan przywrócony, dokument pozostaje w rejestrze |
| 2 | zakup 100 m³ w Pyskowicach, produkcja 480 MP (120 m³), anulowanie zakupu | „Nie można bezpośrednio anulować dokumentu … Towar z tego dokumentu został wykorzystany w późniejszych operacjach …” + lista operacji zależnych |
| 3 | anulowanie zakupu, po którym były rozchody bez utraty pokrycia | wymagane potwierdzenie |
| 4 | korekta WZ 500 → 450 → 600 MP | dokumenty KOR, status SKORYGOWANY, oryginał zachowany |
| 5 | korekta produkcji 500 → 400 MP | zużycie 125 → 100 m³ (+25 m³ drewna, −100 MP zrębki) |
| 6 | korekta sprzedaży bezpośredniej | produkcja = sprzedaż, stan bez zmian |
| 7 | korekta ceny za rąbanie 10 → 12 zł/MP | bez ruchu w księdze, różnica wartości +1 000 zł |
| 8 | korekta uwag / nr dokumentu zewnętrznego | korekta opisowa |
| 9 | *Odwróć* ostatnią korektę | nowa korekta przywracająca dane; korekt się nie usuwa |
| 10 | Adrian (magazynier) | brak „Anuluj” / „Koryguj”; anulowanego dokumentu nie koryguje się |

## Historia, raporty, kwit, PDF (testy 11–42)

1. *Historia*: filtr typu **Korekta**, zakres 15.09–16.09, magazyn, produkt, użytkownik, kontrahent; kolumny stan przed / zmiana / po.
2. *Raporty*: miesiąc 2026-09, wszystkie magazyny → „Bilans spójny”; sekcje zakupy / produkcja / sprzedaż / zużycie / MM / transport / wycena / korekty / anulowania; kliknięcie wiersza → operacje źródłowe; lipiec 2026 → pusty raport, bilans spójny.
3. *Generuj PDF* → plik `raport_…_RAP-….pdf` z polskimi znakami, numerem raportu, polami podpisu i „Strona X z Y”. *Drukuj* → okno wydruku z tą samą treścią.
4. Spójność: zakup miesiąca na Pulpicie = raport (Zabrze) = PDF; stan końcowy w raporcie = Stany = ostatni „stan po” w Historii.
5. *Kwit produkcji dnia*: 22.09.2026, RiC Pyskowice → 20 MP = 5 m³, 6,60 t, 56,1 GJ, 200,00 zł; PDF.
6. Zamknięcie sierpnia (*Inwentaryzacja*) → raport sierpnia bez zmian, oznaczenie „okres zamknięty”, zapis z datą sierpniową zablokowany.

## Kontrole przekrojowe

* Transport nie zmienia stanu w żadnym rodzaju operacji.
* Wyścig dwóch kart: druga WZ na ten sam stan odrzucona, stan nieujemny.
* Telefon 390 px: brak przewijania w poziomie na pulpicie, formularzach, historii, raportach i kwicie.
* Konsola przeglądarki bez wyjątków.
