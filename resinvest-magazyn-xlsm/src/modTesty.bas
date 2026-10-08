Option Explicit
' =====================================================================
' modTesty - testy scenariuszy magazynowych (zakup, produkcja wg receptury,
' transport jako część operacji, korekta, usunięcie, historia, rejestr, dokument).
' URUCHAMIAĆ WYŁĄCZNIE NA KOPII PLIKU, w której nazwie jest "TEST"
' (testy dopisują, korygują i usuwają operacje na produktach "TEST ...").
' Wyniki: arkusz TESTY.
' =====================================================================
Private Const SUR As String = "TEST Drewno opałowe"
Private Const WYR As String = "TEST Zrębka produkcyjna"
Private wsT As Worksheet
Private nr As Long, ok As Long, zle As Long
Private krok As String

Public Function UruchomTesty() As String
    Dim idZak As String, idProd As String, idTr As String, idBezTr As String, idProdTr As String, idProdBez As String, idChain As String
    Dim op As clsOperacja, wynik As Boolean, s As String, przed As Double, n0 As Long
    If InStr(UCase$(ThisWorkbook.Name), "TEST") = 0 Then
        UruchomTesty = "Przerwano: testy uruchamia się tylko na kopii pliku z ""TEST"" w nazwie."
        On Error Resume Next
        MsgBox UruchomTesty, vbExclamation, "Testy"
        Exit Function
    End If
    On Error GoTo blad
    krok = "Przygotuj"
    LogPlik krok
    Przygotuj
    modMagazyn.TrybCichy = True
    modMagazyn.PowodCichy = "test automatyczny"

    ' ---------------- TEST 1: zakup drewna 30 m3 ----------------
    krok = "Set op = NowaOp(""ZAKUP"", SUR, 30, ""M3"")"
    LogPlik krok
    Set op = NowaOp("ZAKUP", SUR, 30, "M3")
    op.CenaZakupu = 230
    krok = "wynik = modMagazyn.ZatwierdzOperacje(op, "")"
    LogPlik krok
    wynik = modMagazyn.ZatwierdzOperacje(op, "")
    idZak = op.Id
    Sprawdz "T1 Zakup drewna 30 m³ → stan +30 m³", wynik And Blisko(modMagazyn.Stan(SUR, "M3", ""), 30) And LiczbaWierszy(idZak) = 1, _
        "stan=" & modMagazyn.Stan(SUR, "M3", "") & " wiersze=" & LiczbaWierszy(idZak) & " " & modMagazyn.OstatniBlad

    ' ---------------- TEST 2: produkcja 120 MP zużywa 30 m3 drewna ----------------
    krok = "Set op = NowaOp(""PRODUKCJA"", WYR, 120, ""MP"")"
    LogPlik krok
    Set op = NowaOp("PRODUKCJA", WYR, 120, "MP")
    krok = "wynik = modMagazyn.ZatwierdzOperacje(op, "")"
    LogPlik krok
    wynik = modMagazyn.ZatwierdzOperacje(op, "")
    idProd = op.Id
    Sprawdz "T2 Produkcja 120 MP → drewno −30 m³, zrębka +120 MP (jedna operacja)", wynik And Blisko(modMagazyn.Stan(SUR, "M3", ""), 0) And Blisko(modMagazyn.Stan(WYR, "MP", ""), 120) _
        And LiczbaWierszy(idProd) = 2 And Blisko(Liczba(Komorka(idProd, "ZUŻYCIE", C_VOL)), 30) And Komorka(idProd, "ZUŻYCIE", C_PROD) = SUR And Komorka(idProd, "ZUŻYCIE", C_JM) = "M3", _
        "drewno=" & modMagazyn.Stan(SUR, "M3", "") & " zrębka=" & modMagazyn.Stan(WYR, "MP", "") & " zużyto=" & Komorka(idProd, "ZUŻYCIE", C_PROD) & " " & Komorka(idProd, "ZUŻYCIE", C_VOL) & " " & modMagazyn.OstatniBlad
    Sprawdz "T2a Zrębka nie jest zużywana jako surowiec", Not JestZuzycieProduktu(idProd, WYR), "zużycie zrębki w operacji " & idProd

    ' ---------------- TEST 3: brak surowca (stan 10 m3, potrzeba 30 m3) ----------------
    krok = "Set op = NowaOp(""ZAKUP"", SUR, 10, ""M3"")"
    LogPlik krok
    Set op = NowaOp("ZAKUP", SUR, 10, "M3")
    op.CenaZakupu = 230
    krok = "modMagazyn.ZatwierdzOperacje op"
    LogPlik krok
    modMagazyn.ZatwierdzOperacje op, ""
    n0 = WierszyDanych()
    krok = "Set op = NowaOp(""PRODUKCJA"", WYR, 120, ""MP"")"
    LogPlik krok
    Set op = NowaOp("PRODUKCJA", WYR, 120, "MP")
    krok = "wynik = modMagazyn.ZatwierdzOperacje(op, "")"
    LogPlik krok
    wynik = modMagazyn.ZatwierdzOperacje(op, "")
    s = modMagazyn.OstatniBlad
    Sprawdz "T3 Produkcja przy niewystarczającym stanie drewna → blokada", (Not wynik) And InStr(s, "Niewystarczający stan surowca") > 0 And InStr(s, "stan: 10") > 0 _
        And InStr(s, "wymagane: 30") > 0 And InStr(s, "brakuje: 20") > 0 And WierszyDanych() = n0 And Blisko(modMagazyn.Stan(SUR, "M3", ""), 10), Replace(s, vbCrLf, " | ")

    ' ---------------- TEST 4: korekta produkcji 120 -> 80 MP ----------------
    krok = "Set op = modMagazyn.WczytajOperacje(idProd)"
    LogPlik krok
    Set op = modMagazyn.WczytajOperacje(idProd)
    op.Volumen = 80
    krok = "wynik = modMagazyn.ZatwierdzOperacje(op, idProd)"
    LogPlik krok
    wynik = modMagazyn.ZatwierdzOperacje(op, idProd)
    Sprawdz "T4 Edycja produkcji 120 → 80 MP: drewno netto −20 m³, zrębka +80 MP", wynik And Blisko(modMagazyn.Stan(SUR, "M3", ""), 20) And Blisko(modMagazyn.Stan(WYR, "MP", ""), 80) _
        And LiczbaWierszy(idProd) = 2 And Blisko(Liczba(Komorka(idProd, "ZUŻYCIE", C_VOL)), 20) And Liczba(Komorka(idProd, "PRODUKCJA", C_WERSJA)) = 2 _
        And WierszyArchiwum(idProd, "KOREKTA") = 2 And JestWHistorii(idProd, "Ilość", "120", "80") And JestWHistorii(idProd, "Zużycie surowca", "30 m³", "20 m³"), _
        "drewno=" & modMagazyn.Stan(SUR, "M3", "") & " zrębka=" & modMagazyn.Stan(WYR, "MP", "") & " archiwum=" & WierszyArchiwum(idProd, "KOREKTA") & " " & modMagazyn.OstatniBlad

    ' ---------------- TEST 5: usunięcie produkcji ----------------
    krok = "wynik = modMagazyn.UsunOperacje(idProd, ""test usunięcia"")"
    LogPlik krok
    wynik = modMagazyn.UsunOperacje(idProd, "test usunięcia")
    Sprawdz "T5 Usunięcie produkcji odwraca skutki (+20 m³ drewna, −80 MP zrębki)", wynik And Blisko(modMagazyn.Stan(SUR, "M3", ""), 40) And Blisko(modMagazyn.Stan(WYR, "MP", ""), 0) _
        And LiczbaWierszy(idProd) = 0 And WierszyArchiwum(idProd, "USUNIĘCIE") = 2 And JestWHistorii(idProd, "Operacja", "", ""), _
        "drewno=" & modMagazyn.Stan(SUR, "M3", "") & " zrębka=" & modMagazyn.Stan(WYR, "MP", "") & " " & modMagazyn.OstatniBlad

    ' ---------------- TEST 6: zakup + transport ----------------
    krok = "Set op = NowaOp(""ZAKUP"", SUR, 30, ""M3"")"
    LogPlik krok
    Set op = NowaOp("ZAKUP", SUR, 30, "M3")
    op.CenaZakupu = 230: op.Dostawca = "LANDER AGRO"
    UstawTransport op, "Transport Kowalski", "Scania R450", "SK 7J884", "Jan Nowak", "Myszków → Zabrze", 110, 550
    przed = modMagazyn.Stan(SUR, "M3", "")
    krok = "wynik = modMagazyn.ZatwierdzOperacje(op, "")"
    LogPlik krok
    wynik = modMagazyn.ZatwierdzOperacje(op, "")
    idTr = op.Id
    Sprawdz "T6 Zakup + transport = jedna operacja ZAKUP z danymi transportu", wynik And LiczbaWierszy(idTr) = 1 And Komorka(idTr, "ZAKUP", C_TRANSPORT) = "TAK" _
        And Komorka(idTr, "ZAKUP", C_PRZEW) = "Transport Kowalski" And Komorka(idTr, "ZAKUP", C_POJAZD) = "Scania R450" And Komorka(idTr, "ZAKUP", C_TRASA) = "Myszków → Zabrze" _
        And Liczba(Komorka(idTr, "ZAKUP", C_KM)) = 110 And Liczba(Komorka(idTr, "ZAKUP", C_KOSZTTR)) = 550 And Blisko(modMagazyn.Stan(SUR, "M3", "") - przed, 30) And WierszyTypu("TRANSPORT") = 0, _
        "wiersze=" & LiczbaWierszy(idTr) & " " & modMagazyn.OstatniBlad

    ' ---------------- TEST 7: produkcja + transport ----------------
    krok = "Set op = NowaOp(""PRODUKCJA"", WYR, 120, ""MP"")"
    LogPlik krok
    Set op = NowaOp("PRODUKCJA", WYR, 120, "MP")
    UstawTransport op, "", "Ładowarka / ciągnik", "SK 5L809", "Adrian Wojciechowski", "plac → hala", 2, 120
    krok = "wynik = modMagazyn.ZatwierdzOperacje(op, "")"
    LogPlik krok
    wynik = modMagazyn.ZatwierdzOperacje(op, "")
    idProdTr = op.Id
    Sprawdz "T7 Produkcja + transport: transport w wierszu PRODUKCJA, koszt liczony raz", wynik And LiczbaWierszy(idProdTr) = 2 _
        And Komorka(idProdTr, "PRODUKCJA", C_TRANSPORT) = "TAK" And Komorka(idProdTr, "PRODUKCJA", C_OPERATOR) = "Adrian Wojciechowski" And Liczba(Komorka(idProdTr, "PRODUKCJA", C_KOSZTTR)) = 120 _
        And Komorka(idProdTr, "ZUŻYCIE", C_PRZEW) = "" And Liczba(Komorka(idProdTr, "ZUŻYCIE", C_KOSZTTR)) = 0 And Blisko(Liczba(Komorka(idProdTr, "ZUŻYCIE", C_VOL)), 30), _
        "wiersze=" & LiczbaWierszy(idProdTr) & " " & modMagazyn.OstatniBlad

    ' ---------------- TEST 8: zakup bez transportu (pola wypełnione, pole Transport odznaczone) ----------------
    krok = "Set op = NowaOp(""ZAKUP"", SUR, 5, ""M3"")"
    LogPlik krok
    Set op = NowaOp("ZAKUP", SUR, 5, "M3")
    op.CenaZakupu = 230
    UstawTransport op, "Firma X", "Auto", "AB 12345", "Kierowca", "A → B", 50, 300
    op.Transport = False
    krok = "wynik = modMagazyn.ZatwierdzOperacje(op, "")"
    LogPlik krok
    wynik = modMagazyn.ZatwierdzOperacje(op, "")
    idBezTr = op.Id
    Sprawdz "T8 Zakup bez transportu: dane przewozu nie są zapisywane", wynik And Komorka(idBezTr, "ZAKUP", C_TRANSPORT) = "NIE" And Komorka(idBezTr, "ZAKUP", C_PRZEW) = "" _
        And Liczba(Komorka(idBezTr, "ZAKUP", C_KOSZTTR)) = 0 And Komorka(idBezTr, "ZAKUP", C_TRASA) = "", modMagazyn.OstatniBlad

    ' ---------------- TEST 9: produkcja bez transportu ----------------
    krok = "Set op = NowaOp(""PRODUKCJA"", WYR, 20, ""MP"")"
    LogPlik krok
    Set op = NowaOp("PRODUKCJA", WYR, 20, "MP")
    krok = "wynik = modMagazyn.ZatwierdzOperacje(op, "")"
    LogPlik krok
    wynik = modMagazyn.ZatwierdzOperacje(op, "")
    idProdBez = op.Id
    Sprawdz "T9 Produkcja bez transportu: zużycie 5 m³, Transport = NIE", wynik And LiczbaWierszy(idProdBez) = 2 And Komorka(idProdBez, "PRODUKCJA", C_TRANSPORT) = "NIE" _
        And Blisko(Liczba(Komorka(idProdBez, "ZUŻYCIE", C_VOL)), 5), modMagazyn.OstatniBlad

    ' ---------------- TEST 10: edycja pola Transport NIE -> TAK oraz TAK -> NIE ----------------
    krok = "Set op = modMagazyn.WczytajOperacje(idBezTr)"
    LogPlik krok
    Set op = modMagazyn.WczytajOperacje(idBezTr)
    UstawTransport op, "XYZ Transport", "MAN TGX", "SK 1234A", "", "Gliwice → Zabrze", 40, 200
    krok = "wynik = modMagazyn.ZatwierdzOperacje(op, idBezTr)"
    LogPlik krok
    wynik = modMagazyn.ZatwierdzOperacje(op, idBezTr)
    krok = "Set op = modMagazyn.WczytajOperacje(idTr)"
    LogPlik krok
    Set op = modMagazyn.WczytajOperacje(idTr)
    op.Transport = False
    krok = "wynik = wynik And modMagazyn.ZatwierdzOperacje(op, idTr)"
    LogPlik krok
    wynik = wynik And modMagazyn.ZatwierdzOperacje(op, idTr)
    Sprawdz "T10 Transport NIE → TAK i TAK → NIE (korekta + historia zmian)", wynik And Komorka(idBezTr, "ZAKUP", C_TRANSPORT) = "TAK" And Komorka(idBezTr, "ZAKUP", C_PRZEW) = "XYZ Transport" _
        And JestWHistorii(idBezTr, "Transport", "NIE", "TAK") And JestWHistorii(idBezTr, "Przewoźnik", "", "XYZ Transport") _
        And Komorka(idTr, "ZAKUP", C_TRANSPORT) = "NIE" And Komorka(idTr, "ZAKUP", C_PRZEW) = "" And Liczba(Komorka(idTr, "ZAKUP", C_KOSZTTR)) = 0 _
        And JestWHistorii(idTr, "Transport", "TAK", "NIE") And JestWHistorii(idTr, "Przewoźnik", "Transport Kowalski", ""), modMagazyn.OstatniBlad

    ' ---------------- TEST 11: zakup z produkcją (łańcuch) ----------------
    przed = modMagazyn.Stan(SUR, "M3", "")
    krok = "Set op = NowaOp(""ZAKUP"", SUR, 25, ""M3"")"
    LogPlik krok
    Set op = NowaOp("ZAKUP", SUR, 25, "M3")
    op.CenaZakupu = 230
    op.ChainProdukcja = True: op.ProdProdukt = WYR: op.ProdVolumen = 100: op.ProdJM = "MP"
    Dim zPrzed As Double
    zPrzed = modMagazyn.Stan(WYR, "MP", "")
    krok = "wynik = modMagazyn.ZatwierdzOperacje(op, "")"
    LogPlik krok
    wynik = modMagazyn.ZatwierdzOperacje(op, "")
    idChain = op.Id
    Sprawdz "T11 Zakup + produkcja: zużycie zakupionego drewna 25 m³, zrębka +100 MP, jedno ID", wynik And LiczbaWierszy(idChain) = 3 _
        And Blisko(modMagazyn.Stan(SUR, "M3", ""), przed) And Blisko(modMagazyn.Stan(WYR, "MP", "") - zPrzed, 100) And Komorka(idChain, "ZUŻYCIE", C_PROD) = SUR, modMagazyn.OstatniBlad

    ' ---------------- TEST 12: receptura ze zrębką jako surowcem jest odrzucana ----------------
    Dim sS As String, jS As String, jP As String, pr As Double, bl As String
    krok = "Ark(ARK_REC).Cells(ostatniRec() + 1, 1).Resize(1, 6).Value = Array(""TEST Zła re"
    LogPlik krok
    Ark(ARK_REC).Cells(ostatniRec() + 1, 1).Resize(1, 6).Value = Array("TEST Zła receptura", "MP", WYR, "MP", 1, "TAK")
    Sprawdz "T12 Receptura ze zrębką jako surowcem → odrzucona", Not modMagazyn.ZnajdzRecepture("TEST Zła receptura", sS, jS, jP, pr, bl) And InStr(bl, "Zrębka nie może być zużywana") > 0, bl

    ' ---------------- TEST 13: receptura produkcyjna z konfiguracji ----------------
    Sprawdz "T13 Zrębka Produkcyjna Leśna ← Drewno opałowe z lasu (1 m³ = 4 MP)", modMagazyn.ZnajdzRecepture("Zrębka Produkcyjna Leśna", sS, jS, jP, pr, bl) _
        And sS = "Drewno opałowe z lasu" And jS = "M3" And jP = "MP" And pr = 4, sS & " " & jS & " " & jP & " " & pr & " " & bl

    ' ---------------- TEST 14: migracja danych historycznych ----------------
    Sprawdz "T14 Dane historyczne: każdy wiersz ma ID i pole Transport, brak typu TRANSPORT", WierszyBezID() = 0 And WierszyTypu("TRANSPORT") = 0, "bez ID: " & WierszyBezID()

    ' ---------------- TEST 15: rejestr operacji (jedna linia = jedna operacja) ----------------
    krok = "modMagazyn.OdswiezRejestr"
    LogPlik krok
    modMagazyn.OdswiezRejestr
    Sprawdz "T15 Rejestr: produkcja z transportem w jednej linii, Transport = Tak", WierszyRejestru(idProdTr) = 1 And RejestrPole(idProdTr, 6) = "Tak" And RejestrPole(idProdTr, 2) = "PRODUKCJA" _
        And RejestrPole(idProdBez, 6) = "Nie" And WierszyRejestru(idProd) = 0, "linie=" & WierszyRejestru(idProdTr) & " transport=" & RejestrPole(idProdTr, 6)

    ' ---------------- TEST 16: dokument - sekcja transportu tylko przy Transport = TAK ----------------
    Dim zTr As Boolean, bezTr As Boolean, zSur As Boolean
    krok = "modMagazyn.WypelnijDokument idBezTr"
    modMagazyn.WypelnijDokument idBezTr
    zTr = DokumentZawiera("DANE TRANSPORTU")
    krok = "modMagazyn.WypelnijDokument idProdBez"
    modMagazyn.WypelnijDokument idProdBez
    If DokumentZawiera("DANE TRANSPORTU") Then
        bezTr = False
    Else
        bezTr = True
    End If
    zSur = DokumentZawiera("Zużyty surowiec")
    Sprawdz "T16 Dokument: sekcja transportu tylko gdy Transport = TAK", (zTr And bezTr And zSur), _
        "z transportem: " & CStr(zTr) & " / bez sekcji przy NIE: " & CStr(bezTr) & " / surowiec: " & CStr(zSur)

    modMagazyn.TrybCichy = False
    wsT.Cells(1, 6).Value = "WYNIK: " & ok & " OK, " & zle & " BŁĄD"
    UruchomTesty = "Testy: " & ok & " OK, " & zle & " BŁĄD (" & nr & ")"
    Exit Function
