' Arkusz REJESTR_OPERACJI - lista operacji odswiezana przy wejsciu na arkusz
Private Sub Worksheet_Activate()
    Static wTrakcie As Boolean
    If wTrakcie Then Exit Sub
    wTrakcie = True
    On Error Resume Next
    modMagazyn.OdswiezRejestr
    wTrakcie = False
End Sub
