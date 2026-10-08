Option Explicit
' =====================================================================
' modMagazyn - silnik programu magazynowego (wersja 4.0)
'
'  * Operacja = jeden ID_operacji. Transport to czesc operacji (kolumna
'    "Transport" TAK/NIE + dane przewozu tylko w wierszu GLOWNYM).
'  * PRODUKCJA zuzywa surowiec wedlug arkusza RECEPTURY
'    (np. Drewno opalowe z lasu [M3] -> Zrebka Produkcyjna Lesna [MP], 1 M3 = 4 MP).
'    Zrebka nigdy nie jest zuzywana jako surowiec.
'  * Brak surowca blokuje produkcje (stan nie schodzi ponizej zera).
'  * Korekta i usuniecie: stare wiersze trafiaja do ARCHIWUM, w arkuszu Dane
'    zostaje wylacznie aktualna wersja operacji - stany i raporty
'    (tabele przestawne) licza sie poprawnie bez zmian w ich budowie.
'  * Kazda zmiana jest zapisywana w HISTORIA_ZMIAN.
' =====================================================================

' --- arkusze ---
Public Const ARK_DANE As String = "Dane"
Public Const ARK_REC As String = "RECEPTURY"
Public Const ARK_HIST As String = "HISTORIA_ZMIAN"
Public Const ARK_ARCH As String = "ARCHIWUM"
Public Const ARK_REJ As String = "REJESTR_OPERACJI"
Public Const ARK_DOK As String = "DOKUMENT"

' --- kolumny arkusza Dane (tabela Tabela_dane) ---
Public Const C_DATAZAL As Long = 1
Public Const C_MIEJSCEZAL As Long = 2
Public Const C_DATA As Long = 3
Public Const C_DOSTAWCA As Long = 4
Public Const C_TYP As Long = 5
Public Const C_WZ As Long = 6
Public Const C_MAG As Long = 7
Public Const C_DEKL As Long = 8
Public Const C_VOL As Long = 9
Public Const C_JM As Long = 10
Public Const C_CZAK As Long = 11
Public Const C_WART As Long = 12
Public Const C_CSPRZ As Long = 13
Public Const C_PROD As Long = 14
Public Const C_ZREBKA As Long = 15
Public Const C_RAB As Long = 16
Public Const C_CRAB As Long = 17
Public Const C_PRZEW As Long = 18
Public Const C_NRREJ As Long = 19
Public Const C_KM As Long = 20
Public Const C_KOSZTTR As Long = 21
Public Const C_ODB As Long = 22
Public Const C_UWAGI As Long = 23
Public Const C_POCH As Long = 24
Public Const C_DODANO As Long = 25
Public Const C_UTWORZYL As Long = 37
Public Const C_KOSZTBAZ As Long = 38
Public Const C_ID As Long = 39
Public Const C_TRANSPORT As Long = 40
Public Const C_TRASA As Long = 41
Public Const C_POJAZD As Long = 42
Public Const C_OPERATOR As Long = 43
Public Const C_ROLA As Long = 44
Public Const C_RECEPTURA As Long = 45
Public Const C_WERSJA As Long = 46
Public Const LICZBA_KOLUMN As Long = 46

' --- role wierszy ---
Public Const ROLA_GLOWNY As String = "GŁÓWNY"
Public Const ROLA_ZUZYCIE As String = "ZUŻYCIE AUTO"
Public Const ROLA_PRODUKCJA As String = "PRODUKCJA AUTO"
Public Const ROLA_SPRZEDAZ As String = "SPRZEDAŻ AUTO"

' --- przeliczniki (zgodne z formulami kolumn Wolumen_MP / Wolumen_t) ---
Public Const WSP_M3_MP As Double = 4        ' 1 m3 = 4 MP
Public Const WSP_MP_T As Double = 0.33      ' 1 MP = 0,33 t
Private Const EPS As Double = 0.000001

' --- tryb pracy ---
Public TrybCichy As Boolean                 ' testy: bez okien dialogowych, automatyczne potwierdzenie
Public PowodCichy As String                 ' powod korekty / usuniecia w trybie cichym
Public OstatniBlad As String
Public OstatniePodsumowanie As String
Public SladKroku As String                 ' diagnostyka: ostatni etap zapisu
Private mOdswiezanie As Boolean             ' blokada ponownego wejścia (odświeżanie rejestru)

' =====================================================================
'  NARZEDZIA
' =====================================================================
Public Sub Diag(ByVal tekst As String)
    ' diagnostyka (tylko gdy ustawiona zmienna środowiskowa RIW_TEST_LOG)
    Dim f As Integer, p As String
    On Error Resume Next
    p = Environ("RIW_TEST_LOG")
    If p = "" Then Exit Sub
    f = FreeFile
    Open p For Append As #f
    Print #f, "  [silnik] " & tekst
    Close #f
End Sub

Public Function Ark(ByVal nazwa As String) As Worksheet
    Set Ark = ThisWorkbook.Worksheets(nazwa)
End Function

Public Function Liczba(ByVal v As Variant) As Double
    Dim s As String
    Liczba = 0
    If IsEmpty(v) Or IsNull(v) Then Exit Function
    If VarType(v) = vbDouble Or VarType(v) = vbInteger Or VarType(v) = vbLong Or VarType(v) = vbSingle Or VarType(v) = vbCurrency Or VarType(v) = vbDecimal Then
        Liczba = CDbl(v)
        Exit Function
    End If
    s = Trim$(CStr(v))
    If s = "" Then Exit Function
    s = Replace(s, " ", "")
    If IsNumeric(s) Then
        Liczba = CDbl(s)
    ElseIf IsNumeric(Replace(s, ".", ",")) Then
        Liczba = CDbl(Replace(s, ".", ","))
    ElseIf IsNumeric(Replace(s, ",", ".")) Then
        Liczba = CDbl(Replace(s, ",", "."))
    End If
End Function

Public Function Tekst(ByVal v As Variant) As String
    If IsError(v) Or IsNull(v) Or IsEmpty(v) Then Exit Function
    Tekst = Trim$(CStr(v))
End Function

Public Function Takie(ByVal a As String, ByVal b As String) As Boolean
    Takie = False
    Takie = (LCase$(Trim$(a)) = LCase$(Trim$(b)))
End Function

Public Function Fmt(ByVal x As Double) As String
    If Abs(x - Round(x, 0)) < EPS Then
        Fmt = Format(Round(x, 0), "#,##0")
    Else
        Fmt = Format(x, "#,##0.00##")
    End If
End Function

Public Function JMOpis(ByVal jm As String) As String
    Select Case UCase$(Trim$(jm))
        Case "M3": JMOpis = "m³"
        Case "TON": JMOpis = "t"
        Case Else: JMOpis = jm
    End Select
End Function

Public Function Uzytkownik() As String
    On Error Resume Next
    Uzytkownik = Application.UserName
    If Uzytkownik = "" Then Uzytkownik = Environ$("USERNAME")
    If Uzytkownik = "" Then Uzytkownik = "nieznany"
End Function

Private Sub Komunikat(ByVal tekst As String, ByVal styl As VbMsgBoxStyle, ByVal tytul As String)
    If TrybCichy Then Exit Sub
    MsgBox tekst, styl, tytul
End Sub

' Ilosc w jednostce -> MP (dokladnie jak formula kolumny Wolumen_MP)
Public Function DoMP(ByVal ilosc As Double, ByVal jm As String) As Double
    Dim j As String
    DoMP = 0
    j = LCase$(Trim$(jm))
    If InStr(j, "mp") > 0 Then
        DoMP = ilosc
    ElseIf InStr(j, "ton") > 0 Then
        DoMP = ilosc / WSP_MP_T
    ElseIf InStr(j, "m3") > 0 Then
        DoMP = ilosc * WSP_M3_MP
    Else
        DoMP = ilosc
    End If
End Function

' MP -> ilosc w jednostce
Public Function ZMP(ByVal mp As Double, ByVal jm As String) As Double
    Dim j As String
    ZMP = 0
    j = LCase$(Trim$(jm))
    If InStr(j, "mp") > 0 Then
        ZMP = mp
    ElseIf InStr(j, "ton") > 0 Then
        ZMP = mp * WSP_MP_T
    ElseIf InStr(j, "m3") > 0 Then
        ZMP = mp / WSP_M3_MP
    Else
        ZMP = mp
    End If
