' =====================================================================
' frmDane - formularz "Dodaj operację" / "Korekta operacji" (wersja 4.0)
'  * Typ operacji: ZAKUP, PRODUKCJA, SPRZEDAŻ, ZUŻYCIE, MM (transport NIE jest typem),
'  * pole "Transport" w ramce transportu: zaznaczone -> dane transportu (przewoźnik,
'    pojazd, nr rej., operator, trasa, km, koszt); odznaczone -> sekcja ukryta,
'  * PRODUKCJA: zużycie surowca liczone z receptury (arkusz RECEPTURY),
'  * zapis wyłącznie przez modMagazyn.ZatwierdzOperacje (walidacja, podsumowanie, historia).
' Nowe kontrolki tworzone są w kodzie (UserForm_Initialize), projekt formularza bez zmian.
' =====================================================================
Private WithEvents chkTransport As MSForms.CheckBox
Private txtTrasa As MSForms.TextBox
Private txtPojazd As MSForms.TextBox
Private txtOperator As MSForms.TextBox
Private lblTrasa As MSForms.Label
Private lblPojazd As MSForms.Label
Private lblOperator As MSForms.Label
Private lblReceptura As MSForms.Label
Private mKorektaId As String
Private mDataOryginalna As String
Private mGotowy As Boolean

' wartości operacji równoległych przy korekcie (odczytuje frmDodatkowe)
Public KorProdProdukt As String
Public KorProdVolumen As Double
Public KorProdJM As String
Public KorSprzOdbiorca As String
Public KorSprzCena As Double

Public Property Get KorektaId() As String
    KorektaId = mKorektaId
End Property

Private Sub cmbJM_Change()
    AktualizujRecepture
End Sub

Private Sub cmbTyp_Change()
    cmbTyp.BackColor = vbWhite
    ' 1. Domyślne ustawienia dla głównych cen
    txtCenaSprzedazy.Enabled = True
    txtCenaZakupu.Enabled = True
    txtCenaSprzedazy.BackColor = vbWhite
    txtCenaZakupu.BackColor = vbWhite

    ' 2. Domyślne ukrywanie opcji równoległych i czyszczenie wyboru
    frmRownolegle.Visible = False
    frmRownolegle.Enabled = True
    chkProdukcja.Enabled = True
    chkSprzedaz.Enabled = True
    chkProdukcja.Value = False
    chkSprzedaz.Value = False

    ' 3. Logika blokowania pól na podstawie wyboru
    Select Case cmbTyp.Value
        Case "ZAKUP"
            txtCenaSprzedazy.Enabled = False
            txtCenaSprzedazy.Value = ""
            txtCenaSprzedazy.BackColor = &HE0E0E0
            frmRownolegle.Visible = True
        Case "SPRZEDAŻ"
            txtCenaZakupu.Enabled = False
            txtCenaZakupu.Value = ""
            txtCenaZakupu.BackColor = &HE0E0E0
        Case "PRODUKCJA", "ZUŻYCIE", "MM"
            txtCenaSprzedazy.Enabled = False
            txtCenaZakupu.Enabled = False
            txtCenaSprzedazy.Value = ""
            txtCenaZakupu.Value = ""
            txtCenaSprzedazy.BackColor = &HE0E0E0
            txtCenaZakupu.BackColor = &HE0E0E0
    End Select

    ' 4. Transport jako część operacji: dostępny dla zakupu, produkcji, sprzedaży i MM
    If Not chkTransport Is Nothing Then
        If cmbTyp.Value = "ZUŻYCIE" Or cmbTyp.Value = "" Then
            chkTransport.Value = False
            chkTransport.Enabled = False
        Else
            chkTransport.Enabled = True
        End If
        UstawTransport
    End If
    PrzeliczWartosc
    AktualizujRecepture
    AktualizujPrzycisk
End Sub

