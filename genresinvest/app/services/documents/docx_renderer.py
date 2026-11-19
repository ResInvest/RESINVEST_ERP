"""Generator DOCX bezpośrednio na oryginalnym papierze firmowym (``assets/letterhead.docx``).

Nagłówek z logo, stopka z danymi rejestrowymi i polami numeracji stron pochodzą 1:1 z szablonu
dostarczonego przez firmę — program podmienia wyłącznie treść dokumentu. Plik można dalej edytować
w MS Word / LibreOffice.
"""

from __future__ import annotations

import io
from functools import lru_cache

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor, Twips
from docx.table import _Cell

from ...config import app_root
from .content import DocContent, Party

FONT_NAME = "Arial"
DARK = RGBColor(0x0A, 0x1A, 0x21)
RED = RGBColor(0xB4, 0x23, 0x18)


@lru_cache(maxsize=1)
def _template_bytes() -> bytes:
    return (app_root() / "assets" / "letterhead.docx").read_bytes()


def _style_run(run, size: float = 10, bold: bool = False, color: RGBColor | None = None) -> None:  # noqa: ANN001
    run.font.name = FONT_NAME
    run.font.size = Pt(size)
    run.font.bold = bold
    if color is not None:
        run.font.color.rgb = color
    rpr = run._element.get_or_add_rPr()
    fonts = rpr.find(qn("w:rFonts"))
    if fonts is None:
        fonts = OxmlElement("w:rFonts")
        rpr.insert(0, fonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        fonts.set(qn(attr), FONT_NAME)
    lang = rpr.find(qn("w:lang"))
    if lang is None:
        lang = OxmlElement("w:lang")
        rpr.append(lang)
    lang.set(qn("w:val"), "pl-PL")


def _para(container, text: str = "", size: float = 10, bold: bool = False, align=None,  # noqa: ANN001
          space_after: float = 0, color: RGBColor | None = None, first: bool = False):
    p = container.paragraphs[0] if first and container.paragraphs and not container.paragraphs[0].text else container.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(0)
    pf.space_after = Pt(space_after)
    pf.line_spacing = 1.1
    if align is not None:
        p.alignment = align
    lines = text.split("\n")
    for i, line in enumerate(lines):
        run = p.add_run(line)
        _style_run(run, size, bold, color)
        if i < len(lines) - 1:
            run.add_break()
    return p


def _labelled(cell: _Cell, label: str, value: str) -> None:
    p = cell.add_paragraph()
    p.paragraph_format.space_after = Pt(0)
    _style_run(p.add_run(f"{label}: "), 11, True)
    lines = value.split("\n")
    for i, line in enumerate(lines):
        run = p.add_run(line)
        _style_run(run, 11)
        if i < len(lines) - 1:
            run.add_break()


def _set_cell_margins(table, twips: int = 100) -> None:  # noqa: ANN001
    tbl_pr = table._tbl.tblPr
    mar = OxmlElement("w:tblCellMar")
    for side in ("top", "left", "bottom", "right"):
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:w"), str(twips if side in ("left", "right") else 70))
        el.set(qn("w:type"), "dxa")
        mar.append(el)
    tbl_pr.append(mar)


def _set_borders(table, size: int = 6, color: str = "3C4A50") -> None:  # noqa: ANN001
    tbl_pr = table._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), str(size))
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), color)
        borders.append(el)
    tbl_pr.append(borders)


def _cant_split(row) -> None:  # noqa: ANN001
    tr_pr = row._tr.get_or_add_trPr()
    el = OxmlElement("w:cantSplit")
    tr_pr.append(el)


def _party(cell: _Cell, party: Party) -> None:
    _para(cell, party.label, 8.5, True, color=DARK, first=True)
    for i, line in enumerate(party.lines):
        _para(cell, line, 9.5, bold=(i == 0))


def render_docx(content: DocContent) -> bytes:
    doc = Document(io.BytesIO(_template_bytes()))
    body = doc.element.body
    for child in list(body):
        if child.tag != qn("w:sectPr"):
            body.remove(child)

    section = doc.sections[0]
    section.top_margin = Twips(1985)
    section.left_margin = Twips(1021)
    section.right_margin = Twips(1021)

    core = doc.core_properties
    core.title = content.title
    core.subject = "Zlecenie"
    core.author = "ResInvest Commodities PL S.A."
    core.language = "pl-PL"

    _para(doc, content.title, 15, True, WD_ALIGN_PARAGRAPH.CENTER, space_after=2 if content.subtitle else 8, color=DARK)
    if content.subtitle:
        _para(doc, content.subtitle, 10, True, WD_ALIGN_PARAGRAPH.CENTER, space_after=8, color=RED)
    if content.watermark:
        _para(doc, f"[{content.watermark}]", 10, True, WD_ALIGN_PARAGRAPH.CENTER, space_after=6, color=RED)

    table = doc.add_table(rows=0, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    _set_borders(table)
    _set_cell_margins(table)
    usable = section.page_width - section.left_margin - section.right_margin
    col_w = int(usable / 2)

    def new_row(span: bool):  # noqa: ANN202
        row = table.add_row()
        for c in row.cells:
            c.width = col_w
        if span:
            merged = row.cells[0].merge(row.cells[1])
            return row, merged
        return row, None

    row, _ = new_row(False)
    _party(row.cells[0], content.contractor)
    _party(row.cells[1], content.issuer)

    _, cell = new_row(True)
    _para(cell, "Krótki opis usługi:", 8.5, True, color=DARK, first=True)
    _para(cell, content.short_description, 11)

    _, cell = new_row(True)
    _para(cell, "Cena netto:", 8.5, True, color=DARK, first=True, space_after=3)
    for line in content.price_lines:
        _para(cell, line, 11, True)
    if content.total_line:
        _para(cell, content.total_line, 11, True)
    _para(cell, "", 4)
    _para(cell, content.payment_line, 11, True)

    _, cell = new_row(True)
    first = True
    for label, value in content.details:
        if first:
            cell.paragraphs[0]._element.getparent().remove(cell.paragraphs[0]._element)
            first = False
        _labelled(cell, label, value)
    _para(cell, "", 6, first=first)
    _para(cell, "Terminy załadunku:", 11)
    _para(cell, content.loading_term, 11, space_after=6)
    _para(cell, "Po stronie Zleceniodawcy sprawę prowadzi:", 11)
    _para(cell, content.handler_line, 11)
    _para(cell, "Po stronie Zleceniobiorcy:", 11)
    _para(cell, content.contractor_contact_line or "—", 11)

    extra = [x for x in (content.notes, content.closing_clause) if x]
    if extra:
        _, cell = new_row(True)
        _para(cell, "Uwagi:", 8.5, True, color=DARK, first=True)
        for x in extra:
            _para(cell, x, 10)

    row, _ = new_row(False)
    _cant_split(row)
    for c, label in zip(row.cells, ("Zleceniobiorca", "Zleceniodawca")):
        _para(c, content.place_date, 11, first=True)
        for _i in range(3):
            _para(c, "", 10)
        _para(c, "." * 70, 8.5, align=WD_ALIGN_PARAGRAPH.CENTER)
        _para(c, label, 8.5, align=WD_ALIGN_PARAGRAPH.CENTER, color=DARK)

    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()
