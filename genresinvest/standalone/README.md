# GenResInvest 1.0 — wersja HTML (jeden plik, offline)

**`dist/GenResInvest.html`** (ok. 1 MB) — otwórz dwuklikiem w Chrome, Edge lub Firefox (komputer lub telefon).
Bez instalacji, serwera i internetu.

## Co zawiera

| Moduł | Opis |
|---|---|
| **Generator zleceń** | Zleceniobiorca, krótki/dokładny opis usługi, cena netto (wiele pozycji, ilość → wartość), płatność, punkty, termin załadunku, osoby, podpisy — układ dotychczasowych zleceń. |
| **Generator zamówień** | Układ wzoru „Zamówienie DRENO”: przedmiot, Zamawiający, Sprzedający, czas obowiązywania, miejsce odbioru, ilość z tolerancją ±%, jednostka, surowiec i pomiar, termin i metoda płatności, cena netto/jednostkę, wartość, uwagi z biblioteki klauzul. |
| **Podgląd na żywo** | Papier A4 z nagłówkiem firmowym obok formularza; pole, w którym jest kursor, podświetla się na dokumencie. |
| **PDF i DOCX** | Generowane w przeglądarce: PDF z osadzonymi czcionkami (polskie znaki), DOCX na oryginalnym `Papier_firmowy_ResInvest.docx`. |
| **Listy z dopisywaniem** | Kontrahenci (nowy kontrahent w oknie bez wychodzenia z formularza), usługi, cennik tras, przedmioty, miejsca odbioru, klauzule, metody płatności, jednostki, osoby. |
| **Walidacja i fokus** | NIP (suma kontrolna), kod pocztowy, telefon, kwoty, daty; komunikat przy polu, kursor na pierwszym błędzie, Enter → następne pole, Ctrl+S zapis. |
| **Cykl dokumentu** | Szkic („PROJEKT”) → wystawienie (numer `ZL/001/11/2026`, `ZAM/001/11/2026`, bez luk) → korekty z powodem (rewizje) → anulowanie; duplikowanie. |
| **Rejestry, raporty, historia** | Filtry, wyszukiwanie, eksport CSV; raport roczny/miesięczny, kontrahenci, przedmioty, trasy; historia operacji „było / jest”. |
| **Dane** | IndexedDB (zapis transakcyjny po każdej zmianie), migawki dzienne (30), kopia do pliku `.json` z sumą SHA-256, przywracanie, synchronizacja między kartami. |
| **Wygoda** | Ctrl+K — wyszukiwanie i polecenia, Alt+N / Alt+M — nowe zlecenie / zamówienie, tryb ciemny, profile użytkowników z PIN. |

## Ważne — gdzie są dane

Dane zapisują się w przeglądarce **na tym komputerze** (osobno dla Chrome i Edge). Dlatego:

* rób **kopię do pliku** co tydzień (Ustawienia i dane → Zapisz kopię) i trzymaj ją na dysku sieciowym — pulpit przypomina o tym po 7 dniach,
* przeniesienie na inny komputer = kopia do pliku → otwórz program na nowym komputerze → Przywróć z pliku,
* do pracy kilku osób jednocześnie na wspólnych danych służy wersja serwerowa GenResInvest (instalator Windows w katalogu nadrzędnym).

## Budowa i testy

```bash
python standalone/build.py                                   # → standalone/dist/GenResInvest.html
node standalone/tests/e2e.js    /tmp/wyniki standalone/dist/GenResInvest.html   # pełny przepływ (Playwright)
node standalone/tests/backup.js /tmp/wyniki standalone/dist/GenResInvest.html   # kopia → przywrócenie → wykrycie podmiany
```

Źródła: `src/index.html`, `src/styles.css`, `src/js/*.js` (łączone w kolejności nazw). Biblioteki w `vendor/`:
jsPDF 2.5.2 (MIT), fflate 0.8.2 (MIT). Zasoby (papier firmowy, nagłówek, czcionki) z `../app/assets`.