End Function

Public Function OstatniWiersz(ByVal ws As Worksheet) As Long
    Dim a As Long, b As Long
    OstatniWiersz = 0
    a = ws.Cells(ws.Rows.Count, C_DATA).End(xlUp).Row
    b = ws.Cells(ws.Rows.Count, C_TYP).End(xlUp).Row
    If b > a Then a = b
    b = ws.Cells(ws.Rows.Count, C_ID).End(xlUp).Row
    If b > a Then a = b
    OstatniWiersz = a
End Function

Private Function DaneTablica(ByRef ostatni As Long) As Variant
    Dim ws As Worksheet
    Set ws = Ark(ARK_DANE)
    ostatni = OstatniWiersz(ws)
    If ostatni < 2 Then
        DaneTablica = Empty
    Else
        DaneTablica = ws.Range(ws.Cells(1, 1), ws.Cells(ostatni, LICZBA_KOLUMN)).Value
    End If
End Function

' =====================================================================
'  STANY MAGAZYNOWE (identycznie jak kolumna Ruch_magazyn_MP)
' =====================================================================
' Stan produktu w MP-ekwiwalencie; pominId - pomija operacje (symulacja korekty)
Public Function StanMP(ByVal produkt As String, ByVal pominId As String) As Double
    Dim d As Variant, ostatni As Long, r As Long, typ As String, v As Double, s As Double
    StanMP = 0
    d = DaneTablica(ostatni)
    If IsEmpty(d) Then Exit Function
    For r = 2 To ostatni
        If Takie(Tekst(d(r, C_PROD)), produkt) Then
            If pominId = "" Or Tekst(d(r, C_ID)) <> pominId Then
                If UCase$(Tekst(d(r, C_MAG))) = "TAK" Then
                    typ = UCase$(Tekst(d(r, C_TYP)))
                    v = DoMP(Liczba(d(r, C_VOL)), Tekst(d(r, C_JM)))
                    If typ = "ZAKUP" Or typ = "PRODUKCJA" Then
                        s = s + v
                    ElseIf typ = "SPRZEDAŻ" Or typ = "ZUŻYCIE" Then
                        s = s - v
                    End If
                End If
            End If
        End If
    Next r
    StanMP = s
End Function

Public Function Stan(ByVal produkt As String, ByVal jm As String, ByVal pominId As String) As Double
    Stan = 0
    Stan = ZMP(StanMP(produkt, pominId), jm)
End Function

' =====================================================================
'  RECEPTURY (arkusz RECEPTURY: A produkt, B JM produktu, C surowiec,
'  D JM surowca, E ilosc produktu z 1 jednostki surowca, F aktywna)
' =====================================================================
Public Function ZnajdzRecepture(ByVal produkt As String, ByRef surowiec As String, ByRef jmSur As String, _
                                ByRef jmProd As String, ByRef przel As Double, ByRef blad As String) As Boolean
    Dim ws As Worksheet, r As Long, ost As Long
    ZnajdzRecepture = False
    blad = ""
    On Error Resume Next
    Set ws = Ark(ARK_REC)
    On Error GoTo 0
    If ws Is Nothing Then
        blad = "Brak arkusza RECEPTURY."
        Exit Function
    End If
    ost = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    For r = 2 To ost
        If Takie(Tekst(ws.Cells(r, 1).Value), produkt) And UCase$(Tekst(ws.Cells(r, 6).Value)) <> "NIE" Then
            surowiec = Tekst(ws.Cells(r, 3).Value)
            jmSur = UCase$(Tekst(ws.Cells(r, 4).Value))
            jmProd = UCase$(Tekst(ws.Cells(r, 2).Value))
            przel = Liczba(ws.Cells(r, 5).Value)
            If surowiec = "" Then
                blad = "Receptura dla „" & produkt & "” nie ma surowca (arkusz RECEPTURY, wiersz " & r & ")."
            ElseIf Takie(surowiec, produkt) Then
                blad = "Receptura dla „" & produkt & "” wskazuje ten sam produkt jako surowiec (arkusz RECEPTURY, wiersz " & r & ")."
            ElseIf InStr(LCase$(surowiec), "zrębk") > 0 Then
                blad = "Receptura dla „" & produkt & "” wskazuje zrębkę jako surowiec. Zrębka nie może być zużywana do produkcji — popraw arkusz RECEPTURY (wiersz " & r & ")."
            ElseIf przel <= 0 Then
                blad = "Receptura dla „" & produkt & "” ma niepoprawny przelicznik (arkusz RECEPTURY, wiersz " & r & ")."
            ElseIf jmSur = "" Or jmProd = "" Then
                blad = "Receptura dla „" & produkt & "” nie ma jednostek (arkusz RECEPTURY, wiersz " & r & ")."
            Else
                ZnajdzRecepture = True
            End If
            Exit Function
        End If
    Next r
    blad = "Brak aktywnej receptury dla produktu „" & produkt & "”. Dodaj ją w arkuszu RECEPTURY (produkt, surowiec, jednostki, przelicznik)."
End Function

Public Function OpisReceptury(ByVal surowiec As String, ByVal jmSur As String, ByVal produkt As String, ByVal jmProd As String, ByVal przel As Double) As String
    OpisReceptury = surowiec & " → " & produkt & " (1 " & JMOpis(jmSur) & " = " & Fmt(przel) & " " & JMOpis(jmProd) & ")"
End Function

' Ilosc surowca potrzebna do wyprodukowania ilosci (w dowolnej JM) wyrobu wg receptury
Private Function Zuzycie(ByVal ilosc As Double, ByVal jm As String, ByVal jmProd As String, ByVal przel As Double) As Double
    Dim wJmProd As Double
    Zuzycie = 0
    If UCase$(Trim$(jm)) = UCase$(Trim$(jmProd)) Then
        wJmProd = ilosc
    Else
        wJmProd = ZMP(DoMP(ilosc, jm), jmProd)
    End If
    Zuzycie = Round(wJmProd / przel, 6)
End Function

