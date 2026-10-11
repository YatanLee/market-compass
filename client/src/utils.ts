import type { DataMode, Source } from "./types";

export const viewNames = {
  overview: "市場總覽",
  events: "事件雷達",
  strategies: "策略實驗室",
  sources: "資料來源",
} as const;

export const categoryNames: Record<string, string> = {
  policy: "政策",
  macro: "總經",
  influencer: "公開人物",
  social: "社群",
};

export const typeNames: Record<string, string> = {
  stock: "股票",
  etf: "交易所交易基金",
  fund: "基金",
};

export const marketNames: Record<string, string> = { US: "美股", TW: "台股", FUND: "基金" };

export const dataKindNames: Record<string, string> = {
  synthetic: "合成資料",
  demo: "合成資料",
  imported: "匯入資料",
  live: "固定來源資料",
  live_snapshot: "官方每日行情快照",
};

export const sourceKindNames: Record<string, string> = {
  exchange_snapshot: "官方每日行情快照",
  news_index: "新聞索引",
  primary: "官方原始資料",
};

export const strategyNames: Record<string, string> = {
  buy_hold: "買進持有",
  sma: "均線趨勢",
  momentum: "動能",
};

export const strategyTitleNames: Record<string, string> = {
  buy_hold: "買進持有策略",
  sma: "均線趨勢策略",
  momentum: "動能策略",
};

export const numberFormat = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 });

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function numberOrMissing(value: unknown, digits = 2): string {
  if (!isFiniteNumber(value)) return "未提供";
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: digits }).format(value);
}

export function percentOrMissing(value: unknown, signed = false): string {
  if (!isFiniteNumber(value)) return "未提供";
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(value)}%`;
}

export function multipleOrMissing(value: unknown): string {
  return isFiniteNumber(value) ? `${numberOrMissing(value, 2)}×` : "未提供";
}

export function priceLabel(price: unknown, currency: unknown): string {
  if (!isFiniteNumber(price)) return "未提供";
  const money = typeof currency === "string" && currency.trim() ? currency.trim() : "未提供";
  return `${numberFormat.format(price)} ${money}`;
}

export function dateTimeLabel(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "未提供";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [yearText, monthText, dayText] = value.split("-");
    if (!yearText || !monthText || !dayText) return "未提供";
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    if (
      calendarDate.getUTCFullYear() !== year ||
      calendarDate.getUTCMonth() !== month - 1 ||
      calendarDate.getUTCDate() !== day
    ) return "未提供";
    return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeZone: "UTC" }).format(calendarDate);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "未提供";
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function dateLabel(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "未提供";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (!Number.isFinite(date.getTime())) return "未提供";
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium" }).format(date);
}

export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function sourceStatus(sourceOrStatus: Source | string | null | undefined): {
  kind: "connected" | "planned" | "error";
  label: string;
} {
  const value = typeof sourceOrStatus === "string" ? sourceOrStatus : sourceOrStatus?.status;
  const status = typeof value === "string" ? value.toLowerCase() : "";
  if (["ok", "connected", "available", "success", "ready"].includes(status)) {
    return { kind: "connected", label: "已連線" };
  }
  if (["not_requested", "not-requested"].includes(status)) {
    return { kind: "planned", label: "尚未請求" };
  }
  if (["planned", "not_configured", "not-configured", "missing", "disabled", "pending", "demo"].includes(status)) {
    return { kind: "planned", label: status === "demo" ? "示範資料" : "規劃中／未接通" };
  }
  if (["error", "failed", "unavailable", "timeout", "rate_limited"].includes(status)) {
    return { kind: "error", label: "取得失敗" };
  }
  return { kind: "planned", label: "狀態未提供" };
}

export function modeLabel(mode: DataMode): string {
  const labels: Record<DataMode, string> = {
    loading: "載入中",
    demo: "示範研究",
    live: "固定來源",
    error: "服務暫不可用",
  };
  return labels[mode];
}