blad:
    UruchomTesty = "Błąd wykonania po teście " & nr & " [" & krok & "]: " & Err.Number & " " & Err.Description & " | etap: " & modMagazyn.SladKroku & " | " & modMagazyn.OstatniBlad
    modMagazyn.TrybCichy = False
    On Error Resume Next
    wsT.Cells(nr + 2, 2).Value = UruchomTesty
End Function

' ------------------------------------------------------------------ pomocnicze
Private Sub LogPlik(ByVal tekst As String)
    ' diagnostyka testów automatycznych (zmienna środowiskowa RIW_TEST_LOG = ścieżka pliku)
    Dim f As Integer, p As String
    On Error Resume Next
    p = Environ("RIW_TEST_LOG")
    If p = "" Then Exit Sub
    f = FreeFile
    Open p For Append As #f
    Print #f, Format(Now, "hh:nn:ss") & " " & tekst & " | " & modMagazyn.SladKroku
    Close #f
End Sub

Private Sub Przygotuj()
    Dim r As Long
    On Error Resume Next
    Set wsT = ThisWorkbook.Worksheets("TESTY")
    On Error GoTo 0
    If wsT Is Nothing Then
        Set wsT = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
        wsT.Name = "TESTY"
    End If
    wsT.Cells.ClearContents
    wsT.Range("A1:D1").Value = Array("Nr", "Test", "Wynik", "Szczegóły")
    nr = 0: ok = 0: zle = 0
    ' receptura testowa
    r = ostatniRec() + 1
    Ark(ARK_REC).Cells(r, 1).Resize(1, 7).Value = Array(WYR, "MP", SUR, "M3", 4, "TAK", "receptura testowa")
