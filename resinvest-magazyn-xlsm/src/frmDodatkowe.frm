' =====================================================================
' frmDodatkowe - drugi krok zakupu: produkcja z zakupionego surowca i/lub sprzedaż
' (wersja 4.0). Zużycie surowca liczone z receptury (arkusz RECEPTURY);
' zapis przez modMagazyn.ZatwierdzOperacje - jedna operacja, jeden ID.
' =====================================================================
Private lblRecepturaPop As MSForms.Label

Private Sub UserForm_Initialize()
    Dim ws As Worksheet
    Dim wsSlownik As Worksheet
    Dim lastRow As Long, lastRowSlownik As Long
    Dim i As Long, j As Long
    Dim kolOdbiorcy As New Collection
    Dim arrOdbiorcy() As String
    Dim temp As String

    ' --- 1. ŁADOWANIE PRODUKTÓW Z ARKUSZA "SŁOWNIK" ---
    On Error Resume Next
    Set wsSlownik = ThisWorkbook.Sheets("SŁOWNIK")
    If Not wsSlownik Is Nothing Then
        lastRowSlownik = wsSlownik.Cells(wsSlownik.Rows.Count, 1).End(xlUp).Row
        For i = 2 To lastRowSlownik
            If wsSlownik.Cells(i, 1).Value <> "" Then cmbProduktProd.AddItem wsSlownik.Cells(i, 1).Value
        Next i
    End If
    On Error GoTo 0

    ' --- 2. ŁADOWANIE JEDNOSTEK MIARY ---
    With cmbJMProd
        .AddItem "MP"
        .AddItem "TON"
        .AddItem "GJ"
        .AddItem "M3"
    End With

    ' --- 3. ŁADOWANIE ODBIORCÓW DO SPRZEDAŻY ---
    On Error Resume Next
    Set ws = ThisWorkbook.Sheets("Dane")
    lastRow = modMagazyn.OstatniWiersz(ws)
    For i = 2 To lastRow
        If ws.Cells(i, 22).Value <> "" Then kolOdbiorcy.Add CStr(ws.Cells(i, 22).Value), CStr(ws.Cells(i, 22).Value)
    Next i
    On Error GoTo 0

    If kolOdbiorcy.Count > 0 Then
        ReDim arrOdbiorcy(1 To kolOdbiorcy.Count)
        For i = 1 To kolOdbiorcy.Count
            arrOdbiorcy(i) = kolOdbiorcy(i)
        Next i
        For i = 1 To UBound(arrOdbiorcy) - 1
            For j = i + 1 To UBound(arrOdbiorcy)
                If UCase(arrOdbiorcy(i)) > UCase(arrOdbiorcy(j)) Then
                    temp = arrOdbiorcy(i)
                    arrOdbiorcy(i) = arrOdbiorcy(j)
                    arrOdbiorcy(j) = temp
                End If
            Next j
        Next i
        For i = 1 To UBound(arrOdbiorcy)
            cmbOdbiorcaSprzedaz.AddItem arrOdbiorcy(i)
        Next i
    End If

    ' --- 4. INFORMACJA O RECEPTURZE (nowa etykieta w ramce produkcji) ---
    On Error Resume Next
    Dim y As Single
    y = modMagazyn.WstawPas(Me, cmbProduktProd.Parent, 30, False)
    Set lblRecepturaPop = cmbProduktProd.Parent.Controls.Add("Forms.Label.1", "lblRecepturaPop", True)
    With lblRecepturaPop
        .Left = 6: .Top = y: .Width = cmbProduktProd.Parent.InsideWidth - 12: .Height = 28
        .WordWrap = True
        .Font.Name = Label1.Font.Name: .Font.Size = Label1.Font.Size
        .ForeColor = RGB(0, 90, 40)
        .Caption = ""
    End With
    On Error GoTo 0

    ' --- 5. STEROWANIE WIDOCZNOŚCIĄ PÓL NA PODSTAWIE GŁÓWNEGO OKNA ---
    If frmDane.chkProdukcja.Value = False Then
        cmbProduktProd.Visible = False
        txtVolumenProd.Visible = False
        cmbJMProd.Visible = False
        If Not lblRecepturaPop Is Nothing Then lblRecepturaPop.Visible = False
    Else
        cmbProduktProd.Visible = True
        txtVolumenProd.Visible = True
        cmbJMProd.Visible = True
        cmbJMProd.ListIndex = 0 ' Domyślnie MP
    End If

    If frmDane.chkSprzedaz.Value = False Then
        cmbOdbiorcaSprzedaz.Visible = False
        txtCenaSprzedazyPop.Visible = False
    Else
        cmbOdbiorcaSprzedaz.Visible = True
        txtCenaSprzedazyPop.Visible = True
    End If

    ' --- 6. KOREKTA: wartości zapisanej operacji ---
    If frmDane.KorektaId <> "" Then
        On Error Resume Next
        If frmDane.KorProdProdukt <> "" Then cmbProduktProd.Value = frmDane.KorProdProdukt
        If frmDane.KorProdJM <> "" Then cmbJMProd.Value = frmDane.KorProdJM
        If frmDane.KorProdVolumen <> 0 Then txtVolumenProd.Value = CStr(frmDane.KorProdVolumen)
        If frmDane.KorSprzOdbiorca <> "" Then cmbOdbiorcaSprzedaz.Value = frmDane.KorSprzOdbiorca
        If frmDane.KorSprzCena <> 0 Then txtCenaSprzedazyPop.Value = CStr(frmDane.KorSprzCena)
        On Error GoTo 0
        btnZatwierdz.Caption = "Zapisz korektę"
    End If
    PrzeliczWartoscPop
    AktualizujRecepturePop
