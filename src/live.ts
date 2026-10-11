import { createHash } from 'node:crypto';
import type { EventCategory } from './contracts.js';

export const TWSE_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
export const GDELT_URL = 'https://api.gdeltproject.org/api/v2/doc/doc?query=(Trump%20OR%20%22Federal%20Reserve%22%20OR%20Powell%20OR%20Buffett%20OR%20Musk%20OR%20tariff)%20(stock%20OR%20market%20OR%20Taiwan)&mode=artlist&format=json&maxrecords=40&timespan=1d&sort=datedesc';
export const FEDERAL_RESERVE_URL = 'https://www.federalreserve.gov/feeds/speeches.xml';
export const WHITEHOUSE_URL = 'https://www.whitehouse.gov/remarks/';

type SourceId = 'twse' | 'gdelt' | 'federal_reserve' | 'whitehouse';
type SourceKind = 'exchange_snapshot' | 'news_index' | 'primary';
type SourceFormat = 'json' | 'text';
type LiveCategory = EventCategory;

interface SourceConfig {
  name: string;
  url: string;
  sourceKind: SourceKind;
  format: SourceFormat;
  description: string;
}

interface TwseInstrument {
  symbol: string;
  name: string;
  market: 'TW';
  type: 'etf' | 'stock';
  currency: 'TWD';
  price: number;
  changePct: number | null;
  history: [];
  dataKind: 'live_snapshot';
  asOf: string | null;
}

interface TwseResult {
  instruments: TwseInstrument[];
  asOf: string | null;
}

interface LiveEvent {
  id: string;
  title: string;
  category: LiveCategory;
  sourceName: string;
  sourceUrl: string;
  sourceKind: 'news_index' | 'primary';
  publishedAt: string | null;
  observedAt: string | null;
  affectedSymbols: string[];
  stance: 'unclassified';
  evidenceScore: null;
  reasons: string[];
  demo: false;
}

interface LiveSource {
  id: SourceId;
  name: string;
  status: 'ok' | 'error';
  url: string;
  sourceKind: SourceKind;
  description: string;
  asOf: string | null;
  retrievedAt: string;
  error?: string;
}

interface SourceResult {
  source: LiveSource;
  value: TwseResult | LiveEvent[];
}

interface LiveSnapshot {
  mode: 'live';
  retrievedAt: string;
  instruments: TwseInstrument[];
  events: LiveEvent[];
  sources: LiveSource[];
  warnings: string[];
}

interface LiveReaderOptions {
  fetchImpl?: typeof globalThis.fetch;
  now?: () => Date;
  timeoutMs?: number;
  cacheTtlMs?: number;
  maxExternalBytes?: number;
}

interface SourceRecord {
  inflight: Promise<SourceResult> | null;
  cachedAt: number;
  result: SourceResult | null;
}

const SOURCE_CONFIG: Record<SourceId, SourceConfig> = {
  twse: {
    name: '臺灣證券交易所',
    url: TWSE_URL,
    sourceKind: 'exchange_snapshot',
    format: 'json',
    description: 'TWSE 當日行情快照；不提供歷史價格序列。',
  },
  gdelt: {
    name: 'GDELT 新聞索引',
    url: GDELT_URL,
    sourceKind: 'news_index',
    format: 'json',
    description: 'GDELT 新聞索引結果；發現時間不代表原文發布時間。',
  },
  federal_reserve: {
    name: 'Federal Reserve 演說',
    url: FEDERAL_RESERVE_URL,
    sourceKind: 'primary',
    format: 'text',
    description: '官方 RSS 標題與連結；發布時間僅在 RSS 明確提供時顯示。',
  },
  whitehouse: {
    name: 'The White House 公開談話',
    url: WHITEHOUSE_URL,
    sourceKind: 'primary',
    format: 'text',
    description: '官方頁面中的 remarks 與 videos 標題連結；不取得影片或逐字稿。',
  },
};

const MAX_EXTERNAL_BYTES = 2 * 1024 * 1024;
const MAX_PRIMARY_FIRST_SEEN = 5_000;
const CACHE_TTL_MS = 60_000;
const WATCHLIST = new Map<string, { symbol: string; type: 'etf' | 'stock' }>([
  ['0050', { symbol: '0050.TW', type: 'etf' }],
  ['2330', { symbol: '2330.TW', type: 'stock' }],
]);

