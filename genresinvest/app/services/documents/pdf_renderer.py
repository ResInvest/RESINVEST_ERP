"""Generator PDF na papierze firmowym ResInvest (nagłówek z logo + stopka rejestrowa).

Używa reportlab i wbudowanych czcionek Liberation Sans (metryka zgodna z Arial, pełne polskie znaki),
więc działa offline i identycznie na każdym komputerze — bez MS Word / LibreOffice.
"""

from __future__ import annotations

import io
from functools import lru_cache
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from ...config import app_root
from ... import APP_NAME, APP_VERSION
from .content import DocContent

PAGE_W, PAGE_H = A4
MARGIN_X = 42
HEADER_H = PAGE_W * 206 / 1550  # proporcje obrazu nagłówka (pełna szerokość strony)
TOP_MARGIN = HEADER_H + 22
BOTTOM_MARGIN = 84
FOOTER_X = 74
FOOTER_MAX_W = 388
DARK = colors.HexColor("#0A1A21")
GREY = colors.HexColor("#84959B")
LINK = colors.HexColor("#002395")
BORDER = colors.HexColor("#3C4A50")

FONT = "GRI-Sans"
FONT_BOLD = "GRI-Sans-Bold"
FONT_ITALIC = "GRI-Sans-Italic"


@lru_cache(maxsize=1)
def _register_fonts() -> None:
    fonts_dir = app_root() / "assets" / "fonts"
    pdfmetrics.registerFont(TTFont(FONT, str(fonts_dir / "LiberationSans-Regular.ttf")))
    pdfmetrics.registerFont(TTFont(FONT_BOLD, str(fonts_dir / "LiberationSans-Bold.ttf")))
    pdfmetrics.registerFont(TTFont(FONT_ITALIC, str(fonts_dir / "LiberationSans-Italic.ttf")))
    pdfmetrics.registerFontFamily(FONT, normal=FONT, bold=FONT_BOLD, italic=FONT_ITALIC, boldItalic=FONT_BOLD)


@lru_cache(maxsize=1)
def _header_image() -> ImageReader:
    return ImageReader(str(app_root() / "assets" / "header.jpg"))


def _styles() -> dict[str, ParagraphStyle]:
    base = ParagraphStyle("base", fontName=FONT, fontSize=10, leading=13.5, textColor=colors.black)
    return {
        "base": base,
        "title": ParagraphStyle("title", parent=base, fontName=FONT_BOLD, fontSize=15, leading=19, alignment=TA_CENTER, textColor=DARK),
        "subtitle": ParagraphStyle("subtitle", parent=base, fontName=FONT_BOLD, fontSize=10, alignment=TA_CENTER, textColor=colors.HexColor("#B42318")),
        "label": ParagraphStyle("label", parent=base, fontName=FONT_BOLD, fontSize=8.5, leading=11, textColor=DARK),
        "party": ParagraphStyle("party", parent=base, fontSize=9.5, leading=12.5),
        "body": ParagraphStyle("body", parent=base, fontSize=11, leading=15),
        "price": ParagraphStyle("price", parent=base, fontName=FONT_BOLD, fontSize=11, leading=15, leftIndent=14, firstLineIndent=-14),
        "strong": ParagraphStyle("strong", parent=base, fontName=FONT_BOLD, fontSize=11, leading=15),
        "small": ParagraphStyle("small", parent=base, fontSize=8.5, leading=11, textColor=DARK),
        "center": ParagraphStyle("center", parent=base, fontSize=8.5, leading=11, alignment=TA_CENTER, textColor=DARK),
    }


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(escape(text).replace("\n", "<br/>"), style)


def _labelled(label: str, value: str, st: dict[str, ParagraphStyle]) -> Paragraph:
    return Paragraph(f"<b>{escape(label)}:</b> {escape(value).replace(chr(10), '<br/>')}", st["body"])


class _NumberedCanvas(rl_canvas.Canvas):
    """Canvas z numeracją „Strona X / N” (dwa przebiegi stron)."""

    def __init__(self, *args, content: DocContent, **kwargs):  # noqa: ANN002, ANN003
        super().__init__(*args, **kwargs)
        self._saved_pages: list[dict] = []
        self._content = content

    def showPage(self) -> None:  # noqa: N802
        self._saved_pages.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        total = len(self._saved_pages)
        for state in self._saved_pages:
            self.__dict__.update(state)
            _draw_letterhead(self, self._content, self._pageNumber, total)
            super().showPage()
        super().save()