Private Sub CommandButton1_Click()
    ' =======================================================
    ' 1. WALIDACJA Z PODŚWIETLANIEM BRAKÓW
    ' =======================================================
    Dim czyBrakujeDanych As Boolean
    czyBrakujeDanych = False

    cmbTyp.BackColor = vbWhite
    txtData.BackColor = vbWhite
    cmbDostawca.BackColor = vbWhite
    cmbOdbiorca.BackColor = vbWhite
    cmbProdukt.BackColor = vbWhite
    txtVolumen.BackColor = vbWhite

    If cmbTyp.Value = "" Then cmbTyp.BackColor = RGB(255, 200, 200): czyBrakujeDanych = True
    If txtData.Value = "" Then txtData.BackColor = RGB(255, 200, 200): czyBrakujeDanych = True
    If cmbDostawca.Value = "" Then cmbDostawca.BackColor = RGB(255, 200, 200): czyBrakujeDanych = True
    If cmbOdbiorca.Value = "" Then cmbOdbiorca.BackColor = RGB(255, 200, 200): czyBrakujeDanych = True
    If cmbProdukt.Value = "" Then cmbProdukt.BackColor = RGB(255, 200, 200): czyBrakujeDanych = True
    If txtVolumen.Value = "" Then txtVolumen.BackColor = RGB(255, 200, 200): czyBrakujeDanych = True

    If czyBrakujeDanych = True Then
        MsgBox "Proszę uzupełnić wszystkie wymagane pola zaznaczone na czerwono!", vbExclamation, "Brak danych"
        Exit Sub
    End If

    If Not IsDate(txtData.Value) Then
        MsgBox "Wprowadzona data ma niepoprawny format!", vbExclamation, "Błąd daty"
        txtData.SetFocus
        Exit Sub
    End If
    If txtDataZal.Value <> "" And Not IsDate(txtDataZal.Value) Then
        MsgBox "Data załadunku ma niepoprawny format!", vbExclamation, "Błąd daty"
        txtDataZal.SetFocus
        Exit Sub
    End If

    ' zasada 2 dni roboczych wstecz - przy korekcie nie dotyczy niezmienionej daty dokumentu
    Dim enteredDate As Date
    Dim minDate As Date
    enteredDate = CDate(txtData.Value)
    minDate = GetMinBusinessDate(Date)
    If enteredDate < minDate And Not (mKorektaId <> "" And txtData.Value = mDataOryginalna) Then
        MsgBox "Nie można wprowadzić daty starszej niż 2 dni robocze wstecz!" & vbCrLf & _
               "Minimalna dozwolona data to: " & Format(minDate, "dd.mm.yyyy"), vbExclamation, "Błąd daty"
        txtData.SetFocus
        Exit Sub
    End If

    If ValNum(txtVolumen.Value) <= 0 Then
        MsgBox "Volumen musi być liczbą większą od zera!", vbExclamation, "Błąd wartości"
        txtVolumen.SetFocus
        Exit Sub
    End If

    ' operacje równoległe przy zakupie - drugi krok (frmDodatkowe)
    If chkProdukcja.Value = True Or chkSprzedaz.Value = True Then
        Me.Hide
        frmDodatkowe.Show
        Exit Sub
    End If

    ' =======================================================
    ' 2. ZAPIS (walidacja, receptura, stan, podsumowanie, historia)
    ' =======================================================
    If modMagazyn.ZatwierdzOperacje(ZbudujOperacje(), mKorektaId) Then
        MsgBox IIf(mKorektaId <> "", "Korekta została zapisana.", "Dane zostały dodane pomyślnie!"), vbInformation
        Unload Me
    End If
End Sub

