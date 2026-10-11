import type { FixtureLookupResult, PriceBar, Strategy } from './contracts.js';

const MIN_HISTORY_BARS = 100;
const MIN_TRAIN_BARS = 70;
const MIN_TEST_BARS = 30;
const MAX_PRICE_ROWS = 5000;
const MAX_LOOKBACK = 252;
const ANNUAL_BARS = 252;
const REQUIRED_TRAIN_RATIO = 0.7;

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

interface SimulationPoint {
  date: string;
  equity: number | null;
  position: number;
  _turnover: number;
  _netReturn: number;
}

interface Simulation {
  equity: number;
  maxDrawdownPct: number;
  turnover: number;
  trades: number;
  dailyReturns: number[];
  curve: SimulationPoint[];
}

export interface BacktestMetrics {
  totalReturnPct: number | null;
  annualizedReturnPct: number | null;
  maxDrawdownPct: number | null;
  volatilityPct: number | null;
  sharpe: number | null;
  turnover: number | null;
  trades: number;
}

export interface BacktestInput {
  symbol: unknown;
  strategy: unknown;
  lookback: unknown;
  feeBps: unknown;
  slippageBps: unknown;
  initialCapital: unknown;
  splitRatio: unknown;
  prices?: unknown;
}

export interface BacktestOptions {
  fixtureLookup?: (symbol: string) => FixtureLookupResult | null | undefined;
}

