/* =========================================================================
   ResInvest ERP 3.16 — EUDR: treści szkoleń, bazy wiedzy i scenariuszy ćwiczeń (język polski).
   Treści mają charakter szkoleniowy i wewnętrzny — nie są poradą prawną ani oficjalnym materiałem Komisji Europejskiej.
   Ukończenie szkolenia potwierdza wyłącznie firma (wewnętrznie) — to nie jest certyfikat Komisji Europejskiej.
   Wszystkie dane w przykładach i ćwiczeniach są fikcyjne i nie identyfikują rzeczywistych dostawców ani transakcji.
   Źródło stanu prawnego: rozporządzenie (UE) 2023/1115 zmienione rozporządzeniem (UE) 2025/2650 (stan: listopad 2026).
   ========================================================================= */
(function (root) {
  "use strict";
  const R = root.RIW || (typeof require === "function" ? require("./engine.js") : null);

  /* ---------------- Baza wiedzy: 11 instrukcji ---------------- */
  const guides = [
    { key: "access", title: "1. Dostęp do systemu EUDR (TRACES) i do API",
      goal: "Założyć konto firmy w systemie informacyjnym EUDR i — jeśli firma chce łączyć ResInvest ERP z systemem — uzyskać dane dostępowe użytkownika usług sieciowych.",
      steps: ["Załóż konto EU Login dla osoby odpowiedzialnej (konto osobowe, nie anonimowe).", "Zaloguj się w systemie EUDR i zarejestruj firmę jako podmiot (operator / handlowiec) albo dołącz do istniejącego wpisu firmy.",
        "Po zatwierdzeniu wpisu firmy: w profilu użytkownika otwórz „Edit Profile” i odczytaj nazwę użytkownika (username).", "W sekcji „Web Services Access” aktywuj dostęp i odczytaj klucz uwierzytelniający (Authentication Key) — klucz jest poufny.",
        "Przekaż administratorowi serwera nazwę użytkownika, klucz i identyfikator klienta (WebServiceClientId); administrator wpisuje je wyłącznie w pliku server.env serwera firmy.",
        "Najpierw przetestuj połączenie w środowisku ACCEPTANCE (Centrum testów), dopiero potem powtórz procedurę dla środowiska PRODUCTION."],
      figure: ["EU Login", "Rejestracja firmy", "Edit Profile → username", "Web Services Access → klucz", "server.env (serwer)", "Test ACCEPTANCE"],
      example: "Firma PRZYKŁAD sp. z o.o. (fikcyjna) zakłada konto EU Login dla kierownika ds. zgodności, rejestruje się jako operator, a po aktywacji dostępu do usług sieciowych wpisuje dane w server.env serwera w swojej siedzibie.",
      mistakes: ["Przekonanie, że samo konto EU Login daje dostęp do API — dostęp trzeba osobno aktywować w profilu.", "Wpisywanie klucza w przeglądarce, w arkuszu lub w repozytorium kodu.", "Pierwsze testy od razu w środowisku produkcyjnym.", "Konto wspólne dla kilku osób — osoba z EU Login odpowiada za przesyłane dane."] },
    { key: "role", title: "2. Ustalenie roli firmy i obowiązków",
      goal: "Ustalić dla każdego rodzaju transakcji, czy firma działa jako operator, pierwszy podmiot niższego szczebla czy handlowiec — od tego zależą wymagane dokumenty i blokady.",
      steps: ["Otwórz EUDR → Administracja → Profil firmy; wybierz wielkość przedsiębiorstwa (data stosowania obowiązków: 30.12.2026 albo 30.06.2027).", "Przypisz produktom ERP kody CN (drewno opałowe, zrębka: 4401).",
        "Przy każdej partii wybierz sposób nabycia: pozyskanie własne / import (operator), zakup od operatora z DDS, zakup od mikro/małego producenta (deklaracja uproszczona), zakup od handlowca.",
        "Sprawdź na karcie partii pole „Obowiązki” — program pokazuje rolę, wymagane dokumenty i datę stosowania."],
      figure: ["Kod CN w załączniku I?", "Sposób nabycia", "Rola w transakcji", "Wymagane dokumenty i blokady"],
      example: "Zrębka kupiona od firmy, która złożyła DDS (fikcyjny dostawca „Drewno-Test”): firma jest pierwszym podmiotem niższego szczebla — zbiera i przechowuje numer referencyjny DDS dostawcy; nie składa własnego DDS przy dalszej sprzedaży w UE.",
      mistakes: ["Traktowanie każdej dostawy jak wymagającej własnego DDS.", "Blokowanie przyjęcia wyłącznie z powodu braku numeru DDS dostawcy bez ustalenia roli.", "Pomijanie drewna opałowego i zrębki (pozycja 4401 jest w załączniku I)."] },
    { key: "receipt", title: "3. Przyjęcie dostawy i utworzenie partii",
      goal: "Nadać partii drewna własny identyfikator bez ponownego wpisywania danych z dokumentu przyjęcia.",
      steps: ["Wprowadź zakup w ERP jak dotąd (Nowa operacja → Zakup).", "W EUDR → Rejestr drewna → „Przyjęcia do przypisania” wybierz dokument.", "Kliknij „Utwórz partię” (dane: ilość, dostawca, magazyn, data przepisane z dokumentu) albo „Przypisz do istniejącej partii”.",
        "Uzupełnij gatunek (polski i łaciński), okres pozyskania i pochodzenie.", "Zapisz i przekaż partię do weryfikacji."],
      figure: ["Zakup w ERP (PZ)", "Przyjęcia do przypisania", "Utwórz / przypisz partię", "Uzupełnij pochodzenie", "Do weryfikacji"],
      example: "Dokument zakupu 30 m³ drewna sosnowego (dane fikcyjne) → partia EUDR/2026/0001, 30 m³, magazyn RiC Zabrze, gatunek Pinus sylvestris.",
      mistakes: ["Tworzenie partii ręcznie, gdy istnieje dokument przyjęcia (podwójne wprowadzanie).", "Brak nazwy łacińskiej gatunku — jest wymagana w DDS dla drewna.", "Jedna partia dla kilku różnych dostaw bez zapisu źródeł."] },
    { key: "docs", title: "4. Dokumentacja partii i dostawcy",
      goal: "Zgromadzić i opisać dokumenty potwierdzające pochodzenie i legalność.",
      steps: ["Otwórz partię → zakładka Dokumenty → „Dodaj dokument”.", "Wybierz rodzaj (zakup, faktura, przewozowy, legalność, prawo do pozyskania, mapa, GPS, oświadczenie dostawcy…).", "Dołącz plik PDF / JPG / PNG / GeoJSON; dokument dostawcy (np. oświadczenie roczne) przypnij do dostawcy.",
        "Kontroler dokumentacji sprawdza dokument i oznacza „Sprawdzony” albo „Odrzucony” z uwagą.", "Nową wersję pliku dodaje się przyciskiem „Zastąp plik” — poprzednie wersje zostają w historii."],
      figure: ["Rodzaj dokumentu", "Plik", "Powiązanie: partia / dostawca", "Sprawdzenie", "Wersje"],
      example: "Do partii fikcyjnej EUDR/2026/0002 dodano fakturę zakupu, dokument przewozowy i oświadczenie dostawcy z numerem referencyjnym DDS.",
      mistakes: ["Zdjęcie dokumentu nieczytelne lub obcięte.", "Dokument bez powiązania z partią.", "Usuwanie starych wersji zamiast dodania nowej."] },
    { key: "geo", title: "5. Geolokalizacja: GPS i polygon GIS",
      goal: "Zapisać położenie działek, z których pozyskano drewno (wymóg dla operatora).",
      steps: ["Działka do 4 ha: wystarczy punkt GPS (szerokość, długość, do 6 miejsc po przecinku).", "Działka powyżej 4 ha: wymagany wielokąt (polygon) — wczytaj plik GeoJSON z systemu GIS albo od dostawcy.",
        "Współrzędne w układzie WGS84, kolejność w GeoJSON: długość, szerokość; wielokąt zamknięty, bez otworów.", "Program sprawdza plik przy zapisie i pokazuje błędy."],
      figure: ["Powierzchnia ≤ 4 ha → punkt", "Powierzchnia > 4 ha → polygon", "WGS84 (lon, lat)", "Kontrola programu"],
      example: "Punkt fikcyjny: 50.183000, 18.356000 (działka 3,2 ha). Polygon fikcyjny: prostokąt 0,004° × 0,003°.",
      mistakes: ["Zamiana kolejności szerokości i długości w GeoJSON.", "Więcej niż 6 miejsc po przecinku.", "Punkt zamiast wielokąta dla działki powyżej 4 ha.", "Linie (LineString) zamiast wielokąta."] },
    { key: "dd", title: "6. Należyta staranność krok po kroku",
      goal: "Przeprowadzić i udokumentować trzy etapy należytej staranności — decyzje podejmuje człowiek.",
      steps: ["Etap 1 (art. 9): sprawdź każdą pozycję listy informacji; program pokazuje podpowiedź, ale potwierdzasz Ty.", "Etap 2 (art. 10): oceń kryteria ryzyka (kraj, złożoność łańcucha, korupcja, zgłoszenia) i wybierz wynik z uzasadnieniem.",
        "Etap 3 (art. 11): przy ryzyku nie-znikomym opisz środki (dodatkowe dokumenty, audyt dostawcy, weryfikacja w terenie) i oceń ryzyko rezydualne.", "Osoba odpowiedzialna zatwierdza wynik końcowy z uzasadnieniem — dopiero wtedy partia jest „Dopuszczona”."],
      figure: ["Etap 1: informacje", "Etap 2: ryzyko", "Etap 3: środki", "Zatwierdzenie osoby odpowiedzialnej"],
      example: "Partia fikcyjna z kraju niskiego ryzyka, z kompletem dokumentów: etap 1 potwierdzony, etap 2 — ryzyko znikome z uzasadnieniem, zatwierdzenie przez kierownika.",
      mistakes: ["Zatwierdzanie partii na podstawie samej zielonej kontrolki formularza.", "Brak uzasadnienia wyniku oceny ryzyka.", "Ryzyko wysokie w jednym kryterium, a wynik „znikome” bez środków."] },
    { key: "dds", title: "7. Złożenie DDS w systemie EUDR (proces kontrolowany)",
      goal: "Złożyć oświadczenie o należytej staranności, gdy firma działa jako operator.",
      steps: ["EUDR TRACES → Nowy wpis DDS (rodzaj: własne) → wybierz partie.", "Krok 1–2: przygotuj i pobierz zestaw danych (JSON, GeoJSON, XML).", "Krok 3: przycisk „OTWÓRZ OFICJALNY SYSTEM EUDR TRACES” — zaloguj się kontem EU Login.",
        "Krok 4: wprowadź dane / wczytaj GeoJSON i złóż oświadczenie.", "Krok 5: wpisz numer referencyjny i weryfikacyjny.", "Krok 6: po co najmniej godzinie sprawdź status i powiąż z wydaniem."],
      figure: ["Zestaw danych", "Plik", "System EUDR", "Złożenie", "Numery", "Status i WZ"],
      example: "Ćwiczenie w środowisku ACCEPTANCE: numer nadany w systemie testowym zapisuje się tylko w ewidencji testowej.",
      mistakes: ["Składanie oświadczeń testowych w środowisku produkcyjnym.", "Przepisywanie numeru testowego do ewidencji produkcyjnej.", "Sprawdzanie statusu co kilka minut (zalecane co najmniej 1 godzina)."] },
    { key: "refs", title: "8. Numery referencyjne i weryfikacyjne dostawców",
      goal: "Zebrać i przechowywać numery DDS / identyfikatory deklaracji uproszczonych otrzymane od dostawców.",
      steps: ["Przy zakupie od operatora poproś o numer referencyjny i weryfikacyjny DDS (na fakturze, WZ lub w oświadczeniu).", "EUDR TRACES → Nowy wpis → rodzaj „DDS dostawcy” albo „Deklaracja uproszczona”; powiąż z dostawcą i partią.",
        "Program sprawdza format numeru; numer testowy nie zostanie przyjęty do ewidencji produkcyjnej.", "Dokument z numerem dołącz w Dokumentacji."],
      figure: ["Dostawca", "Numer referencyjny + weryfikacyjny", "Wpis w rejestrze", "Powiązanie z partią"],
      example: "Fikcyjny dostawca przekazał numer 26PLTEST000001 (przykład formatu, nie istnieje) — zapisany w trybie ACCEPTANCE do ćwiczenia.",
      mistakes: ["Brak numeru weryfikacyjnego.", "Numer zapisany tylko w notatce, bez powiązania z partią.", "Przepisanie numeru z innej dostawy."] },
    { key: "release", title: "9. Wydanie (WZ) i informacja dla odbiorcy",
      goal: "Wydać drewno z zachowaniem identyfikowalności i zgodnie z obowiązkami.",
      steps: ["Wprowadź sprzedaż w ERP.", "Na karcie partii → „Powiąż dokument” → WZ, ilość.", "Program sprawdza obowiązki: dla roli operatora po dacie stosowania brak DDS blokuje wydanie; w pozostałych przypadkach pokazuje ostrzeżenie.",
        "Przekaż odbiorcy wymagane informacje (np. numer referencyjny DDS) zgodnie z rolą firmy."],
      figure: ["Sprzedaż (WZ)", "Powiązanie z partią", "Kontrola obowiązków", "Informacja dla odbiorcy"],
      example: "Partia fikcyjna dopuszczona, z DDS dostawcy → wydanie bez blokady; partia operatora bez własnego DDS → blokada po 30.12.2026.",
      mistakes: ["Wydanie z partii bez salda.", "Obejście blokady bez uzasadnienia.", "Brak danych odbiorcy w dokumencie sprzedaży."] },
    { key: "chain", title: "10. Przesunięcia, przetwarzanie, podział i łączenie partii",
      goal: "Zachować pochodzenie przy MM, produkcji zrębki, dzieleniu i mieszaniu.",
      steps: ["MM: powiąż partię z dokumentem MM — przy części ilości program tworzy partię pochodną w magazynie docelowym.", "Produkcja: „Przetworzenie” — wybierz partie surowca i ilości, wskaż wyrób (np. zrębka) — nowa partia zachowuje źródła.",
        "Podział: partia na części (np. dwa place). Łączenie: kilka partii w jedną (lista źródeł zostaje).", "Zakładka „Identyfikowalność” pokazuje cały łańcuch."],
      figure: ["Partia źródłowa", "MM / produkcja / podział / łączenie", "Partia pochodna", "Pochodzenie zachowane"],
      example: "Dwie partie fikcyjne drewna sosnowego zrębkowane do partii zrębki — partia zrębki ma dwa źródła i ich geolokalizacje.",
      mistakes: ["Mieszanie drewna objętego i nieobjętego EUDR bez zapisu.", "Produkcja bez wskazania partii surowca.", "Łączenie partii z różnych magazynów."] },
    { key: "audit", title: "11. Audyt wewnętrzny i przechowywanie dokumentów",
      goal: "Okresowo sprawdzić system należytej staranności i przechowywać dokumentację co najmniej 5 lat.",
      steps: ["EUDR → Audyt → Nowy audyt; oceń 13 obszarów (program podpowiada dane, oceniasz Ty).", "Dla niezgodności wpisz braki, zalecenia, osobę odpowiedzialną i termin.", "Zakończ audyt, ustal termin kolejnego, pobierz raport PDF.",
        "Sprawdzaj kopie zapasowe: dokumenty EUDR są w folderze skanów serwera i kopii zapasowej."],
      figure: ["13 obszarów", "Wyniki i braki", "Zalecenia i terminy", "Raport PDF", "Kolejny audyt"],
      example: "Audyt fikcyjny: 11 obszarów spełnionych, 2 częściowo — wynik 92 % (wynik wewnętrzny, nie certyfikat zgodności).",
      mistakes: ["Traktowanie wyniku procentowego jako potwierdzenia zgodności z prawem.", "Brak terminów działań naprawczych.", "Usuwanie dokumentów przed upływem 5 lat."] }
  ];

  /* ---------------- Szkolenia: 5 modułów ---------------- */
  const modules = [
    { key: "basics", title: "Podstawy EUDR", pass: 80, lessons: [
      { title: "Cel i zakres rozporządzenia", body: ["EUDR zakazuje wprowadzania do obrotu w UE, udostępniania i wywozu produktów, które nie są wolne od wylesiania, nie zostały wyprodukowane legalnie albo nie są objęte oświadczeniem o należytej staranności.", "Dotyczy siedmiu towarów, w tym drewna; produkty z drewna wymienia załącznik I (m.in. 4401 — drewno opałowe, zrębka, trociny, pellet)."] },
      { title: "Data graniczna i terminy", body: ["Wolne od wylesiania oznacza pozyskanie z terenów niewylesionych po 31 grudnia 2020 r.", "Po zmianie rozporządzeniem 2025/2650 obowiązki stosuje się od 30 grudnia 2026 r. (duże i średnie przedsiębiorstwa), a dla mikro i małych od 30 czerwca 2027 r. (wyjątki — m.in. podmioty objęte wcześniej EUTR)."] },
      { title: "Role uczestników łańcucha", body: ["Operator wprowadza produkt jako pierwszy na rynek UE albo go wywozi — przeprowadza należytą staranność i składa DDS.", "Podmiot niższego szczebla i handlowiec dalej obracają produktem — zbierają i przechowują informacje o dostawcach i odbiorcach; pierwszy podmiot niższego szczebla przechowuje numer DDS lub identyfikator deklaracji uproszczonej."] }],
      quiz: [
        { q: "Data graniczna „wolne od wylesiania” to:", o: ["31.12.2020", "30.12.2026", "01.01.2023"], a: 0 },
        { q: "Czy drewno opałowe i zrębka (4401) są objęte EUDR?", o: ["Tak", "Nie", "Tylko drewno tropikalne"], a: 0 },
        { q: "Od kiedy obowiązki stosuje duża firma?", o: ["30.12.2026", "30.06.2027", "30.12.2025"], a: 0 },
        { q: "Kto składa DDS?", o: ["Operator", "Każdy handlowiec przy każdej sprzedaży", "Przewoźnik"], a: 0 },
        { q: "Czy wynik procentowy audytu wewnętrznego jest certyfikatem zgodności?", o: ["Nie", "Tak", "Tak, jeśli ponad 90 %"], a: 0 }] },
    { key: "wood", title: "Drewno surowe w praktyce", pass: 80, lessons: [
      { title: "Partia i identyfikowalność", body: ["Partia ma własny identyfikator i łączy się z dokumentem przyjęcia; ruchy (MM, produkcja, WZ) zapisuje się jako powiązania z dokumentami ERP — bez drugiej ewidencji magazynowej.", "Podział i łączenie partii zachowuje listę źródeł i ich pochodzenie."] },
      { title: "Pochodzenie i geolokalizacja", body: ["Dla operatora wymagana jest geolokalizacja wszystkich działek: punkt dla działek do 4 ha, wielokąt powyżej 4 ha (WGS84, do 6 miejsc po przecinku).", "Gatunek podaje się nazwą zwyczajową i łacińską."] },
      { title: "Dokumenty legalności", body: ["Dokumenty zakupu, przewozu, legalności pozyskania i prawa do pozyskania przechowuje się co najmniej 5 lat.", "Dokumenty sprawdza kontroler; nowe wersje plików nie usuwają poprzednich."] }],
      quiz: [
        { q: "Działka 6 ha — jaka geolokalizacja?", o: ["Wielokąt (polygon)", "Punkt GPS", "Adres pocztowy"], a: 0 },
        { q: "Kolejność współrzędnych w GeoJSON:", o: ["długość, szerokość", "szerokość, długość", "dowolna"], a: 0 },
        { q: "Przy łączeniu partii pochodzenie:", o: ["jest zachowane — lista źródeł", "jest kasowane", "przyjmuje się z największej partii"], a: 0 },
        { q: "Minimalny okres przechowywania dokumentów:", o: ["5 lat", "1 rok", "10 lat"], a: 0 },
        { q: "Czy partię tworzy się ręcznie, gdy jest dokument przyjęcia?", o: ["Nie — z dokumentu, bez ponownego wpisywania", "Tak, zawsze ręcznie", "Tylko w arkuszu"], a: 0 }] },
    { key: "traces", title: "Oficjalny system EUDR (TRACES)", pass: 80, lessons: [
      { title: "Dostęp i środowiska", body: ["System ma środowisko testowe ACCEPTANCE i produkcyjne PRODUCTION; konta i klucze są osobne.", "Samo konto EU Login nie daje dostępu do API — trzeba aktywować „Web Services Access” w profilu."] },
      { title: "Oświadczenie DDS", body: ["DDS zawiera m.in. rolę, rodzaj działalności (DOMESTIC / IMPORT / EXPORT), kod HS, opis, ilość, gatunek i producentów z geolokalizacją.", "Po złożeniu system nadaje numer referencyjny i weryfikacyjny; status sprawdza się po co najmniej godzinie."] },
      { title: "Bezpieczeństwo", body: ["Klucz uwierzytelniający przechowuje się wyłącznie po stronie serwera (server.env), nigdy w przeglądarce ani w repozytorium.", "Numery testowe i symulowane nie trafiają do ewidencji produkcyjnej."] }],
      quiz: [
        { q: "Gdzie przechowuje się klucz uwierzytelniający API?", o: ["Na serwerze firmy (server.env)", "W przeglądarce", "W arkuszu Excel"], a: 0 },
        { q: "Czy konto EU Login samo daje dostęp do API?", o: ["Nie", "Tak", "Tylko dla administratora"], a: 0 },
        { q: "Pierwsze testy połączenia wykonuje się w:", o: ["ACCEPTANCE", "PRODUCTION", "dowolnym"], a: 0 },
        { q: "Kiedy sprawdzać status po złożeniu DDS?", o: ["po co najmniej 1 godzinie", "co 10 sekund", "nigdy"], a: 0 },
        { q: "Numer z ćwiczenia (SYM-…) to:", o: ["numer symulowany, nie numer TRACES", "prawdziwy numer DDS", "numer faktury"], a: 0 }] },
    { key: "practice", title: "Praktyczne ćwiczenia (symulacja ACCEPTANCE)", pass: 80, lessons: [
      { title: "Jak pracować w ćwiczeniach", body: ["Ćwiczenia korzystają wyłącznie z danych fikcyjnych; wyniki zapisują się przy szkoleniu, a nie w rejestrze DDS.", "Numer symulowany ma przedrostek SYM- i nie jest numerem systemu TRACES."] },
      { title: "Scenariusze", body: ["Cztery scenariusze: pozyskanie własne (operator), zakup od operatora, zakup od mikro producenta, próba wydania partii bez DDS.", "W każdym ustal rolę, wymagany numer i decyzję."] }],
      quiz: [
        { q: "Gdzie zapisuje się wynik ćwiczenia?", o: ["Przy szkoleniu pracownika", "W rejestrze DDS produkcyjnym", "Nigdzie"], a: 0 },
        { q: "Czy dane ćwiczeń identyfikują rzeczywistych dostawców?", o: ["Nie — są fikcyjne", "Tak", "Czasami"], a: 0 },
        { q: "Zakup od mikro producenta pierwotnego — jaki identyfikator zbierasz?", o: ["Identyfikator deklaracji uproszczonej", "Własny DDS", "Żaden"], a: 0 },
        { q: "Wydanie partii operatora bez DDS po dacie stosowania:", o: ["jest blokowane", "jest dozwolone", "wymaga tylko notatki"], a: 0 },
        { q: "Czy tryb demonstracyjny łączy się z Komisją Europejską?", o: ["Nie", "Tak", "Tylko w nocy"], a: 0 }] },
    { key: "control", title: "Kontrola i audyt", pass: 80, lessons: [
      { title: "Kontrola dokumentacji", body: ["Kontroler sprawdza dokumenty i oznacza je jako sprawdzone albo odrzucone z uwagą.", "Każda czynność ma wpis w dzienniku; historii nie można usunąć."] },
      { title: "Audyt wewnętrzny", body: ["Audyt obejmuje 13 obszarów: rola, partie, dostawcy, dokumentacja, geolokalizacja, trzy etapy należytej staranności, DDS, ciągłość łańcucha, przechowywanie, bezpieczeństwo, szkolenia.", "Wynik procentowy jest wskaźnikiem wewnętrznym, a nie certyfikatem zgodności."] }],
      quiz: [
        { q: "Ile obszarów obejmuje audyt EUDR w programie?", o: ["13", "5", "20"], a: 0 },
        { q: "Czy można usunąć wpis z dziennika zmian?", o: ["Nie", "Tak, administrator", "Tak, po roku"], a: 0 },
        { q: "Dla niezgodności audytu trzeba podać:", o: ["zalecenia i termin", "tylko ocenę", "nic"], a: 0 },
        { q: "Kto zatwierdza wynik należytej staranności?", o: ["Osoba odpowiedzialna / Administrator EUDR", "Program automatycznie", "Magazynier"], a: 0 },
        { q: "Wynik 95 % w audycie oznacza:", o: ["wewnętrzną ocenę systemu, nie certyfikat", "certyfikat zgodności z prawem", "zwolnienie z kontroli"], a: 0 }] }
  ];

  /* ---------------- Scenariusze ćwiczeń (dane fikcyjne) ---------------- */
  const roleOpts = [["OPERATOR", "Operator"], ["DOWNSTREAM_FIRST", "Pierwszy podmiot niższego szczebla"], ["DOWNSTREAM", "Handlowiec / podmiot niższego szczebla"], ["NONE", "Brak obowiązków"]];
  const refOpts = [["OWN", "Własny DDS"], ["DDS", "Numer DDS dostawcy"], ["SD", "Identyfikator deklaracji uproszczonej"], ["NONE", "Brak numeru"]];
  const decOpts = [["RELEASE", "Wydać"], ["BLOCK", "Wstrzymać do złożenia DDS"], ["WARN", "Wydać z ostrzeżeniem i uzupełnić"]];
  const scenarios = [
    { key: "own", title: "A. Pozyskanie własne — drewno sosnowe (dane fikcyjne)", story: "Firma „Las-Test” (fikcyjna) pozyskuje drewno z własnego lasu (PRZYKŁAD 12-b, 3,5 ha) i jako pierwsza wprowadza je na rynek UE.",
      data: [["Gatunek", "Sosna zwyczajna — Pinus sylvestris"], ["Kod CN", "4401"], ["Ilość", "40 m³ / 38 t"], ["Geolokalizacja", "punkt 50.100000, 18.200000"]],
      checks: [{ key: "role", label: "Rola firmy", options: roleOpts, expect: "OPERATOR" }, { key: "ref", label: "Wymagany numer", options: refOpts, expect: "OWN" }, { key: "geo", label: "Działka 3,5 ha — geolokalizacja", options: [["POINT", "Punkt"], ["POLYGON", "Wielokąt"]], expect: "POINT" }] },
    { key: "upstream", title: "B. Zakup od operatora z DDS (dane fikcyjne)", story: "Fikcyjna firma „Drewno-Test” sprzedaje zrębkę i przekazuje numer referencyjny i weryfikacyjny DDS.",
      data: [["Dostawca", "Drewno-Test (fikcyjny)"], ["Numer referencyjny", "26PLTEST000001 (przykład formatu)"], ["Ilość", "300 MP"]],
      checks: [{ key: "role", label: "Rola firmy", options: roleOpts, expect: "DOWNSTREAM_FIRST" }, { key: "ref", label: "Co zbierasz i przechowujesz", options: refOpts, expect: "DDS" }] },
    { key: "sme", title: "C. Zakup od mikro producenta pierwotnego (dane fikcyjne)", story: "Fikcyjny właściciel lasu prywatnego (mikro przedsiębiorca, kraj niskiego ryzyka) złożył jednorazową deklarację uproszczoną.",
      data: [["Dostawca", "Gospodarstwo leśne PRZYKŁAD"], ["Kraj", "PL — niskie ryzyko"], ["Ilość", "12 m³"]],
      checks: [{ key: "role", label: "Rola firmy", options: roleOpts, expect: "DOWNSTREAM_FIRST" }, { key: "ref", label: "Wymagany identyfikator", options: refOpts, expect: "SD" }] },
    { key: "block", title: "D. Wydanie partii operatora bez DDS (dane fikcyjne)", story: "Po 30.12.2026 magazynier próbuje wydać partię z pozyskania własnego, dla której nie złożono DDS.",
      data: [["Partia", "EUDR/2027/0007 (fikcyjna)"], ["Rola", "operator"], ["DDS", "brak"]],
      checks: [{ key: "decision", label: "Decyzja", options: decOpts, expect: "BLOCK" }, { key: "ref", label: "Czego brakuje", options: refOpts, expect: "OWN" }] }
  ];

  const EudrContent = { guides, modules, scenarios };
  if (R) R.EudrContent = EudrContent;
  if (typeof module !== "undefined" && module.exports) module.exports = EudrContent;
})(typeof globalThis !== "undefined" ? globalThis : this);