' =====================================================================
'  PLANOWANIE I WALIDACJA OPERACJI (bez zapisu)
' =====================================================================
Public Function Zaplanuj(ByVal op As clsOperacja, ByVal pominId As String) As Boolean
    Dim blad As String, sur As String, jmS As String, jmP As String, przel As Double
    Dim dostepne As Double
    Zaplanuj = False
    OstatniBlad = ""
    op.Typ = UCase$(Trim$(op.Typ))
    op.SurowiecProdukt = "": op.SurowiecIlosc = 0: op.SurowiecJM = "": op.RecepturaOpis = "": op.Przelicznik = 0

    Select Case op.Typ
        Case "ZAKUP", "PRODUKCJA", "SPRZEDAŻ", "ZUŻYCIE", "MM"
        Case Else
            OstatniBlad = "Wybierz typ operacji (ZAKUP, PRODUKCJA, SPRZEDAŻ, ZUŻYCIE, MM). Transport nie jest osobnym typem — zaznacz pole „Transport” w operacji."
            Exit Function
    End Select
    If Not IsDate(op.DataOp) Then OstatniBlad = "Niepoprawna data operacji.": Exit Function
    If Trim$(op.Produkt) = "" Then OstatniBlad = "Wybierz produkt.": Exit Function
    If op.Volumen <= 0 Then OstatniBlad = "Ilość (Volumen) musi być większa od zera.": Exit Function
    If Trim$(op.JM) = "" Then OstatniBlad = "Wybierz jednostkę miary.": Exit Function

    ' --- transport: czesc operacji ---
    If op.Transport Then
        If op.Typ = "ZUŻYCIE" Then OstatniBlad = "Zużycie nie ma transportu — odznacz pole „Transport”.": Exit Function
        If Trim$(op.Przewoznik) = "" And Trim$(op.Pojazd) = "" And Trim$(op.NrRej) = "" Then
            OstatniBlad = "Zaznaczono Transport — podaj przewoźnika, pojazd albo numer rejestracyjny.": Exit Function
        End If
        If op.Dystans < 0 Then OstatniBlad = "Kilometry nie mogą być ujemne.": Exit Function
        If op.KosztTrans < 0 Then OstatniBlad = "Koszt transportu nie może być ujemny.": Exit Function
    Else
        ' transport odznaczony: dane przewozu nie sa zapisywane i nie powoduja bledow
        op.Przewoznik = "": op.NrRej = "": op.Dystans = 0: op.KosztTrans = 0
        op.Trasa = "": op.Pojazd = "": op.Operator = ""
    End If

    ' --- produkcja na magazynie: zuzycie surowca wg receptury ---
    If op.Typ = "PRODUKCJA" Then
        If Not ZnajdzRecepture(op.Produkt, sur, jmS, jmP, przel, blad) Then OstatniBlad = blad: Exit Function
        op.SurowiecProdukt = sur: op.SurowiecJM = jmS: op.Przelicznik = przel
        op.RecepturaOpis = OpisReceptury(sur, jmS, op.Produkt, jmP, przel)
        op.SurowiecIlosc = Zuzycie(op.Volumen, op.JM, jmP, przel)
        op.StanSurowcaPrzed = Round(Stan(sur, jmS, pominId), 6)
        op.StanSurowcaPo = Round(op.StanSurowcaPrzed - op.SurowiecIlosc, 6)
        If op.SurowiecIlosc > op.StanSurowcaPrzed + EPS Then
            OstatniBlad = "Niewystarczający stan surowca." & vbCrLf & vbCrLf & sur & ":" & vbCrLf & _
                "stan: " & Fmt(op.StanSurowcaPrzed) & " " & JMOpis(jmS) & vbCrLf & _
                "wymagane: " & Fmt(op.SurowiecIlosc) & " " & JMOpis(jmS) & vbCrLf & _
                "brakuje: " & Fmt(op.SurowiecIlosc - op.StanSurowcaPrzed) & " " & JMOpis(jmS) & vbCrLf & vbCrLf & _
                "Operacja nie została zapisana."
            Exit Function
        End If
        op.StanProduktuPrzed = Round(Stan(op.Produkt, op.JM, pominId), 6)
        op.StanProduktuPo = Round(op.StanProduktuPrzed + IIf(UCase$(op.CzyMag) = "NIE", 0, op.Volumen), 6)
    End If

    ' --- zakup z produkcja (frmDodatkowe): surowcem jest zakupiony towar ---
    If op.Typ = "ZAKUP" And op.ChainProdukcja Then
        If Trim$(op.ProdProdukt) = "" Or op.ProdVolumen <= 0 Or Trim$(op.ProdJM) = "" Then OstatniBlad = "Uzupełnij produkt, ilość i jednostkę produkcji.": Exit Function
        If Not ZnajdzRecepture(op.ProdProdukt, sur, jmS, jmP, przel, blad) Then OstatniBlad = blad: Exit Function
        If Not Takie(sur, op.Produkt) Then
            OstatniBlad = "Zakupiony produkt „" & op.Produkt & "” nie jest surowcem receptury „" & op.ProdProdukt & "” (surowiec: " & sur & "). Zmień produkt albo popraw arkusz RECEPTURY."
            Exit Function
        End If
        op.SurowiecProdukt = sur: op.SurowiecJM = jmS: op.Przelicznik = przel
        op.RecepturaOpis = OpisReceptury(sur, jmS, op.ProdProdukt, jmP, przel)
        op.SurowiecIlosc = Zuzycie(op.ProdVolumen, op.ProdJM, jmP, przel)
        op.StanSurowcaPrzed = Round(Stan(sur, jmS, pominId), 6)
        dostepne = Round(op.StanSurowcaPrzed + ZMP(DoMP(op.Volumen, op.JM), jmS), 6)
        op.StanSurowcaPo = Round(dostepne - op.SurowiecIlosc, 6)
        If op.SurowiecIlosc > dostepne + EPS Then
            OstatniBlad = "Niewystarczający stan surowca." & vbCrLf & vbCrLf & sur & ":" & vbCrLf & _
                "stan + zakup: " & Fmt(dostepne) & " " & JMOpis(jmS) & vbCrLf & _
                "wymagane: " & Fmt(op.SurowiecIlosc) & " " & JMOpis(jmS) & vbCrLf & _
                "brakuje: " & Fmt(op.SurowiecIlosc - dostepne) & " " & JMOpis(jmS) & vbCrLf & vbCrLf & _
                "Operacja nie została zapisana."
            Exit Function
        End If
        op.StanProduktuPrzed = Round(Stan(op.ProdProdukt, op.ProdJM, pominId), 6)
        op.StanProduktuPo = Round(op.StanProduktuPrzed + IIf(op.ChainSprzedaz, 0, op.ProdVolumen), 6)
    End If
    If op.ChainSprzedaz Then
        If Trim$(op.SprzOdbiorca) = "" Or op.SprzCena <= 0 Then OstatniBlad = "Uzupełnij odbiorcę i cenę sprzedaży.": Exit Function
    End If
    Zaplanuj = True
End Function

' Podsumowanie pokazywane przed zatwierdzeniem
Public Function Podsumowanie(ByVal op As clsOperacja, ByVal korektaId As String) As String
    Dim s As String
    If korektaId <> "" Then s = "KOREKTA OPERACJI " & korektaId & vbCrLf & vbCrLf
    If op.Typ = "PRODUKCJA" Then
        s = s & "PRODUKCJA" & vbCrLf & "Produkt: " & op.Produkt & vbCrLf & "Ilość: " & Fmt(op.Volumen) & " " & JMOpis(op.JM) & vbCrLf & vbCrLf
        s = s & "SUROWIEC DO ZUŻYCIA" & vbCrLf & op.SurowiecProdukt & ": " & Fmt(op.SurowiecIlosc) & " " & JMOpis(op.SurowiecJM) & vbCrLf
        s = s & "Receptura: " & op.RecepturaOpis & vbCrLf & vbCrLf
        s = s & "STAN MAGAZYNOWY PO ZATWIERDZENIU" & vbCrLf
        s = s & op.SurowiecProdukt & ": " & Fmt(op.StanSurowcaPrzed) & " " & JMOpis(op.SurowiecJM) & " → " & Fmt(op.StanSurowcaPo) & " " & JMOpis(op.SurowiecJM) & vbCrLf
        s = s & op.Produkt & ": " & Fmt(op.StanProduktuPrzed) & " " & JMOpis(op.JM) & " → " & Fmt(op.StanProduktuPo) & " " & JMOpis(op.JM) & vbCrLf
    Else
        s = s & op.Typ & vbCrLf & "Produkt: " & op.Produkt & vbCrLf & "Ilość: " & Fmt(op.Volumen) & " " & JMOpis(op.JM) & vbCrLf
        If op.Typ = "ZAKUP" Then s = s & "Dostawca: " & op.Dostawca & vbCrLf & "Wartość: " & Format(op.Volumen * op.CenaZakupu, "#,##0.00") & " zł" & vbCrLf
        If op.Typ = "SPRZEDAŻ" Then s = s & "Odbiorca: " & op.Odbiorca & vbCrLf & "Wartość: " & Format(op.Volumen * op.CenaSprzedazy, "#,##0.00") & " zł" & vbCrLf
        If op.ChainProdukcja Then
            s = s & vbCrLf & "+ PRODUKCJA: " & op.ProdProdukt & " " & Fmt(op.ProdVolumen) & " " & JMOpis(op.ProdJM) & vbCrLf
            s = s & "SUROWIEC DO ZUŻYCIA" & vbCrLf & op.SurowiecProdukt & ": " & Fmt(op.SurowiecIlosc) & " " & JMOpis(op.SurowiecJM) & vbCrLf
            s = s & "Receptura: " & op.RecepturaOpis & vbCrLf
            s = s & op.SurowiecProdukt & " (stan + zakup − zużycie): " & Fmt(op.StanSurowcaPo) & " " & JMOpis(op.SurowiecJM) & vbCrLf
        End If
        If op.ChainSprzedaz Then s = s & "+ SPRZEDAŻ do: " & op.SprzOdbiorca & " po " & Format(op.SprzCena, "#,##0.00") & " zł" & vbCrLf
    End If
    s = s & vbCrLf & "Transport: " & op.OpisTransportu()
    Podsumowanie = s
End Function