End Sub

Private Function ostatniRec() As Long
    ostatniRec = 0
    ostatniRec = Ark(ARK_REC).Cells(Ark(ARK_REC).Rows.Count, 1).End(xlUp).Row
End Function

Private Sub Sprawdz(ByVal nazwa As String, ByVal warunek As Boolean, ByVal szczegoly As String)
    nr = nr + 1
    wsT.Cells(nr + 1, 1).Value = nr
    wsT.Cells(nr + 1, 2).Value = nazwa
    wsT.Cells(nr + 1, 3).Value = IIf(warunek, "OK", "BŁĄD")
    wsT.Cells(nr + 1, 4).Value = IIf(warunek, "", szczegoly)
    If warunek Then ok = ok + 1 Else zle = zle + 1
End Sub

Private Function NowaOp(ByVal typ As String, ByVal produkt As String, ByVal ilosc As Double, ByVal jm As String) As clsOperacja
    Dim op As New clsOperacja
    op.Typ = typ: op.DataOp = Date: op.DataZal = Date
    op.Dostawca = "TEST Dostawca": op.Odbiorca = "Magazyn Zabrze"
    op.NrWZ = "TEST/" & typ: op.CzyMag = "TAK": op.Deklaracja = "KZR"
    op.Produkt = produkt: op.Volumen = ilosc: op.JM = jm
    op.Uwagi = "test automatyczny"
    Set NowaOp = op
