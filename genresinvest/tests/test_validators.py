import pytest

from app import validators as v
from app.services import numbering
from datetime import date


@pytest.mark.parametrize("nip", ["6452037772", "645-203-77-72", "PL 969 116 56 64", "2060002073", "6460007202"])
def test_valid_nip(nip):
    assert v.is_valid_nip(nip)


@pytest.mark.parametrize("nip", ["6452037773", "123", "", None, "abcdefghij", "0000000000x"])
def test_invalid_nip(nip):
    assert not v.is_valid_nip(nip)


@pytest.mark.parametrize(
    "raw,gr",
    [("900", 90000), ("900,5", 90050), ("1 234,56", 123456), ("1.234,56", 123456), (900.5, 90050), ("0,01", 1), ("900 zł", 90000)],
)
def test_amount_parsing(raw, gr):
    assert v.parse_amount_to_gr(raw) == gr


@pytest.mark.parametrize("raw", ["0", "-5", "abc", "1,234", "12.345", "999999999999"])
def test_amount_rejected(raw):
    with pytest.raises(ValueError):
        v.parse_amount_to_gr(raw)


def test_format_pln():
    assert v.format_pln(123456789) == "1 234 567,89"
    assert v.format_pln(90000) == "900,00"


def test_quantity():
    assert v.parse_quantity_to_milli("12,5") == 12500
    assert v.parse_quantity_to_milli("") is None
    with pytest.raises(ValueError):
        v.parse_quantity_to_milli("1,2345")


def test_postal_and_phone():
    assert v.normalize_postal_code("40527") == "40-527"
    assert v.is_valid_postal_code("40-527")
    assert not v.is_valid_postal_code("40527x")
    assert v.is_valid_phone("+48 606 403 090")
    assert not v.is_valid_phone("12ab")


def test_number_pattern():
    assert numbering.render_number("ZL/{SEQ}/{MM}/{YYYY}", 7, 3, date(2026, 11, 13)) == "ZL/007/11/2026"
    assert numbering.render_number("{YY}-{SEQ}", 12, 4, date(2026, 1, 1)) == "26-0012"
    with pytest.raises(ValueError):
        numbering.validate_pattern("ZL/{MM}")
    with pytest.raises(ValueError):
        numbering.validate_pattern("ZL/{SEQ}/{XX}")


def test_clean_text_strips_control_chars():
    assert v.clean_text(" a\x00b\r\nc ", 10) == "ab\nc"
    with pytest.raises(ValueError):
        v.clean_text("x" * 11, 10)
