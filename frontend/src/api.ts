import type { Analysis } from "./types";

export async function analyzeReport(file: File, accessCode: string): Promise<Analysis> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/v1/reports/analyze", {
    method: "POST",
    headers: accessCode ? { "X-App-Code": accessCode } : undefined,
    body,
  });
  if (!response.ok) {
    let message = "Не удалось обработать отчет";
    try {
      const payload = (await response.json()) as { detail?: string };
      message = payload.detail || message;
    } catch {
      // Keep the generic error when the server did not return JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<Analysis>;
}