End Function

Private Sub UstawTransport(ByVal op As clsOperacja, ByVal przew As String, ByVal pojazd As String, ByVal rej As String, ByVal oper As String, ByVal trasa As String, ByVal km As Double, ByVal koszt As Double)
    op.Transport = True
    op.Przewoznik = przew: op.Pojazd = pojazd: op.NrRej = rej: op.Operator = oper: op.Trasa = trasa
    op.Dystans = km: op.KosztTrans = koszt
End Sub

Private Function Blisko(ByVal a As Double, ByVal b As Double) As Boolean
    Blisko = False
    Blisko = Abs(a - b) < 0.0001
End Function

Private Function LiczbaWierszy(ByVal id As String) As Long
    Dim ws As Worksheet, r As Long
    LiczbaWierszy = 0
    Set ws = Ark(ARK_DANE)
    For r = 2 To modMagazyn.OstatniWiersz(ws)
        If Tekst(ws.Cells(r, C_ID).Value) = id Then LiczbaWierszy = LiczbaWierszy + 1
    Next r
End Function

Private Function WierszyDanych() As Long
    WierszyDanych = 0
    WierszyDanych = modMagazyn.OstatniWiersz(Ark(ARK_DANE))
End Function

Private Function Komorka(ByVal id As String, ByVal typ As String, ByVal kol As Long) As String
    Dim ws As Worksheet, r As Long
    Set ws = Ark(ARK_DANE)
    For r = 2 To modMagazyn.OstatniWiersz(ws)
        If Tekst(ws.Cells(r, C_ID).Value) = id And UCase$(Tekst(ws.Cells(r, C_TYP).Value)) = typ Then
            Komorka = Tekst(ws.Cells(r, kol).Value)
            Exit Function
        End If
    Next r