' =====================================================================
'  ZATWIERDZENIE (nowa operacja albo korekta) - jedyna droga zapisu
' =====================================================================
Public Function ZatwierdzOperacje(ByVal op As clsOperacja, ByVal korektaId As String) As Boolean
    Dim tytul As String, powod As String, stara As clsOperacja, wiersze As Collection
    ZatwierdzOperacje = False
    OstatniBlad = ""
    If korektaId <> "" Then
        Set stara = WczytajOperacje(korektaId)
        If stara Is Nothing Then
            OstatniBlad = "Nie znaleziono operacji " & korektaId & " w arkuszu Dane."
            Komunikat OstatniBlad, vbExclamation, "Korekta"
            Exit Function
        End If
    End If
    SladKroku = "planowanie"
    If Not Zaplanuj(op, korektaId) Then
        Komunikat OstatniBlad, vbExclamation, IIf(InStr(OstatniBlad, "Niewystarczający") > 0, "Niewystarczający stan surowca", "Nie można zapisać operacji")
        Exit Function
    End If
    SladKroku = "podsumowanie"
    OstatniePodsumowanie = Podsumowanie(op, korektaId)
    tytul = IIf(op.Typ = "PRODUKCJA", "Zatwierdź produkcję", IIf(korektaId <> "", "Zatwierdź korektę", "Zatwierdź operację"))
    If Not TrybCichy Then
        If MsgBox(OstatniePodsumowanie & vbCrLf & vbCrLf & "OK = " & tytul & "    Anuluj = powrót do formularza", vbOKCancel + vbQuestion, tytul) <> vbOK Then
            OstatniBlad = "Anulowano przez użytkownika."
            Exit Function
        End If
    End If
    If korektaId <> "" Then
        If TrybCichy Then
            powod = PowodCichy
        Else
            powod = InputBox("Podaj powód korekty operacji " & korektaId & ":", "Powód korekty")
        End If
        If Trim$(powod) = "" Then
            OstatniBlad = "Korekta wymaga podania powodu — nic nie zostało zmienione."
            Komunikat OstatniBlad, vbExclamation, "Korekta"
            Exit Function
        End If
        op.Id = korektaId
        op.Wersja = stara.Wersja + 1
    Else
        SladKroku = "nowe ID"
        op.Id = NoweID()
        op.Wersja = 1
    End If

    SladKroku = "numer ID / wiersze"
    Set wiersze = WierszeDoKorekty(korektaId)          ' numery starych wierszy (przed dopisaniem nowych)
    SladKroku = "zapis wierszy"
    ZapiszWiersze op
    SladKroku = "archiwum / historia"
    If korektaId <> "" Then
        Archiwizuj wiersze, "KOREKTA", powod
        LogujRoznice stara, op, powod
    Else
        Loguj op.Id, "UTWORZENIE", "Operacja", "", Replace(Podsumowanie(op, ""), vbCrLf, " | "), ""
    End If
    SladKroku = "rejestr"
    PoZmianie
    SladKroku = ""
    ZatwierdzOperacje = True
End Function

Private Function WierszeDoKorekty(ByVal id As String) As Collection
    Dim c As New Collection, ws As Worksheet, r As Long, ost As Long
    Set WierszeDoKorekty = c
    If id = "" Then Exit Function
    Set ws = Ark(ARK_DANE)
    ost = OstatniWiersz(ws)
    For r = 2 To ost
        If Tekst(ws.Cells(r, C_ID).Value) = id Then c.Add r
    Next r
End Function

Public Sub PoZmianie()
    On Error Resume Next
    OdswiezRejestr
    If Not TrybCichy Then ThisWorkbook.RefreshAll
End Sub

' =====================================================================
'  ZAPIS WIERSZY
' =====================================================================
Private Function NowyWiersz(ByVal op As clsOperacja, ByVal rola As String) As Variant
    Dim w() As Variant
    ReDim w(1 To LICZBA_KOLUMN)
    If IsDate(op.DataZal) Then
        w(C_DATAZAL) = CDate(op.DataZal)
    Else
        w(C_DATAZAL) = CDate(op.DataOp)
    End If
    w(C_MIEJSCEZAL) = op.MiejsceZal
    w(C_DATA) = CDate(op.DataOp)
    w(C_DOSTAWCA) = op.Dostawca
    w(C_TYP) = op.Typ
    w(C_WZ) = op.NrWZ
    w(C_MAG) = op.CzyMag
    w(C_DEKL) = op.Deklaracja
    w(C_VOL) = op.Volumen
    w(C_JM) = op.JM
    w(C_CZAK) = op.CenaZakupu
    w(C_WART) = 0
    w(C_CSPRZ) = op.CenaSprzedazy
    w(C_PROD) = op.Produkt
    w(C_ZREBKA) = op.Zrebka
    w(C_RAB) = op.Rabanie
    w(C_CRAB) = op.CenaRab
    w(C_ODB) = op.Odbiorca
    w(C_UWAGI) = op.Uwagi
    w(C_POCH) = op.MiejscePochodzenia
    w(C_DODANO) = Now
    w(C_UTWORZYL) = Uzytkownik()
    w(C_ID) = op.Id
    w(C_TRANSPORT) = IIf(op.Transport, "TAK", "NIE")
    w(C_ROLA) = rola
    w(C_WERSJA) = op.Wersja
    ' dane przewozu tylko w wierszu glownym (koszt liczony raz na operacje)
    If rola = ROLA_GLOWNY And op.Transport Then
        w(C_PRZEW) = op.Przewoznik
        w(C_NRREJ) = UCase$(op.NrRej)
        w(C_KM) = op.Dystans
        w(C_KOSZTTR) = op.KosztTrans
        w(C_KOSZTBAZ) = op.KosztTrans
        w(C_TRASA) = op.Trasa
        w(C_POJAZD) = op.Pojazd
        w(C_OPERATOR) = op.Operator
    Else
        w(C_PRZEW) = "": w(C_NRREJ) = "": w(C_KM) = "": w(C_KOSZTTR) = "": w(C_KOSZTBAZ) = ""
        w(C_TRASA) = "": w(C_POJAZD) = "": w(C_OPERATOR) = ""
    End If
    NowyWiersz = w
End Function

Private Function WierszZuzycia(ByVal op As clsOperacja) As Variant
    Dim w As Variant
    w = NowyWiersz(op, ROLA_ZUZYCIE)
    w(C_TYP) = "ZUŻYCIE"
    w(C_MAG) = "TAK"
    w(C_VOL) = op.SurowiecIlosc
    w(C_JM) = op.SurowiecJM
    w(C_CZAK) = 0: w(C_WART) = 0: w(C_CSPRZ) = 0
    w(C_PROD) = op.SurowiecProdukt
    w(C_ZREBKA) = ""
    w(C_RAB) = "": w(C_CRAB) = 0
    w(C_UWAGI) = "Automatyczne zużycie surowca wg receptury: " & op.RecepturaOpis
    w(C_RECEPTURA) = op.RecepturaOpis
    WierszZuzycia = w
End Function

