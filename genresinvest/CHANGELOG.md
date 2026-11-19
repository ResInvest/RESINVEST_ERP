# Historia zmian

## 1.0.0 — 2026-11-19

Pierwsze wydanie GenResInvest.

* Zlecenia: szkic → wystawienie (numer bez luk) → korekty (rewizje z powodem) → anulowanie; duplikowanie.
* Dokumenty PDF (natywnie) i DOCX (na papierze firmowym ResInvest), podgląd przed zapisem, archiwum z SHA-256.
* Listy rozwijane z wyszukiwaniem i dopisywaniem: kontrahenci, opisy usług, ceny netto, jednostki, osoby prowadzące.
* Walidacja (NIP, kody, telefony, kwoty) z fokusem na pierwszym błędzie; obsługa klawiatury.
* Kartoteka kontrahentów z importem/eksportem CSV; słowniki; kartoteki JSON.
* Raporty roczne i okresowe, eksport rejestru XLSX/CSV.
* Historia operacji z porównaniem zmian i filtrami.
* Konta i role, blokada logowania, wymuszona zmiana hasła startowego.
* Kopie zapasowe automatyczne i ręczne, przywracanie z kopią bezpieczeństwa.
* Instalator Windows (PyInstaller + Inno Setup).
