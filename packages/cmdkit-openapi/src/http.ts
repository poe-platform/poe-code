import { UserError } from "@poe-code/cmdkit";
import type { TokenSource } from "./auth/types.js";

type QueryScalar = string | number | boolean | null | undefined;

export type QueryValue = QueryScalar | QueryScalar[];

export interface HttpRequestOptions {
  baseUrl: string;
  path: string;
  method: string;
  tokenSource: TokenSource;
  auth: "required" | "none";
  fetch?: typeof globalThis.fetch;
  pathParams?: Record<string, string | number | boolean>;
  query?: Record<string, QueryValue>;
  body?: unknown;
  dryRun?: boolean;
  verbose?: boolean;
  signal?: AbortSignal;
  writeStdout?: (chunk: string) => void;
  writeStderr?: (chunk: string) => void;
}

export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message = `HTTP ${status}`) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

export async function requestJson<TResult = unknown>(
  options: HttpRequestOptions
): Promise<TResult | undefined> {
  const token = options.auth === "none" ? undefined : await options.tokenSource.getToken();
  const method = options.method.toUpperCase();
  const hasBody = options.body !== undefined;
  const serializedBody = hasBody ? JSON.stringify(options.body) : undefined;
  const url = buildRequestUrl(options);
  const headers = createHeaders(token, hasBody);
  const writeStdout = options.writeStdout ?? process.stdout.write.bind(process.stdout);
  const writeStderr = options.writeStderr ?? process.stderr.write.bind(process.stderr);
  const requestLine = `${method} ${url}`;

  if (options.verbose) {
    writeStderr(`${requestLine}\n`);
  }

  if (options.dryRun) {
    writeStdout(formatDryRunOutput(requestLine, headers, options.body));
    return undefined;
  }

  const response = await (options.fetch ?? globalThis.fetch)(url, {
    method,
    headers,
    body: serializedBody,
    signal: options.signal,
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type");

  if (response.ok) {
    if (text.length === 0) {
      return undefined;
    }

    if (!isJsonContentType(contentType)) {
      throw new HttpError(
        response.status,
        text,
        `Expected a JSON response body but received content-type ${JSON.stringify(
          contentType ?? "<missing>"
        )}.`
      );
    }

    return JSON.parse(text) as TResult;
  }

  if (response.status === 401) {
    await options.tokenSource.invalidate?.();
  }

  throw new HttpError(response.status, parseResponseBody(text, contentType));
}

function buildRequestUrl(options: HttpRequestOptions): string {
  const resolvedPath = substitutePathParams(options.path, options.pathParams);
  const baseUrl = new URL(options.baseUrl);
  const normalizedBasePath = baseUrl.pathname.endsWith("/")
    ? baseUrl.pathname.slice(0, -1)
    : baseUrl.pathname;
  const normalizedPath = resolvedPath.startsWith("/") ? resolvedPath : `/${resolvedPath}`;

  baseUrl.pathname = `${normalizedBasePath}${normalizedPath}`;

  for (const [key, value] of Object.entries(options.query ?? {})) {
    appendQueryValue(baseUrl.searchParams, key, value);
  }

  return baseUrl.toString();
}

function substitutePathParams(
  path: string,
  pathParams?: Record<string, string | number | boolean>
): string {
  const resolvedPath = path.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = pathParams?.[key];

    if (value === undefined) {
      throw new UserError(`Missing path parameter "${key}".`);
    }

    return encodeURIComponent(String(value));
  });

  if (resolvedPath.includes("{") || resolvedPath.includes("}")) {
    throw new UserError(`Invalid path template "${path}".`);
  }

  return resolvedPath;
}

function appendQueryValue(searchParams: URLSearchParams, key: string, value: QueryValue): void {
  const values = Array.isArray(value) ? value : [value];

  for (const entry of values) {
    if (entry === undefined) {
      continue;
    }

    searchParams.append(key, entry === null ? "" : String(entry));
  }
}

function createHeaders(token: string | undefined, hasBody: boolean): Record<string, string> {
  return {
    ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
  };
}

function formatDryRunOutput(
  requestLine: string,
  headers: Record<string, string>,
  body: unknown
): string {
  const lines = [
    requestLine,
    ...Object.entries(headers).map(([key, value]) => {
      const headerValue =
        key.toLowerCase() === "authorization" && value.startsWith("Bearer ")
          ? "Bearer ****"
          : value;

      return `${key}: ${headerValue}`;
    }),
    "",
  ];

  if (body !== undefined) {
    lines.push(JSON.stringify(body));
  }

  return `${lines.join("\n")}\n`;
}

function parseResponseBody(text: string, contentType: string | null): unknown {
  if (text.length === 0) {
    return undefined;
  }

  if (!isJsonContentType(contentType)) {
    return text;
  }

  return JSON.parse(text) as unknown;
}

function isJsonContentType(contentType: string | null): boolean {
  if (contentType === null) {
    return false;
  }

  const normalized = contentType.toLowerCase();
  return normalized.includes("application/json") || normalized.includes("+json");
}
