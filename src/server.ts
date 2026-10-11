import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getDemoDashboard, getDemoPrices } from '../fixtures/demo-data.js';
import { InputError, runBacktest } from './backtest.js';
import { createLiveReader } from './live.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4187;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_STATIC_BYTES = 10 * 1024 * 1024;
const modulePath = fileURLToPath(import.meta.url);
const moduleDirectory = dirname(modulePath);
const isCompiledServer = modulePath.includes(`${sep}dist${sep}server${sep}`);
const DEFAULT_PUBLIC_DIR = isCompiledServer
  ? resolve(moduleDirectory, '../../ui')
  : resolve(moduleDirectory, '../dist/ui');

const CONTENT_TYPES = new Map<string, string>([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

interface HttpError extends Error {
  statusCode: number;
}

interface CreateServerOptions {
  publicDir?: string;
  fetchImpl?: typeof globalThis.fetch;
  now?: () => Date;
  liveOptions?: {
    timeoutMs?: number;
    cacheTtlMs?: number;
    maxExternalBytes?: number;
  };
}

interface StartServerOptions extends CreateServerOptions {
  host?: string;
  port?: number;
}

function httpError(message: string, statusCode: number): HttpError {
  return Object.assign(new Error(message), { statusCode });
}

function statusCodeOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined;
  const statusCode = error.statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤。';
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload) ?? 'null');
  securityHeaders(response);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Length', String(body.byteLength));
  response.end(body);
}

function localHostHeader(value: string | undefined): boolean {
  if (typeof value !== 'string' || value.length > 255) return false;
  try {
    const parsed = new URL(`http://${value}`);
    return !parsed.username && !parsed.password
      && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function sameLocalOrigin(originValue: string | undefined, hostValue: string | undefined): boolean {
  if (!localHostHeader(hostValue) || typeof originValue !== 'string') return false;
  try {
    const origin = new URL(originValue);
    const host = new URL(`http://${hostValue}`);
    return origin.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname.toLowerCase())
      && origin.host.toLowerCase() === host.host.toLowerCase();
  } catch {
    return false;
  }
}

function requestAllowed(request: IncomingMessage, response: ServerResponse): boolean {
  const host = request.headers.host;
  if (!localHostHeader(host)) {
    sendJson(response, 421, { error: '僅接受本機服務網址。' });
    return false;
  }
  const origin = request.headers.origin;
  const fetchSite = request.headers['sec-fetch-site'];
  if (origin && !sameLocalOrigin(origin, host)) {
    sendJson(response, 403, { error: '跨來源請求已拒絕。' });
    return false;
  }
  if (fetchSite === 'cross-site') {
    sendJson(response, 403, { error: '跨來源請求已拒絕。' });
    return false;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD' && !origin) {
    sendJson(response, 403, { error: '此操作需要同源請求。' });
    return false;
  }
  return true;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = request.headers['content-type'] ?? '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw httpError('請以 JSON 格式提供回測設定。', 415);
  }
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    throw httpError('請求資料不得超過 1 MB。', 413);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_JSON_BYTES) throw httpError('請求資料不得超過 1 MB。', 413);
    chunks.push(buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid body');
    return parsed as Record<string, unknown>;
  } catch {
    throw httpError('JSON 格式錯誤。', 400);
  }
}

function staticPath(pathname: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw httpError('網址路徑格式錯誤。', 400);
  }
  if (decoded.includes('\0') || decoded.includes('\\')) throw httpError('網址路徑格式錯誤。', 400);
  return decoded;
}