End Function

Private Function JestZuzycieProduktu(ByVal id As String, ByVal produkt As String) As Boolean
    Dim ws As Worksheet, r As Long
    JestZuzycieProduktu = False
    Set ws = Ark(ARK_DANE)
    For r = 2 To modMagazyn.OstatniWiersz(ws)
        If Tekst(ws.Cells(r, C_ID).Value) = id And UCase$(Tekst(ws.Cells(r, C_TYP).Value)) = "ZUŻYCIE" And Takie(Tekst(ws.Cells(r, C_PROD).Value), produkt) Then JestZuzycieProduktu = True
    Next r
End Function

Private Function WierszyTypu(ByVal typ As String) As Long
    Dim ws As Worksheet, r As Long
    WierszyTypu = 0
    Set ws = Ark(ARK_DANE)
    For r = 2 To modMagazyn.OstatniWiersz(ws)
        If UCase$(Tekst(ws.Cells(r, C_TYP).Value)) = typ Then WierszyTypu = WierszyTypu + 1
    Next r
End Function

Private Function WierszyBezID() As Long
    Dim ws As Worksheet, r As Long
    WierszyBezID = 0
    Set ws = Ark(ARK_DANE)
    For r = 2 To modMagazyn.OstatniWiersz(ws)
        If Tekst(ws.Cells(r, C_ID).Value) = "" Or (Tekst(ws.Cells(r, C_TRANSPORT).Value) <> "TAK" And Tekst(ws.Cells(r, C_TRANSPORT).Value) <> "NIE") Then WierszyBezID = WierszyBezID + 1
    Next r
