from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .parser import ReportParseError, analyze_pdf


MAX_PDF_SIZE = 50 * 1024 * 1024
app = FastAPI(title="Credit Report Sales API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if origin],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-App-Code"],
)


@app.exception_handler(ReportParseError)
async def parse_error_handler(_, exc: ReportParseError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


def check_access(code: str | None) -> None:
    expected = os.getenv("APP_ACCESS_CODE")
    if expected and code != expected:
        raise HTTPException(status_code=401, detail="Неверный код доступа")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/reports/analyze")
async def analyze_report(
    file: UploadFile = File(...),
    x_app_code: str | None = Header(default=None),
) -> dict:
    check_access(x_app_code)
    if file.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=415, detail="Поддерживаются только PDF-файлы")
    payload = await file.read(MAX_PDF_SIZE + 1)
    await file.close()
    if len(payload) > MAX_PDF_SIZE:
        raise HTTPException(status_code=413, detail="PDF превышает лимит 50 МБ")
    return analyze_pdf(payload)


STATIC_DIR = Path(__file__).resolve().parents[1] / "static"
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
