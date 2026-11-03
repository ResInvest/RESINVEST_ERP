# ResInvest ERP — proponowane usprawnienia UI (poza zakresem Demo v2.1)

Poniższe punkty **nie zostały zaimplementowane**, bo nie są wymagane do działania funkcji z FAZY 1 i Demo v2.
Kolejność = szacowany wpływ na szybkość wpisywania i liczbę pomyłek.

## Wprowadzone w FAZIE 1, bo były konieczne do poprawnego działania

| Zmiana | Powód |
|---|---|
| Pola liczbowe `type="text" inputmode="decimal"` zamiast `type="number"` | `type="number"` odrzuca `1 250,50` wklejone z Excela i w części przeglądarek zamienia przecinek na pustą wartość |
| Echo „odczytano: 1 250,5” pod polem i normalizacja po opuszczeniu pola | użytkownik widzi, jak system zrozumiał liczbę, zanim zapisze |
| Błędy dopiero po dotknięciu pola lub próbie zapisu; lista błędów z nazwą pola i skokiem do pola | brak „czerwonego” formularza na starcie, szybkie znalezienie braków |
| Panel „Przebieg operacji / Stan przed–po / Plan dokumentów” obok formularza | zależności zakup → zużycie → produkcja → sprzedaż są widoczne przed zapisem |
| Stały przycisk zapisu w panelu (nie przebudowywany przy przeliczeniu) | przebudowa przycisku między `mousedown` a `mouseup` gubiła kliknięcie „Zapisz” zaraz po wpisaniu ceny |
| Dolny pasek „Zapisz operację” na telefonie | na wąskim ekranie panel podsumowania jest pod formularzem |
| Przełącznik samouczka pod polami | początkujący widzą pomoc, doświadczeni ją ukrywają |

## Propozycje

1. **Klawiatura w formularzu** — `Enter` przechodzi do następnego pola zamiast zapisu; skróty `Alt+1…5` do sekcji. Już działa `Ctrl+S` = zapis.
2. **Szablony operacji** — „Powtórz ostatnią operację od tego dostawcy” (dostawca, produkt, cena, NDL, pojazd). Najczęstszy przypadek w obrocie drewnem to powtarzalne dostawy.
3. ~~Sprzedaż bez produkcji~~ — **zrobione w Demo v2** (Sprzedaż z magazynu, WZ).
4. ~~Koszt rąbania~~ — **zrobione w Demo v2** (Cena za rąbanie, domyślnie 10 zł/MP). Do rozważenia: koszt jednostkowy 1 MP zrębki (surowiec + rąbanie + transport) w raporcie.
5. **Słowniki z wyszukiwaniem** — przy >30 kontrahentach `select` zastąpić polem z podpowiedziami (komponent `Autocomplete` z 1.3.0), z dodawaniem nowej pozycji zależnym od uprawnień.
6. **Skan kwitu wywozowego / kwitu wagowego** — załącznik do PW/PZ (mechanizm `Scans` z 1.3.0).
7. **Cykl inwentaryzacji z FAZY 2** — statusy W TRAKCIE i GOTOWA DO ZAMKNIĘCIA, drugi podpis (kierownik zatwierdza spis magazyniera).
8. **Przełącznik motywu** — v2 jest jasny (wymaganie); ciemny Grafit z v1 można przywrócić jako opcję dla pracy nocnej.
9. ~~Wydruk dokumentów~~ — **zrobione w Demo v2.1** (druk i PDF z logo, numerem i polami podpisu).
10. **Walidacja numeru kwitu** według formatu LP i ostrzeżenie o duplikacie kwitu w historii.
11. **Mapa miejsca transportu** — podpowiedź odległości (km) dla znanych miejsc dostawy na podstawie historii kursów.
12. **Powiadomienie o zbliżającym się przełomie miesiąca** z listą pozycji bez spisu.
13. **Sprzedaż WZ z wielu pozycji** — jeden dokument WZ z kilkoma towarami (np. zrębka + PKS dla jednego odbiorcy).
14. **Import listy wagonów** — wklejenie tonaży z listu przewozowego / Excela (kolumna liczb) do tabeli wagonów jednym ruchem.
15. **Masa orientacyjna per produkt** w kartotece produktów (teraz: jedna wartość dla drewna w konfiguracji).
