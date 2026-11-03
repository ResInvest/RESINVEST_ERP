# Ewidencja obrotu — plik CSV (od 3.8.1)

Przycisk **CSV** w *Operacjach* i w rejestrach *Dokumenty / Przyjęcia / Wydania / MM*, przycisk **CSV ewidencji**
w *Raportach* (okres raportu) i w *Planerze zakupów* (tydzień albo rok planera) pobierają ten sam plik:
`ewidencja_….csv` — średnik jako separator, przecinek dziesiętny, kodowanie UTF-8 z BOM (Excel otwiera polskie znaki).

## Zasada wierszy

Jeden wiersz = jeden ruch towaru w transakcji (numer WZ):

| Zakup/Sprzedaż | Kiedy powstaje |
|---|---|
| **Zakup** | zakup od dostawcy (na magazyn albo prosto do produkcji) |
| **Produkcja** | rąbanie drewna na zrębkę: w zakupie z produkcją, przy sprzedaży bezpośredniej z lasu, na magazynie |
| **Sprzedaż** | sprzedaż odbiorcy — z magazynu, z produkcji, bezpośrednio z lasu |
| **MM** | przesunięcie między magazynami firmy |

Transakcja „zakup + produkcja + sprzedaż bezpośrednia” to trzy wiersze z tym samym numerem WZ.
**Transport** (firma, nr rejestracyjny, km, koszt, typ) jest w **ostatnim** wierszu transakcji — tym ruchu, który
jest przewożony. Dzięki temu suma kolumny „Koszt transportu” = koszt transportu w raportach (bez dublowania).
Anulowane, usunięte, robocze i czekające na zatwierdzenie transakcje nie trafiają do pliku; skorygowane — z danymi po korekcie.

## Kolumny

| Kolumna | Zawartość |
|---|---|
| Data załadunku do klienta końcowego | wiersz Sprzedaż: data dokumentu (pole „Data dokumentu”, puste = data operacji) |
| Miejsce załadunku | kolej: bocznica załadunku; produkcja w lesie: nadleśnictwo · leśnictwo; wycinka: budowa; sprzedaż ze stanu, MM, produkcja na placu: magazyn |
| Data operacji | data operacji (data przyjęcia) |
| Dostawca | dostawca zakupu |
| Zakup/Sprzedaż | Zakup / Produkcja / Sprzedaż / MM |
| Nr. WZ | numer transakcji (jedna seria WZ) |
| Czy magazynowane (TAK / NIE) | TAK — ruch zmienia stan magazynu; NIE — towar od razu zużyty / sprzedany (las → odbiorca) |
| Deklaracja/KZR | podstawa zakupu (wiersz Zakup) |
| Volumen, Jednostka miary | ilość ruchu w jednostce dokumentu (m³, MP, t) |
| Cena zakupu/produkcji (zł/mp;zł/tona) | Zakup: cena zakupu; Produkcja: stawka rąbania; jednostka ceny w kolumnie *Jednostka_ceny_zakupu* |
| Wartość | Zakup: wartość zakupu; Produkcja: koszt rąbania; Sprzedaż: przychód |
| Cena sprzedaży (zł/mp;zł/tona) | cena sprzedaży; jednostka w *Jednostka_ceny_sprzedaży* |
| Produkt | nazwa produktu z kartoteki |
| Rodzaj zrębki a/b | **a** — zrębka leśna, **b** — zrębka inwestycyjna (z rodzaju produkcji albo produktu) |
| Rąbanie własne/wynajęte (kto) | „własne — rębak (operator)” albo „wynajęte — firma” |
| Koszt rąbania usługa | koszt rąbania, gdy rębak wynajęty (usługa obca); przy rębaku własnym 0 |
| Transport: Firma | flota własna / firmy zewnętrzne (kilka — po przecinku) / przewoźnik kolejowy / dostawca |
| Nr. Rejestracyjny | numery rejestracyjne kursów; kolej: nr składu i liczba wagonów |
| Odległość km | suma km kursów |
| Koszt transportu | koszt transportu transakcji |
| Odbiorca | odbiorca sprzedaży; MM: magazyn źródłowy → docelowy |
| Uwagi | uwagi operacji i numer dokumentu zewnętrznego (w pierwszym wierszu transakcji) |
| Miejsce pochodzenia | nadleśnictwo · leśnictwo, budowa (wycinka), dostawca · miejscowość, magazyn |
| Data dodania wpisu | data i godzina zapisania transakcji w systemie |
| Wolumen_MP, Wolumen_t, Wolumen_GJ | ilość wiersza przeliczona na MP, tony (waga rzeczywista, gdy wpisana) i energię GJ (t × t_gj) |
| Ruch_magazyn_MP, Ruch_magazyn_t | zmiana stanu magazynu (+ przychód, − rozchód); produkcja na placu: wynik minus zużyty surowiec |
| Wartość_zakupu_zł_calc | wartość zakupu z silnika (zakup + koszt surowca) |
| Wartość_sprzedaży_zł_calc | przychód z silnika |
| Typ_transportu_heurystyka | brak / własny / zewnętrzny (liczba firm, wliczony w cenę) / mieszany / kolejowy / dostawca |
| Koszt_rąbania_total | pełny koszt rąbania (własne i wynajęte) |
| Miesiąc_tekst, Rok | miesiąc słownie i rok daty operacji |
| Jednostka_ceny_zakupu, Jednostka_ceny_sprzedaży | zł/MP, zł/t, zł/m³ |
| Magazyn | magazyn transakcji |

### Dane z planera zakupów

| Kolumna | Zawartość |
|---|---|
| Plan_dnia_MP | plan dnia magazynu z planera (pierwszy wiersz transakcji — bez dublowania przy sumowaniu) |
| Uwagi_planu | uwagi planu dnia |
| Plan_miesiąca_MP | suma planu magazynu w miesiącu operacji |
| Wykonanie_miesiąca_MP | wykonanie planera w miesiącu (zakupy MP: produkcja z zakupu, produkcja w lesie, zakup zrębki) |
| Realizacja_miesiąca_% | wykonanie ÷ plan całego miesiąca |
| Wykonanie_planera_MP | ile MP ta transakcja wnosi do wykonania planu (0 — nie jest zakupem MP) |

Planer ma nadal własny eksport **CSV planera** (dni tygodnia albo miesiące roku: plan, wykonanie, tony, ceny, km, kursy).

Kod: `app/src/trade.js` (`RIW.Trade.COLUMNS`, `RIW.Trade.rows`), testy: `tests/features38.test.mjs`, E2E „3.8 CSV …”.