' Operacja z pól formularza (dane transportu tylko przy zaznaczonym "Transport")
Public Function ZbudujOperacje() As clsOperacja
    Dim op As New clsOperacja
    op.Typ = cmbTyp.Value
    op.DataOp = CDate(txtData.Value)
    If IsDate(txtDataZal.Value) Then op.DataZal = CDate(txtDataZal.Value) Else op.DataZal = op.DataOp
    op.MiejsceZal = TxtMiejsceZal.Value
    op.Dostawca = cmbDostawca.Value
    op.Odbiorca = cmbOdbiorca.Value
    op.NrWZ = txtWZ.Value
    op.CzyMag = cmbCzyMag.Value
    op.Deklaracja = txtDeklaracja.Value
    op.Volumen = ValNum(txtVolumen.Value)
    op.JM = cmbJM.Value
    op.CenaZakupu = ValNum(txtCenaZakupu.Value)
    op.CenaSprzedazy = ValNum(txtCenaSprzedazy.Value)
    op.Produkt = cmbProdukt.Value
    op.Zrebka = cmbZrebka.Value
    op.Rabanie = cmbRabanie.Value
    op.CenaRab = ValNum(txtCenaRab.Value)
    op.Uwagi = txtUwagi.Value
    op.MiejscePochodzenia = cmbMiejscePochodzenia.Value
    op.Transport = False
    If Not chkTransport Is Nothing Then op.Transport = (chkTransport.Value = True)
    If op.Transport Then
        op.Przewoznik = cmbPrzewoznik.Value
        op.NrRej = UCase(txtNrRej.Value)
        op.Dystans = ValNum(txtDystans.Value)
        op.KosztTrans = ValNum(txtKosztTrans.Value)
        op.Trasa = txtTrasa.Value
        op.Pojazd = txtPojazd.Value
        op.Operator = txtOperator.Value
    End If
    Set ZbudujOperacje = op
End Function

' --- FUNKCJA POMOCNICZA ---
Private Function ValNum(txtValue As Variant) As Double
    ValNum = modMagazyn.Liczba(txtValue)
End Function

Private Sub CommandButton2_Click()
    Unload Me
End Sub

Private Sub txtCenaSprzedazy_Change()
    If txtCenaSprzedazy.Value <> "" Then txtCenaZakupu.Value = ""
    PrzeliczWartosc
End Sub

Private Sub txtCenaZakupu_Change()
    If txtCenaZakupu.Value <> "" Then txtCenaSprzedazy.Value = ""
    PrzeliczWartosc
End Sub

Private Sub txtData_Change()
    txtData.BackColor = vbWhite
End Sub

Private Sub cmbDostawca_Change()
    cmbDostawca.BackColor = vbWhite
End Sub

Private Sub cmbOdbiorca_Change()
    cmbOdbiorca.BackColor = vbWhite
End Sub

Private Sub cmbProdukt_Change()
    cmbProdukt.BackColor = vbWhite
    AktualizujRecepture
End Sub

Private Sub txtNrRej_Change()
    txtNrRej.Value = UCase(txtNrRej.Value)
End Sub

Private Sub txtVolumen_Change()
    txtVolumen.BackColor = vbWhite
    PrzeliczWartosc
    AktualizujRecepture
End Sub