Private Sub ZapiszWiersze(ByVal op As clsOperacja)
    Dim lista As New Collection, w As Variant
    Select Case op.Typ
        Case "PRODUKCJA"
            w = NowyWiersz(op, ROLA_GLOWNY)
            w(C_CZAK) = 0: w(C_WART) = 0: w(C_CSPRZ) = 0
            If Trim$(op.CzyMag) = "" Then w(C_MAG) = "TAK"
            w(C_RECEPTURA) = op.RecepturaOpis
            lista.Add w
            lista.Add WierszZuzycia(op)
        Case "ZAKUP"
            w = NowyWiersz(op, ROLA_GLOWNY)
            w(C_CSPRZ) = 0
            w(C_WART) = Round(op.Volumen * op.CenaZakupu, 2)
            If op.ChainProdukcja Then
                w(C_MAG) = "TAK"                    ' surowiec wchodzi na stan i jest zuzywany wierszem ZUZYCIE
                w(C_CRAB) = 0                        ' koszt rabania w wierszu produkcji
                w(C_RECEPTURA) = op.RecepturaOpis
            ElseIf op.ChainSprzedaz Then
                w(C_MAG) = "NIE"                     ' sprzedaz bezposrednia zakupionego towaru
            End If
            lista.Add w
            If op.ChainProdukcja Then
                w = NowyWiersz(op, ROLA_PRODUKCJA)
                w(C_TYP) = "PRODUKCJA"
                w(C_MAG) = IIf(op.ChainSprzedaz, "NIE", "TAK")
                w(C_VOL) = op.ProdVolumen: w(C_JM) = op.ProdJM: w(C_PROD) = op.ProdProdukt
                w(C_CZAK) = 0: w(C_WART) = 0: w(C_CSPRZ) = 0
                w(C_UWAGI) = "Automatyczna produkcja z zakupionego surowca"
                w(C_RECEPTURA) = op.RecepturaOpis
                lista.Add w
                w = WierszZuzycia(op)
                lista.Add w
            End If
            If op.ChainSprzedaz Then
                w = NowyWiersz(op, ROLA_SPRZEDAZ)
                w(C_TYP) = "SPRZEDAŻ"
                w(C_MAG) = "NIE"
                w(C_DOSTAWCA) = op.Odbiorca
                If op.ChainProdukcja Then
                    w(C_VOL) = op.ProdVolumen: w(C_JM) = op.ProdJM: w(C_PROD) = op.ProdProdukt
                End If
                w(C_CZAK) = 0
                w(C_CSPRZ) = op.SprzCena
                w(C_WART) = Round(Liczba(w(C_VOL)) * op.SprzCena, 2)
                w(C_ODB) = op.SprzOdbiorca
                w(C_CRAB) = 0
                w(C_UWAGI) = "Automatyczna bezpośrednia sprzedaż"
                lista.Add w
            End If
        Case "SPRZEDAŻ"
            w = NowyWiersz(op, ROLA_GLOWNY)
            w(C_CZAK) = 0
            w(C_WART) = Round(op.Volumen * op.CenaSprzedazy, 2)
            lista.Add w
        Case Else ' ZUŻYCIE, MM
            w = NowyWiersz(op, ROLA_GLOWNY)
            w(C_CZAK) = 0: w(C_WART) = 0: w(C_CSPRZ) = 0
            lista.Add w
    End Select
    DopiszWiersze lista
End Sub

Private Sub DopiszWiersze(ByVal lista As Collection)
    Dim ws As Worksheet, r As Long, i As Long, k As Long, w As Variant
    Set ws = Ark(ARK_DANE)
    r = OstatniWiersz(ws)
    For i = 1 To lista.Count
        w = lista(i)
        r = r + 1
        For k = 1 To LICZBA_KOLUMN
            ' kolumny 26-36 to kolumny obliczeniowe tabeli - wypelnia je Excel
            If k < 26 Or k > 36 Then
                If Not IsEmpty(w(k)) Then ws.Cells(r, k).Value = w(k)
            End If
        Next k
        RozszerzTabele ws, r
    Next i
End Sub

Private Sub RozszerzTabele(ByVal ws As Worksheet, ByVal wiersz As Long)
    Dim lo As Object
    On Error Resume Next
    Set lo = ws.ListObjects(1)
    If lo Is Nothing Then Exit Sub
    If lo.Range.Row + lo.Range.Rows.Count - 1 < wiersz Then
        lo.Resize ws.Range(lo.Range.Cells(1, 1), ws.Cells(wiersz, lo.Range.Column + lo.Range.Columns.Count - 1))
    End If
End Sub

Public Function NoweID() As String
    Dim m As Long
    m = MaxNumerID(Ark(ARK_DANE))
    On Error Resume Next
    Dim a As Long
    a = MaxNumerID(Ark(ARK_ARCH))
    On Error GoTo 0
    If a > m Then m = a
    NoweID = "OP-" & Format(m + 1, "000000")
End Function

Private Function MaxNumerID(ByVal ws As Worksheet) As Long
    Dim r As Long, ost As Long, s As String, n As Long
    MaxNumerID = 0
    ost = ws.Cells(ws.Rows.Count, C_ID).End(xlUp).Row
    For r = 2 To ost
        s = Tekst(ws.Cells(r, C_ID).Value)
        If Left$(s, 3) = "OP-" Then
            n = CLng(Liczba(Mid$(s, 4)))
            If n > MaxNumerID Then MaxNumerID = n
        End If
    Next r
End Function

' =====================================================================
'  ODCZYT OPERACJI Z ARKUSZA
' =====================================================================
Public Function WczytajOperacje(ByVal id As String) As clsOperacja
    Dim ws As Worksheet, r As Long, ost As Long, op As clsOperacja, rola As String, gl As Long
    Set ws = Ark(ARK_DANE)
    ost = OstatniWiersz(ws)
    For r = 2 To ost
        If Tekst(ws.Cells(r, C_ID).Value) = id Then
            rola = Tekst(ws.Cells(r, C_ROLA).Value)
            If rola = ROLA_GLOWNY Or (gl = 0 And rola = "") Then gl = r: Exit For
        End If
    Next r
    If gl = 0 Then Exit Function
    Set op = New clsOperacja
    op.Id = id
    op.Wersja = CLng(Liczba(ws.Cells(gl, C_WERSJA).Value))
    If op.Wersja < 1 Then op.Wersja = 1
    op.DataZal = ws.Cells(gl, C_DATAZAL).Value
    op.MiejsceZal = Tekst(ws.Cells(gl, C_MIEJSCEZAL).Value)
    op.DataOp = ws.Cells(gl, C_DATA).Value
    op.Dostawca = Tekst(ws.Cells(gl, C_DOSTAWCA).Value)
    op.Typ = UCase$(Tekst(ws.Cells(gl, C_TYP).Value))
    op.NrWZ = Tekst(ws.Cells(gl, C_WZ).Value)
    op.CzyMag = Tekst(ws.Cells(gl, C_MAG).Value)
    op.Deklaracja = Tekst(ws.Cells(gl, C_DEKL).Value)
    op.Volumen = Liczba(ws.Cells(gl, C_VOL).Value)
    op.JM = Tekst(ws.Cells(gl, C_JM).Value)
    op.CenaZakupu = Liczba(ws.Cells(gl, C_CZAK).Value)
    op.CenaSprzedazy = Liczba(ws.Cells(gl, C_CSPRZ).Value)
    op.Produkt = Tekst(ws.Cells(gl, C_PROD).Value)
    op.Zrebka = Tekst(ws.Cells(gl, C_ZREBKA).Value)
    op.Rabanie = Tekst(ws.Cells(gl, C_RAB).Value)
    op.CenaRab = Liczba(ws.Cells(gl, C_CRAB).Value)
    op.Odbiorca = Tekst(ws.Cells(gl, C_ODB).Value)
    op.Uwagi = Tekst(ws.Cells(gl, C_UWAGI).Value)
    op.MiejscePochodzenia = Tekst(ws.Cells(gl, C_POCH).Value)
    op.Przewoznik = Tekst(ws.Cells(gl, C_PRZEW).Value)
    op.NrRej = Tekst(ws.Cells(gl, C_NRREJ).Value)
    op.Dystans = Liczba(ws.Cells(gl, C_KM).Value)
    op.KosztTrans = Liczba(ws.Cells(gl, C_KOSZTTR).Value)
    op.Trasa = Tekst(ws.Cells(gl, C_TRASA).Value)
    op.Pojazd = Tekst(ws.Cells(gl, C_POJAZD).Value)
    op.Operator = Tekst(ws.Cells(gl, C_OPERATOR).Value)
    If Tekst(ws.Cells(gl, C_TRANSPORT).Value) <> "" Then
        op.Transport = (UCase$(Tekst(ws.Cells(gl, C_TRANSPORT).Value)) = "TAK")
    Else
        op.Transport = (op.Przewoznik <> "" Or op.NrRej <> "" Or op.Dystans <> 0 Or op.KosztTrans <> 0)
    End If
    ' wiersze automatyczne tej samej operacji
    For r = 2 To ost
        If r <> gl And Tekst(ws.Cells(r, C_ID).Value) = id Then
            Select Case UCase$(Tekst(ws.Cells(r, C_TYP).Value))
                Case "PRODUKCJA"
                    op.ChainProdukcja = True
                    op.ProdProdukt = Tekst(ws.Cells(r, C_PROD).Value)
                    op.ProdVolumen = Liczba(ws.Cells(r, C_VOL).Value)
                    op.ProdJM = Tekst(ws.Cells(r, C_JM).Value)
                Case "ZUŻYCIE"
                    op.PoprzedniSurowiec = Tekst(ws.Cells(r, C_PROD).Value)
                    op.PoprzednieZuzycie = Liczba(ws.Cells(r, C_VOL).Value)
                    op.PoprzednieZuzycieJM = Tekst(ws.Cells(r, C_JM).Value)
                Case "SPRZEDAŻ"
                    op.ChainSprzedaz = True
                    op.SprzOdbiorca = Tekst(ws.Cells(r, C_ODB).Value)
                    op.SprzCena = Liczba(ws.Cells(r, C_CSPRZ).Value)
            End Select
        End If
    Next r
    Set WczytajOperacje = op
