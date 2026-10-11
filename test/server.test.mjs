import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { startServer } from '../src/server.mjs';

async function withServer(options, run) {
  const server = await startServer({
    port: 0,
    fetchImpl: async () => { throw new Error('Network access is disabled in server tests.'); },
    ...options,
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function validBacktest(overrides = {}) {
  return {
    symbol: 'SPY',
    strategy: 'sma',
    lookback: 20,
    feeBps: 10,
    slippageBps: 5,
    initialCapital: 100_000,
    splitRatio: 0.7,
    ...overrides,
  };
}

test('serves a safe local dashboard, static assets, and non-execution health route', async () => {
  await withServer({}, async (base) => {
    const healthResponse = await fetch(`${base}/api/health`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), { status: 'ok', executionEnabled: false });
    assert.match(healthResponse.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(healthResponse.headers.get('content-security-policy'), /style-src 'self'/);

    const dashboardResponse = await fetch(`${base}/api/dashboard`);
    const dashboard = await dashboardResponse.json();
    assert.equal(dashboardResponse.status, 200);
    assert.equal(dashboard.mode, 'demo');
    assert.equal(dashboard.instruments.length, 5);
    assert.ok(dashboard.instruments.every((item) => item.dataKind === 'synthetic' && item.history.length >= 320));
    assert.ok(dashboard.instruments.some((item) => item.market === 'US' && item.type === 'etf'));
    assert.ok(dashboard.instruments.some((item) => item.market === 'TW' && item.type === 'stock'));
    assert.ok(dashboard.instruments.some((item) => item.market === 'FUND' && item.type === 'fund'));
    assert.ok(dashboard.events.every((event) => event.demo === true && event.sourceUrl === null && event.publishedAt === null));
    assert.ok(dashboard.events.every((event) => event.title.startsWith('示意情境：')));
    assert.deepEqual(dashboard.strategies.map((item) => item.id), ['buy_hold', 'sma', 'momentum']);

    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /lang="zh-Hant"/);

    const traversal = await fetch(`${base}/%2e%2e%2fREADME.md`);
    assert.equal(traversal.status, 403);
    assert.match((await traversal.json()).error, /無法讀取/);

    const execution = await fetch(`${base}/api/execute`);
    assert.equal(execution.status, 404);
    assert.deepEqual(await execution.json(), { error: '找不到此 API。' });
  });
});

test('enforces host and same-origin protections for API requests', async () => {
  await withServer({}, async (base) => {
    const crossOriginGet = await fetch(`${base}/api/health`, { headers: { Origin: 'http://attacker.example' } });
    assert.equal(crossOriginGet.status, 403);

    const crossSite = await fetch(`${base}/api/health`, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(crossSite.status, 403);

    const missingOrigin = await fetch(`${base}/api/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBacktest()),
    });
    assert.equal(missingOrigin.status, 403);

    const crossOriginPost = await fetch(`${base}/api/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://attacker.example' },
      body: JSON.stringify(validBacktest()),
    });
    assert.equal(crossOriginPost.status, 403);

    const url = new URL(base);
    const mismatchedHost = await new Promise((resolve, reject) => {
      const request = httpRequest({
        hostname: '127.0.0.1',
        port: Number(url.port),
        path: '/api/health',
        method: 'GET',
        headers: { Host: '127.0.0.1.evil.example' },
      }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject);
      request.end();
    });
    assert.equal(mismatchedHost, 421);
  });
});

test('validates backtest input and applies the one-megabyte request limit', async () => {
  await withServer({}, async (base) => {
    const origin = base;
    const validResponse = await fetch(`${base}/api/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(validBacktest()),
    });
    const result = await validResponse.json();
    assert.equal(validResponse.status, 200);
    assert.equal(result.dataKind, 'synthetic');
    assert.equal(result.curve.length, result.split.testBars);
    assert.equal(result.split.trainBars, Math.floor(400 * 0.7));

    const invalidResponse = await fetch(`${base}/api/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(validBacktest({ splitRatio: 0.6 })),
    });
    assert.equal(invalidResponse.status, 400);
    assert.match((await invalidResponse.json()).error, /訓練比例/);

    const oversizedResponse = await fetch(`${base}/api/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ ...validBacktest(), padding: 'x'.repeat(1024 * 1024 + 1) }),
    });
    assert.equal(oversizedResponse.status, 413);
  });
});

test('requires JSON content type before parsing a backtest body', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/api/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: base },
      body: 'not json',
    });
    assert.equal(response.status, 415);
    assert.match((await response.json()).error, /JSON/);
  });
});
