import { text as designText } from "toolcraft-design";
import { UserError } from "toolcraft";
import type { TokenSource } from "./auth/types.js";
import { classifyNetworkError } from "./network-error.js";
import { redactHeaders, redactHeaderValue, redactSensitiveQueryValues } from "./redaction.js";

type QueryScalar = string | number | boolean | null | undefined;
const TRANSCRIPT_BODY_BYTE_LIMIT = 4 * 1024;

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

export interface HttpErrorRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface HttpErrorResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
}

export class HttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly request: HttpErrorRequest;
  readonly response: HttpErrorResponse;

  get body(): unknown {
    return this.response.body;
  }

  constructor(args: { request: HttpErrorRequest; response: HttpErrorResponse; message?: string }) {
    super(
      args.message ??
        `${args.request.method} ${args.request.url} → ${args.response.status} ${args.response.statusText}`
    );
    this.name = "HttpError";
    this.status = args.response.status;
    this.statusText = args.response.statusText;
    this.request = args.request;
    this.response = args.response;
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
  const requestLine = `${method} ${redactSensitiveQueryValues(url)}`;

  if (options.dryRun) {
    writeStdout(formatDryRunOutput(requestLine, headers, options.body));
    return undefined;
  }

  if (options.verbose) {
    writeStderr(
      formatTranscriptLines(formatVerboseRequestTranscript(method, url, headers, options.body))
    );
  }

  let response: Response;

  try {
    response = await (options.fetch ?? globalThis.fetch)(url, {
      method,
      headers,
      body: serializedBody,
      signal: options.signal
    });
  } catch (error) {
    throw classifyNetworkError(error, url) ?? error;
  }

  const text = await response.text();
  const contentType = response.headers.get("content-type");
  const request = createHttpErrorRequest(method, url, headers, options.body);
  const responseHeaders = redactHeaders(serializeHeaders(response.headers));

  if (response.ok) {
    if (text.length === 0) {
      if (options.verbose) {
        writeStderr(
          formatTranscriptLines(formatVerboseResponseTranscript(response, responseHeaders))
        );
      }

      return undefined;
    }

    if (!isJsonContentType(contentType)) {
      if (options.verbose) {
        writeStderr(
          formatTranscriptLines(formatVerboseResponseTranscript(response, responseHeaders, text))
        );
      }

      throw new HttpError({
        request,
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          body: text
        },
        message: `Expected a JSON response body but received content-type ${JSON.stringify(
          contentType ?? "<missing>"
        )}.`
      });
    }

    let body: TResult;

    try {
      body = JSON.parse(text) as TResult;
    } catch {
      if (options.verbose) {
        writeStderr(
          formatTranscriptLines(formatVerboseResponseTranscript(response, responseHeaders, text))
        );
      }

      throw new HttpError({
        request,
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          body: text
        },
        message: "Expected a valid JSON response body but received malformed JSON."
      });
    }

    if (options.verbose) {
      writeStderr(
        formatTranscriptLines(formatVerboseResponseTranscript(response, responseHeaders, body))
      );
    }

    return body;
  }

  if (response.status === 401 && options.auth === "required") {
    await options.tokenSource.invalidate?.(token).catch(() => undefined);
  }

  const body = parseResponseBody(text, contentType);

  if (options.verbose) {
    writeStderr(
      formatTranscriptLines(formatVerboseResponseTranscript(response, responseHeaders, body))
    );
  }

  throw new HttpError({
    request,
    response: {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body
    }
  });
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
    const value =
      pathParams !== undefined && Object.prototype.hasOwnProperty.call(pathParams, key)
        ? pathParams[key]
        : undefined;

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
    ...(hasBody ? { "Content-Type": "application/json" } : {})
  };
}

function createHttpErrorRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: unknown
): HttpErrorRequest {
  return {
    method,
    url: redactSensitiveQueryValues(url),
    headers: redactHeaders(headers),
    ...(body === undefined ? {} : { body })
  };
}

function serializeHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

function formatDryRunOutput(
  requestLine: string,
  headers: Record<string, string>,
  body: unknown
): string {
  const lines = [
    requestLine,
    ...Object.entries(headers).map(([key, value]) => {
      const headerValue = redactHeaderValue(key, value);

      return `${key}: ${headerValue}`;
    }),
    ""
  ];

  if (body !== undefined) {
    lines.push(JSON.stringify(body));
  }

  return `${lines.join("\n")}\n`;
}

function formatVerboseRequestTranscript(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: unknown
): string[] {
  const lines = [
    `→ ${method} ${redactSensitiveQueryValues(url)}`,
    ...Object.entries(headers).map(([key, value]) => {
      const headerValue = redactHeaderValue(key, value);

      return `    ${key}: ${headerValue}`;
    })
  ];

  if (body !== undefined) {
    lines.push(...indentTranscriptBlock(formatTranscriptBody(body)));
  }

  return lines;
}

function formatVerboseResponseTranscript(
  response: Response,
  headers: Record<string, string>,
  body?: unknown
): string[] {
  const lines = [
    `← ${response.status} ${response.statusText}`,
    ...Object.entries(headers).map(([key, value]) => `    ${key}: ${value}`)
  ];

  if (body !== undefined) {
    lines.push(...indentTranscriptBlock(formatTranscriptBody(body)));
  }

  return lines;
}

function formatTranscriptLines(lines: string[]): string {
  return `${lines.map((line) => formatTranscriptLine(line)).join("\n")}\n`;
}

function formatTranscriptLine(line: string): string {
  if (!process.stderr.isTTY) {
    return line;
  }

  return designText.muted(line);
}

function formatTranscriptBody(body: unknown): string {
  const formatted = typeof body === "string" ? body : JSON.stringify(body, null, 2);

  return truncateTranscriptBody(formatted ?? String(body));
}

function indentTranscriptBlock(value: string): string[] {
  return value.split("\n").map((line) => `    ${line}`);
}

function truncateTranscriptBody(value: string): string {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(value);

  if (encoded.byteLength <= TRANSCRIPT_BODY_BYTE_LIMIT) {
    return value;
  }

  const truncatedChars: string[] = [];
  let truncatedByteLength = 0;

  for (const character of value) {
    const characterByteLength = encoder.encode(character).byteLength;

    if (truncatedByteLength + characterByteLength > TRANSCRIPT_BODY_BYTE_LIMIT) {
      break;
    }

    truncatedChars.push(character);
    truncatedByteLength += characterByteLength;
  }

  const truncatedBytes = encoded.byteLength - truncatedByteLength;

  return `${truncatedChars.join("")}\n… (${truncatedBytes} bytes truncated)`;
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