async function serveStatic(response: ServerResponse, pathname: string, publicDir: string): Promise<void> {
  try {
    const decodedPath = staticPath(pathname);
    const root = await realpath(publicDir);
    const relativeRequest = decodedPath.replace(/^\/+/, '') || 'index.html';
    let target = resolve(root, relativeRequest);
    let rel = relative(root, target);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      sendJson(response, 403, { error: '無法讀取此項目。' });
      return;
    }
    let metadata;
    try {
      metadata = await stat(target);
      if (metadata.isDirectory()) {
        target = resolve(target, 'index.html');
        metadata = await stat(target);
      }
    } catch {
      sendJson(response, 404, { error: '找不到此頁面。' });
      return;
    }
    const resolvedTarget = await realpath(target);
    rel = relative(root, resolvedTarget);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      sendJson(response, 403, { error: '無法讀取此項目。' });
      return;
    }
    if (!metadata.isFile()) {
      sendJson(response, 404, { error: '找不到此頁面。' });
      return;
    }
    if (metadata.size > MAX_STATIC_BYTES) {
      sendJson(response, 413, { error: '靜態檔案超過讀取上限。' });
      return;
    }
    const body = await readFile(resolvedTarget);
    securityHeaders(response);
    response.statusCode = 200;
    response.setHeader('Content-Type', CONTENT_TYPES.get(extname(resolvedTarget).toLowerCase()) ?? 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Content-Length', String(body.byteLength));
    response.end(body);
  } catch (error: unknown) {
    if (statusCodeOf(error) === undefined && typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      sendJson(response, 404, { error: '找不到此頁面。' });
      return;
    }
    const status = statusCodeOf(error);
    sendJson(response, status ?? 500, { error: status ? errorMessage(error) : '無法讀取本機頁面。' });
  }
}

function sendMethodNotAllowed(response: ServerResponse, allowed: string): void {
  response.setHeader('Allow', allowed);
  sendJson(response, 405, { error: '不支援此請求方式。' });
}

export function createServer({
  publicDir = DEFAULT_PUBLIC_DIR,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  liveOptions = {},
}: CreateServerOptions = {}): HttpServer {
  const getLiveSnapshot = createLiveReader({ fetchImpl, now, ...liveOptions });
  return createHttpServer(async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    securityHeaders(response);
    if (!requestAllowed(request, response)) return;

    let pathname: string;
    try {
      pathname = new URL(request.url ?? '', 'http://localhost').pathname;
    } catch {
      sendJson(response, 400, { error: '網址格式錯誤。' });
      return;
    }

    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/health') {
        if (request.method !== 'GET') return sendMethodNotAllowed(response, 'GET');
        sendJson(response, 200, { status: 'ok', executionEnabled: false });
        return;
      }
      if (pathname === '/api/dashboard') {
        if (request.method !== 'GET') return sendMethodNotAllowed(response, 'GET');
        sendJson(response, 200, getDemoDashboard(now()));
        return;
      }
      if (pathname === '/api/live') {
        if (request.method !== 'GET') return sendMethodNotAllowed(response, 'GET');
        try {
          sendJson(response, 200, await getLiveSnapshot());
        } catch {
          sendJson(response, 500, { error: '即時來源暫時無法讀取。' });
        }
        return;
      }
      if (pathname === '/api/backtest') {
        if (request.method !== 'POST') return sendMethodNotAllowed(response, 'POST');
        try {
          const body = await readJsonBody(request);
          const result = runBacktest(body, {
            fixtureLookup: (symbol) => {
              const prices = getDemoPrices(symbol);
              const instrument = getDemoDashboard(now()).instruments.find((item) => item.symbol === symbol);
              if (!prices) return null;
              return {
                prices,
                dataKind: 'synthetic',
                ...(instrument ? { market: instrument.market, type: instrument.type } : {}),
              };
            },
          });
          sendJson(response, 200, result);
        } catch (error: unknown) {
          const status = error instanceof InputError ? 400 : statusCodeOf(error) ?? 500;
          sendJson(response, status, {
            error: error instanceof InputError || statusCodeOf(error) ? errorMessage(error) : '回測暫時無法完成。',
          });
        }
        return;
      }
      sendJson(response, 404, { error: '找不到此 API。' });
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendMethodNotAllowed(response, 'GET, HEAD');
      return;
    }
    await serveStatic(response, pathname, publicDir);
  });
}

export async function startServer({ host = DEFAULT_HOST, port = DEFAULT_PORT, ...options }: StartServerOptions = {}): Promise<HttpServer> {
  if (host !== DEFAULT_HOST) throw new TypeError('Market Compass must bind only to 127.0.0.1.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Port must be an integer from 0 to 65535.');
  const server = createServer(options);
  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, DEFAULT_HOST);
  });
  return server;
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  startServer().then((server) => {
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : DEFAULT_PORT;
    console.log(`Market Compass 本機服務已啟動：http://127.0.0.1:${port}`);
  }).catch((error: unknown) => {
    console.error('無法啟動 Market Compass 本機服務。', errorMessage(error));
    process.exitCode = 1;
  });
}
