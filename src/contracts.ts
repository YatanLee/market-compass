export interface PriceBar {
  date: string;
  close: number;
}

export type Strategy = 'buy_hold' | 'sma' | 'momentum';
export type DataKind = 'synthetic' | 'imported' | 'live_snapshot';
export type MarketId = 'US' | 'TW' | 'FUND';
export type InstrumentType = 'stock' | 'etf' | 'fund';
export type EventCategory = 'policy' | 'influencer' | 'social' | 'macro';

export interface Instrument {
  symbol: string;
  name: string;
  market: MarketId;
  type: InstrumentType;
  currency: 'USD' | 'TWD';
  price: number;
  changePct: number | null;
  history: PriceBar[];
  dataKind: DataKind;
  asOf: string;
}

export interface ResearchEvent {
  id: string;
  title: string;
  category: EventCategory;
  sourceName: string;
  sourceUrl: string | null;
  publishedAt: string | null;
  observedAt: string | null;
  affectedSymbols: string[];
  stance: string;
  evidenceScore: number | null;
  reasons: string[];
  demo: boolean;
  sourceKind?: 'news_index' | 'primary';
}

export interface FixtureLookupResult {
  prices: PriceBar[];
  dataKind?: string;
  market?: string;
  type?: string;
}

export interface DashboardSource {
  id: string;
  name: string;
  status: 'demo' | 'not_requested' | 'ok' | 'error';
  url: string | null;
  description: string;
}

export interface Dashboard {
  mode: 'demo';
  asOf: string;
  generatedAt: string;
  instruments: Instrument[];
  events: ResearchEvent[];
  strategies: Array<{ id: Strategy; name: string; description: string; risk: string }>;
  sources: DashboardSource[];
  warnings: string[];
}
