import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLiveReader,
  FEDERAL_RESERVE_URL,
  GDELT_URL,
  TWSE_URL,
  WHITEHOUSE_URL,
} from '../src/live.js';

const retrievedAt = '2026-10-11T02:00:00.000Z';
const twseRows: unknown[] = [
  { Code: '0050', Name: '台灣大型股 ETF', ClosingPrice: '123.45', Change: '1.23', Date: '2026-10-09' },
  { Code: '2330', Name: '台灣科技股', ClosingPrice: '1,200.00', Change: '-10.00', TradeDate: '115/10/09' },
  { Code: '9999', Name: '不在本機清單', ClosingPrice: '50.00', Change: '1.00' },
];
const gdeltArticles = [
  { title: 'Trump outlines a tariff proposal', url: 'https://news.example/story/1', seendate: '20261011T013000Z' },
  { title: 'Powell discusses rates', url: 'https://news.example/story/2', seendate: '20261011T014000Z' },
  { title: 'Global markets open higher', url: 'https://news.example/story/3', seendate: '20261011T015000Z' },
  { title: 'Ignore unsafe URL', url: 'javascript:alert(1)', seendate: '20261011T015500Z' },
];
const fedFeed = `<?xml version="1.0"?><rss version="2.0"><channel><title>Speeches</title>
  <item><title>Powell discusses rates &amp; inflation outlook</title><link>https://www.federalreserve.gov/newsevents/speech/powell20261010a.htm</link><pubDate>Sat, 10 Oct 2026 16:00:00 GMT</pubDate></item>
  <item><title><![CDATA[Board publishes a speech without date]]></title><link><![CDATA[/newsevents/speech/official2026.htm]]></link></item>
</channel></rss>`;
const whitehousePage = `<!doctype html><html><body><nav><a href="/remarks/2026/10/10/">Remarks</a></nav><main>
  <a href="/remarks/2026/10/10/president-addresses-economic-outlook/">Remarks by the President on the Economic Outlook</a>
  <a href="https://www.whitehouse.gov/videos/president-speaks-to-reporters/">President Speaks to Reporters About Trade</a>
  <a href="https://www.whitehouse.gov/videos/president-speaks-to-reporters/">President Speaks to Reporters About Trade</a>
  <a href="/remarks/2026/10/10/nav-title/">Read More</a>
  <a href="/videos/date-title/">October 10, 2026</a>
  <a href="/videos/duration-title/">03:24</a>
  <a href="https://evil.example/remarks/2026/10/10/foreign/">Foreign Official Remarks About Markets</a>
  <a href="javascript:alert(1)">Official Statement About Markets</a>
</main></body></html>`;

interface ProviderOverrides {
  twse?: unknown;
  gdelt?: unknown;
  fed?: string;
  whitehouse?: string;
}

