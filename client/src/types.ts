export type DataMode = "loading" | "demo" | "live" | "error";
export type MarketId = "US" | "TW" | "FUND" | string;
export type InstrumentType = "stock" | "etf" | "fund" | string;
export type StrategyId = "buy_hold" | "sma" | "momentum";
export type ViewId = "overview" | "events" | "strategies" | "sources";

export interface PricePoint {
  date: string;
  close: number;
}

export interface Instrument {
  symbol: string;
  name: string;
  market: MarketId;
  type: InstrumentType;
  currency?: string | null;
  price: number | null;
  changePct: number | null;
  history?: PricePoint[];
  dataKind?: string;
  asOf?: string | null;
}

export interface ResearchEvent {
  id: string;
  title: string;
  category: string;
  sourceName?: string | null;
  sourceUrl?: string | null;
  sourceKind?: string | null;
  publishedAt?: string | null;
  observedAt?: string | null;
  affectedSymbols?: string[];
  stance?: string | null;
  evidenceScore?: number | null;
  reasons?: string[];
  demo?: boolean;
}

export interface Source {
  id: string;
  name: string;
  status: string;
  url?: string | null;
  sourceKind?: string | null;
  description?: string | null;
  asOf?: string | null;
  retrievedAt?: string | null;
  error?: string | null;
}

export interface DashboardPayload {
  mode: string;
  asOf?: string | null;
  generatedAt?: string | null;
  retrievedAt?: string | null;
  instruments?: Instrument[];
  events?: ResearchEvent[];
  sources?: Source[];
  warnings?: string[];
}

export interface BacktestRequest {
  symbol: string;
  strategy: StrategyId;
  lookback: number;
  feeBps: number;
  slippageBps: number;
  initialCapital: number;
  splitRatio: 0.7;
  prices?: PricePoint[];
}

export interface BacktestMetrics {
  totalReturnPct: number | null;
  annualizedReturnPct: number | null;
  maxDrawdownPct: number | null;
  volatilityPct: number | null;
  sharpe: number | null;
  turnover: number | null;
  trades: number | null;
}

export interface BacktestResult {
  symbol: string;
  strategy: StrategyId;
  dataKind?: string;
  metrics?: Partial<BacktestMetrics>;
  benchmark?: {
    totalReturnPct?: number | null;
    maxDrawdownPct?: number | null;
  };
  split?: {
    trainEnd?: string | null;
    testStart?: string | null;
    testEnd?: string | null;
    trainBars?: number | null;
    testBars?: number | null;
  };
  curve?: Array<{
    date: string;
    equity: number;
    benchmark: number;
    position?: number;
  }>;
  warnings?: Array<string | { message?: string }>;
  assumptions?: string[];
}

export interface BacktestSnapshot {
  request: BacktestRequest;
  dataKind: string;
  priceProvenance: "synthetic" | "live" | "imported";
  importedFileName: string | null;
  symbolIdentity: "unverified" | "listed_instrument";
  inputPriceCount: number;
  priceDateRange: { start: string | null; end: string | null };
}