def _draw_letterhead(c: rl_canvas.Canvas, content: DocContent, page: int, total: int) -> None:
    c.saveState()
    c.drawImage(_header_image(), 0, PAGE_H - HEADER_H, width=PAGE_W, height=HEADER_H, mask=None)

    if content.watermark:
        c.saveState()
        c.setFillColor(colors.Color(0.75, 0.1, 0.1, alpha=0.10))
        c.setFont(FONT_BOLD, 96)
        c.translate(PAGE_W / 2, PAGE_H / 2)
        c.rotate(35)
        c.drawCentredString(0, -30, content.watermark)
        c.restoreState()

    # Stopka rejestrowa (zawijana tak, by nie nachodziła na numer strony).
    lines: list[tuple[str, str]] = []
    for i, line in enumerate(content.footer):
        font = FONT_BOLD if i == 0 else FONT
        lines += [(font, part) for part in simpleSplit(line, font, 7, FOOTER_MAX_W)]
    y = 28 + 8.4 * (len(lines) - 1)
    for font, text in lines:
        c.setFont(font, 7)
        c.setFillColor(DARK)
        c.drawString(FOOTER_X, y, text)
        y -= 8.4
    c.setFont(FONT, 7)
    c.setFillColor(GREY)
    label = "Strona "
    c.drawString(472, 40, label)
    c.setFillColor(DARK)
    c.setFont(FONT_BOLD, 7)
    c.drawString(472 + c.stringWidth(label, FONT, 7), 40, f"{page} / {total}")
    if content.website:
        c.setFont(FONT_BOLD, 7.5)
        c.setFillColor(DARK)
        c.drawRightString(PAGE_W - MARGIN_X, 14, content.website)
        url = content.website if content.website.startswith("http") else f"https://{content.website}"
        w = c.stringWidth(content.website, FONT_BOLD, 7.5)
        c.linkURL(url, (PAGE_W - MARGIN_X - w, 12, PAGE_W - MARGIN_X, 22), relative=0)
    c.restoreState()


def render_pdf(content: DocContent) -> bytes:
    _register_fonts()
    st = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=MARGIN_X,
        rightMargin=MARGIN_X,
        topMargin=TOP_MARGIN,
        bottomMargin=BOTTOM_MARGIN,
        title=content.title,
        author="ResInvest Commodities PL S.A.",
        subject="Zlecenie",
        creator=f"{APP_NAME} {APP_VERSION}",
    )
    width = PAGE_W - 2 * MARGIN_X
    half = width / 2

    def party_cell(party) -> list:  # noqa: ANN001
        cell = [_p(party.label, st["label"])]
        for i, line in enumerate(party.lines):
            cell.append(Paragraph(f"<b>{escape(line)}</b>" if i == 0 else escape(line), st["party"]))
        return cell

    story: list = [_p(content.title, st["title"])]
    if content.subtitle:
        story.append(_p(content.subtitle, st["subtitle"]))
    story.append(Spacer(1, 10))

    price_cell = [_p("Cena netto:", st["label"]), Spacer(1, 3)]
    price_cell += [_p(line, st["price"]) for line in content.price_lines]
    if content.total_line:
        price_cell.append(_p(content.total_line, st["strong"]))
    price_cell += [Spacer(1, 4), _p(content.payment_line, st["strong"])]

    detail_cell: list = [_labelled(k, val, st) for k, val in content.details]
    detail_cell += [Spacer(1, 6), _p("Terminy załadunku:", st["body"]), _p(content.loading_term, st["body"]), Spacer(1, 6)]
    detail_cell.append(_p("Po stronie Zleceniodawcy sprawę prowadzi:", st["body"]))
    detail_cell.append(_p(content.handler_line, st["body"]))
    detail_cell.append(_p("Po stronie Zleceniobiorcy:", st["body"]))
    detail_cell.append(_p(content.contractor_contact_line or "—", st["body"]))

    rows: list[list] = [
        [party_cell(content.contractor), party_cell(content.issuer)],
        [[_p("Krótki opis usługi:", st["label"]), _p(content.short_description, st["body"])], ""],
        [price_cell, ""],
        [detail_cell, ""],
    ]
    extra = [x for x in (content.notes, content.closing_clause) if x]
    if extra:
        notes_cell: list = [_p("Uwagi:", st["label"])] + [_p(x, st["base"]) for x in extra]
        rows.append([notes_cell, ""])

    def sign_cell(label: str) -> list:
        return [
            _p(content.place_date, st["body"]),
            Spacer(1, 46),
            _p("." * 70, st["center"]),
            _p(label, st["center"]),
        ]

    rows.append([sign_cell("Zleceniobiorca"), sign_cell("Zleceniodawca")])

    table = Table(rows, colWidths=[half, half], repeatRows=0)
    style = [
        ("BOX", (0, 0), (-1, -1), 0.8, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]
    for r in range(1, len(rows) - 1):
        style.append(("SPAN", (0, r), (1, r)))
    table.setStyle(TableStyle(style))
    story.append(table)
    story.append(Spacer(1, 6))
    story.append(KeepTogether([_p(f"Dokument wygenerowany w {APP_NAME} {APP_VERSION}", ParagraphStyle("gen", parent=st["small"], fontSize=6.5, textColor=GREY))]))

    doc.build(story, canvasmaker=lambda *a, **kw: _NumberedCanvas(*a, content=content, **kw))
    return buf.getvalue()