End Function

Private Function WierszyArchiwum(ByVal id As String, ByVal akcja As String) As Long
    Dim ws As Worksheet, r As Long
    WierszyArchiwum = 0
    Set ws = Ark(ARK_ARCH)
    For r = 2 To ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
        If Tekst(ws.Cells(r, C_ID).Value) = id And Tekst(ws.Cells(r, LICZBA_KOLUMN + 3).Value) = akcja Then WierszyArchiwum = WierszyArchiwum + 1
    Next r
End Function

Private Function JestWHistorii(ByVal id As String, ByVal pole As String, ByVal bylo As String, ByVal jest As String) As Boolean
    Dim ws As Worksheet, r As Long
    JestWHistorii = False
    Set ws = Ark(ARK_HIST)
    For r = 2 To ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
        If Tekst(ws.Cells(r, 3).Value) = id And Tekst(ws.Cells(r, 5).Value) = pole Then
            If (bylo = "" And jest = "") Or (Tekst(ws.Cells(r, 6).Value) = bylo And Tekst(ws.Cells(r, 7).Value) = jest) Then JestWHistorii = True: Exit Function
        End If
    Next r
End Function

Private Function WierszyRejestru(ByVal id As String) As Long
    Dim ws As Worksheet, r As Long
    WierszyRejestru = 0
    Set ws = Ark(ARK_REJ)
    For r = 6 To ws.Cells(ws.Rows.Count, 12).End(xlUp).Row
        If Tekst(ws.Cells(r, 12).Value) = id Then WierszyRejestru = WierszyRejestru + 1
    Next r
End Function

Private Function RejestrPole(ByVal id As String, ByVal kol As Long) As String
    Dim ws As Worksheet, r As Long
    Set ws = Ark(ARK_REJ)
    For r = 6 To ws.Cells(ws.Rows.Count, 12).End(xlUp).Row
        If Tekst(ws.Cells(r, 12).Value) = id Then RejestrPole = Tekst(ws.Cells(r, kol).Value): Exit Function
    Next r
End Function

Private Function DokumentZawiera(ByVal szukany As String) As Boolean
    Dim ws As Worksheet, r As Long, v As String, jest As Boolean
    jest = False
    Set ws = Ark(ARK_DOK)
    For r = 1 To 80
        v = LCase$(Tekst(ws.Cells(r, 1).Value))
        If Len(v) >= Len(szukany) Then
            If InStr(v, LCase$(szukany)) > 0 Then
                jest = True
            End If
        End If
    Next r
    DokumentZawiera = jest
End Function