End Function

' =====================================================================
'  ARCHIWUM, USUWANIE, HISTORIA ZMIAN
' =====================================================================
' Kopiuje wiersze do ARCHIWUM (z data, uzytkownikiem, akcja, powodem) i usuwa je z Dane
Private Sub Archiwizuj(ByVal wiersze As Collection, ByVal akcja As String, ByVal powod As String)
    Dim wsD As Worksheet, wsA As Worksheet, i As Long, r As Long, k As Long, ra As Long, tab() As Long
    If wiersze.Count = 0 Then Exit Sub
    Set wsD = Ark(ARK_DANE)
    Set wsA = Ark(ARK_ARCH)
    ra = wsA.Cells(wsA.Rows.Count, 1).End(xlUp).Row
    If ra < 1 Then ra = 1
    ReDim tab(1 To wiersze.Count)
    For i = 1 To wiersze.Count
        r = wiersze(i)
        tab(i) = r
        ra = ra + 1
        For k = 1 To LICZBA_KOLUMN
            wsA.Cells(ra, k).Value = wsD.Cells(r, k).Value
        Next k
        wsA.Cells(ra, LICZBA_KOLUMN + 1).Value = Now
        wsA.Cells(ra, LICZBA_KOLUMN + 2).Value = Uzytkownik()
        wsA.Cells(ra, LICZBA_KOLUMN + 3).Value = akcja
        wsA.Cells(ra, LICZBA_KOLUMN + 4).Value = powod
    Next i
    ' usuwanie od dolu, aby numery wierszy sie nie przesuwaly
    For i = UBound(tab) To 1 Step -1
        wsD.Rows(tab(i)).Delete
    Next i
End Sub

Public Function UsunOperacje(ByVal id As String, ByVal powod As String) As Boolean
    Dim wiersze As Collection, op As clsOperacja, skutki As String, ujemne As String
    UsunOperacje = False
    OstatniBlad = ""
    Set op = WczytajOperacje(id)
    Set wiersze = WierszeDoKorekty(id)
    If op Is Nothing Or wiersze.Count = 0 Then
        OstatniBlad = "Nie znaleziono operacji " & id & "."
        Komunikat OstatniBlad, vbExclamation, "Usuwanie"
        Exit Function
    End If
    skutki = SkutkiUsuniecia(id, ujemne)
    If Not TrybCichy Then
        If MsgBox("Usunąć operację " & id & "?" & vbCrLf & vbCrLf & Replace(Podsumowanie(op, ""), "Transport:", "Transport:") & vbCrLf & vbCrLf & _
                  "SKUTEK MAGAZYNOWY USUNIĘCIA:" & vbCrLf & skutki & IIf(ujemne <> "", vbCrLf & "UWAGA — stan ujemny po usunięciu: " & ujemne, "") & vbCrLf & vbCrLf & _
                  "Wiersze zostaną przeniesione do arkusza ARCHIWUM (dane nie są tracone).", vbOKCancel + vbExclamation, "Usuń operację") <> vbOK Then
            OstatniBlad = "Anulowano przez użytkownika."
            Exit Function
        End If
        If powod = "" Then powod = InputBox("Podaj powód usunięcia operacji " & id & ":", "Powód usunięcia")
    Else
        If powod = "" Then powod = PowodCichy
    End If
    If Trim$(powod) = "" Then
        OstatniBlad = "Usunięcie wymaga podania powodu — nic nie zostało zmienione."
        Komunikat OstatniBlad, vbExclamation, "Usuwanie"
        Exit Function
    End If
    Archiwizuj wiersze, "USUNIĘCIE", powod
    Loguj id, "USUNIĘCIE", "Operacja", Replace(Podsumowanie(op, ""), vbCrLf, " | "), "(usunięta — wiersze w ARCHIWUM)", powod
    Loguj id, "USUNIĘCIE", "Skutek magazynowy", "", Replace(skutki, vbCrLf, " | "), powod
    PoZmianie
    UsunOperacje = True
End Function

' Odwrocenie skutkow magazynowych usuniecia (do potwierdzenia i historii)
Private Function SkutkiUsuniecia(ByVal id As String, ByRef ujemne As String) As String
    Dim ws As Worksheet, r As Long, ost As Long, typ As String, v As Double, s As String, p As String, jm As String, stanPo As Double
    Set ws = Ark(ARK_DANE)
    ost = OstatniWiersz(ws)
    For r = 2 To ost
        If Tekst(ws.Cells(r, C_ID).Value) = id And UCase$(Tekst(ws.Cells(r, C_MAG).Value)) = "TAK" Then
            typ = UCase$(Tekst(ws.Cells(r, C_TYP).Value))
            p = Tekst(ws.Cells(r, C_PROD).Value)
            jm = Tekst(ws.Cells(r, C_JM).Value)
            v = Liczba(ws.Cells(r, C_VOL).Value)
            If typ = "ZAKUP" Or typ = "PRODUKCJA" Then
                s = s & p & ": -" & Fmt(v) & " " & JMOpis(jm) & vbCrLf
            ElseIf typ = "SPRZEDAŻ" Or typ = "ZUŻYCIE" Then
                s = s & p & ": +" & Fmt(v) & " " & JMOpis(jm) & vbCrLf
            End If
            stanPo = Stan(p, jm, id)
            If stanPo < -EPS And InStr(ujemne, p) = 0 Then ujemne = ujemne & p & " (" & Fmt(stanPo) & " " & JMOpis(jm) & ") "
        End If
    Next r
    If s = "" Then s = "brak wpływu na stan (operacja niemagazynowana)" & vbCrLf
    SkutkiUsuniecia = s
End Function

Public Sub Loguj(ByVal id As String, ByVal akcja As String, ByVal pole As String, ByVal bylo As String, ByVal jest As String, ByVal powod As String)
    Dim ws As Worksheet, r As Long
    On Error Resume Next
    Set ws = Ark(ARK_HIST)
    On Error GoTo 0
    If ws Is Nothing Then Exit Sub
    r = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row + 1
    If r < 2 Then r = 2
    ws.Cells(r, 1).Value = Now
    ws.Cells(r, 2).Value = Uzytkownik()
    ws.Cells(r, 3).Value = id
    ws.Cells(r, 4).Value = akcja
    ws.Cells(r, 5).Value = pole
    ws.Cells(r, 6).Value = bylo
    ws.Cells(r, 7).Value = jest
    ws.Cells(r, 8).Value = powod
End Sub

Private Sub Porownaj(ByVal id As String, ByVal pole As String, ByVal a As Variant, ByVal b As Variant, ByVal powod As String, ByRef n As Long)
    Dim sa As String, sb As String
    If VarType(a) = vbDouble Then sa = Fmt(CDbl(a)) Else sa = Tekst(a)
    If VarType(b) = vbDouble Then sb = Fmt(CDbl(b)) Else sb = Tekst(b)
    If sa <> sb Then
        Loguj id, "KOREKTA", pole, sa, sb, powod
        n = n + 1
    End If
End Sub