Private Sub UserForm_Initialize()
    Dim ws As Worksheet
    Dim wsSlownik As Worksheet
    Dim lastRow As Long
    Dim lastRowSlownik As Long
    Dim cellVal As String
    Dim i As Long, j As Long

    Dim kolDostawcy As New Collection
    Dim kolOdbiorcy As New Collection
    Dim kolTransport As New Collection
    Dim kolMiejsce As New Collection

    Dim arrDostawcy() As String, arrOdbiorcy() As String, arrTransport() As String
    Dim arrMiejsce() As String
    Dim temp As String

    ' --- 1. USTAWIENIE ARKUSZY ---
    Set ws = ThisWorkbook.Sheets("Dane")
    lastRow = modMagazyn.OstatniWiersz(ws)
    Set wsSlownik = ThisWorkbook.Sheets("SŁOWNIK")
    lastRowSlownik = wsSlownik.Cells(wsSlownik.Rows.Count, 1).End(xlUp).Row

    ' --- 2. POBIERANIE UNIKALNYCH REKORDÓW (Dostawcy, Odbiorcy, Przewoźnicy, Miejsca) ---
    On Error Resume Next
    For i = 2 To lastRow
        If ws.Cells(i, 4).Value <> "" Then kolDostawcy.Add CStr(ws.Cells(i, 4).Value), CStr(ws.Cells(i, 4).Value)
        If ws.Cells(i, 22).Value <> "" Then kolOdbiorcy.Add CStr(ws.Cells(i, 22).Value), CStr(ws.Cells(i, 22).Value)
        If ws.Cells(i, 18).Value <> "" Then kolTransport.Add CStr(ws.Cells(i, 18).Value), CStr(ws.Cells(i, 18).Value)
        If ws.Cells(i, 24).Value <> "" Then kolMiejsce.Add CStr(ws.Cells(i, 24).Value), CStr(ws.Cells(i, 24).Value)
    Next i
    On Error GoTo 0

    ' --- 3. SORTOWANIE DOSTAWCÓW ---
    If kolDostawcy.Count > 0 Then
        ReDim arrDostawcy(1 To kolDostawcy.Count)
        For i = 1 To kolDostawcy.Count: arrDostawcy(i) = kolDostawcy(i): Next i
        For i = 1 To UBound(arrDostawcy) - 1
            For j = i + 1 To UBound(arrDostawcy)
                If UCase(arrDostawcy(i)) > UCase(arrDostawcy(j)) Then
                    temp = arrDostawcy(i): arrDostawcy(i) = arrDostawcy(j): arrDostawcy(j) = temp
                End If
            Next j
        Next i
        For i = 1 To UBound(arrDostawcy): cmbDostawca.AddItem arrDostawcy(i): Next i
    End If

    ' --- 4. SORTOWANIE ODBIORCÓW ---
    If kolOdbiorcy.Count > 0 Then
        ReDim arrOdbiorcy(1 To kolOdbiorcy.Count)
        For i = 1 To kolOdbiorcy.Count: arrOdbiorcy(i) = kolOdbiorcy(i): Next i
        For i = 1 To UBound(arrOdbiorcy) - 1
            For j = i + 1 To UBound(arrOdbiorcy)
                If UCase(arrOdbiorcy(i)) > UCase(arrOdbiorcy(j)) Then
                    temp = arrOdbiorcy(i): arrOdbiorcy(i) = arrOdbiorcy(j): arrOdbiorcy(j) = temp
                End If
            Next j
        Next i
        For i = 1 To UBound(arrOdbiorcy): cmbOdbiorca.AddItem arrOdbiorcy(i): Next i
    End If

    ' --- 5. SORTOWANIE PRZEWOŹNIKÓW ---
    If kolTransport.Count > 0 Then
        ReDim arrTransport(1 To kolTransport.Count)
        For i = 1 To kolTransport.Count: arrTransport(i) = kolTransport(i): Next i
        For i = 1 To UBound(arrTransport) - 1
            For j = i + 1 To UBound(arrTransport)
                If UCase(arrTransport(i)) > UCase(arrTransport(j)) Then
                    temp = arrTransport(i): arrTransport(i) = arrTransport(j): arrTransport(j) = temp
                End If
            Next j
        Next i
        For i = 1 To UBound(arrTransport): cmbPrzewoznik.AddItem arrTransport(i): Next i
    End If

    ' --- 5a. SORTOWANIE MIEJSCA POCHODZENIA ---
    If kolMiejsce.Count > 0 Then
        ReDim arrMiejsce(1 To kolMiejsce.Count)
        For i = 1 To kolMiejsce.Count: arrMiejsce(i) = kolMiejsce(i): Next i
        For i = 1 To UBound(arrMiejsce) - 1
            For j = i + 1 To UBound(arrMiejsce)
                If UCase(arrMiejsce(i)) > UCase(arrMiejsce(j)) Then
                    temp = arrMiejsce(i): arrMiejsce(i) = arrMiejsce(j): arrMiejsce(j) = temp
                End If
            Next j
        Next i
        For i = 1 To UBound(arrMiejsce): cmbMiejscePochodzenia.AddItem arrMiejsce(i): Next i
    End If

    ' --- 6. ŁADOWANIE LISTY PRODUKTÓW Z ARKUSZA SŁOWNIK ---
    cmbProdukt.Clear
    For i = 2 To lastRowSlownik
        cellVal = wsSlownik.Cells(i, 1).Value
        If cellVal <> "" Then cmbProdukt.AddItem cellVal
    Next i
    Dim x As Long, y As Long
    Dim tempProd As String
    If cmbProdukt.ListCount > 1 Then
        For x = 0 To cmbProdukt.ListCount - 2
            For y = x + 1 To cmbProdukt.ListCount - 1
                If UCase(cmbProdukt.List(x)) > UCase(cmbProdukt.List(y)) Then
                    tempProd = cmbProdukt.List(x): cmbProdukt.List(x) = cmbProdukt.List(y): cmbProdukt.List(y) = tempProd
                End If
            Next y
        Next x
    End If

    ' --- STAŁE LISTY (transport nie jest typem operacji - pole "Transport" w ramce transportu) ---
    With cmbTyp
        .AddItem "ZAKUP": .AddItem "PRODUKCJA": .AddItem "SPRZEDAŻ": .AddItem "ZUŻYCIE": .AddItem "MM"
        .ListRows = 20
    End With
    With cmbJM: .AddItem "MP": .AddItem "TON": .AddItem "GJ": .AddItem "M3": End With
    With cmbZrebka: .AddItem "A": .AddItem "B": End With
    With cmbCzyMag: .AddItem "TAK": .AddItem "NIE": End With
    With cmbRabanie: .AddItem "własne": .AddItem "ECO-Rest": End With

    ' --- 7. NOWE KONTROLKI: Transport (pole wyboru + dane) i informacja o recepturze ---
    BudujKontrolki

    ' --- 8. USTAWIENIA DOMYŚLNE ---
    cmbCzyMag.ListIndex = 0
    cmbJM.ListIndex = 0
    txtData.Value = FormatDateTime(Date, vbShortDate)
    txtDataZal.Value = FormatDateTime(Date, vbShortDate)
    UstawTransport
    mGotowy = True
