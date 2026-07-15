from __future__ import annotations

import json
import sys
from pathlib import Path

from app.parser import analyze_pdf


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: inspect_report.py REPORT.pdf [REPORT.pdf ...]")
    results = []
    for raw_path in sys.argv[1:]:
        path = Path(raw_path)
        analysis = analyze_pdf(path.read_bytes())
        results.append(
            {
                "file": path.name,
                "summary": analysis["summary"],
                "contracts": [
                    {
                        "creditor": item["creditor"],
                        "status": item["status"],
                        "balance": item["balance"]["total"],
                        "paid": item["paid"]["total"],
                        "payment_events": item["actual_payment_count"],
                    }
                    for item in analysis["contracts"]
                ],
                "warnings": analysis["warnings"],
            }
        )
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