function requireNumber(
  value: unknown,
  label: string,
  min: number,
  max: number,
  { integer = false }: { integer?: boolean } = {},
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new InputError(`${label}須介於 ${min} 與 ${max}。`);
  }
  if (integer && !Number.isInteger(value)) throw new InputError(`${label}須為整數。`);
  return value;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validatePriceRows(rows: unknown): PriceBar[] {
  if (!Array.isArray(rows)) throw new InputError('價格資料必須是日期與收盤價清單。');
  if (rows.length > MAX_PRICE_ROWS) throw new InputError(`價格資料最多 ${MAX_PRICE_ROWS} 筆。`);
  if (rows.length < MIN_HISTORY_BARS) throw new InputError(`至少需要 ${MIN_HISTORY_BARS} 筆價格資料，才能保留足夠的樣本內外區間。`);

  let previousDate = '';
  return rows.map((row: unknown, index: number): PriceBar => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new InputError(`第 ${index + 1} 筆資料格式錯誤。`);
    }
    const record = row as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== 'date' && key !== 'close')) {
      throw new InputError(`第 ${index + 1} 筆資料格式錯誤。`);
    }
    if (!isIsoDate(record.date)) throw new InputError(`第 ${index + 1} 筆日期必須是有效的 YYYY-MM-DD。`);
    if (record.date <= previousDate) throw new InputError('價格日期必須依時間遞增且不得重複。');
    if (typeof record.close !== 'number' || !Number.isFinite(record.close) || record.close < 1e-12 || record.close > 1e12) {
      throw new InputError(`第 ${index + 1} 筆收盤價必須介於 0.000000000001 與 1,000,000,000,000。`);
    }
    previousDate = record.date;
    return { date: record.date, close: record.close };
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function round(value: number | null, places = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function dataWarnings(prices: PriceBar[], isFund: boolean): string[] {
  const gaps: number[] = [];
  for (let i = 1; i < prices.length; i += 1) {
    const previous = Date.parse(`${prices[i - 1]!.date}T00:00:00Z`);
    const current = Date.parse(`${prices[i]!.date}T00:00:00Z`);
    gaps.push((current - previous) / 86_400_000);
  }
  const typicalGap = median(gaps);
  const irregular = gaps.some((gap) => gap > Math.max(14, typicalGap * 2.5));
  const warnings = [
    '回測只反映收盤價序列；未確認是否為調整後價格，拆股、配息與其他公司行動可能使結果偏離總報酬。',
    '日期間隔以每一列作為一根資料棒年化，使用 252 根假設；未補入交易所休市日。',
  ];
  if (typicalGap > 4) {
    warnings.push(`日期間隔中位數約 ${round(typicalGap, 1)} 日；資料可能是週頻或月頻，仍以 252 根資料棒年化。`);
  }
  if (irregular) warnings.push('價格日期間隔不規則；年化與波動估計可能不適用於此資料頻率。');
  if (isFund) warnings.push('基金資料以淨值為基礎；頻率、申贖費與配息再投入未納入。');
  return warnings;
}

function positionAt(strategy: Strategy, prices: PriceBar[], returnIndex: number, lookback: number): number {
  if (strategy === 'buy_hold') return 1;
  const signalIndex = returnIndex - 2;
  if (signalIndex < 0) return 0;
  if (strategy === 'sma') {
    const first = signalIndex - lookback + 1;
    if (first < 0) return 0;
    let total = 0;
    for (let i = first; i <= signalIndex; i += 1) total += prices[i]!.close;
    return prices[signalIndex]!.close > total / lookback ? 1 : 0;
  }
  const baseIndex = signalIndex - lookback;
  if (baseIndex < 0) return 0;
  return prices[signalIndex]!.close > prices[baseIndex]!.close ? 1 : 0;
}

function simulate(
  prices: PriceBar[],
  indices: number[],
  strategy: Strategy,
  lookback: number,
  initialCapital: number,
  costRate: number,
): Simulation {
  let equity = initialCapital;
  let peak = initialCapital;
  let maxDrawdownPct = 0;
  let previousPosition = 0;
  let turnover = 0;
  let trades = 0;
  const dailyReturns: number[] = [];
  const curve: SimulationPoint[] = [];

  for (const index of indices) {
    const position = positionAt(strategy, prices, index, lookback);
    const tradeTurnover = Math.abs(position - previousPosition);
    if (tradeTurnover > 0) trades += 1;
    turnover += tradeTurnover;
    const grossReturn = prices[index]!.close / prices[index - 1]!.close - 1;
    const costFactor = Math.max(0, 1 - tradeTurnover * costRate);
    const netReturn = costFactor * (1 + grossReturn * position) - 1;
    const nextEquity = equity * (1 + netReturn);
    if (!Number.isFinite(grossReturn) || !Number.isFinite(netReturn) || !Number.isFinite(nextEquity)) {
      throw new InputError('價格序列造成數值溢位；請檢查極端價格變化後再試。');
    }
    equity = nextEquity;
    dailyReturns.push(netReturn);
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.min(maxDrawdownPct, (equity / peak - 1) * 100);
    curve.push({
      date: prices[index]!.date,
      equity: round(equity, 6),
      position,
      _turnover: tradeTurnover,
      _netReturn: netReturn,
    });
    previousPosition = position;
  }

  return { equity, maxDrawdownPct, turnover, trades, dailyReturns, curve };
}

function metricsFor(simulation: Simulation, initialCapital: number): BacktestMetrics {
  const totalReturnPct = (simulation.equity / initialCapital - 1) * 100;
  const periods = simulation.dailyReturns.length;
  const annualizedReturnPct = periods > 0 && simulation.equity > 0
    ? (Math.pow(simulation.equity / initialCapital, ANNUAL_BARS / periods) - 1) * 100
    : null;
  const mean = periods ? simulation.dailyReturns.reduce((sum, value) => sum + value, 0) / periods : null;
  const variance = periods > 1 && mean !== null
    ? simulation.dailyReturns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (periods - 1)
    : null;
  const standardDeviation = variance === null ? null : Math.sqrt(variance);
  const volatilityPct = standardDeviation !== null ? standardDeviation * Math.sqrt(ANNUAL_BARS) * 100 : null;
  const sharpe = standardDeviation !== null && standardDeviation > 0 && mean !== null
    ? (mean / standardDeviation) * Math.sqrt(ANNUAL_BARS)
    : null;
  for (const value of [totalReturnPct, annualizedReturnPct, simulation.maxDrawdownPct, volatilityPct, sharpe, simulation.turnover]) {
    if (value !== null && !Number.isFinite(value)) {
      throw new InputError('回測指標超出數值範圍；請檢查價格變化或本金設定。');
    }
  }
  return {
    totalReturnPct: round(totalReturnPct),
    annualizedReturnPct: round(annualizedReturnPct),
    maxDrawdownPct: round(simulation.maxDrawdownPct),
    volatilityPct: round(volatilityPct),
    sharpe: round(sharpe),
    turnover: round(simulation.turnover, 4),
    trades: simulation.trades,
  };
}

function isStrategy(value: unknown): value is Strategy {
  return value === 'buy_hold' || value === 'sma' || value === 'momentum';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function runBacktest(input: unknown, { fixtureLookup }: BacktestOptions = {}) {
  if (!isRecord(input)) throw new InputError('請提供回測設定。');
  const symbol = input.symbol;
  if (typeof symbol !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,31}$/.test(symbol)) {
    throw new InputError('標的代碼格式錯誤。');
  }
  const strategyValue = input.strategy;
  if (!isStrategy(strategyValue)) throw new InputError('不支援這項策略。');
  const strategy = strategyValue;
  const lookback = requireNumber(input.lookback, '回看期間', 5, MAX_LOOKBACK, { integer: true });
  const feeBps = requireNumber(input.feeBps, '手續費', 0, 500);
  const slippageBps = requireNumber(input.slippageBps, '滑價', 0, 500);
  if (feeBps + slippageBps > 1000) throw new InputError('手續費與滑價合計不得超過 1,000 bps。');
  const initialCapital = requireNumber(input.initialCapital, '研究本金', 1, 1_000_000_000);
  const splitRatio = requireNumber(input.splitRatio, '訓練比例', REQUIRED_TRAIN_RATIO, REQUIRED_TRAIN_RATIO);

  let prices: PriceBar[];
  let dataKind: string;
  let isFund = false;
  const fixture = fixtureLookup?.(symbol);
  if (input.prices === undefined) {
    if (!fixture) throw new InputError('找不到此示範標的；請選擇清單中的標的或匯入價格資料。');
    prices = validatePriceRows(fixture.prices);
    dataKind = fixture.dataKind ?? 'synthetic';
    isFund = fixture.market === 'FUND' || fixture.type === 'fund';
  } else {
    prices = validatePriceRows(input.prices);
    dataKind = 'imported';
    isFund = fixture?.market === 'FUND' || fixture?.type === 'fund';
  }

  const splitIndex = Math.floor(prices.length * splitRatio);
  const trainBars = splitIndex;
  const testBars = prices.length - splitIndex;
  if (trainBars < MIN_TRAIN_BARS || testBars < MIN_TEST_BARS) {
    throw new InputError(`樣本切分至少需要 ${MIN_TRAIN_BARS} 根訓練資料及 ${MIN_TEST_BARS} 根樣本外資料。`);
  }
  if (lookback + 3 > trainBars) {
    throw new InputError(`回看期間不得超過訓練資料可支援的上限（${trainBars - 3} 根）。`);
  }

  const testIndices = Array.from({ length: testBars }, (_, offset) => splitIndex + offset);
  const costRate = (feeBps + slippageBps) / 10_000;
  const strategyRun = simulate(prices, testIndices, strategy, lookback, initialCapital, costRate);
  const benchmarkRun = simulate(prices, testIndices, 'buy_hold', lookback, initialCapital, costRate);
  const strategyMetrics = metricsFor(strategyRun, initialCapital);
  const benchmarkMetrics = metricsFor(benchmarkRun, initialCapital);
  const curve = strategyRun.curve.map((point, index) => ({
    date: point.date,
    equity: point.equity,
    benchmark: benchmarkRun.curve[index]!.equity,
    position: point.position,
  }));
  return {
    symbol,
    strategy,
    dataKind,
    metrics: strategyMetrics,
    benchmark: {
      totalReturnPct: benchmarkMetrics.totalReturnPct,
      maxDrawdownPct: benchmarkMetrics.maxDrawdownPct,
    },
    split: {
      trainEnd: prices[splitIndex - 1]!.date,
      testStart: prices[splitIndex]!.date,
      testEnd: prices.at(-1)!.date,
      trainBars,
      testBars,
    },
    curve,
    warnings: [
      ...dataWarnings(prices, isFund),
      ...(dataKind === 'imported' ? ['匯入價格的標的身分未驗證；回測結果只對這組價格序列成立。'] : []),
    ],
    assumptions: [
      '依日期排序後以固定 70% 訓練、30% 樣本外區間計算；策略、基準與曲線使用同一段樣本外期間。',
      '策略訊號使用收盤價索引 i-2，決定 close[i-1] 至 close[i] 這段報酬的曝險，延遲一根完整收盤資料。',
      '手續費與滑價在初始進場及曝險變動時，按換手率同樣套用於策略和基準。',
      '交易次數是多頭與現金曝險切換次數；進場與退出各計一次。',
      '年化使用 252 根資料棒，Sharpe 使用零無風險利率；此值不是獲利機率。',
      '只計算多頭或現金曝險，不計稅、融資、流動性、追蹤誤差或基金申贖條件。',
    ],
  };
}