Private Sub LogujRoznice(ByVal a As clsOperacja, ByVal b As clsOperacja, ByVal powod As String)
    Dim n As Long, id As String, d1 As String, d2 As String
    id = b.Id
    If IsDate(a.DataOp) Then d1 = Format(CDate(a.DataOp), "dd.mm.yyyy")
    If IsDate(b.DataOp) Then d2 = Format(CDate(b.DataOp), "dd.mm.yyyy")
    Porownaj id, "Typ operacji", a.Typ, b.Typ, powod, n
    Porownaj id, "Data operacji", d1, d2, powod, n
    Porownaj id, "Dostawca", a.Dostawca, b.Dostawca, powod, n
    Porownaj id, "Odbiorca", a.Odbiorca, b.Odbiorca, powod, n
    Porownaj id, "Produkt", a.Produkt, b.Produkt, powod, n
    Porownaj id, "Ilość", a.Volumen, b.Volumen, powod, n
    Porownaj id, "Jednostka", a.JM, b.JM, powod, n
    Porownaj id, "Cena zakupu", a.CenaZakupu, b.CenaZakupu, powod, n
    Porownaj id, "Cena sprzedaży", a.CenaSprzedazy, b.CenaSprzedazy, powod, n
    Porownaj id, "Transport", IIf(a.Transport, "TAK", "NIE"), IIf(b.Transport, "TAK", "NIE"), powod, n
    Porownaj id, "Przewoźnik", a.Przewoznik, b.Przewoznik, powod, n
    Porownaj id, "Pojazd", a.Pojazd, b.Pojazd, powod, n
    Porownaj id, "Nr rejestracyjny", a.NrRej, b.NrRej, powod, n
    Porownaj id, "Operator / kierowca", a.Operator, b.Operator, powod, n
    Porownaj id, "Trasa", a.Trasa, b.Trasa, powod, n
    Porownaj id, "Kilometry", a.Dystans, b.Dystans, powod, n
    Porownaj id, "Koszt transportu", a.KosztTrans, b.KosztTrans, powod, n
    If a.ChainProdukcja Or b.ChainProdukcja Then
        Porownaj id, "Produkcja (produkt)", a.ProdProdukt, b.ProdProdukt, powod, n
        Porownaj id, "Produkcja (ilość)", a.ProdVolumen, b.ProdVolumen, powod, n
    End If
    If a.PoprzedniSurowiec <> "" Or b.SurowiecProdukt <> "" Then
        Porownaj id, "Receptura produkcji (surowiec)", a.PoprzedniSurowiec, b.SurowiecProdukt, powod, n
        Porownaj id, "Zużycie surowca", Fmt(a.PoprzednieZuzycie) & " " & JMOpis(a.PoprzednieZuzycieJM), Fmt(b.SurowiecIlosc) & " " & JMOpis(b.SurowiecJM), powod, n
    End If
    Porownaj id, "Uwagi", a.Uwagi, b.Uwagi, powod, n
    Loguj id, "KOREKTA", "Wersja", CStr(a.Wersja), CStr(b.Wersja) & " (zmienionych pól: " & n & ")", powod
End Sub

' =====================================================================
'  REJESTR OPERACJI (jedna linia = jedna operacja)
' =====================================================================
Public Sub OdswiezRejestr()
    If mOdswiezanie Then Exit Sub
    mOdswiezanie = True
    On Error GoTo koniec
    OdswiezRejestrWewn
koniec:
    mOdswiezanie = False
End Sub

Private Sub OdswiezRejestrWewn()
    Dim d As Variant, ost As Long, r As Long, wsR As Worksheet, w As Long, i As Long
    Dim id As String, typ As String, wyn() As Variant, n As Long, j As Long
    On Error Resume Next
    Set wsR = Ark(ARK_REJ)
    On Error GoTo 0
    If wsR Is Nothing Then Exit Sub
    Diag "rejestr: odczyt"
    d = DaneTablica(ost)
    Diag "rejestr: czyszczenie, wierszy=" & ost
    wsR.Range("A6:N" & wsR.Rows.Count).ClearContents
    If IsEmpty(d) Then Exit Sub
    ReDim wyn(1 To ost, 1 To 14)
    For r = ost To 2 Step -1
        If Tekst(d(r, C_ROLA)) = ROLA_GLOWNY Or Tekst(d(r, C_ROLA)) = "" Then
            n = n + 1
            id = Tekst(d(r, C_ID))
            typ = Tekst(d(r, C_TYP))
            wyn(n, 1) = d(r, C_DATA)
            wyn(n, 6) = IIf(Tekst(d(r, C_TRANSPORT)) = "", IIf(Tekst(d(r, C_PRZEW)) <> "" Or Liczba(d(r, C_KOSZTTR)) <> 0, "Tak", "Nie"), IIf(UCase$(Tekst(d(r, C_TRANSPORT))) = "TAK", "Tak", "Nie"))
            wyn(n, 3) = d(r, C_PROD)
            wyn(n, 4) = d(r, C_VOL)
            wyn(n, 5) = d(r, C_JM)
            wyn(n, 7) = Tekst(d(r, C_PRZEW)) & IIf(Tekst(d(r, C_POJAZD)) <> "", " / " & Tekst(d(r, C_POJAZD)), "") & IIf(Tekst(d(r, C_NRREJ)) <> "", " / " & Tekst(d(r, C_NRREJ)), "")
            wyn(n, 8) = d(r, C_KOSZTTR)
            wyn(n, 12) = id
            wyn(n, 13) = d(r, C_WERSJA)
            wyn(n, 14) = d(r, C_UWAGI)
            ' wiersze automatyczne tej samej operacji
            If id <> "" Then
                For j = 2 To ost
                    If j <> r And Tekst(d(j, C_ID)) = id Then
                        Select Case UCase$(Tekst(d(j, C_TYP)))
                            Case "ZUŻYCIE"
                                wyn(n, 9) = d(j, C_PROD): wyn(n, 10) = d(j, C_VOL): wyn(n, 11) = d(j, C_JM)
                            Case "PRODUKCJA"
                                typ = typ & " + PRODUKCJA"
                            Case "SPRZEDAŻ"
                                typ = typ & " + SPRZEDAŻ"
                        End Select
                    End If
                Next j
            End If
            wyn(n, 2) = typ
        End If
    Next r
    Diag "rejestr: operacji=" & n
    If n > 0 Then
        Dim outArr() As Variant
        ReDim outArr(1 To n, 1 To 14)
        For i = 1 To n
            For w = 1 To 14
                outArr(i, w) = wyn(i, w)
            Next w
        Next i
        Diag "rejestr: zapis"
        wsR.Range("A6").Resize(n, 14).Value = outArr
    End If
    Diag "rejestr: koniec"
    wsR.Range("B3").Value = "Operacji: " & n & "   |   odświeżono: " & Format(Now, "dd.mm.yyyy hh:nn")
End Sub

' =====================================================================
'  WYBOR OPERACJI I MAKRA PRZYCISKOW
' =====================================================================
Public Function WybranyID() As String
    Dim s As String
    On Error Resume Next
    Select Case ActiveSheet.Name
        Case ARK_REJ
            If ActiveCell.Row >= 6 Then s = Tekst(ActiveSheet.Cells(ActiveCell.Row, 12).Value)
        Case ARK_DANE, ARK_ARCH
            If ActiveCell.Row >= 2 Then s = Tekst(ActiveSheet.Cells(ActiveCell.Row, C_ID).Value)
    End Select
    On Error GoTo 0
    If s = "" Then s = Trim$(InputBox("Zaznacz wiersz operacji w arkuszu REJESTR_OPERACJI albo Dane, albo wpisz ID operacji (np. OP-000012 lub H-0123):", "Wybór operacji"))
    WybranyID = s
End Function

Public Sub KorektaOperacji()
    Dim id As String, op As clsOperacja
    id = WybranyID()
    If id = "" Then Exit Sub
    Set op = WczytajOperacje(id)
    If op Is Nothing Then
        MsgBox "Nie znaleziono operacji " & id & " w arkuszu Dane.", vbExclamation, "Korekta"
        Exit Sub
    End If
    On Error Resume Next
    Unload frmDodatkowe
    Unload frmDane
    On Error GoTo 0
    frmDane.WczytajDoKorekty op
    frmDane.Show
End Sub

Public Sub UsunOperacjeUI()
    Dim id As String
    id = WybranyID()
    If id = "" Then Exit Sub
    If UsunOperacje(id, "") Then MsgBox "Operacja " & id & " została usunięta. Skutki magazynowe zostały odwrócone, a wiersze przeniesiono do arkusza ARCHIWUM.", vbInformation, "Usunięto"
End Sub

Public Sub OdswiezRejestrUI()
    OdswiezRejestr
    Ark(ARK_REJ).Activate
End Sub

