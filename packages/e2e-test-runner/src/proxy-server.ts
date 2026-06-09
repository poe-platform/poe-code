import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { dirname, join } from 'node:path';
import { hasOwnErrorCode } from './error-codes.js';
import type { CapturedExchange, ProxyConfig, ProxyRoute } from './proxy-types.js';

export interface ProxyServer {
  url: string;
  close(): Promise<void>;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    request.on('data', (chunk) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

function parseBody(value: string): unknown {
  if (value.trim() === '') {
    return '';
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      result[name] = value;
      continue;
    }

    if (Array.isArray(value)) {
      result[name] = value.join(', ');
    }
  }

  return result;
}

function redactCapturedHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    redacted[name] = isSensitiveHeaderName(name) ? '[redacted]' : value;
  }

  return redacted;
}

function isSensitiveHeaderName(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized === 'authorization' ||
    normalized === 'proxy-authorization' ||
    normalized === 'cookie' ||
    normalized === 'set-cookie' ||
    normalized === 'x-api-key' ||
    normalized.includes('api-key') ||
    normalized.includes('token') ||
    normalized.includes('secret')
  );
}

function sanitizeModelName(model: string): string {
  const lower = model.toLowerCase();
  let result = '';
  for (const char of lower) {
    const code = char.charCodeAt(0);
    const isAlpha = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;
    if (isAlpha || isDigit || char === '-') {
      result += char;
      continue;
    }

    result += '-';
  }

  return result;
}

function generateSnapshotKey(request: {
  model: string;
  messages: Array<{ role: string; content: string }>;
}): string {
  const normalized = JSON.stringify({
    model: request.model,
    messages: request.messages,
  });
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  return `${sanitizeModelName(request.model)}-${hash}`;
}

function getSnapshotKeyFromRequestBody(requestBody: unknown): string {
  if (requestBody === null || typeof requestBody !== 'object') {
    throw new Error('Snapshot key requires JSON object request body.');
  }

  const body = requestBody as Record<string, unknown>;
  if (typeof body.model !== 'string') {
    throw new Error('Snapshot key requires request body.model to be a string.');
  }
  if (!Array.isArray(body.messages)) {
    throw new Error('Snapshot key requires request body.messages to be an array.');
  }

  return generateSnapshotKey({
    model: body.model,
    messages: body.messages as Array<{ role: string; content: string }>,
  });
}

