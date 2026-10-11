import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server.js';

const TEST_PUBLIC_DIR = fileURLToPath(new URL('../client/', import.meta.url));

interface TestOptions {
  publicDir?: string;
}

interface DashboardResponse {
  mode: string;
  instruments: Array<{ dataKind: string; history: unknown[]; market: string; type: string }>;
  events: Array<{ demo: boolean; sourceUrl: string | null; publishedAt: string | null; title: string }>;
  strategies: Array<{ id: string }>;
}

interface BacktestResponse {
  dataKind: string;
  curve: unknown[];
  split: { trainBars: number; testBars: number };
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function withServer(options: TestOptions, run: (base: string) => Promise<void>): Promise<void> {
  const server = await startServer({
    port: 0,
    publicDir: TEST_PUBLIC_DIR,
    fetchImpl: async () => { throw new Error('Network access is disabled in server tests.'); },
    ...options,
  });
  const address = server.address();
  assert.ok(typeof address === 'object' && address !== null);
  const base = `http://127.0.0.1:${address.port}`;
  try {
    await run(base);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  }
}

function validBacktest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    const policy = healthResponse.headers.get('content-security-policy') ?? '';
    assert.match(policy, /script-src 'self'/);
    assert.match(policy, /style-src 'self'/);

    const dashboardResponse = await fetch(`${base}/api/dashboard`);
    const dashboard = await jsonBody(dashboardResponse) as unknown as DashboardResponse;
    assert.equal(dashboardResponse.status, 200);
    assert.equal(dashboard.mode, 'demo');
    assert.equal(dashboard.instruments.length, 5);
    assert.ok(dashboard.instruments.every((item) => item.dataKind === 'synthetic' && item.history.length >= 320));
    assert.ok(dashboard.instruments.some((item) => item.market === 'US' && item.type === 'etf'));
    assert.ok(dashboard.instruments.some((item) => item.market === 'TW' && item.type === 'stock'));
    assert.ok(dashboard.instruments.some((item) => item.market === 'FUND' && item.type === 'fund'));
    assert.ok(dashboard.events.every((event) => event.demo && event.sourceUrl === null && event.publishedAt === null));
    assert.ok(dashboard.events.every((event) => event.title.startsWith('示意情境：')));
    assert.deepEqual(dashboard.strategies.map((item) => item.id), ['buy_hold', 'sma', 'momentum']);

    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await page.text(), /lang="zh-Hant"/);

    const traversal = await fetch(`${base}/%2e%2e%2fREADME.md`);
    assert.equal(traversal.status, 403);
    const traversalBody = await jsonBody(traversal);
    assert.match(String(traversalBody.error), /無法讀取/);

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
    const mismatchedHost = await new Promise<number | undefined>((resolvePromise, reject) => {
      const request = httpRequest({
        hostname: '127.0.0.1',
        port: Number(url.port),
        path: '/api/health',
        method: 'GET',
        headers: { Host: '127.0.0.1.evil.example' },
      }, (response) => {
        response.resume();
        response.on('end', () => resolvePromise(response.statusCode));
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
    const result = await jsonBody(validResponse) as unknown as BacktestResponse;
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
    const invalidBody = await jsonBody(invalidResponse);
    assert.match(String(invalidBody.error), /訓練比例/);

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
    const body = await jsonBody(response);
    assert.match(String(body.error), /JSON/);
  });
});