' =====================================================================
'  DOKUMENT OPERACJI (arkusz DOKUMENT + eksport PDF)
'  Sekcja transportu pojawia sie tylko, gdy Transport = TAK.
' =====================================================================
Public Sub WypelnijDokument(ByVal id As String)
    Dim ws As Worksheet, op As clsOperacja, wsD As Worksheet, r As Long, ost As Long, w As Long
    Set op = WczytajOperacje(id)
    If op Is Nothing Then Err.Raise vbObjectError + 1, , "Nie znaleziono operacji " & id
    Set ws = Ark(ARK_DOK)
    Set wsD = Ark(ARK_DANE)
    ws.Cells.ClearContents
    ws.Range("A1").Value = "DOKUMENT OPERACJI MAGAZYNOWEJ"
    ws.Range("A2").Value = "ResInvest — Magazyn Zabrze"
    w = 4
    DokPole ws, w, "ID operacji", op.Id & "  (wersja " & op.Wersja & ")"
    DokPole ws, w, "Typ operacji", op.Typ & IIf(op.ChainProdukcja, " + PRODUKCJA", "") & IIf(op.ChainSprzedaz, " + SPRZEDAŻ", "")
    DokPole ws, w, "Data operacji", Format(op.DataOp, "dd.mm.yyyy")
    DokPole ws, w, "Data załadunku", IIf(IsDate(op.DataZal), Format(op.DataZal, "dd.mm.yyyy"), "")
    DokPole ws, w, "Nr WZ / dokumentu", op.NrWZ
    DokPole ws, w, "Dostawca", op.Dostawca
    DokPole ws, w, "Odbiorca", op.Odbiorca
    DokPole ws, w, "Deklaracja / KZR", op.Deklaracja
    DokPole ws, w, "Miejsce pochodzenia", op.MiejscePochodzenia
    w = w + 1
    ws.Cells(w, 1).Value = "POZYCJE"
    w = w + 1
    ws.Cells(w, 1).Value = "Typ": ws.Cells(w, 2).Value = "Produkt": ws.Cells(w, 3).Value = "Ilość": ws.Cells(w, 4).Value = "JM"
    ws.Cells(w, 5).Value = "Cena": ws.Cells(w, 6).Value = "Wartość": ws.Cells(w, 7).Value = "Magazynowane"
    ost = OstatniWiersz(wsD)
    For r = 2 To ost
        If Tekst(wsD.Cells(r, C_ID).Value) = id Then
            w = w + 1
            ws.Cells(w, 1).Value = wsD.Cells(r, C_TYP).Value
            ws.Cells(w, 2).Value = wsD.Cells(r, C_PROD).Value
            ws.Cells(w, 3).Value = wsD.Cells(r, C_VOL).Value
            ws.Cells(w, 4).Value = wsD.Cells(r, C_JM).Value
            ws.Cells(w, 5).Value = IIf(Liczba(wsD.Cells(r, C_CZAK).Value) <> 0, wsD.Cells(r, C_CZAK).Value, wsD.Cells(r, C_CSPRZ).Value)
            ws.Cells(w, 6).Value = wsD.Cells(r, C_WART).Value
            ws.Cells(w, 7).Value = wsD.Cells(r, C_MAG).Value
        End If
    Next r
    If op.PoprzedniSurowiec <> "" Then
        w = w + 1
        DokPole ws, w, "Zużyty surowiec", op.PoprzedniSurowiec & ": " & Fmt(op.PoprzednieZuzycie) & " " & JMOpis(op.PoprzednieZuzycieJM)
        DokPole ws, w, "Receptura", Tekst(PierwszaReceptura(id))
    End If
    If op.Transport Then
        w = w + 1
        ws.Cells(w, 1).Value = "DANE TRANSPORTU"
        w = w + 1
        DokPole ws, w, "Transport", "TAK"
        DokPole ws, w, "Przewoźnik", op.Przewoznik
        DokPole ws, w, "Pojazd", op.Pojazd
        DokPole ws, w, "Nr rejestracyjny", op.NrRej
        DokPole ws, w, "Operator / kierowca", op.Operator
        DokPole ws, w, "Trasa", op.Trasa
        DokPole ws, w, "Kilometry", Fmt(op.Dystans)
        DokPole ws, w, "Koszt transportu", Format(op.KosztTrans, "#,##0.00") & " zł"
    End If
    If op.Uwagi <> "" Then
        w = w + 1
        DokPole ws, w, "Uwagi", op.Uwagi
    End If
    w = w + 1
    DokPole ws, w, "Wygenerowano", Format(Now, "dd.mm.yyyy hh:nn") & " — " & Uzytkownik()
End Sub

Private Function PierwszaReceptura(ByVal id As String) As String
    Dim ws As Worksheet, r As Long, ost As Long
    Set ws = Ark(ARK_DANE)
    ost = OstatniWiersz(ws)
    For r = 2 To ost
        If Tekst(ws.Cells(r, C_ID).Value) = id And Tekst(ws.Cells(r, C_RECEPTURA).Value) <> "" Then
            PierwszaReceptura = Tekst(ws.Cells(r, C_RECEPTURA).Value)
            Exit Function
        End If
    Next r
End Function

Private Sub DokPole(ByVal ws As Worksheet, ByRef w As Long, ByVal etykieta As String, ByVal wartosc As String)
    If Trim$(wartosc) = "" Then Exit Sub
    ws.Cells(w, 1).Value = etykieta
    ws.Cells(w, 2).Value = wartosc
    w = w + 1
End Sub

Public Sub DokumentOperacjiPDF()
    Dim id As String, plik As Variant
    id = WybranyID()
    If id = "" Then Exit Sub
    On Error GoTo blad
    WypelnijDokument id
    plik = Application.GetSaveAsFilename(InitialFileName:="Dokument_" & id & ".pdf", FileFilter:="PDF (*.pdf), *.pdf", Title:="Zapisz dokument operacji")
    If VarType(plik) = vbBoolean Then
        Ark(ARK_DOK).Activate
        Exit Sub
    End If
    Ark(ARK_DOK).ExportAsFixedFormat Type:=xlTypePDF, Filename:=CStr(plik), Quality:=xlQualityStandard, OpenAfterPublish:=True
    Loguj id, "DOKUMENT", "PDF", "", CStr(plik), ""
    Exit Sub
blad:
    MsgBox "Nie udało się utworzyć dokumentu: " & Err.Description, vbExclamation, "Dokument"
End Sub

' =====================================================================
'  UKLAD FORMULARZY - wstawienie pasa na nowe kontrolki w ramce
'  (ramka rosnie, kontrolki pod nia przesuwaja sie w dol; formularz rosnie)
'  Zwraca wspolrzedna Top pasa wewnatrz ramki.
' =====================================================================
Public Function WstawPas(ByVal formularz As Object, ByVal ramka As Object, ByVal wysokosc As Single, ByVal naGorze As Boolean) As Single
    Dim c As Object, dolStary As Single, y As Single, maxDol As Single, minGora As Single, maxEkran As Single
    dolStary = ramka.Top + ramka.Height
    If naGorze Then
        minGora = 100000
        For Each c In ramka.Controls
            If c.Top < minGora Then minGora = c.Top
        Next c
        If minGora = 100000 Then minGora = 6
        For Each c In ramka.Controls
            c.Top = c.Top + wysokosc
        Next c
        y = minGora
    Else
        For Each c In ramka.Controls
            If c.Top + c.Height > maxDol Then maxDol = c.Top + c.Height
        Next c
        y = maxDol + 4
    End If
    ramka.Height = ramka.Height + wysokosc
    For Each c In formularz.Controls
        If Not c Is ramka Then
            If TypeName(c.Parent) = TypeName(formularz) Then
                If c.Top >= dolStary - 1 Then c.Top = c.Top + wysokosc
            End If
        End If
    Next c
    formularz.Height = formularz.Height + wysokosc
    On Error Resume Next
    maxEkran = Application.UsableHeight * 0.92
    If maxEkran > 200 And formularz.Height > maxEkran Then
        maxDol = 0
        For Each c In formularz.Controls
            If TypeName(c.Parent) = TypeName(formularz) Then
                If c.Top + c.Height > maxDol Then maxDol = c.Top + c.Height
            End If
        Next c
        formularz.ScrollBars = 2              ' fmScrollBarsVertical - ekran mniejszy niz formularz
        formularz.ScrollHeight = maxDol + 10
        formularz.Height = maxEkran
    End If
    WstawPas = y
End Function