End Sub

' ---------------------------------------------------------------------
' Kontrolki tworzone w kodzie (bez zmiany projektu formularza)
' ---------------------------------------------------------------------
Private Sub BudujKontrolki()
    Dim y As Single, gora As Single, wys As Single
    On Error GoTo koniec
    wys = txtNrRej.Height

    ' Informacja o recepturze (PRODUKCJA) - nowy pas na dole ramki produktu
    y = modMagazyn.WstawPas(Me, cmbProdukt.Parent, 30, False)
    Set lblReceptura = cmbProdukt.Parent.Controls.Add("Forms.Label.1", "lblReceptura", True)
    With lblReceptura
        .Left = 6: .Top = y: .Width = cmbProdukt.Parent.InsideWidth - 12: .Height = 28
        .WordWrap = True
        .Font.Name = Label12.Font.Name: .Font.Size = Label12.Font.Size
        .ForeColor = RGB(0, 90, 40)
        .Caption = ""
        .Visible = False
    End With

    ' Pole wyboru "Transport" - nowy pas na górze ramki transportu
    gora = modMagazyn.WstawPas(Me, txtNrRej.Parent, 22, True)
    Set chkTransport = txtNrRej.Parent.Controls.Add("Forms.CheckBox.1", "chkTransport", True)
    With chkTransport
        .Left = Label16.Left: .Top = gora: .Width = 260: .Height = 18
        .Caption = "Transport (dane przewozu w tej operacji)"
        .Font.Name = Label16.Font.Name: .Font.Size = Label16.Font.Size + 1: .Font.Bold = True
        .Value = False
    End With

    ' Dodatkowe dane transportu: trasa, pojazd, operator / kierowca - nowy pas na dole ramki
    y = modMagazyn.WstawPas(Me, txtNrRej.Parent, wys + 18, False)
    Set lblTrasa = NowaEtykieta("lblTrasa", "Trasa", cmbPrzewoznik.Left, y)
    Set txtTrasa = NowePole("txtTrasa", cmbPrzewoznik.Left, y + 13, cmbPrzewoznik.Width)
    Set lblPojazd = NowaEtykieta("lblPojazd", "Pojazd", txtNrRej.Left, y)
    Set txtPojazd = NowePole("txtPojazd", txtNrRej.Left, y + 13, txtNrRej.Width)
    Set lblOperator = NowaEtykieta("lblOperator", "Operator / kierowca", txtDystans.Left, y)
    Set txtOperator = NowePole("txtOperator", txtDystans.Left, y + 13, txtKosztTrans.Left + txtKosztTrans.Width - txtDystans.Left)
koniec:
End Sub

Private Function NowaEtykieta(ByVal nazwa As String, ByVal tekst As String, ByVal x As Single, ByVal y As Single) As MSForms.Label
    Dim l As MSForms.Label
    Set l = txtNrRej.Parent.Controls.Add("Forms.Label.1", nazwa, True)
    l.Caption = tekst: l.Left = x: l.Top = y: l.Width = 140: l.Height = 12
    l.Font.Name = Label17.Font.Name: l.Font.Size = Label17.Font.Size
    Set NowaEtykieta = l