function response(body: unknown, status = 200, contentType?: string): Response {
  const isText = typeof body === 'string';
  const headers = { 'content-type': contentType ?? (isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8') };
  return new Response(isText ? body : JSON.stringify(body), { status, headers });
}

function fixedProviderResponse(url: string, overrides: ProviderOverrides = {}): Response {
  if (url === TWSE_URL) return response(overrides.twse ?? twseRows);
  if (url === GDELT_URL) return response(overrides.gdelt ?? { articles: gdeltArticles });
  if (url === FEDERAL_RESERVE_URL) return response(overrides.fed ?? fedFeed, 200, 'application/rss+xml; charset=utf-8');
  if (url === WHITEHOUSE_URL) return response(overrides.whitehouse ?? whitehousePage, 200, 'text/html; charset=utf-8');
  throw new Error('Unexpected upstream URL');
}

test('calls only the four fixed providers and preserves price/news provenance', async () => {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const getLive = createLiveReader({
    now: () => new Date(retrievedAt),
    fetchImpl: async (input, init) => {
      const url = String(input);
      calls.push({ url, options: init ?? {} });
      return fixedProviderResponse(url);
    },
  });

  const result = await getLive();
  assert.deepEqual(calls.map((call) => call.url).sort(), [GDELT_URL, TWSE_URL, FEDERAL_RESERVE_URL, WHITEHOUSE_URL].sort());
  assert.ok(calls.every((call) => call.options.redirect === 'error'));
  assert.ok(calls.every((call) => call.options.method === 'GET'));
  assert.ok(calls.every((call) => call.options.signal instanceof AbortSignal));
  assert.equal(result.mode, 'live');
  assert.equal(result.retrievedAt, retrievedAt);
  assert.deepEqual(result.sources.map((source) => source.id), ['twse', 'gdelt', 'federal_reserve', 'whitehouse']);
  assert.ok(result.sources.every((source) => source.status === 'ok'));
  assert.equal(result.sources.find((source) => source.id === 'federal_reserve')!.sourceKind, 'primary');
  assert.equal(result.sources.find((source) => source.id === 'whitehouse')!.sourceKind, 'primary');

  assert.equal(result.instruments.length, 2);
  assert.equal(result.instruments[0]!.dataKind, 'live_snapshot');
  assert.equal(result.instruments[0]!.history.length, 0);
  assert.equal(result.instruments[0]!.price, 123.45);
  assert.equal(result.instruments[0]!.asOf, '2026-10-09');
  assert.equal(result.sources.find((source) => source.id === 'twse')!.asOf, '2026-10-09');
  assert.equal(result.sources.find((source) => source.id === 'twse')!.retrievedAt, retrievedAt);

  assert.equal(result.events.length, 7);
  assert.equal(result.events[0]!.title, gdeltArticles[0]!.title);
  assert.equal(result.events[0]!.category, 'policy');
  assert.equal(result.events[1]!.category, 'influencer');
  assert.equal(result.events[2]!.category, 'macro');
  assert.equal(result.events[0]!.sourceUrl, gdeltArticles[0]!.url);
  assert.equal(result.events[0]!.sourceKind, 'news_index');
  assert.equal(result.events[0]!.publishedAt, null);
  assert.equal(result.events[0]!.observedAt, '2026-10-11T01:30:00.000Z');
  assert.equal(result.events[0]!.evidenceScore, null);
  assert.deepEqual(result.events[0]!.affectedSymbols, []);
  assert.ok(result.events[0]!.reasons.some((reason) => reason.includes('未驗證原始發言')));
  assert.equal(result.sources.find((source) => source.id === 'gdelt')!.asOf, '2026-10-11T01:50:00.000Z');

  const fedEvent = result.events.find((event) => event.sourceKind === 'primary' && event.sourceName === 'Federal Reserve' && event.title.includes('Powell'));
  assert.ok(fedEvent);
  assert.equal(fedEvent.title, 'Powell discusses rates & inflation outlook');
  assert.equal(fedEvent.publishedAt, '2026-10-10T16:00:00.000Z');
  assert.equal(fedEvent.observedAt, retrievedAt);
  assert.equal(fedEvent.category, 'influencer');
  assert.equal(fedEvent.evidenceScore, null);
  assert.deepEqual(fedEvent.affectedSymbols, []);
  assert.ok(fedEvent.reasons.some((reason) => reason.includes('本機首次取得時間')));
  const undatedFed = result.events.find((event) => event.sourceName === 'Federal Reserve' && event.title.includes('without date'));
  assert.ok(undatedFed);
  assert.equal(undatedFed.publishedAt, null);
  assert.equal(result.sources.find((source) => source.id === 'federal_reserve')!.asOf, fedEvent.publishedAt);

  const whitehouseEvents = result.events.filter((event) => event.sourceName === 'The White House');
  assert.equal(whitehouseEvents.length, 2);
  assert.equal(whitehouseEvents[0]!.sourceUrl, 'https://www.whitehouse.gov/remarks/2026/10/10/president-addresses-economic-outlook/');
  assert.equal(whitehouseEvents[0]!.publishedAt, null);
  assert.equal(whitehouseEvents[0]!.observedAt, retrievedAt);
  assert.equal(whitehouseEvents[0]!.category, 'policy');
  assert.equal(whitehouseEvents[0]!.evidenceScore, null);
  assert.ok(whitehouseEvents[0]!.reasons.some((reason) => reason.includes('發布時間')));
  assert.equal(result.sources.find((source) => source.id === 'whitehouse')!.asOf, null);
  assert.ok(result.warnings.some((warning) => warning.includes('GDELT')));
  assert.ok(result.warnings.some((warning) => warning.includes('Fed 發布時間')));
});

test('reports each provider failure independently without synthetic fallback', async () => {
  const getLive = createLiveReader({
    now: () => new Date(retrievedAt),
    fetchImpl: async (input) => {
      const url = String(input);
      if (url === TWSE_URL) return response({ error: 'private upstream details' }, 429);
      return fixedProviderResponse(url);
    },
  });
  const result = await getLive();
  assert.equal(result.instruments.length, 0);
  assert.equal(result.events.length, 7);
  assert.ok(result.events.every((event) => event.demo === false));
  const twseSource = result.sources.find((source) => source.id === 'twse')!;
  assert.equal(twseSource.status, 'error');
  assert.ok(result.sources.filter((source) => source.id !== 'twse').every((source) => source.status === 'ok'));
  assert.match(twseSource.error ?? '', /HTTP 429/);
  assert.doesNotMatch(twseSource.error ?? '', /private upstream details/);
  assert.ok(result.warnings.some((warning) => warning.includes('不補入合成資料')));

  const primaryFailure = createLiveReader({
    now: () => new Date(retrievedAt),
    fetchImpl: async (input) => {
      const url = String(input);
      return url === FEDERAL_RESERVE_URL
        ? response('<rss><channel><item><title>not a valid item without link</title></item></channel></rss>', 200, 'application/rss+xml')
        : fixedProviderResponse(url);
    },
  });
  const partial = await primaryFailure();
  const fedSource = partial.sources.find((source) => source.id === 'federal_reserve')!;
  assert.equal(fedSource.status, 'error');
  assert.match(fedSource.error ?? '', /無法辨識/);
  assert.equal(partial.sources.find((source) => source.id === 'whitehouse')!.status, 'ok');
  assert.ok(partial.warnings.some((warning) => warning.includes('Federal Reserve')));
});

test('rejects unsafe and unexpected primary-source document structures', async () => {
  const badFed = createLiveReader({
    now: () => new Date(retrievedAt),
    fetchImpl: async (input) => fixedProviderResponse(String(input), {
      fed: '<!DOCTYPE rss [<!ENTITY x "expanded">]><rss><channel><item><title>&x;</title><link>https://www.federalreserve.gov/a</link></item></channel></rss>',
    }),
  });
  const fedResult = await badFed();
  const fedSource = fedResult.sources.find((source) => source.id === 'federal_reserve')!;
  assert.equal(fedSource.status, 'error');
  assert.match(fedSource.error ?? '', /結構無法辨識/);

  const badWhitehouse = createLiveReader({
    now: () => new Date(retrievedAt),
    fetchImpl: async (input) => fixedProviderResponse(String(input), {
      whitehouse: '<html><main><a href="https://evil.example/remarks/2026/a">Foreign Official Remarks About Markets</a></main></html>',
    }),
  });
  const whResult = await badWhitehouse();
  const whSource = whResult.sources.find((source) => source.id === 'whitehouse')!;
  assert.equal(whSource.status, 'error');
  assert.match(whSource.error ?? '', /沒有符合預期/);
});

test('single-flights each of the four reads and caches the result for the throttle interval', async () => {
  let callCount = 0;
  const getLive = createLiveReader({
    now: () => new Date(retrievedAt),
    fetchImpl: async (input) => {
      callCount += 1;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
      return fixedProviderResponse(String(input), { twse: [], gdelt: { articles: [] } });
    },
  });
  const [first, second] = await Promise.all([getLive(), getLive()]);
  assert.equal(callCount, 4);
  assert.ok(first.sources.every((source) => source.status === 'ok'));
  assert.ok(second.sources.every((source) => source.status === 'ok'));
  await getLive();
  assert.equal(callCount, 4);
});

test('keeps index discovery, primary publication and local retrieval times distinct when cached', async () => {
  let clock = Date.parse(retrievedAt);
  const getLive = createLiveReader({
    now: () => new Date(clock),
    fetchImpl: async (input) => {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
      clock += 1000;
      return fixedProviderResponse(String(input), {
        twse: [],
        gdelt: { articles: [{ title: 'A headline without an index date', url: 'https://news.example/no-date' }] },
      });
    },
  });
  const first = await getLive();
  const sourceRetrievals = first.sources.map((source) => source.retrievedAt).sort();
  assert.ok(sourceRetrievals.every((value) => value > retrievedAt));
  assert.equal(first.retrievedAt, sourceRetrievals.at(-1));
  const gdeltEvent = first.events.find((event) => event.sourceKind === 'news_index');
  assert.ok(gdeltEvent);
  assert.equal(gdeltEvent.publishedAt, null);
  assert.equal(gdeltEvent.observedAt, null);
  const fedEvent = first.events.find((event) => event.sourceName === 'Federal Reserve');
  assert.ok(fedEvent);
  assert.equal(fedEvent.observedAt, first.sources.find((source) => source.id === 'federal_reserve')!.retrievedAt);
  assert.equal(fedEvent.publishedAt, '2026-10-10T16:00:00.000Z');
  const whitehouseEvent = first.events.find((event) => event.sourceName === 'The White House');
  assert.ok(whitehouseEvent);
  assert.equal(whitehouseEvent.observedAt, first.sources.find((source) => source.id === 'whitehouse')!.retrievedAt);
  assert.equal(whitehouseEvent.publishedAt, null);

  clock += 5000;
  const cached = await getLive();
  assert.equal(cached.retrievedAt, first.retrievedAt);
  assert.deepEqual(cached.sources.map((source) => source.retrievedAt), first.sources.map((source) => source.retrievedAt));
});

test('retains first local observation for repeated official events across cache refreshes', async () => {
  let clock = Date.parse(retrievedAt);
  const getLive = createLiveReader({
    now: () => new Date(clock),
    fetchImpl: async (input) => fixedProviderResponse(String(input), { twse: [], gdelt: { articles: [] } }),
  });
  const first = await getLive();
  const firstFed = first.events.find((event) => event.sourceName === 'Federal Reserve' && event.title.includes('Powell'));
  const firstWhitehouse = first.events.find((event) => event.sourceName === 'The White House');
  assert.ok(firstFed && firstWhitehouse);

  clock += 61_000;
  const refreshed = await getLive();
  const refreshedFed = refreshed.events.find((event) => event.id === firstFed.id);
  const refreshedWhitehouse = refreshed.events.find((event) => event.id === firstWhitehouse.id);
  assert.ok(refreshedFed && refreshedWhitehouse);
  assert.ok(refreshed.sources.find((source) => source.id === 'federal_reserve')!.retrievedAt > first.sources.find((source) => source.id === 'federal_reserve')!.retrievedAt);
  assert.ok(refreshed.sources.find((source) => source.id === 'whitehouse')!.retrievedAt > first.sources.find((source) => source.id === 'whitehouse')!.retrievedAt);
  assert.equal(refreshedFed.observedAt, firstFed.observedAt);
  assert.equal(refreshedWhitehouse.observedAt, firstWhitehouse.observedAt);
  assert.equal(refreshedFed.publishedAt, firstFed.publishedAt);
  assert.equal(refreshedWhitehouse.publishedAt, null);
});

test('aborts all fixed source reads after the configured timeout', async () => {
  const getLive = createLiveReader({
    now: () => new Date(retrievedAt),
    timeoutMs: 10,
    fetchImpl: (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal || typeof signal === 'string') {
        reject(new Error('missing abort signal'));
        return;
      }
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });
  const result = await getLive();
  assert.ok(result.sources.every((source) => source.status === 'error'));
  assert.ok(result.sources.every((source) => /逾時/.test(source.error ?? '')));
});

test('bounds provider bytes and parses JSON independently from primary-source text', async () => {
  const getLive = createLiveReader({
    now: () => new Date(retrievedAt),
    maxExternalBytes: 1024,
    fetchImpl: async (input) => {
      const url = String(input);
      if (url === TWSE_URL) return response({ padding: 'x'.repeat(1500) });
      if (url === GDELT_URL) return new Response('{bad-json', { status: 200 });
      return fixedProviderResponse(url);
    },
  });
  const result = await getLive();
  const twseSource = result.sources.find((source) => source.id === 'twse')!;
  const gdeltSource = result.sources.find((source) => source.id === 'gdelt')!;
  assert.equal(twseSource.status, 'error');
  assert.match(twseSource.error ?? '', /安全讀取上限/);
  assert.equal(gdeltSource.status, 'error');
  assert.match(gdeltSource.error ?? '', /JSON 格式/);
  assert.equal(result.sources.find((source) => source.id === 'federal_reserve')!.status, 'ok');
  assert.equal(result.sources.find((source) => source.id === 'whitehouse')!.status, 'ok');
});
