Option Explicit
' =====================================================================
' clsOperacja - jedna operacja magazynowa (dane z formularza lub z arkusza Dane).
' Operacja = jeden identyfikator (ID_operacji). Transport jest jej czescia
' (flaga Transport), a nie osobnym typem operacji.
' =====================================================================

' --- identyfikacja ---
Public Id As String
Public Wersja As Long

' --- dane podstawowe (kolumny A..X arkusza Dane) ---
Public Typ As String                ' ZAKUP | PRODUKCJA | SPRZEDAŻ | ZUŻYCIE | MM
Public DataZal As Variant
Public MiejsceZal As String
Public DataOp As Variant
Public Dostawca As String
Public Odbiorca As String
Public NrWZ As String
Public CzyMag As String             ' TAK / NIE
Public Deklaracja As String
Public Volumen As Double
Public JM As String                 ' MP | TON | GJ | M3
Public CenaZakupu As Double
Public CenaSprzedazy As Double
Public Produkt As String
Public Zrebka As String
Public Rabanie As String
Public CenaRab As Double
Public Uwagi As String
Public MiejscePochodzenia As String

' --- transport (czesc operacji) ---
Public Transport As Boolean
Public Przewoznik As String
Public NrRej As String
Public Dystans As Double
Public KosztTrans As Double
Public Trasa As String
Public Pojazd As String
Public Operator As String

' --- operacje rownolegle przy zakupie (frmDodatkowe) ---
Public ChainProdukcja As Boolean
Public ProdProdukt As String
Public ProdVolumen As Double
Public ProdJM As String
Public ChainSprzedaz As Boolean
Public SprzOdbiorca As String
Public SprzCena As Double

' --- wyliczane przez planowanie (receptura i stany) ---
Public SurowiecProdukt As String
Public SurowiecJM As String
Public SurowiecIlosc As Double
Public Przelicznik As Double
Public RecepturaOpis As String
Public StanSurowcaPrzed As Double   ' w jednostce surowca (SurowiecJM)
Public StanSurowcaPo As Double
Public StanProduktuPrzed As Double  ' w jednostce JM wyrobu
Public StanProduktuPo As Double

' --- tylko przy wczytaniu z arkusza (korekta / audyt) ---
Public PoprzedniSurowiec As String
Public PoprzednieZuzycie As Double
Public PoprzednieZuzycieJM As String

Public Function OpisTransportu() As String
    If Not Transport Then
        OpisTransportu = "NIE"
        Exit Function
    End If
    Dim s As String
    s = "TAK"
    If Przewoznik <> "" Then s = s & " | przewoźnik: " & Przewoznik
    If Pojazd <> "" Then s = s & " | pojazd: " & Pojazd
    If NrRej <> "" Then s = s & " | nr rej.: " & NrRej
    If Operator <> "" Then s = s & " | operator: " & Operator
    If Trasa <> "" Then s = s & " | trasa: " & Trasa
    s = s & " | " & Dystans & " km | koszt: " & Format(KosztTrans, "#,##0.00") & " zł"
    OpisTransportu = s
End Function