End Function

Private Function NowePole(ByVal nazwa As String, ByVal x As Single, ByVal y As Single, ByVal szer As Single) As MSForms.TextBox
    Dim t As MSForms.TextBox
    Set t = txtNrRej.Parent.Controls.Add("Forms.TextBox.1", nazwa, True)
    t.Left = x: t.Top = y: t.Width = szer: t.Height = txtNrRej.Height
    t.Font.Name = txtNrRej.Font.Name: t.Font.Size = txtNrRej.Font.Size
    t.SpecialEffect = txtNrRej.SpecialEffect
    t.BorderStyle = txtNrRej.BorderStyle
    t.BorderColor = txtNrRej.BorderColor
    Set NowePole = t
End Function

Private Sub chkTransport_Click()
    UstawTransport
End Sub

' Sekcja "Dane transportu" widoczna tylko przy zaznaczonym polu Transport
Private Sub UstawTransport()
    Dim wl As Boolean
    If chkTransport Is Nothing Then Exit Sub
    wl = (chkTransport.Value = True)
    On Error Resume Next
    Label16.Visible = wl: cmbPrzewoznik.Visible = wl
    Label17.Visible = wl: txtNrRej.Visible = wl
    Label18.Visible = wl: txtDystans.Visible = wl
    Label19.Visible = wl: txtKosztTrans.Visible = wl
    lblTrasa.Visible = wl: txtTrasa.Visible = wl
    lblPojazd.Visible = wl: txtPojazd.Visible = wl
    lblOperator.Visible = wl: txtOperator.Visible = wl
    If wl Then
        chkTransport.ForeColor = RGB(0, 100, 0)
    Else
        chkTransport.ForeColor = &H80000012
    End If
End Sub

' Receptura i zużycie surowca na żywo (PRODUKCJA)
Private Sub AktualizujRecepture()
    Dim sur As String, jmS As String, jmP As String, przel As Double, blad As String, zuz As Double, st As Double
    If lblReceptura Is Nothing Then Exit Sub
    If cmbTyp.Value <> "PRODUKCJA" Or cmbProdukt.Value = "" Then
        lblReceptura.Visible = False
        Exit Sub
    End If
    lblReceptura.Visible = True
    If Not modMagazyn.ZnajdzRecepture(cmbProdukt.Value, sur, jmS, jmP, przel, blad) Then
        lblReceptura.ForeColor = RGB(180, 0, 0)
        lblReceptura.Caption = blad
        Exit Sub
    End If
    st = modMagazyn.Stan(sur, jmS, mKorektaId)
    lblReceptura.ForeColor = RGB(0, 90, 40)
    lblReceptura.Caption = "Surowiec: " & sur & " (stan: " & modMagazyn.Fmt(st) & " " & modMagazyn.JMOpis(jmS) & ") · " & _
        "1 " & modMagazyn.JMOpis(jmS) & " = " & modMagazyn.Fmt(przel) & " " & modMagazyn.JMOpis(jmP)
    If ValNum(txtVolumen.Value) > 0 And cmbJM.Value <> "" Then
        zuz = ValNum(txtVolumen.Value)
        If UCase(cmbJM.Value) <> UCase(jmP) Then zuz = modMagazyn.ZMP(modMagazyn.DoMP(zuz, cmbJM.Value), jmP)
        zuz = zuz / przel
        lblReceptura.Caption = lblReceptura.Caption & vbCrLf & "Zużycie: " & modMagazyn.Fmt(zuz) & " " & modMagazyn.JMOpis(jmS) & " " & sur & _
            IIf(zuz > st + 0.000001, "  — BRAKUJE " & modMagazyn.Fmt(zuz - st) & " " & modMagazyn.JMOpis(jmS), "")
        If zuz > st + 0.000001 Then lblReceptura.ForeColor = RGB(180, 0, 0)
    End If
End Sub

