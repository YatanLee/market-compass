import type { BacktestRequest, BacktestResult, DashboardPayload } from "./types";

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(path, {
      ...options,
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json", ...(options.headers ?? {}) },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: unknown } | null;
      throw new Error(typeof body?.error === "string" ? body.error : "API_FAILED");
    }
    return await response.json() as T;
  } finally {
    window.clearTimeout(timer);
  }
}

export function getDashboard(): Promise<DashboardPayload> {
  return requestJson<DashboardPayload>("/api/dashboard");
}

export function getLiveSnapshot(): Promise<DashboardPayload> {
  return requestJson<DashboardPayload>("/api/live");
}

export function postBacktest(request: BacktestRequest): Promise<BacktestResult> {
  return requestJson<BacktestResult>("/api/backtest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}