End Sub

' --- POWRÓT DO OKNA GŁÓWNEGO ---
Private Sub btnWstecz_Click()
    Me.Hide
    frmDane.Show
End Sub

' --- ZAPIS: jedna operacja (zakup + produkcja / sprzedaż) przez silnik ---
Private Sub btnZatwierdz_Click()
    Dim op As clsOperacja
    If frmDane.chkProdukcja.Value = True Then
        If cmbProduktProd.Value = "" Or txtVolumenProd.Value = "" Or cmbJMProd.Value = "" Then
            MsgBox "Wypełnij wszystkie dane dla produkcji!", vbExclamation, "Brak danych"
            Exit Sub
        End If
        If ValNum(txtVolumenProd.Value) <= 0 Then
            MsgBox "Volumen produkcji musi być większy od zera!", vbExclamation, "Błąd wartości"
            Exit Sub
        End If
    End If
    If frmDane.chkSprzedaz.Value = True Then
        If cmbOdbiorcaSprzedaz.Value = "" Or txtCenaSprzedazyPop.Value = "" Then
            MsgBox "Wypełnij wszystkie dane dla sprzedaży (Odbiorca, Cena)!", vbExclamation, "Brak danych"
            Exit Sub
        End If
        If ValNum(txtCenaSprzedazyPop.Value) <= 0 Then
            MsgBox "Cena sprzedaży musi być większa od zera!", vbExclamation, "Błąd wartości"
            Exit Sub
        End If
    End If

    Set op = frmDane.ZbudujOperacje()
    op.Typ = "ZAKUP"
    op.ChainProdukcja = (frmDane.chkProdukcja.Value = True)
    If op.ChainProdukcja Then
        op.ProdProdukt = cmbProduktProd.Value
        op.ProdVolumen = ValNum(txtVolumenProd.Value)
        op.ProdJM = cmbJMProd.Value
    End If
    op.ChainSprzedaz = (frmDane.chkSprzedaz.Value = True)
    If op.ChainSprzedaz Then
        op.SprzOdbiorca = cmbOdbiorcaSprzedaz.Value
        op.SprzCena = ValNum(txtCenaSprzedazyPop.Value)
    End If

    If modMagazyn.ZatwierdzOperacje(op, frmDane.KorektaId) Then
        Unload frmDane
        Unload Me
        MsgBox "Wszystkie powiązane operacje zostały zapisane (jedna operacja " & op.Id & ").", vbInformation
    End If
