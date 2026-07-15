from pathlib import Path

import pytest

from app.parser import CONTRACT_RE, ReportParseError, analyze_text, build_compliance, build_projection, money_values, parse_contract


FIXTURES = Path(__file__).parent / "fixtures"


def test_rejects_unknown_report() -> None:
    with pytest.raises(ReportParseError, match="определить формат"):
        analyze_text("Это не кредитный отчет" * 30)


def test_money_parser_does_not_join_date_and_following_amount() -> None:
    assert money_values("14 622 р.  15 июня 2026  511 768,24 р.") == [14_622, 511_768.24]


def test_projection_uses_payment_and_rate() -> None:
    contract = {
        "balance": {"total": 100_000},
        "payments": {"average": 10_000, "minimum": None, "next": None, "remaining_total": None},
        "rates": {"nominal": 12, "psk": 15},
        "end_date": None,
    }
    projection = build_projection(contract, __import__("datetime").date(2026, 1, 1))
    assert projection["status"] == "calculated"
    assert projection["months"] == 11
    assert projection["total"] > 100_000
    assert projection["rate_source"] == "nominal"


def test_projection_flags_payment_below_interest() -> None:
    contract = {
        "balance": {"total": 300_000},
        "payments": {"average": 1_000, "minimum": None, "next": None, "remaining_total": None},
        "rates": {"nominal": 50, "psk": 55},
        "end_date": None,
    }
    projection = build_projection(contract, __import__("datetime").date(2026, 1, 1))
    assert projection["status"] == "insufficient_payment"


def test_missing_payment_does_not_fall_through_to_debt_amount() -> None:
    block = """1. ТЕСТ БАНК - Договор займа (кредита) - Иной заем Без просрочек
Дата совершения сделки
01 января 2026 01 января 2026 31 декабря 9999
Тип сделки
Величина среднемесячного платежа по договору займа (кредита)
Величина среднемесячного платежа
-
Условия платежей
Сумма и дата ближайшего следующего платежа по основному долгу
-
Сумма минимального платежа
-
Сведения о сумме задолженности
Общая 40 000 р. 35 000 р. 4 000 р. 1 000 р.
Сумма всех внесенных платежей
По обязательству По основному долгу По процентам По иным требованиям
0 р. 0 р. 0 р. 0 р.
"""
    header = CONTRACT_RE.search(block)
    assert header is not None
    contract = parse_contract(block, header, __import__("datetime").date(2026, 7, 15))
    assert contract["payments"] == {
        "average": None,
        "minimum": None,
        "next": None,
        "remaining_total": None,
    }


def test_compliance_groups_close_contracts_and_low_payments() -> None:
    contracts = [
        {
            "id": "a",
            "creditor": "Банк A",
            "actual_payment_count": 0,
            "payment_count_confidence": "high",
            "balance": {"total": 350_000},
            "status": "active",
            "deal_date": "2026-01-01",
        },
        {
            "id": "b",
            "creditor": "Банк B",
            "actual_payment_count": 2,
            "payment_count_confidence": "high",
            "balance": {"total": 20_000},
            "status": "active",
            "deal_date": "2026-01-04",
        },
        {
            "id": "c",
            "creditor": "Банк C",
            "actual_payment_count": 4,
            "payment_count_confidence": "high",
            "balance": {"total": 10_000},
            "status": "active",
            "deal_date": "2026-01-02",
        },
    ]
    result = build_compliance(contracts)
    assert len(result["low_payment_contracts"]) == 2
    assert len(result["large_low_payment_contracts"]) == 1
    assert len(result["proximity_groups"]) == 1
    assert set(result["proximity_groups"][0]["contract_ids"]) == {"a", "b", "c"}
