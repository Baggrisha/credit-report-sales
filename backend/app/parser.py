from __future__ import annotations

import math
import re
import subprocess
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any


MONEY_RE = re.compile(
    r"(?<!\d)-?(?:\d{1,3}(?: \d{3})+|\d+)(?:,\d{1,2})?\s*р\.",
    re.IGNORECASE,
)
DATE_RE = re.compile(
    r"(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|"
    r"сентября|октября|ноября|декабря)\s+(\d{4})",
    re.IGNORECASE,
)
SHORT_DATE_RE = re.compile(
    r"(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|"
    r"сентября|октября|ноября|декабря)",
    re.IGNORECASE,
)
MONTHS = {
    "января": 1,
    "февраля": 2,
    "марта": 3,
    "апреля": 4,
    "мая": 5,
    "июня": 6,
    "июля": 7,
    "августа": 8,
    "сентября": 9,
    "октября": 10,
    "ноября": 11,
    "декабря": 12,
}
CONTRACT_RE = re.compile(
    r"^\s*\d+\.\s+(?P<creditor>.+?)\s+-\s+Договор займа \(кредита\)(?P<tail>.*)$",
    re.MULTILINE,
)


class ReportParseError(ValueError):
    pass


@dataclass(frozen=True)
class ParsedDate:
    value: date

    @property
    def iso(self) -> str:
        return self.value.isoformat()