End Sub

' ==========================================
' FUNKCJE POMOCNICZE
' ==========================================
Private Function ValNum(txtValue As Variant) As Double
    ValNum = modMagazyn.Liczba(txtValue)
End Function

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

Private Sub txtVolumenProd_KeyPress(ByVal KeyAscii As MSForms.ReturnInteger)
    TylkoLiczby KeyAscii, txtVolumenProd
End Sub

Private Sub txtCenaSprzedazyPop_KeyPress(ByVal KeyAscii As MSForms.ReturnInteger)
    TylkoLiczby KeyAscii, txtCenaSprzedazyPop
End Sub

Private Sub PrzeliczWartoscPop()
    Dim ilosc As Double
    Dim cenaSprzedazy As Double
    Dim wartosc As Double
    If frmDane.chkProdukcja.Value = True Then
        ilosc = ValNum(txtVolumenProd.Value)
    Else
        ilosc = ValNum(frmDane.txtVolumen.Value)
    End If
    cenaSprzedazy = ValNum(txtCenaSprzedazyPop.Value)
    wartosc = ilosc * cenaSprzedazy
    If wartosc > 0 Then
        lblWartoscSprzedazyPop.Caption = Format(wartosc, "#,##0.00") & " zł"
        lblWartoscSprzedazyPop.ForeColor = vbBlue
    Else
        lblWartoscSprzedazyPop.Caption = "---"
        lblWartoscSprzedazyPop.ForeColor = &H80000012
    End If
End Sub

' Zużycie zakupionego surowca wg receptury produktu
Private Sub AktualizujRecepturePop()
    Dim sur As String, jmS As String, jmP As String, przel As Double, blad As String, zuz As Double
    If lblRecepturaPop Is Nothing Then Exit Sub
    If frmDane.chkProdukcja.Value = False Or cmbProduktProd.Value = "" Then lblRecepturaPop.Caption = "": Exit Sub
    If Not modMagazyn.ZnajdzRecepture(cmbProduktProd.Value, sur, jmS, jmP, przel, blad) Then
        lblRecepturaPop.ForeColor = RGB(180, 0, 0)
        lblRecepturaPop.Caption = blad
        Exit Sub
    End If
    lblRecepturaPop.ForeColor = RGB(0, 90, 40)
    If Not modMagazyn.Takie(sur, frmDane.cmbProdukt.Value) Then
        lblRecepturaPop.ForeColor = RGB(180, 0, 0)
        lblRecepturaPop.Caption = "Surowcem receptury jest „" & sur & "”, a zakupiono „" & frmDane.cmbProdukt.Value & "”."
        Exit Sub
    End If
    lblRecepturaPop.Caption = "Receptura: 1 " & modMagazyn.JMOpis(jmS) & " " & sur & " = " & modMagazyn.Fmt(przel) & " " & modMagazyn.JMOpis(jmP)
    If ValNum(txtVolumenProd.Value) > 0 And cmbJMProd.Value <> "" Then
        zuz = ValNum(txtVolumenProd.Value)
        If UCase(cmbJMProd.Value) <> UCase(jmP) Then zuz = modMagazyn.ZMP(modMagazyn.DoMP(zuz, cmbJMProd.Value), jmP)
        lblRecepturaPop.Caption = lblRecepturaPop.Caption & vbCrLf & "Zużycie surowca: " & modMagazyn.Fmt(zuz / przel) & " " & modMagazyn.JMOpis(jmS)
    End If
End Sub

Private Sub txtCenaSprzedazyPop_Change()
    PrzeliczWartoscPop
End Sub

Private Sub txtVolumenProd_Change()
    PrzeliczWartoscPop
    AktualizujRecepturePop
End Sub

Private Sub cmbProduktProd_Change()
    AktualizujRecepturePop
End Sub

Private Sub cmbJMProd_Change()
    AktualizujRecepturePop
End Sub
