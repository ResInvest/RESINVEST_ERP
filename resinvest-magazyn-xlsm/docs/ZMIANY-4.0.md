# ResInvest Magazyn Zabrze 4.0 — szczegóły zmian

## 1. Model danych (arkusz `Dane`, tabela `Tabela_dane`)
Rozszerzono istniejącą tabelę zamiast tworzyć nową (raporty i model danych korzystają z `Tabela_dane`).

| Kol. | Nazwa | Znaczenie |
|---|---|---|
| AM | ID_operacji | `OP-000001` (nowe) lub `H-0001` (historyczne). Wszystkie wiersze jednej operacji mają to samo ID |
| AN | Transport | TAK / NIE — flaga operacji (odpowiednik `operation.transportEnabled`) |
| AO | Trasa | np. „Myszków → Zabrze” |
| AP | Pojazd | opis pojazdu |
| AQ | Operator_kierowca | operator / kierowca |
| AR | Rola_wiersza | GŁÓWNY, ZUŻYCIE AUTO, PRODUKCJA AUTO, SPRZEDAŻ AUTO |
| AS | Receptura | np. „Drewno opałowe z lasu → Zrębka Produkcyjna Leśna (1 m³ = 4 MP)” |
| AT | Wersja | 1, 2, … (rośnie przy każdej korekcie) |

Istniejące kolumny transportu (R firma, S nr rej., T km, U koszt, AL koszt bazowy) są wypełniane **tylko w wierszu GŁÓWNYM** i tylko przy Transport = TAK — koszt transportu liczy się raz na operację.

## 2. Logika produkcji
* Receptura: arkusz `RECEPTURY` (produkt wyjściowy, JM, surowiec, JM surowca, przelicznik = ilość produktu z 1 jednostki surowca, aktywna).
* Zużycie = ilość produkcji (przeliczona do JM receptury) ÷ przelicznik. 120 MP ÷ 4 = 30 m³.
* Stan surowca liczony identycznie jak kolumna `Ruch_magazyn_MP` (wiersze „Czy magazynowane = TAK”; ZAKUP/PRODUKCJA +, SPRZEDAŻ/ZUŻYCIE −; m³ × 4, t ÷ 0,33), w jednostce surowca.
* Brak surowca → operacja odrzucona: „Niewystarczający stan surowca. Drewno opałowe z lasu: stan 10 m³, wymagane 30 m³, brakuje 20 m³”.
* Receptura wskazująca zrębkę jako surowiec jest odrzucana.
* Zakup z produkcją (krok 2 formularza): surowcem musi być zakupiony produkt; zakup wchodzi na stan (TAK), zużycie wg receptury (TAK), produkcja +. Dawny zapis (ZAKUP NIE + ZUŻYCIE NIE z ilością zakupu) zastąpiony.
* Koszt rąbania zapisywany tylko w wierszu produkcji (wcześniej kopiowany do wszystkich wierszy operacji).

## 3. Korekta i usunięcie
* Korekta: nowe wiersze operacji (to samo ID, Wersja + 1) zapisywane są przed usunięciem starych; stare wiersze kopiowane do `ARCHIWUM` (data, użytkownik, akcja KOREKTA, powód). Stan po korekcie = stan bez starej wersji + nowa wersja (120 → 80 MP: −20 m³ drewna, +80 MP).
* Usunięcie: potwierdzenie ze skutkiem magazynowym (np. Drewno +30 m³, Zrębka −120 MP), wiersze do `ARCHIWUM` (USUNIĘCIE), wpis w historii.
* Dane nie są tracone fizycznie — pełna kopia każdej wersji w `ARCHIWUM`. W `Dane` zostaje wyłącznie aktualna wersja, dzięki czemu tabele przestawne liczą poprawnie bez zmian ich budowy.
* Historia (`HISTORIA_ZMIAN`) zapisuje różnice pól: typ, data, kontrahenci, produkt, ilość, JM, ceny, Transport, przewoźnik, pojazd, nr rej., operator, trasa, km, koszt, produkcja, **receptura (surowiec)**, zużycie, uwagi, wersja.

## 4. Formularze
Projekty formularzy (`frmDane`, `frmDodatkowe`) nie zostały zmienione binarnie. Nowe kontrolki tworzy kod przy otwarciu:
* pole wyboru **Transport** na górze ramki transportu; pola Trasa / Pojazd / Operator–kierowca w nowym rzędzie ramki; sekcja ukrywana przy odznaczeniu,
* etykieta receptury w ramce produktu (surowiec, stan, zużycie, ostrzeżenie o braku),
* ramki rosną, kontrolki pod nimi przesuwają się w dół (przy małym ekranie formularz dostaje pasek przewijania).

## 5. Raporty
* `MAGAZYN!AA12` = `COUNTIFS(Dane!AN:AN,"TAK",Dane!AR:AR,"GŁÓWNY")` (liczba operacji z transportem),
* `AB12` / `AC12` = suma km / kosztu transportu z wierszy z Transport = TAK.
* Pozostałe tabele przestawne (MAGAZYN, KONTRAHENCI, TRANSPORT) korzystają z `Tabela_dane` jak dotąd; po *Odśwież wszystko* obejmują nowe kolumny.

## 6. Weryfikacja
* 17 scenariuszy `modTesty.UruchomTesty` — wynik w LibreOffice 24.2 (headless): **17 OK / 0 BŁĄD** (szczegóły w opisie commita).
* Wszystkie części XML poprawne składniowo; projekt VBA odczytany niezależnie przez `olevba` i LibreOffice.
* Nie sprawdzono w Microsoft Excelu (brak w środowisku budowy): kompilacji formularzy, wyglądu formularza po dodaniu kontrolek, odświeżenia modelu danych Power Pivot z nowymi kolumnami.