' ---------------------------------------------------------------------
' Korekta: wczytanie zapisanej operacji do formularza
' ---------------------------------------------------------------------
Public Sub WczytajDoKorekty(ByVal op As clsOperacja)
    mKorektaId = op.Id
    Me.Caption = "Korekta operacji " & op.Id & " (wersja " & op.Wersja & ")"
    UstawWartosc cmbTyp, op.Typ
    txtData.Value = Format(op.DataOp, "dd.mm.yyyy")
    If IsDate(op.DataOp) Then txtData.Value = FormatDateTime(CDate(op.DataOp), vbShortDate)
    mDataOryginalna = txtData.Value
    If IsDate(op.DataZal) Then txtDataZal.Value = FormatDateTime(CDate(op.DataZal), vbShortDate)
    TxtMiejsceZal.Value = op.MiejsceZal
    UstawWartosc cmbDostawca, op.Dostawca
    UstawWartosc cmbOdbiorca, op.Odbiorca
    txtWZ.Value = op.NrWZ
    UstawWartosc cmbCzyMag, op.CzyMag
    txtDeklaracja.Value = op.Deklaracja
    UstawWartosc cmbProdukt, op.Produkt
    UstawWartosc cmbJM, op.JM
    txtVolumen.Value = CStr(op.Volumen)
    If op.CenaZakupu <> 0 Then txtCenaZakupu.Value = CStr(op.CenaZakupu)
    If op.CenaSprzedazy <> 0 Then txtCenaSprzedazy.Value = CStr(op.CenaSprzedazy)
    UstawWartosc cmbZrebka, op.Zrebka
    UstawWartosc cmbRabanie, op.Rabanie
    If op.CenaRab <> 0 Then txtCenaRab.Value = CStr(op.CenaRab)
    txtUwagi.Value = op.Uwagi
    UstawWartosc cmbMiejscePochodzenia, op.MiejscePochodzenia
    UstawWartosc cmbPrzewoznik, op.Przewoznik
    txtNrRej.Value = op.NrRej
    If op.Dystans <> 0 Then txtDystans.Value = CStr(op.Dystans)
    If op.KosztTrans <> 0 Then txtKosztTrans.Value = CStr(op.KosztTrans)
    If Not txtTrasa Is Nothing Then txtTrasa.Value = op.Trasa: txtPojazd.Value = op.Pojazd: txtOperator.Value = op.Operator
    If Not chkTransport Is Nothing Then chkTransport.Value = op.Transport
    UstawTransport
    ' operacje równoległe (zakup z produkcją / sprzedażą)
    KorProdProdukt = op.ProdProdukt: KorProdVolumen = op.ProdVolumen: KorProdJM = op.ProdJM
    KorSprzOdbiorca = op.SprzOdbiorca: KorSprzCena = op.SprzCena
    If op.Typ = "ZAKUP" Then
        chkProdukcja.Value = op.ChainProdukcja
        chkSprzedaz.Value = op.ChainSprzedaz
    End If
    AktualizujRecepture
    AktualizujPrzycisk
End Sub

Private Sub UstawWartosc(ByVal c As MSForms.ComboBox, ByVal v As String)
    If v = "" Then Exit Sub
    On Error Resume Next
    c.Value = v
    If Err.Number <> 0 Or c.Value <> v Then
        Err.Clear
        c.AddItem v
        c.Value = v
    End If
End Sub

Private Sub PrzeliczWartosc()
    Dim ilosc As Double
    Dim cenaSprzedazy As Double
    Dim cenaZakupu As Double

    If Not IsNumeric(txtVolumen.Value) Or txtVolumen.Value = "" Then
        lblWartosc.Caption = "---"
        Exit Sub
    End If
    ilosc = CDbl(txtVolumen.Value)

    If IsNumeric(txtCenaSprzedazy.Value) And txtCenaSprzedazy.Value <> "" Then
        cenaSprzedazy = CDbl(txtCenaSprzedazy.Value)
        lblWartosc.Caption = Format(ilosc * cenaSprzedazy, "#,##0.00") & " zł"
        lblWartosc.ForeColor = vbBlue
    ElseIf IsNumeric(txtCenaZakupu.Value) And txtCenaZakupu.Value <> "" Then
        cenaZakupu = CDbl(txtCenaZakupu.Value)
        lblWartosc.Caption = Format(ilosc * cenaZakupu, "#,##0.00") & " zł"
        lblWartosc.ForeColor = &H8000&
    Else
        lblWartosc.Caption = "---"
    End If
