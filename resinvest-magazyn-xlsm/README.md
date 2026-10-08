# ResInvest Magazyn Zabrze — program magazynowy w Excelu (XLSM), wersja 4.0

Plik `ResInvest_Magazyn_Zabrze_4.0.xlsm` to rozwinięcie dotychczasowego skoroszytu
`ResInvest_Magazyn_Zabrze_CZYSTY_TRANSPORT-2.xlsm`. **Wszystkie dane zostały przeniesione**
(577 wierszy arkusza `Dane`), tabele przestawne, model danych, fragmentatory i raporty pozostały bez zmian w budowie.

## Co się zmieniło

| Obszar | Było | Jest |
|---|---|---|
| Transport | osobny typ operacji `TRANSPORT` (w starszych wersjach) i pola transportu zawsze widoczne | **pole wyboru „Transport”** w formularzu; po zaznaczeniu sekcja *Dane transportu* (przewoźnik, pojazd, nr rej., operator/kierowca, trasa, km, koszt). Transport jest częścią operacji Zakup / Produkcja (także Sprzedaż i MM). Koszt zapisywany raz — w wierszu głównym operacji |
| Produkcja | automatyczne „zużycie” tej samej ilości produktu (`Zrzyna`/zrębka) | zużycie **surowca z receptury** (arkusz `RECEPTURY`): 120 MP *Zrębki Produkcyjnej Leśnej* zużywa 30 m³ *Drewna opałowego z lasu* (1 m³ = 4 MP). Zrębka nigdy nie jest zużywana jako surowiec |
| Brak surowca | stan mógł zejść poniżej zera | blokada z komunikatem: *stan / wymagane / brakuje* |
| Zatwierdzenie | bez podsumowania | podsumowanie przed zapisem: produkt, ilość, **surowiec do zużycia**, stan przed → po, transport |
| Korekta / usunięcie | brak (ręczna edycja wierszy) | przyciski **KOREKTA** i **USUŃ**: poprzednia wersja trafia do arkusza `ARCHIWUM`, stany są przeliczane (np. 120 → 80 MP: drewno −20 m³, zrębka +80 MP) |
| Historia zmian | brak | arkusz `HISTORIA_ZMIAN`: kto, kiedy, pole, było → jest, powód (np. *Transport: NIE → TAK*, *Receptura produkcji (surowiec): Zrębka → Drewno opałowe z lasu*) |
| Rejestr | — | arkusz `REJESTR_OPERACJI`: jedna linia = jedna operacja (Data, Typ, Materiał, Ilość, Jednostka, **Transport Tak/Nie**…) |
| Dokument | — | przycisk **DOKUMENT PDF**: dokument operacji; sekcja *Dane transportu* tylko gdy Transport = TAK |

### Nowe kolumny tabeli `Tabela_dane` (AM–AT)
`ID_operacji` · `Transport` (TAK/NIE) · `Trasa` · `Pojazd` · `Operator_kierowca` · `Rola_wiersza` (GŁÓWNY / ZUŻYCIE AUTO / PRODUKCJA AUTO / SPRZEDAŻ AUTO) · `Receptura` · `Wersja`

### Migracja danych historycznych
* każdy wiersz dostał `ID_operacji` (`H-0001`…); wiersze zapisane razem przez stary formularz
  (wiersz główny + wiersze „Automatyczna produkcja/zużycie/sprzedaż” o tym samym nr WZ, dacie i minucie wpisu) mają wspólne ID — razem 475 operacji,
* `Transport` = TAK, jeśli wiersz miał wypełnioną firmę / nr rej. / km / koszt transportu (204 wiersze),
* wartości historyczne (ilości, produkty, koszty) **nie zostały zmienione** — także dawne wiersze ZUŻYCIE zapisane na zrębce. Przy korekcie takiej operacji zużycie zostanie przeliczone według receptury, a zmiana surowca zapisze się w historii,
* `MAGAZYN!AA12:AC12` (liczba kursów, km, koszt transportu) liczą teraz z kolumny `Transport` zamiast z typu „TRANSPORT”,
* „TRANSPORT” usunięto z listy typów operacji w `SŁOWNIK`.