async function writeSnapshot(
  route: ProxyRoute,
  key: string,
  requestBody: unknown,
  responseBody: unknown,
): Promise<void> {
  if (!route.snapshotDir) {
    throw new Error(`Record mode route ${route.path} is missing snapshotDir.`);
  }

  const snapshotPath = join(route.snapshotDir, `${key}.json`);
  const snapshotDir = dirname(snapshotPath);
  if (snapshotDir.length > 0 && snapshotDir !== '.') {
    await mkdir(snapshotDir, { recursive: true });
  }

  const snapshot = {
    key,
    request: requestBody,
    response: responseBody,
    metadata: {
      recordedAt: new Date().toISOString(),
    },
  };
  const temporaryPath = `${snapshotPath}.${process.pid}.${randomUUID()}.tmp`;
  let temporaryCreated = false;
  try {
    await writeFile(temporaryPath, JSON.stringify(snapshot, null, 2), {
      encoding: 'utf8',
      flag: 'wx',
    });
    temporaryCreated = true;
    await rename(temporaryPath, snapshotPath);
  } catch (error) {
    if (temporaryCreated || !isAlreadyExistsError(error)) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
    throw error;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return hasOwnErrorCode(error, 'EEXIST');
}

function isMissingFileError(error: unknown): boolean {
  return hasOwnErrorCode(error, 'ENOENT');
}

async function readSnapshotResponse(route: ProxyRoute, key: string): Promise<unknown> {
  if (!route.snapshotDir) {
    throw new Error(`Playback mode route ${route.path} is missing snapshotDir.`);
  }

  const snapshotPath = join(route.snapshotDir, `${key}.json`);
  const snapshotRaw = await readFile(snapshotPath, 'utf8');
  const snapshot = parseBody(snapshotRaw);
  if (
    snapshot === null ||
    typeof snapshot !== 'object' ||
    !Object.prototype.hasOwnProperty.call(snapshot, 'response')
  ) {
    throw new Error(`Snapshot ${snapshotPath} is missing response.`);
  }

  return (snapshot as { response: unknown }).response;
}

function toUpstreamHeaders(headers: Record<string, string>): Record<string, string> {
  const nextHeaders = { ...headers };
  delete nextHeaders.host;
  delete nextHeaders.connection;
  delete nextHeaders['content-length'];
  return nextHeaders;
}

function writeUpstreamResponse(
  response: ServerResponse,
  upstream: { status: number; raw: string; headers: Headers },
): void {
  response.statusCode = upstream.status;
  for (const [name, value] of upstream.headers.entries()) {
    const lower = name.toLowerCase();
    if (lower === 'content-encoding' || lower === 'transfer-encoding') {
      continue;
    }
    response.setHeader(name, value);
  }
  response.end(upstream.raw);
}

function matchRoute(routes: ProxyRoute[], path: string): ProxyRoute | undefined {
  return routes.find((route) => path.startsWith(route.path));
}

function writeJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(payload));
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function startProxyServer(config: ProxyConfig): Promise<ProxyServer> {
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    const matchedRoute = matchRoute(config.routes, requestUrl.pathname);

    if (!matchedRoute) {
      writeJson(response, 502, {
        error: `No matching proxy route for ${requestUrl.pathname}`,
      });
      return;
    }

    const route = matchedRoute;

    try {
      const requestBodyRaw = await readBody(request);
      const requestBody = parseBody(requestBodyRaw);
      const requestHeaders = normalizeHeaders(request.headers);
      const capturedRequestHeaders = redactCapturedHeaders(requestHeaders);
      const method = request.method ?? 'GET';

      async function forwardUpstream(): Promise<{
        status: number;
        body: unknown;
        raw: string;
        headers: Headers;
      }> {
        const upstreamHeaders = toUpstreamHeaders(requestHeaders);
        const upstreamUrl = new URL(
          `${requestUrl.pathname}${requestUrl.search}`,
          route.target,
        ).toString();

        const upstreamResponse = await fetch(upstreamUrl, {
          method,
          headers: upstreamHeaders,
          body: method === 'GET' || method === 'HEAD' ? undefined : requestBodyRaw,
        });
        const raw = await upstreamResponse.text();
        return {
          status: upstreamResponse.status,
          body: parseBody(raw),
          raw,
          headers: upstreamResponse.headers,
        };
      }

        async function captureAndRespond(status: number, body: unknown): Promise<void> {
        const exchange: CapturedExchange = {
          timestamp: new Date().toISOString(),
          route: route.path,
          request: {
            method,
            path: requestUrl.pathname,
            headers: capturedRequestHeaders,
            body: requestBody,
          },
          response: { status, body },
        };
        await appendFile(config.captureFile, `${JSON.stringify(exchange)}\n`);
        writeJson(response, status, body);
      }

      if (route.mode === 'playback') {
        const key = getSnapshotKeyFromRequestBody(requestBody);

        if (route.snapshotDir) {
          try {
            const responseBody = await readSnapshotResponse(route, key);
            await captureAndRespond(200, responseBody);
            return;
          } catch (error) {
            if (!isMissingFileError(error)) {
              throw error;
            }
          }
        }

        if (config.onMiss === 'error') {
          await captureAndRespond(404, { error: `Snapshot not found for key ${key}` });
          return;
        }

        if (config.onMiss === 'warn') {
          process.stderr.write(`[proxy] snapshot miss: ${key}\n`);
        }

        const upstream = await forwardUpstream();

        if (config.onMiss === 'record') {
          await writeSnapshot(route, key, requestBody, upstream.body);
        }

        const exchange: CapturedExchange = {
          timestamp: new Date().toISOString(),
          route: route.path,
          request: {
            method,
            path: requestUrl.pathname,
            headers: capturedRequestHeaders,
            body: requestBody,
          },
          response: { status: upstream.status, body: upstream.body },
        };
        await appendFile(config.captureFile, `${JSON.stringify(exchange)}\n`);

        writeUpstreamResponse(response, upstream);
        return;
      }

      if (route.mode === 'record') {
        const upstream = await forwardUpstream();
        const key = getSnapshotKeyFromRequestBody(requestBody);

        const exchange: CapturedExchange = {
          timestamp: new Date().toISOString(),
          route: route.path,
          request: {
            method,
            path: requestUrl.pathname,
            headers: capturedRequestHeaders,
            body: requestBody,
          },
          response: { status: upstream.status, body: upstream.body },
        };
        await appendFile(config.captureFile, `${JSON.stringify(exchange)}\n`);
        await writeSnapshot(route, key, requestBody, upstream.body);

        writeUpstreamResponse(response, upstream);
        return;
      }

      writeJson(response, 501, {
        error: `Unsupported proxy mode ${route.mode as string}`,
      });
    } catch (error) {
      writeJson(response, 502, {
        error: error instanceof Error ? error.message : 'Proxy request failed',
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine proxy server address');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await closeServer(server);
    },
  };
}
