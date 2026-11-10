/* Słownik CS/EN — część 19 (3.8: kilka firm transportu zewnętrznego, data przyjęcia, jedna seria numeracji WZ) */
(function (root) { "use strict"; (root.RIW_I18N || require("./i18n.js")).addPairs({
  /* --- transport zewnętrzny: kilka firm --- */
  "Liczba firm przewidzianych do transportu": ["Počet firem určených pro dopravu", "Number of companies assigned to transport"],
  "Wpisz ilość firm zewnętrznych, którym zlecono transport.": ["Zadejte počet externích firem, kterým byla doprava zadána.", "Enter the number of external companies the transport was assigned to."],
  "Kilka firm: w każdym kursie wybierz firmę z listy albo wpisz nową nazwę.": ["Více firem: u každé jízdy vyberte firmu ze seznamu nebo zadejte nový název.", "Several companies: for each run choose a company from the list or type a new name."],
  "wybierz z listy albo wpisz nową firmę": ["vyberte ze seznamu nebo zadejte novou firmu", "choose from the list or type a new company"],
  "liczbę firm": ["počet firem", "the number of companies"],
  "Maksymalnie {n} firm zewnętrznych w jednej operacji": ["Nejvýše {n} externích firem v jedné operaci", "At most {n} external companies in one operation"],
  "Wybierz albo wpisz firmę transportową kursu {n}": ["Vyberte nebo zadejte dopravní firmu jízdy {n}", "Choose or enter the transport company for run {n}"],
  "W kursach podano {a} firm, a zadeklarowano {b} — zwiększ liczbę firm albo popraw kursy": ["V jízdách je uvedeno {a} firem, ale deklarováno {b} — zvyšte počet firem nebo opravte jízdy", "The runs list {a} companies but {b} were declared — increase the number of companies or fix the runs"],
  "Zadeklarowano {b} firm transportowych, a w kursach podano {a}.": ["Deklarováno {b} dopravních firem, v jízdách uvedeno {a}.", "{b} transport companies were declared, the runs list {a}."],
  "Przewoźnicy zewnętrzni": ["Externí dopravci", "External carriers"],

  /* --- data przyjęcia, opisy rodzajów --- */
  "Wprowadź datę przyjęcia produktu na magazyn.": ["Zadejte datum příjmu produktu na sklad.", "Enter the date the product was received into the warehouse."],
  "<b>Co:</b> data wystawienia dokumentu (np. data z dokumentu dostawcy). Puste = data przyjęcia (data operacji). <b>Data przyjęcia</b> to dzień przyjęcia / wydania towaru; datę i godzinę utworzenia wpisu zapisuje system.": ["<b>Co:</b> datum vystavení dokladu (např. datum z dokladu dodavatele). Prázdné = datum příjmu (datum operace). <b>Datum příjmu</b> je den příjmu / výdeje zboží; datum a čas vytvoření záznamu ukládá systém.", "<b>What:</b> the document issue date (e.g. the date on the supplier's document). Empty = receipt date (operation date). The <b>receipt date</b> is the day goods are received / issued; the system records the date and time the entry was created."],
  "Dostawca → magazyn. Opcjonalnie produkcja i sprzedaż bezpośrednia z lasu.": ["Dodavatel → sklad. Volitelně výroba a přímý prodej z lesa.", "Supplier → warehouse. Optionally production and direct sale from the forest."],
  "Magazyn → odbiorca albo sprzedaż bezpośrednia po produkcji w lesie.": ["Sklad → odběratel nebo přímý prodej po výrobě v lese.", "Warehouse → customer or direct sale after production in the forest."],
  "Surowiec ze stanu → produkt na stanie. Bez transportu.": ["Surovina ze skladu → produkt na skladě. Bez dopravy.", "Raw material from stock → product in stock. No transport."],

  /* --- jedna seria numeracji WZ --- */
  "Numeracja dokumentów magazynowych": ["Číslování skladových dokladů", "Warehouse document numbering"],
  "Jedna seria WZ dla wszystkich dokumentów": ["Jedna řada WZ pro všechny doklady", "One WZ series for all documents"],
  "Osobne serie według rodzaju dokumentu (PZ, WZ, RW, PW, MM…)": ["Samostatné řady podle druhu dokladu (PZ, WZ, RW, PW, MM…)", "Separate series by document type (PZ, WZ, RW, PW, MM…)"],
  "Jedna seria WZ (domyślnie): każda transakcja — zakup, sprzedaż, produkcja, MM, korekta, inwentaryzacja, bilans otwarcia — dostaje kolejny numer WZ/NNN/MM/RRRR. Numery nadane wcześniej nie zmieniają się.": ["Jedna řada WZ (výchozí): každá transakce — nákup, prodej, výroba, MM, oprava, inventura, počáteční stav — dostane další číslo WZ/NNN/MM/RRRR. Dříve přidělená čísla se nemění.", "One WZ series (default): every transaction — purchase, sale, production, MM, correction, stocktaking, opening balance — gets the next number WZ/NNN/MM/YYYY. Numbers assigned earlier do not change."],
  "Dokument WZ": ["Doklad WZ", "WZ document"],
  "Seria": ["Řada", "Series"],
  "WZ — wspólna numeracja wszystkich dokumentów transakcji": ["WZ — společné číslování všech dokladů transakce", "WZ — common numbering of all documents of the transaction"],

  /* --- ewidencja obrotu (CSV) --- */
  "CSV ewidencji": ["CSV evidence", "Ledger CSV"],
  "CSV planera": ["CSV plánovače", "Planner CSV"],
  "Pobrano ewidencję CSV": ["Evidence CSV stažena", "Ledger CSV downloaded"]
}); })(typeof globalThis !== "undefined" ? globalThis : this);