class SourceError extends Error {
  constructor(message: string, readonly kind: 'unavailable' | 'invalid_data' | 'http' | 'timeout' | 'too_large' = 'unavailable') {
    super(message);
    this.name = 'SourceError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '--' || trimmed === '-') return null;
  const parsed = Number(trimmed.replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTwseDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match) {
    const candidate = `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(`${candidate}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate ? candidate : null;
  }
  match = /^(\d{2,4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  let year = Number(match[1]);
  if (year < 1911) year += 1911;
  const candidate = `${String(year).padStart(4, '0')}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate ? candidate : null;
}

function parseTwse(payload: unknown): TwseResult {
  if (!Array.isArray(payload)) throw new SourceError('來源回傳格式無法辨識。', 'invalid_data');
  const rows: unknown[] = payload;
  const byCode = new Map<string, TwseInstrument>();
  const dates: string[] = [];
  for (const candidate of rows) {
    if (!isRecord(candidate)) continue;
    const date = parseTwseDate(candidate.Date ?? candidate.TradeDate ?? candidate.TradeDateTime);
    if (date) dates.push(date);
    const watch = WATCHLIST.get(String(candidate.Code ?? '').trim());
    const price = parseNumber(candidate.ClosingPrice);
    if (!watch || price === null || price <= 0) continue;
    const change = parseNumber(candidate.Change);
    const previous = change === null ? null : price - change;
    const changePct = previous !== null && previous > 0 ? ((price / previous) - 1) * 100 : null;
    const name = typeof candidate.Name === 'string' && candidate.Name.trim().length <= 100
      ? candidate.Name.trim()
      : (watch.symbol === '0050.TW' ? '台灣大型股 ETF' : '台灣科技股');
    byCode.set(watch.symbol, {
      symbol: watch.symbol,
      name,
      market: 'TW',
      type: watch.type,
      currency: 'TWD',
      price,
      changePct: changePct === null || !Number.isFinite(changePct) ? null : Number(changePct.toFixed(2)),
      history: [],
      dataKind: 'live_snapshot',
      asOf: date,
    });
  }
  return { instruments: [...byCode.values()], asOf: dates.sort().at(-1) ?? null };
}

function parseSeenDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  let normalized = value;
  if (compact) normalized = `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}.000Z`;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function safeArticleUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return value;
  } catch {
    return null;
  }
}

function classifyTitle(title: string): LiveCategory {
  const normalized = title.toLocaleLowerCase();
  if (/\b(trump|tariff|white house|president)\b|關稅|政策|白宮|總統/.test(normalized)) return 'policy';
  if (/\b(powell|buffett|musk)\b|鮑爾|巴菲特|馬斯克/.test(normalized)) return 'influencer';
  return 'macro';
}

function parseGdelt(payload: unknown): LiveEvent[] {
  if (!isRecord(payload) || !Array.isArray(payload.articles)) {
    throw new SourceError('來源回傳格式無法辨識。', 'invalid_data');
  }
  const events: LiveEvent[] = [];
  for (const articleValue of payload.articles.slice(0, 40) as unknown[]) {
    if (!isRecord(articleValue)) continue;
    const url = safeArticleUrl(articleValue.url);
    const title = typeof articleValue.title === 'string' ? articleValue.title : '';
    if (!url || !title || title.length > 500) continue;
    const observedAt = parseSeenDate(articleValue.seendate);
    const sourceName = new URL(url).hostname;
    const digest = createHash('sha256').update(url).digest('hex').slice(0, 16);
    events.push({
      id: `gdelt-${digest}`,
      title,
      category: classifyTitle(title),
      sourceName,
      sourceUrl: url,
      sourceKind: 'news_index',
      publishedAt: null,
      observedAt,
      affectedSymbols: [],
      stance: 'unclassified',
      evidenceScore: null,
      reasons: [
        '此項目來自 GDELT 新聞索引；尚未獨立查證標題內容。',
        'GDELT seendate 表示索引發現時間，不是原文發布時間。',
        '類別只依標題關鍵字主題分類，未驗證原始發言；不推估獲利機率。',
      ],
      demo: false,
    });
  }
  return events;
}

function decodeBasicEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_match: string, entityValue: string) => {
    const lowered = entityValue.toLowerCase();
    if (lowered === 'amp') return '&';
    if (lowered === 'lt') return '<';
    if (lowered === 'gt') return '>';
    if (lowered === 'quot') return '"';
    if (lowered === 'apos') return "'";
    if (lowered === 'nbsp') return '\u00a0';
    const codePoint = lowered.startsWith('#x') ? Number.parseInt(lowered.slice(2), 16) : Number.parseInt(lowered.slice(1), 10);
    if (!Number.isInteger(codePoint) || codePoint < 1 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return '\ufffd';
    return String.fromCodePoint(codePoint);
  });
}

function extractXmlText(block: string, tagName: string): string | null {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}\\s*>`, 'i');
  const match = pattern.exec(block);
  if (!match?.[1]) return null;
  let value = match[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(value);
  if (cdata?.[1]) value = cdata[1];
  else if (/[<>]/.test(value)) return null;
  return decodeBasicEntities(value).replace(/\s+/g, ' ').trim();
}

function officialHttpsUrl(value: string | null, hostname: string, baseUrl: string): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function parsePublicationDate(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function primaryEvent({
  idPrefix,
  url,
  title,
  sourceName,
  category,
  publishedAt,
  observedAt,
  reason,
}: {
  idPrefix: 'fed' | 'whitehouse';
  url: string;
  title: string;
  sourceName: string;
  category: LiveCategory;
  publishedAt: string | null;
  observedAt: string;
  reason: string;
}): LiveEvent {
  const digest = createHash('sha256').update(url).digest('hex').slice(0, 16);
  return {
    id: `${idPrefix}-${digest}`,
    title,
    category,
    sourceName,
    sourceUrl: url,
    sourceKind: 'primary',
    publishedAt,
    observedAt,
    affectedSymbols: [],
    stance: 'unclassified',
    evidenceScore: null,
    reasons: [reason, '未推估價格方向、獲利機率或因果關係。'],
    demo: false,
  };
}

function parseFederalReserveFeed(xmlValue: unknown, retrievedAt: string): LiveEvent[] {
  if (typeof xmlValue !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(xmlValue) || !/<rss\b/i.test(xmlValue)) {
    throw new SourceError('Federal Reserve RSS 結構無法辨識。', 'invalid_data');
  }
  const items = [...xmlValue.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)].slice(0, 40);
  if (!items.length) throw new SourceError('Federal Reserve RSS 沒有符合預期的 item。', 'invalid_data');
  const events: LiveEvent[] = [];
  for (const itemMatch of items) {
    const item = itemMatch[1] ?? '';
    const title = extractXmlText(item, 'title');
    const linkText = extractXmlText(item, 'link');
    if (!title || title.length > 500 || !linkText) continue;
    const url = officialHttpsUrl(linkText, 'www.federalreserve.gov', 'https://www.federalreserve.gov/');
    if (!url) continue;
    events.push(primaryEvent({
      idPrefix: 'fed',
      url,
      title,
      sourceName: 'Federal Reserve',
      category: 'influencer',
      publishedAt: parsePublicationDate(extractXmlText(item, 'pubDate')),
      observedAt: retrievedAt,
      reason: '來自 Federal Reserve 官方演說 RSS；觀察時間為本機首次取得時間，僅保留 RSS 標題與連結，重啟後會重設。',
    }));
  }
  if (!events.length) throw new SourceError('Federal Reserve RSS 項目欄位或官方連結無法辨識。', 'invalid_data');
  return events;
}

function stripHtmlText(value: string): string {
  return decodeBasicEntities(value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function meaningfulWhiteHouseTitle(value: string): boolean {
  const title = value.trim();
  if (title.length < 12 || title.length > 300) return false;
  if (/^(home|remarks|videos|news|briefings|watch|read more|more|the white house)$/i.test(title)) return false;
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(title)) return false;
  if (/^(?:\d{1,2}[/-]){2}\d{2,4}$/.test(title) || /^[A-Za-z]+ \d{1,2}, \d{4}$/.test(title)) return false;
  return title.split(/\s+/).length >= 3;
}

function parseWhiteHouseRemarks(htmlValue: unknown, retrievedAt: string): LiveEvent[] {
  if (typeof htmlValue !== 'string' || !/<html\b|<main\b|<a\b/i.test(htmlValue)) {
    throw new SourceError('White House remarks 頁面結構無法辨識。', 'invalid_data');
  }
  const anchors = [...htmlValue.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)];
  const seen = new Set<string>();
  const events: LiveEvent[] = [];
  for (const anchorMatch of anchors) {
    const attributes = anchorMatch[1] ?? '';
    const innerHtml = anchorMatch[2] ?? '';
    const href = /\bhref\s*=\s*(["'])(.*?)\1/i.exec(attributes)?.[2];
    if (!href) continue;
    const url = officialHttpsUrl(href, 'www.whitehouse.gov', WHITEHOUSE_URL);
    if (!url) continue;
    const pathname = new URL(url).pathname;
    if (!(pathname.startsWith('/videos/') || /^\/remarks\/\d{4}\//.test(pathname))) continue;
    if (seen.has(url)) continue;
    const title = stripHtmlText(innerHtml);
    if (!meaningfulWhiteHouseTitle(title)) continue;
    seen.add(url);
    events.push(primaryEvent({
      idPrefix: 'whitehouse',
      url,
      title,
      sourceName: 'The White House',
      category: 'policy',
      publishedAt: null,
      observedAt: retrievedAt,
      reason: '來自 White House 官方 remarks 頁面；頁面未提供可確認的原文發布時間，觀察時間為本機首次取得時間，重啟後會重設。',
    }));
    if (events.length >= 20) break;
  }
  if (!events.length) throw new SourceError('White House 頁面沒有符合預期的 remarks 或 videos 標題連結。', 'invalid_data');
  return events;
}

async function readTextBounded(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new SourceError('來源資料超過安全讀取上限。', 'too_large');
  }
  const body = response.body;
  if (!body) throw new SourceError('來源回應沒有可讀取的內容。', 'invalid_data');
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new SourceError('來源資料超過安全讀取上限。', 'too_large');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
  } catch {
    throw new SourceError('來源回傳的文字編碼無法辨識。', 'invalid_data');
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SourceError('來源回傳的 JSON 格式無法辨識。', 'invalid_data');
  }
}

type SourceParser = (payload: unknown, retrievedAt: string) => TwseResult | LiveEvent[];
const SOURCE_PARSERS: Record<SourceId, SourceParser> = {
  twse: (payload) => parseTwse(payload),
  gdelt: (payload) => parseGdelt(payload),
  federal_reserve: parseFederalReserveFeed,
  whitehouse: parseWhiteHouseRemarks,
};

function sourceAsOf(id: SourceId, value: TwseResult | LiveEvent[]): string | null {
  if (id === 'twse') return (value as TwseResult).asOf;
  if (id === 'gdelt') return (value as LiveEvent[]).map((event) => event.observedAt).filter((date): date is string => Boolean(date)).sort().at(-1) ?? null;
  if (id === 'federal_reserve') return (value as LiveEvent[]).map((event) => event.publishedAt).filter((date): date is string => Boolean(date)).sort().at(-1) ?? null;
  return null;
}

function emptySourceValue(id: SourceId): TwseResult | LiveEvent[] {
  return id === 'twse' ? { instruments: [], asOf: null } : [];
}

function recordPrimaryFirstSeen(events: LiveEvent[], retrievedAt: string, firstSeen: Map<string, string>): LiveEvent[] {
  return events.map((event) => {
    const existing = firstSeen.get(event.id);
    if (existing) return { ...event, observedAt: existing };
    if (firstSeen.size < MAX_PRIMARY_FIRST_SEEN) {
      firstSeen.set(event.id, retrievedAt);
      return { ...event, observedAt: retrievedAt };
    }
    return {
      ...event,
      observedAt: null,
      reasons: [
        '本機首次觀察時間未知：程序內的來源事件保留容量已滿。',
        ...event.reasons.slice(1),
      ],
    };
  });
}

function errorFor(error: unknown): string {
  if (error instanceof SourceError) {
    if (error.kind === 'timeout') return '來源連線逾時（10 秒）。';
    if (error.kind === 'too_large' || error.kind === 'invalid_data') return error.message;
    if (error.kind === 'http') {
      const status = Number(error.message);
      return Number.isInteger(status) && status >= 100 && status <= 599
        ? `來源回傳 HTTP ${status}。`
        : '來源暫時無法讀取（HTTP 回應異常）。';
    }
  }
  return '來源暫時無法讀取。';
}

export function createLiveReader({
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  timeoutMs = 10_000,
  cacheTtlMs = CACHE_TTL_MS,
  maxExternalBytes = MAX_EXTERNAL_BYTES,
}: LiveReaderOptions = {}): () => Promise<LiveSnapshot> {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  const state = new Map<SourceId, SourceRecord>(
    (Object.keys(SOURCE_CONFIG) as SourceId[]).map((id) => [id, { inflight: null, cachedAt: 0, result: null }]),
  );
  const primaryFirstSeen = new Map<string, string>();

  async function fetchResource(config: SourceConfig): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const operation = (async (): Promise<unknown> => {
      let response: Response;
      try {
        response = await fetchImpl(config.url, {
          method: 'GET',
          headers: { accept: config.format === 'json' ? 'application/json' : 'application/rss+xml, application/xml, text/html;q=0.9' },
          redirect: 'error',
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) throw new SourceError('timeout', 'timeout');
        throw new SourceError('unavailable');
      }
      if (!response.ok) throw new SourceError(String(response.status), 'http');
      const text = await readTextBounded(response, maxExternalBytes);
      return config.format === 'json' ? parseJson(text) : text;
    })();
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new SourceError('timeout', 'timeout'));
      }, timeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function getSource(id: SourceId): Promise<SourceResult> {
    const config = SOURCE_CONFIG[id];
    const record = state.get(id)!;
    const nowMs = now().getTime();
    if (record.inflight) return record.inflight;
    if (record.result && nowMs - record.cachedAt < cacheTtlMs) return Promise.resolve(record.result);

    record.inflight = (async (): Promise<SourceResult> => {
      let result: SourceResult;
      try {
        const payload = await fetchResource(config);
        const retrievedAt = now().toISOString();
        let value = SOURCE_PARSERS[id](payload, retrievedAt);
        if (config.sourceKind === 'primary') value = recordPrimaryFirstSeen(value as LiveEvent[], retrievedAt, primaryFirstSeen);
        result = {
          source: {
            id,
            name: config.name,
            status: 'ok',
            url: config.url,
            sourceKind: config.sourceKind,
            description: config.description,
            asOf: sourceAsOf(id, value),
            retrievedAt,
          },
          value,
        };
      } catch (error: unknown) {
        const retrievedAt = now().toISOString();
        result = {
          source: {
            id,
            name: config.name,
            status: 'error',
            url: config.url,
            sourceKind: config.sourceKind,
            description: config.description,
            asOf: null,
            retrievedAt,
            error: errorFor(error),
          },
          value: emptySourceValue(id),
        };
      }
      record.cachedAt = now().getTime();
      record.result = result;
      return result;
    })().finally(() => {
      record.inflight = null;
    });
    return record.inflight;
  }

  return async function getLiveSnapshot(): Promise<LiveSnapshot> {
    const [twse, gdelt, federalReserve, whitehouse] = await Promise.all([
      getSource('twse'),
      getSource('gdelt'),
      getSource('federal_reserve'),
      getSource('whitehouse'),
    ]);
    const sourceResults = [twse, gdelt, federalReserve, whitehouse];
    const warnings = [
      '即時來源為 TWSE 行情快照、GDELT 新聞索引、Federal Reserve RSS 與 White House 公開談話頁；來源失敗時不補入合成資料。',
      '新聞索引與官方標題只提供情境；不代表原始發言已查證，也不推估價格方向、獲利機率或因果關係。',
      'TWSE 回傳的是當日快照，不是價格歷史；GDELT 的發現時間不等於原文發布時間。Fed 發布時間只在 RSS 明確提供時顯示，White House 頁未提供可確認時間時維持未知。',
    ];
    for (const { source } of sourceResults) {
      if (source.status === 'error') warnings.push(`${source.name}目前無法使用；請查看來源狀態。`);
    }
    if (twse.source.status === 'ok' && (twse.value as TwseResult).instruments.length === 0) {
      warnings.push('TWSE 快照中沒有符合本機示範清單的 0050 或 2330 資料。');
    }
    const retrievedAt = sourceResults.map(({ source }) => source.retrievedAt).filter(Boolean).sort().at(-1) ?? now().toISOString();
    return {
      mode: 'live',
      retrievedAt,
      instruments: (twse.value as TwseResult).instruments,
      events: [
        ...(gdelt.value as LiveEvent[]),
        ...(federalReserve.value as LiveEvent[]),
        ...(whitehouse.value as LiveEvent[]),
      ],
      sources: sourceResults.map(({ source }) => source),
      warnings,
    };
  };
}
