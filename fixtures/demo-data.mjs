const BUSINESS_DAY_COUNT = 400;
const END_DATE = '2026-10-09';

function makeDates(count = BUSINESS_DAY_COUNT, endDate = END_DATE) {
  const dates = [];
  const cursor = new Date(`${endDate}T00:00:00.000Z`);
  while (dates.length < count) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates.reverse();
}

function makeHistory({ count, start, drift, volatility, phase }) {
  const dates = makeDates(count);
  return dates.map((date, index) => {
    const t = index;
    const cycle = 0.055 * Math.sin((t + phase) / 21)
      + 0.025 * Math.sin((t + phase * 2) / 7.3)
      + 0.012 * Math.cos((t + phase) / 3.1);
    const logReturn = drift * t / 252 + volatility * cycle;
    const close = Math.round(start * Math.exp(logReturn) * 100) / 100;
    return { date, close };
  });
}

const instrumentSpecs = [
  {
    symbol: 'SPY', name: '美國大型股示範 ETF', market: 'US', type: 'etf', currency: 'USD',
    start: 500, drift: 0.07, volatility: 0.72, phase: 2,
  },
  {
    symbol: 'AAPL', name: '美國科技股示範標的', market: 'US', type: 'stock', currency: 'USD',
    start: 210, drift: 0.09, volatility: 1.05, phase: 11,
  },
  {
    symbol: '0050.TW', name: '台灣大型股示範 ETF', market: 'TW', type: 'etf', currency: 'TWD',
    start: 190, drift: 0.08, volatility: 0.9, phase: 19,
  },
  {
    symbol: '2330.TW', name: '台灣科技股示範標的', market: 'TW', type: 'stock', currency: 'TWD',
    start: 980, drift: 0.11, volatility: 1.15, phase: 7,
  },
  {
    symbol: 'DEMO-FUND-TWD', name: '台幣基金淨值示範', market: 'FUND', type: 'fund', currency: 'TWD',
    start: 15, drift: 0.035, volatility: 0.28, phase: 31,
  },
];

export const demoInstruments = instrumentSpecs.map((spec) => {
  const history = makeHistory({ count: BUSINESS_DAY_COUNT, ...spec });
  const current = history.at(-1).close;
  const previous = history.at(-2).close;
  return {
    symbol: spec.symbol,
    name: `${spec.name}（合成資料）`,
    market: spec.market,
    type: spec.type,
    currency: spec.currency,
    price: current,
    changePct: Number(((current / previous - 1) * 100).toFixed(2)),
    history,
    dataKind: 'synthetic',
    asOf: history.at(-1).date,
  };
});

const eventRows = [
  {
    id: 'demo-policy-scenario',
    title: '示意情境：假設政策訊號出現變化',
    category: 'policy',
    stance: 'neutral',
    evidenceScore: 18,
    affectedSymbols: ['SPY', '0050.TW'],
    reasons: ['此為虛構情境，用來示範事件欄位。', '不代表真實政策消息，也不表示獲利機率。'],
  },
  {
    id: 'demo-macro-scenario',
    title: '示意情境：假設主要經濟指標波動擴大',
    category: 'macro',
    stance: 'watch',
    evidenceScore: 16,
    affectedSymbols: ['SPY', 'AAPL'],
    reasons: ['此為虛構情境，用來示範總經事件整理。', '沒有引用真實人物或真實新聞。'],
  },
  {
    id: 'demo-influencer-scenario',
    title: '示意情境：假設某公開帳號談及產業主題',
    category: 'influencer',
    stance: 'unclassified',
    evidenceScore: 8,
    affectedSymbols: ['AAPL', '2330.TW'],
    reasons: ['此為虛構情境，沒有指涉或引用真實人物。', '不代表已觀測到公開人物發言。'],
  },
  {
    id: 'demo-social-scenario',
    title: '示意情境：假設某產品討論短暫增加',
    category: 'social',
    stance: 'unclassified',
    evidenceScore: 5,
    affectedSymbols: ['0050.TW'],
    reasons: ['此為虛構情境，不是社群平台觀測數據。', '沒有用事件評分推估獲利機率。'],
  },
];

export function getDemoDashboard(now = new Date()) {
  const generatedAt = now.toISOString();
  return {
    mode: 'demo',
    asOf: demoInstruments[0].asOf,
    generatedAt,
    instruments: demoInstruments.map((instrument) => ({
      ...instrument,
      history: instrument.history.map((bar) => ({ ...bar })),
    })),
    events: eventRows.map((event) => ({
      ...event,
      sourceName: '本機合成情境',
      sourceUrl: null,
      publishedAt: null,
      observedAt: generatedAt,
      demo: true,
      reasons: [...event.reasons],
      affectedSymbols: [...event.affectedSymbols],
    })),
    strategies: [
      { id: 'buy_hold', name: '買進持有', description: '全程持有作為比較基準。', risk: 'exposure' },
      { id: 'sma', name: '均線趨勢', description: '價格高於回看均線時持有。', risk: 'exposure' },
      { id: 'momentum', name: '動能', description: '回看區間報酬為正時持有。', risk: 'exposure' },
    ],
    sources: [
      {
        id: 'synthetic',
        name: '本機合成資料',
        status: 'demo',
        url: null,
        description: '價格與示意事件均為合成資料，不能代表真實市場或新聞。',
      },
      {
        id: 'twse',
        name: '臺灣證券交易所',
        status: 'not_requested',
        url: 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
        description: '使用者主動更新時讀取快照，不是歷史價格資料。',
      },
      {
        id: 'gdelt',
        name: 'GDELT 新聞索引',
        status: 'not_requested',
        url: 'https://api.gdeltproject.org/api/v2/doc/doc',
        description: '使用者主動更新時查詢；索引發現時間不等同原文發布時間。',
      },
    ],
    warnings: [
      '本頁示範價格與事件皆為合成資料，不是即時行情或真實事件。',
      '歷史序列以平日產生，未納入各市場休市日；基金淨值頻率與配息也未模擬。',
      '尚未提供經調整收盤價或公司行動資料，不能據此宣稱總報酬。',
    ],
  };
}

export function getDemoPrices(symbol) {
  const instrument = demoInstruments.find((item) => item.symbol === symbol);
  return instrument?.history.map((bar) => ({ ...bar })) ?? null;
}