## Instalacja i uruchomienie
1. Skopiuj `ResInvest_Magazyn_Zabrze_4.0.xlsm` w miejsce pracy (np. OneDrive/SharePoint jak dotychczas).
2. Otwórz w Excelu (Microsoft 365 / 2016+ dla Windows) i **włącz makra** (*Włącz zawartość*). Jeśli plik pochodzi z internetu: *Właściwości pliku → Odblokuj*.
3. Przy pierwszym otwarciu Excel kompiluje projekt VBA ze źródeł (plik nie zawiera skompilowanego p-kodu) — to trwa chwilę i jest jednorazowe. Zapisz plik.
4. *Dane → Odśwież wszystko*, aby tabele przestawne i model danych objęły nowe kolumny.

Praca: arkusz **REJESTR_OPERACJI** → przyciski **NOWA OPERACJA / KOREKTA / USUŃ / DOKUMENT PDF / ODŚWIEŻ** (przycisk **DODAJ** na arkuszu TRANSPORT działa jak dotąd).
Receptury: arkusz **RECEPTURY** (produkt wyjściowy, JM, surowiec, JM surowca, przelicznik, aktywna).

## Testy
Moduł `modTesty` (makro `UruchomTesty`) zawiera 17 scenariuszy (10 wymaganych + łańcuch zakup→produkcja, blokada receptury ze zrębką, receptura z konfiguracji, migracja, rejestr, dokument).
**Uruchamiaj wyłącznie na kopii pliku, w której nazwie jest „TEST”** — testy dopisują i usuwają operacje na produktach „TEST …”. Wyniki: arkusz `TESTY`.

Automatycznie (bez Excela, LibreOffice headless):
```
python3 tools/build_workbook.py <oryginał.xlsm> src dist/ResInvest_Magazyn_Zabrze_4.0.xlsm
cp dist/ResInvest_Magazyn_Zabrze_4.0.xlsm /tmp/Magazyn_TEST.xlsm
python3 tools/lo_run.py /tmp/Magazyn_TEST.xlsm VBAProject.modTesty.UruchomTesty /tmp/wynik.xlsx
```

## Struktura repozytorium
```
dist/ResInvest_Magazyn_Zabrze_4.0.xlsm   gotowy plik
src/                                    źródła VBA (UTF-8; przy budowie konwertowane do CP1250)
  modMagazyn.bas   silnik: receptury, stany, walidacja, zapis, korekta, usuwanie, historia, rejestr, dokument
  clsOperacja.cls  model operacji
  frmDane.frm      formularz operacji (kod; projekt formularza bez zmian — nowe kontrolki tworzone w kodzie)
  frmDodatkowe.frm drugi krok zakupu (produkcja/sprzedaż)
  modTesty.bas     testy scenariuszy
  Module1.bas, Arkusz6_REJESTR.cls
tools/
  build_workbook.py  budowa XLSM z oryginału (migracja, nowe arkusze, formuły, VBA)
  vbaproj.py         zapis projektu VBA (MS-CFB + MS-OVBA)
  lo_run.py          uruchamianie makr w LibreOffice (testy)
docs/ZMIANY-4.0.md     szczegóły zmian i ograniczenia
```

## Ograniczenia (ważne)
* Plik zbudowano i przetestowano bez Microsoft Excela — logikę (17 scenariuszy) wykonano w LibreOffice. **Formularze (UserForm) nie zostały uruchomione w Excelu** — sprawdź wygląd formularza „Nowa operacja” po pierwszym otwarciu (pole Transport, sekcja Dane transportu, informacja o recepturze).
* Ten plik w repozytorium nie zastępuje oryginału — oryginał pozostaje bez zmian.
