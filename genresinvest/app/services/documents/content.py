"""Model treści dokumentu zlecenia — jedno źródło dla generatora PDF i DOCX.

Dzięki temu oba formaty mają identyczną treść, a zmiana układu wymaga edycji w jednym miejscu.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any

from ... import validators as v


@dataclass
class Party:
    label: str
    lines: list[str]  # pierwsza linia = „Firma: …” (pogrubiona)


@dataclass
class DocContent:
    title: str
    subtitle: str
    watermark: str | None
    contractor: Party
    issuer: Party
    short_description: str
    price_lines: list[str]
    total_line: str | None
    payment_line: str
    details: list[tuple[str, str]]
    loading_term: str
    handler_line: str
    contractor_contact_line: str
    notes: str
    closing_clause: str
    place_date: str
    footer: list[str] = field(default_factory=list)
    website: str = ""
    file_stem: str = "Zlecenie"


def _fmt_date(value: Any) -> str:
    if isinstance(value, str):
        value = date.fromisoformat(value[:10])
    return value.strftime("%d.%m.%Y")


def _amount(net_amount: str, unit: str) -> str:
    gr = v.parse_amount_to_gr(net_amount)
    unit = unit.strip()
    return f"{v.format_pln(gr)} {unit}" if unit else f"{v.format_pln(gr)} zł"


def _safe_name(text: str) -> str:
    keep = []
    for ch in text:
        if ch.isalnum() or ch in "-_":
            keep.append(ch)
        elif ch in " /.\\":
            keep.append("-" if ch != " " else "_")
    return "".join(keep).strip("-_")[:80] or "Zlecenie"


def build_content(order: dict[str, Any], company: dict[str, Any], doc_cfg: dict[str, Any]) -> DocContent:
    issuer = order.get("issuer") or {}
    if not issuer.get("name"):
        issuer = company
    contractor = order.get("contractor") or {}

    status = order.get("status", "draft")
    number = order.get("number")
    title = doc_cfg.get("title", "ZLECENIE")
    title = f"{title} nr {number}" if number else f"{title} — PROJEKT"
    subtitle_parts = []
    if order.get("revision", 0) > 1:
        subtitle_parts.append(f"Korekta nr {order['revision'] - 1}")
    if status == "cancelled":
        subtitle_parts.append("ANULOWANE")
    watermark = {"draft": "PROJEKT", "cancelled": "ANULOWANE"}.get(status)

    def party_lines(p: dict[str, Any]) -> list[str]:
        lines = [f"Firma: {p.get('name', '')}"]
        if p.get("street"):
            lines.append(p["street"])
        city = " ".join(x for x in (p.get("postal_code", ""), p.get("city", "")) if x)
        if city:
            lines.append(city)
        if p.get("country") and p.get("country") != "PL":
            lines.append(p["country"])
        if p.get("nip"):
            lines.append(f"NIP: {p['nip']}")
        return lines

    price_lines = []
    for item in order.get("items", []):
        line = f"{item['position']}. {item['route']}: {_amount(item['net_amount'], item['unit'])}"
        if item.get("quantity"):
            qty = v.format_quantity(v.parse_quantity_to_milli(item["quantity"]) or 0)
            line += f" × {qty} = {v.format_pln(v.parse_amount_to_gr(item['value']))} zł netto"
        price_lines.append(line)
    total_line = None
    if order.get("total_net") and len(order.get("items", [])) > 1:
        total_line = f"Wartość zlecenia netto: {v.format_pln(v.parse_amount_to_gr(order['total_net']))} zł"

    payment_line = doc_cfg.get("payment_text", "Płatność: {days} dni od daty wystawienia faktury").replace(
        "{days}", str(order.get("payment_days", 14))
    )

    details = [
        ("Dokładny opis usługi", order.get("service_detailed") or order.get("service_short", "")),
        ("Rodzaj przewożonego towaru", order.get("cargo_type", "")),
        ("Punkt wyjściowy (załadunek)", order.get("origin_point", "")),
        ("Punkt docelowy (rozładunek)", order.get("destination_point", "")),
    ]
    details = [(k, val) for k, val in details if val]

    handler = order.get("handler_name", "")
    if order.get("handler_phone"):
        handler += f": {order['handler_phone']}"
    contact = ": ".join(x for x in (order.get("contractor_contact_name", ""), order.get("contractor_contact_phone", "")) if x)

    footer = [
        f"{issuer.get('legal_name') or issuer.get('name', '')}, siedziba: {issuer.get('street', '')}, "
        f"{issuer.get('postal_code', '')} {issuer.get('city', '')}",
    ]
    if issuer.get("correspondence_address"):
        footer.append(f"Adres do korespondencji: {issuer['correspondence_address']}")
    reg = ", ".join(
        x for x in (
            f"NIP: {issuer['nip']}" if issuer.get("nip") else "",
            f"REGON: {issuer['regon']}" if issuer.get("regon") else "",
            f"KRS: {issuer['krs']}" if issuer.get("krs") else "",
        ) if x
    )
    if issuer.get("court"):
        reg += f" - {issuer['court']}"
    if reg:
        footer.append(reg)
    if issuer.get("share_capital"):
        footer.append(f"Wysokość kapitału zakładowego {issuer['share_capital']}")

    stem = "Zlecenie_" + _safe_name(number or "PROJEKT") + "_" + _safe_name(contractor.get("name", ""))
    if order.get("revision", 0) > 1:
        stem += f"_korekta{order['revision'] - 1}"

    return DocContent(
        title=title,
        subtitle=" · ".join(subtitle_parts),
        watermark=watermark,
        contractor=Party("Zleceniobiorca:", party_lines(contractor)),
        issuer=Party("Zleceniodawca:", party_lines(issuer)),
        short_description=order.get("service_short", ""),
        price_lines=price_lines,
        total_line=total_line,
        payment_line=payment_line,
        details=details,
        loading_term=order.get("loading_term", ""),
        handler_line=handler,
        contractor_contact_line=contact,
        notes=order.get("notes", ""),
        closing_clause=doc_cfg.get("closing_clause", ""),
        place_date=f"{order.get('issue_place', '')}, dnia {_fmt_date(order['issue_date'])}",
        footer=footer,
        website=issuer.get("website", ""),
        file_stem=stem,
    )