def extract_pdf_text(pdf: bytes) -> str:
    if not pdf:
        raise ReportParseError("Файл пустой")
    try:
        result = subprocess.run(
            ["pdftotext", "-layout", "-", "-"],
            input=pdf,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ReportParseError("Не удалось запустить извлечение текста из PDF") from exc
    if result.returncode != 0:
        raise ReportParseError("Файл поврежден или не является поддерживаемым PDF")
    text = result.stdout.decode("utf-8", errors="replace").replace("\u00a0", " ")
    if len(text.strip()) < 200:
        raise ReportParseError("В PDF нет текстового слоя. OCR пока не поддерживается")
    return text


def money_values(text: str) -> list[float]:
    values: list[float] = []
    for raw in MONEY_RE.findall(text):
        normalized = re.sub(r"[^\d,\-]", "", raw).replace(",", ".")
        try:
            values.append(float(Decimal(normalized)))
        except (ValueError, ArithmeticError):
            continue
    return values


def parse_date(value: str) -> ParsedDate | None:
    match = DATE_RE.search(value)
    if not match:
        return None
    try:
        return ParsedDate(
            date(int(match.group(3)), MONTHS[match.group(2).lower()], int(match.group(1)))
        )
    except ValueError:
        return None


def section_between(text: str, start: str, ends: tuple[str, ...]) -> str:
    start_index = text.find(start)
    if start_index < 0:
        return ""
    end_index = len(text)
    for marker in ends:
        candidate = text.find(marker, start_index + len(start))
        if candidate >= 0:
            end_index = min(end_index, candidate)
    return text[start_index:end_index]


def next_value_line(block: str, marker: str) -> str:
    index = block.find(marker)
    if index < 0:
        return ""
    lines = block[index:].splitlines()[1:]
    for line in lines:
        if MONEY_RE.search(line):
            return line
    return ""


def first_percentage(block: str) -> float | None:
    match = re.search(r"(\d{1,3}(?:[,.]\d{1,4})?)\s*%", block)
    return float(match.group(1).replace(",", ".")) if match else None


def parse_summary(text: str) -> tuple[int | None, float | None]:
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if "Действующие кредиты/займы" not in line:
            continue
        for candidate in reversed(lines[max(0, index - 4) : index]):
            count_match = re.match(r"\s*(\d+)\b", candidate)
            values = money_values(candidate[count_match.end() :] if count_match else candidate)
            if count_match and values:
                return int(count_match.group(1)), values[0]
    return None, None


def parse_paid(block: str) -> dict[str, float]:
    paid = section_between(
        block,
        "Сумма всех внесенных платежей",
        ("Сведения для оценки дохода", "Сведения о соблюдении", "Фактические платежи"),
    )
    lines = paid.splitlines()
    for index, line in enumerate(lines):
        if "По обязательству" not in line:
            continue
        for candidate in lines[index + 1 : index + 5]:
            values = money_values(candidate)
            if len(values) >= 4:
                return dict(zip(("total", "principal", "interest", "other"), values[:4]))
    return {"total": 0.0, "principal": 0.0, "interest": 0.0, "other": 0.0}


def parse_balance(block: str) -> dict[str, float]:
    debt = section_between(
        block,
        "Сведения о сумме задолженности",
        ("Сумма всех внесенных платежей", "Сведения для оценки дохода"),
    )
    for line in debt.splitlines():
        if re.match(r"\s*Общая\s+", line):
            values = money_values(line)
            if len(values) >= 4:
                return dict(zip(("total", "principal", "interest", "other"), values[:4]))
            if values:
                return {"total": values[0], "principal": 0.0, "interest": 0.0, "other": 0.0}
    return {"total": 0.0, "principal": 0.0, "interest": 0.0, "other": 0.0}


def parse_actual_payment_dates(block: str, report_year: int) -> list[str]:
    payments = section_between(
        block,
        "Фактические платежи по договору",
        ("Изменения договора", "Сведения о споре", "Информация о поручительстве"),
    )
    if not payments:
        return []
    year = report_year
    found: set[str] = set()
    for line in payments.splitlines():
        year_match = re.match(r"\s*(20\d{2})\s*$", line)
        if year_match:
            year = int(year_match.group(1))
            continue
        for day, month_name in SHORT_DATE_RE.findall(line):
            try:
                found.add(date(year, MONTHS[month_name.lower()], int(day)).isoformat())
            except ValueError:
                continue
    return sorted(found)


def parse_contract(block: str, header: re.Match[str], report_date: date) -> dict[str, Any]:
    tail = header.group("tail").strip()
    creditor = re.sub(r"\s+", " ", header.group("creditor")).strip()

    amount_block = section_between(
        block,
        "Сумма и валюта обязательства",
        ("Сведения о полной стоимости", "Общие сведения о сделке"),
    )
    initial_values = money_values(amount_block)
    initial_amount = max(initial_values) if initial_values else None

    deal_block = section_between(
        block,
        "Дата совершения сделки",
        ("Тип сделки", "Кредитная линия"),
    )
    deal_dates = [parse_date(match.group(0)) for match in DATE_RE.finditer(deal_block)]
    clean_dates = [item for item in deal_dates if item]
    deal_date = clean_dates[0].value if clean_dates else None
    end_date = clean_dates[2].value if len(clean_dates) >= 3 else None

    psk_block = section_between(
        block,
        "Сведения о полной стоимости кредита",
        ("Общие сведения о сделке", "Дата совершения сделки"),
    )
    psk = first_percentage(psk_block)

    rate_block = section_between(
        block,
        "Сведения об учете обязательства",
        ("Учет задолженности", "Величина среднемесячного платежа"),
    )
    nominal_rate = first_percentage(rate_block)
    if nominal_rate is None:
        zero_rate = re.search(r"\n\s*0\s+0\s+", rate_block)
        nominal_rate = 0.0 if zero_rate else None

    average_block = section_between(
        block,
        "Величина среднемесячного платежа по договору",
        ("Условия платежей", "Сведения о сумме задолженности"),
    )
    average_line = next_value_line(average_block, "Величина среднемесячного платежа по договору")
    average_values = money_values(average_line)
    average_payment = average_values[0] if average_values else None
    remaining_reported = average_values[-1] if len(average_values) >= 2 else None

    conditions = section_between(
        block,
        "Условия платежей",
        ("Сведения о сумме задолженности",),
    )
    next_payment_block = section_between(
        conditions,
        "Сумма и дата ближайшего следующего платежа",
        ("Сумма минимального платежа", "Дата начала и окончания беспроцентного периода"),
    )
    next_line = next_value_line(next_payment_block, "Сумма и дата ближайшего следующего платежа")
    next_values = money_values(next_line)
    next_payment = sum(next_values[:2]) if next_values else None
    minimum_block = section_between(
        conditions,
        "Сумма минимального платежа",
        ("Дата начала и окончания беспроцентного периода",),
    )
    minimum_line = next_value_line(minimum_block, "Сумма минимального платежа")
    minimum_values = money_values(minimum_line)
    minimum_payment = minimum_values[0] if minimum_values else None

    paid = parse_paid(block)
    balance = parse_balance(block)
    payment_dates = parse_actual_payment_dates(block, report_date.year)

    normalized_tail = tail.lower()
    return {
        "id": re.sub(r"[^a-zа-я0-9]+", "-", creditor.lower()).strip("-")
        + f"-{deal_date.isoformat() if deal_date else header.start()}",
        "creditor": creditor,
        "status": "closed" if "Закрыт" in tail else "active",
        "status_label": tail or "Статус не указан",
        "deal_date": deal_date.isoformat() if deal_date else None,
        "end_date": end_date.isoformat() if end_date else None,
        "initial_amount": initial_amount,
        "balance": balance,
        "paid": paid,
        "rates": {"nominal": nominal_rate, "psk": psk},
        "payments": {
            "average": average_payment,
            "minimum": minimum_payment,
            "next": next_payment,
            "remaining_total": remaining_reported,
        },
        "actual_payment_dates": payment_dates,
        "actual_payment_count": len(payment_dates),
        "payment_count_confidence": "high" if payment_dates else ("low" if paid["total"] > 0 else "high"),
        "has_overdue_history": "просроч" in normalized_tail and "без просроч" not in normalized_tail,
    }


def months_between(start: date, end: date) -> int | None:
    if end.year >= 9999 or end <= start:
        return None
    return max(1, (end.year - start.year) * 12 + end.month - start.month)


def build_projection(contract: dict[str, Any], report_date: date) -> dict[str, Any]:
    balance = float(contract["balance"]["total"])
    payments = contract["payments"]
    payment = next(
        (float(value) for value in (payments["average"], payments["minimum"], payments["next"]) if value and value > 0),
        None,
    )
    rate = contract["rates"]["nominal"]
    rate_source = "nominal"
    confidence = "medium"
    if rate is None or rate <= 0:
        rate = contract["rates"]["psk"]
        rate_source = "psk_proxy"
        confidence = "low"
    rate = float(rate or 0)

    end = date.fromisoformat(contract["end_date"]) if contract["end_date"] else None
    remaining_months = months_between(report_date, end) if end else None
    reported_total = payments["remaining_total"]

    if balance <= 0:
        return {"status": "paid", "monthly_payment": 0, "months": 0, "total": 0, "interest": 0, "confidence": "high"}
    if reported_total and reported_total > 0:
        months = math.ceil(reported_total / payment) if payment else remaining_months
        return {
            "status": "calculated",
            "monthly_payment": payment,
            "months": months,
            "total": round(float(reported_total), 2),
            "interest": round(max(0, float(reported_total) - balance), 2),
            "confidence": "high",
            "rate_source": "reported_remaining_total",
        }

    monthly_rate = rate / 1200
    if not payment and remaining_months:
        if monthly_rate > 0:
            factor = (1 + monthly_rate) ** remaining_months
            payment = balance * monthly_rate * factor / (factor - 1)
        else:
            payment = balance / remaining_months

    if not payment or payment <= 0:
        return {
            "status": "needs_input",
            "monthly_payment": None,
            "months": remaining_months,
            "total": None,
            "interest": None,
            "confidence": "low",
            "message": "В отчете недостаточно данных о платеже или сроке",
        }

    if monthly_rate > 0 and payment <= balance * monthly_rate:
        return {
            "status": "insufficient_payment",
            "monthly_payment": round(payment, 2),
            "months": None,
            "total": None,
            "interest": None,
            "confidence": "low",
            "message": "Платеж не покрывает расчетные проценты",
        }

    outstanding = balance
    total = 0.0
    months = 0
    while outstanding > 0.01 and months < 600:
        interest = outstanding * monthly_rate
        actual = min(payment, outstanding + interest)
        outstanding = max(0.0, outstanding + interest - actual)
        total += actual
        months += 1

    if months >= 600:
        return {
            "status": "needs_input",
            "monthly_payment": round(payment, 2),
            "months": None,
            "total": None,
            "interest": None,
            "confidence": "low",
            "message": "Расчетный срок превышает 50 лет",
        }
    return {
        "status": "calculated",
        "monthly_payment": round(payment, 2),
        "months": months,
        "total": round(total, 2),
        "interest": round(max(0, total - balance), 2),
        "confidence": confidence,
        "rate_source": rate_source,
    }


def build_compliance(contracts: list[dict[str, Any]], large_debt_threshold: float = 300_000) -> dict[str, Any]:
    low_payment = []
    for contract in contracts:
        count = contract["actual_payment_count"]
        if count < 3:
            low_payment.append(
                {
                    "contract_id": contract["id"],
                    "creditor": contract["creditor"],
                    "payment_count": count,
                    "confidence": contract["payment_count_confidence"],
                    "balance": contract["balance"]["total"],
                    "status": contract["status"],
                    "severity": "high" if count == 0 else "medium",
                }
            )

    dated = sorted(
        (date.fromisoformat(item["deal_date"]), item)
        for item in contracts
        if item["deal_date"]
    )
    proximity_groups: list[dict[str, Any]] = []
    for index, (start_date, _) in enumerate(dated):
        group = [item for candidate_date, item in dated[index:] if 0 <= (candidate_date - start_date).days < 4]
        if len(group) >= 2:
            ids = {item["id"] for item in group}
            if any(ids <= set(existing["contract_ids"]) for existing in proximity_groups):
                continue
            proximity_groups = [
                existing
                for existing in proximity_groups
                if not set(existing["contract_ids"]) < ids
            ]
            proximity_groups.append(
                {
                    "contract_ids": sorted(ids),
                    "creditors": [item["creditor"] for item in group],
                    "start_date": start_date.isoformat(),
                    "days_window": max(
                        (date.fromisoformat(item["deal_date"]) - start_date).days for item in group
                    ),
                }
            )

    large_low_payment = [
        item
        for item in low_payment
        if item["status"] == "active" and item["balance"] >= large_debt_threshold
    ]
    return {
        "low_payment_contracts": low_payment,
        "proximity_groups": proximity_groups,
        "large_low_payment_contracts": large_low_payment,
        "large_debt_threshold": large_debt_threshold,
        "requires_legal_review": bool(low_payment or proximity_groups or large_low_payment),
    }


def analyze_text(text: str) -> dict[str, Any]:
    if "Объединенного Кредитного Бюро" not in text:
        if "НБКИ" in text or "Национальное бюро кредитных историй" in text:
            raise ReportParseError("Формат НБКИ распознан, но для него нужен проверочный образец")
        raise ReportParseError("Не удалось определить формат кредитного отчета")

    generated_match = re.search(r"Сформирован\s+([^\n]+?)\s+\d{1,2}:\d{2}", text)
    generated = parse_date(generated_match.group(1)) if generated_match else None
    report_date = generated.value if generated else date.today()
    version_match = re.search(r"\bv(\d+\.\d+\.\d+\.\d+)\b", text)
    customer_match = re.search(r"СУБЪЕКТ КРЕДИТНОЙ ИСТОРИИ\s*\n\s*([^\n]+)", text)
    customer_name = re.sub(r"\s+", " ", customer_match.group(1)).strip() if customer_match else None

    matches = list(CONTRACT_RE.finditer(text))
    if not matches:
        raise ReportParseError("В отчете не найдены кредитные договоры")
    contracts = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        contracts.append(parse_contract(text[match.start() : end], match, report_date))

    active = [item for item in contracts if item["status"] == "active"]
    for contract in active:
        contract["projection"] = build_projection(contract, report_date)
    for contract in contracts:
        if "projection" not in contract:
            contract["projection"] = None

    reported_count, reported_debt = parse_summary(text)
    calculated_debt = round(sum(item["balance"]["total"] for item in active), 2)
    paid = {
        key: round(sum(item["paid"][key] for item in active), 2)
        for key in ("total", "principal", "interest", "other")
    }

    projections = [item["projection"] for item in active]
    resolved = [item for item in projections if item and item["total"] is not None]
    unresolved_count = len(projections) - len(resolved)
    bank_projection = {
        "monthly_payment": round(sum(item["monthly_payment"] or 0 for item in resolved), 2),
        "months": max((item["months"] or 0 for item in resolved), default=0),
        "total": round(sum(item["total"] for item in resolved), 2) if resolved else None,
        "interest": round(sum(item["interest"] or 0 for item in resolved), 2) if resolved else None,
        "unresolved_contracts": unresolved_count,
        "confidence": "low" if unresolved_count or any(item["confidence"] == "low" for item in resolved) else "medium",
    }

    warnings: list[str] = []
    if reported_count is not None and reported_count != len(active):
        warnings.append("Количество действующих договоров не совпало со сводкой ОКБ")
    difference = round(calculated_debt - reported_debt, 2) if reported_debt is not None else None
    if difference is not None and abs(difference) > 1:
        warnings.append("Сумма долга по договорам отличается от сводки ОКБ")
    if unresolved_count:
        warnings.append("Для части договоров требуется уточнить платеж или срок")
    if any(item["projection"] and item["projection"].get("rate_source") == "psk_proxy" for item in active):
        warnings.append("Для части прогнозов ПСК используется как приближение ставки")

    return {
        "report": {
            "provider": "ОКБ",
            "provider_label": "Объединенное Кредитное Бюро",
            "version": version_match.group(1) if version_match else None,
            "generated_at": report_date.isoformat(),
            "customer_name": customer_name,
        },
        "summary": {
            "active_count": len(active),
            "closed_count": len(contracts) - len(active),
            "reported_active_count": reported_count,
            "reported_total_debt": reported_debt,
            "calculated_total_debt": calculated_debt,
            "debt_difference": difference,
            "paid": paid,
            "bank_projection": bank_projection,
        },
        "contracts": contracts,
        "compliance": build_compliance(contracts),
        "warnings": warnings,
    }


def analyze_pdf(pdf: bytes) -> dict[str, Any]:
    return analyze_text(extract_pdf_text(pdf))
