' Otwarcie formularza "Nowa operacja" (przycisk DODAJ / NOWA OPERACJA)
Sub OtworzFormularz()
    On Error Resume Next
    Unload frmDodatkowe
    Unload frmDane
    On Error GoTo 0
    frmDane.Show
End Sub