End Sub

' --- UNIWERSALNA FUNKCJA BLOKUJĄCA LITERY ---
Private Sub TylkoLiczby(ByRef KeyAscii As MSForms.ReturnInteger, ByRef TextBox As MSForms.TextBox)
    Select Case KeyAscii
        Case 48 To 57
        Case 44, 46
            KeyAscii = 44
            If InStr(TextBox.Text, ",") > 0 Then
                KeyAscii = 0
                Beep
            End If
        Case Else
            KeyAscii = 0
            Beep
    End Select
End Sub

Private Sub txtVolumen_KeyPress(ByVal KeyAscii As MSForms.ReturnInteger)
    TylkoLiczby KeyAscii, txtVolumen
End Sub

Private Sub txtCenaZakupu_KeyPress(ByVal KeyAscii As MSForms.ReturnInteger)
    TylkoLiczby KeyAscii, txtCenaZakupu
End Sub

Private Sub txtCenaSprzedazy_KeyPress(ByVal KeyAscii As MSForms.ReturnInteger)
    TylkoLiczby KeyAscii, txtCenaSprzedazy
End Sub

Private Sub txtCenaRab_KeyPress(ByVal KeyAscii As MSForms.ReturnInteger)
    TylkoLiczby KeyAscii, txtCenaRab
End Sub

Private Sub txtDystans_KeyPress(ByVal KeyAscii As MSForms.ReturnInteger)
    TylkoLiczby KeyAscii, txtDystans
End Sub

Private Sub txtKosztTrans_KeyPress(ByVal KeyAscii As MSForms.ReturnInteger)
    TylkoLiczby KeyAscii, txtKosztTrans
End Sub

Private Function IsInCombo(combo As MSForms.ComboBox, strText As String) As Boolean
    Dim i As Long
    IsInCombo = False
    For i = 0 To combo.ListCount - 1
        If LCase(combo.List(i)) = LCase(strText) Then
            IsInCombo = True
            Exit Function
        End If
    Next i
End Function

' Minimalna data: 2 dni robocze wstecz (pomija weekendy)
Private Function GetMinBusinessDate(startDate As Date) As Date
    Dim d As Date
    Dim businessDaysCount As Integer
    d = startDate
    businessDaysCount = 0
    Do While businessDaysCount < 2
        d = d - 1
        If Weekday(d, vbMonday) < 6 Then businessDaysCount = businessDaysCount + 1
    Loop
    GetMinBusinessDate = d
End Function

Private Sub chkProdukcja_Click()
    If chkProdukcja.Value = True Then
        chkProdukcja.BackColor = RGB(200, 255, 200)
        chkProdukcja.Font.Bold = True
        chkProdukcja.ForeColor = RGB(0, 100, 0)
    Else
        chkProdukcja.BackColor = frmRownolegle.BackColor
        chkProdukcja.Font.Bold = False
        chkProdukcja.ForeColor = &H80000012
    End If
    AktualizujPrzycisk
End Sub

Private Sub chkSprzedaz_Click()
    If chkSprzedaz.Value = True Then
        chkSprzedaz.BackColor = RGB(200, 230, 255)
        chkSprzedaz.Font.Bold = True
        chkSprzedaz.ForeColor = RGB(0, 50, 150)
        cmbCzyMag.Value = "NIE"
        cmbCzyMag.Enabled = False
    Else
        chkSprzedaz.BackColor = frmRownolegle.BackColor
        chkSprzedaz.Font.Bold = False
        chkSprzedaz.ForeColor = &H80000012
        cmbCzyMag.Enabled = True
    End If
    AktualizujPrzycisk
End Sub

Private Sub AktualizujPrzycisk()
    If chkProdukcja.Value = True Or chkSprzedaz.Value = True Then
        CommandButton1.Caption = "Dalej >"
    ElseIf mKorektaId <> "" Then
        CommandButton1.Caption = "Zapisz korektę"
    Else
        CommandButton1.Caption = "Zatwierdź"
    End If
End Sub
