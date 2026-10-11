import { createServer as createHttpServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getDemoDashboard, getDemoPrices } from '../fixtures/demo-data.mjs';
import { InputError, runBacktest } from './backtest.mjs';
import { createLiveReader } from './live.mjs';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4187;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_STATIC_BYTES = 10 * 1024 * 1024;
const DEFAULT_PUBLIC_DIR = resolve(fileURLToPath(new URL('../public/', import.meta.url)));

const CONTENT_TYPES = new Map([
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

function securityHeaders(response) {
  response.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  securityHeaders(response);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Length', String(body.byteLength));
  response.end(body);
}

function localHostHeader(value) {
  if (typeof value !== 'string' || value.length > 255) return false;
  try {
    const parsed = new URL(`http://${value}`);
    return !parsed.username && !parsed.password
      && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function sameLocalOrigin(originValue, hostValue) {
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

function requestAllowed(request, response) {
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

async function readJsonBody(request) {
  const contentType = request.headers['content-type'] ?? '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw Object.assign(new Error('請以 JSON 格式提供回測設定。'), { statusCode: 415 });
  }
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    throw Object.assign(new Error('請求資料不得超過 1 MB。'), { statusCode: 413 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > MAX_JSON_BYTES) throw Object.assign(new Error('請求資料不得超過 1 MB。'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid body');
    return parsed;
  } catch {
    throw Object.assign(new Error('JSON 格式錯誤。'), { statusCode: 400 });
  }
}

function staticPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw Object.assign(new Error('網址路徑格式錯誤。'), { statusCode: 400 });
  }
  if (decoded.includes('\0') || decoded.includes('\\')) {
    throw Object.assign(new Error('網址路徑格式錯誤。'), { statusCode: 400 });
  }
  return decoded;
}

async function serveStatic(response, pathname, publicDir) {
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
  } catch (error) {
    if (error?.code === 'ENOENT') {
      sendJson(response, 404, { error: '找不到此頁面。' });
      return;
    }
    sendJson(response, error?.statusCode ?? 500, { error: error?.statusCode ? error.message : '無法讀取本機頁面。' });
  }
}

function sendMethodNotAllowed(response, allowed) {
  response.setHeader('Allow', allowed);
  sendJson(response, 405, { error: '不支援此請求方式。' });
}

export function createServer({
  publicDir = DEFAULT_PUBLIC_DIR,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  liveOptions = {},
} = {}) {
  const getLiveSnapshot = createLiveReader({ fetchImpl, now, ...liveOptions });
  return createHttpServer(async (request, response) => {
    securityHeaders(response);
    if (!requestAllowed(request, response)) return;

    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
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
              return prices ? { prices, dataKind: 'synthetic', market: instrument?.market, type: instrument?.type } : null;
            },
          });
          sendJson(response, 200, result);
        } catch (error) {
          sendJson(response, error instanceof InputError ? 400 : (error?.statusCode ?? 500), {
            error: error instanceof InputError || error?.statusCode ? error.message : '回測暫時無法完成。',
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

export async function startServer({ host = DEFAULT_HOST, port = DEFAULT_PORT, ...options } = {}) {
  if (host !== DEFAULT_HOST) throw new TypeError('Market Compass must bind only to 127.0.0.1.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Port must be an integer from 0 to 65535.');
  const server = createServer(options);
  await new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
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
    console.log(`Market Compass 本機服務已啟動：http://127.0.0.1:${address.port}`);
  }).catch((error) => {
    console.error('無法啟動 Market Compass 本機服務。', error.message);
    process.exitCode = 1;
  });
}
