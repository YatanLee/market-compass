import { createHash } from 'node:crypto';

export const TWSE_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
export const GDELT_URL = 'https://api.gdeltproject.org/api/v2/doc/doc?query=(Trump%20OR%20%22Federal%20Reserve%22%20OR%20Powell%20OR%20Buffett%20OR%20Musk%20OR%20tariff)%20(stock%20OR%20market%20OR%20Taiwan)&mode=artlist&format=json&maxrecords=40&timespan=1d&sort=datedesc';
export const FEDERAL_RESERVE_URL = 'https://www.federalreserve.gov/feeds/speeches.xml';
export const WHITEHOUSE_URL = 'https://www.whitehouse.gov/remarks/';

const SOURCE_CONFIG = {
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
const WATCHLIST = new Map([
  ['0050', { symbol: '0050.TW', type: 'etf' }],
  ['2330', { symbol: '2330.TW', type: 'stock' }],
]);

class SourceError extends Error {
  constructor(message, kind = 'unavailable') {
    super(message);
    this.kind = kind;
  }
}

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '--' || trimmed === '-') return null;
  const parsed = Number(trimmed.replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTwseDate(value) {
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

function parseTwse(payload) {
  if (!Array.isArray(payload)) throw new SourceError('來源回傳格式無法辨識。', 'invalid_data');
  const byCode = new Map();
  const dates = [];
  for (const row of payload) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const date = parseTwseDate(row.Date ?? row.TradeDate ?? row.TradeDateTime);
    if (date) dates.push(date);
    const watch = WATCHLIST.get(String(row.Code ?? '').trim());
    const price = parseNumber(row.ClosingPrice);
    if (!watch || price === null || price <= 0) continue;
    const change = parseNumber(row.Change);
    const previous = change === null ? null : price - change;
    const changePct = previous && previous > 0 ? ((price / previous) - 1) * 100 : null;
    const name = typeof row.Name === 'string' && row.Name.trim().length <= 100
      ? row.Name.trim()
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

function parseSeenDate(value) {
  if (typeof value !== 'string') return null;
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  let normalized = value;
  if (compact) normalized = `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}.000Z`;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function safeArticleUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return value;
  } catch {
    return null;
  }
}

function classifyTitle(title) {
  const normalized = title.toLocaleLowerCase();
  if (/\b(trump|tariff|white house|president)\b|關稅|政策|白宮|總統/.test(normalized)) return 'policy';
  if (/\b(powell|buffett|musk)\b|鮑爾|巴菲特|馬斯克/.test(normalized)) return 'influencer';
  return 'macro';
}

function parseGdelt(payload, retrievedAt) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.articles)) {
    throw new SourceError('來源回傳格式無法辨識。', 'invalid_data');
  }
  const events = [];
  for (const article of payload.articles.slice(0, 40)) {
    if (!article || typeof article !== 'object' || Array.isArray(article)) continue;
    const url = safeArticleUrl(article.url);
    const title = typeof article.title === 'string' ? article.title : '';
    if (!url || !title || title.length > 500) continue;
    const observedAt = parseSeenDate(article.seendate);
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

function decodeBasicEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    const lowered = entity.toLowerCase();
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

function extractXmlText(block, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}\\s*>`, 'i');
  const match = pattern.exec(block);
  if (!match) return null;
  let value = match[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(value);
  if (cdata) value = cdata[1];
  else if (/[<>]/.test(value)) return null;
  return decodeBasicEntities(value).replace(/\s+/g, ' ').trim();
}

function officialHttpsUrl(value, hostname, baseUrl) {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== hostname
        || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function parsePublicationDate(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function primaryEvent({ idPrefix, url, title, sourceName, category, publishedAt, observedAt, reason }) {
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

function parseFederalReserveFeed(xml, retrievedAt) {
  if (typeof xml !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(xml) || !/<rss\b/i.test(xml)) {
    throw new SourceError('Federal Reserve RSS 結構無法辨識。', 'invalid_data');
  }
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)].slice(0, 40);
  if (!items.length) throw new SourceError('Federal Reserve RSS 沒有符合預期的 item。', 'invalid_data');
  const events = [];
  for (const [, item] of items) {
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

function stripHtmlText(value) {
  return decodeBasicEntities(value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function meaningfulWhiteHouseTitle(value) {
  const title = value.trim();
  if (title.length < 12 || title.length > 300) return false;
  if (/^(home|remarks|videos|news|briefings|watch|read more|more|the white house)$/i.test(title)) return false;
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(title)) return false;
  if (/^(?:\d{1,2}[/-]){2}\d{2,4}$/.test(title) || /^[A-Za-z]+ \d{1,2}, \d{4}$/.test(title)) return false;
  return title.split(/\s+/).length >= 3;
}

function parseWhiteHouseRemarks(html, retrievedAt) {
  if (typeof html !== 'string' || !/<html\b|<main\b|<a\b/i.test(html)) {
    throw new SourceError('White House remarks 頁面結構無法辨識。', 'invalid_data');
  }
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)];
  const seen = new Set();
  const events = [];
  for (const [, attributes, innerHtml] of anchors) {
    const href = /\bhref\s*=\s*(["'])(.*?)\1/i.exec(attributes)?.[2];
    if (!href) continue;
    const url = officialHttpsUrl(href, 'www.whitehouse.gov', WHITEHOUSE_URL);
    if (!url || !(new URL(url).pathname.startsWith('/videos/') || /^\/remarks\/\d{4}\//.test(new URL(url).pathname))) continue;
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

async function readTextBounded(response, maxBytes) {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new SourceError('來源資料超過安全讀取上限。', 'too_large');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new SourceError('來源回應沒有可讀取的內容。', 'invalid_data');
  }
  const reader = response.body.getReader();
  const chunks = [];
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
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
  } catch {
    throw new SourceError('來源回傳的文字編碼無法辨識。', 'invalid_data');
  }
  return decoded;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new SourceError('來源回傳的 JSON 格式無法辨識。', 'invalid_data');
  }
}

const SOURCE_PARSERS = {
  twse: parseTwse,
  gdelt: parseGdelt,
  federal_reserve: parseFederalReserveFeed,
  whitehouse: parseWhiteHouseRemarks,
};

function sourceAsOf(id, value) {
  if (id === 'twse') return value.asOf ?? null;
  if (id === 'gdelt') return value.map((event) => event.observedAt).filter(Boolean).sort().at(-1) ?? null;
  if (id === 'federal_reserve') return value.map((event) => event.publishedAt).filter(Boolean).sort().at(-1) ?? null;
  return null;
}

function emptySourceValue(id) {
  return id === 'twse' ? { instruments: [], asOf: null } : [];
}

function recordPrimaryFirstSeen(events, retrievedAt, firstSeen) {
  return events.map((event) => {
    if (firstSeen.has(event.id)) return { ...event, observedAt: firstSeen.get(event.id) };
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

function errorFor(error) {
  if (error?.kind === 'timeout') return '來源連線逾時（10 秒）。';
  if (error?.kind === 'too_large' || error?.kind === 'invalid_data') return error.message;
  if (error?.kind === 'http') {
    const status = Number(error.message);
    return Number.isInteger(status) && status >= 100 && status <= 599
      ? `來源回傳 HTTP ${status}。`
      : '來源暫時無法讀取（HTTP 回應異常）。';
  }
  return '來源暫時無法讀取。';
}

export function createLiveReader({
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  timeoutMs = 10_000,
  cacheTtlMs = CACHE_TTL_MS,
  maxExternalBytes = MAX_EXTERNAL_BYTES,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  const state = new Map(Object.keys(SOURCE_CONFIG).map((id) => [id, { inflight: null, cachedAt: 0, result: null }]));
  const primaryFirstSeen = new Map();

  async function fetchResource(config) {
    const controller = new AbortController();
    let timer;
    const operation = (async () => {
      let response;
      try {
        response = await fetchImpl(config.url, {
          method: 'GET',
          headers: { accept: config.format === 'json' ? 'application/json' : 'application/rss+xml, application/xml, text/html;q=0.9' },
          redirect: 'error',
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) throw new SourceError('timeout', 'timeout');
        throw error;
      }
      if (!response?.ok) throw new SourceError(String(response?.status ?? ''), 'http');
      const text = await readTextBounded(response, maxExternalBytes);
      return config.format === 'json' ? parseJson(text) : text;
    })();
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new SourceError('timeout', 'timeout'));
      }, timeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  function getSource(id) {
    const config = SOURCE_CONFIG[id];
    const record = state.get(id);
    const nowMs = now().getTime();
    if (record.inflight) return record.inflight;
    if (record.result && nowMs - record.cachedAt < cacheTtlMs) return Promise.resolve(record.result);

    record.inflight = (async () => {
      let retrievedAt;
      let result;
      try {
        const payload = await fetchResource(config);
        retrievedAt = now().toISOString();
        let value = SOURCE_PARSERS[id](payload, retrievedAt);
        if (config.sourceKind === 'primary') value = recordPrimaryFirstSeen(value, retrievedAt, primaryFirstSeen);
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
      } catch (error) {
        retrievedAt = now().toISOString();
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

  return async function getLiveSnapshot() {
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
    if (twse.source.status === 'ok' && twse.value.instruments.length === 0) {
      warnings.push('TWSE 快照中沒有符合本機示範清單的 0050 或 2330 資料。');
    }
    const retrievedAt = sourceResults.map(({ source }) => source.retrievedAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? now().toISOString();
    return {
      mode: 'live',
      retrievedAt,
      instruments: twse.value.instruments,
      events: [
        ...gdelt.value,
        ...federalReserve.value,
        ...whitehouse.value,
      ],
      sources: sourceResults.map(({ source }) => source),
      warnings,
    };
  };
}
