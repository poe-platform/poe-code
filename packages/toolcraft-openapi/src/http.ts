import { text as designText } from "toolcraft-design";
import { UserError } from "toolcraft";
import type { TokenSource } from "./auth/types.js";
import { classifyNetworkError } from "./network-error.js";
import { redactHeaders, redactHeaderValue, redactSensitiveQueryValues } from "./redaction.js";

type QueryScalar = string | number | boolean | null | undefined;
type QueryObject = { readonly [key: string]: QueryValue };
type HeaderScalar = string | number | boolean | undefined;
const TRANSCRIPT_BODY_BYTE_LIMIT = 4 * 1024;

export type QueryValue = QueryScalar | QueryValue[] | QueryObject;

export interface HttpRequestOptions {
  baseUrl: string;
  path: string;
  method: string;
  tokenSource: TokenSource;
  auth: "required" | "none";
  fetch?: typeof globalThis.fetch;
  pathParams?: Record<string, string | number | boolean>;
  query?: Record<string, QueryValue>;
  headers?: Record<string, HeaderScalar>;
  body?: unknown;
  bodyMode?: "json" | "form" | "raw" | "base64" | "multipart";
  contentType?: string;
  multipartBinaryFields?: readonly string[];
  responseMode?: "json" | "text" | "binary";
  accept?: string;
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

export interface BinaryHttpResponse {
  contentType: string;
  encoding: "base64";
  byteLength: number;
  data: string;
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
  const serializedBody = hasBody
    ? options.bodyMode === "form"
      ? serializeFormBody(options.body)
      : options.bodyMode === "raw"
        ? serializeRawBody(options.body)
        : options.bodyMode === "base64"
          ? decodeBase64Body(options.body)
          : options.bodyMode === "multipart"
            ? serializeMultipartBody(options.body, options.multipartBinaryFields)
            : JSON.stringify(options.body)
    : undefined;
  const url = buildRequestUrl(options);
  const headers = createHeaders(
    token,
    hasBody,
    options.headers,
    options.accept,
    options.bodyMode,
    options.contentType
  );
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

  const contentType = response.headers.get("content-type");
  const request = createHttpErrorRequest(method, url, headers, options.body);
  const responseHeaders = redactHeaders(serializeHeaders(response.headers));

  if (response.ok && options.responseMode === "binary") {
    const bytes = new Uint8Array(await response.arrayBuffer());

    if (bytes.byteLength === 0) {
      if (options.verbose) {
        writeStderr(
          formatTranscriptLines(formatVerboseResponseTranscript(response, responseHeaders))
        );
      }

      return undefined;
    }

    const body: BinaryHttpResponse = {
      contentType: contentType ?? options.accept ?? "application/octet-stream",
      encoding: "base64",
      byteLength: bytes.byteLength,
      data: Buffer.from(bytes).toString("base64")
    };

    if (options.verbose) {
      writeStderr(
        formatTranscriptLines(formatVerboseResponseTranscript(response, responseHeaders, body))
      );
    }

    return body as TResult;
  }

  const text = await response.text();

  if (response.ok) {
    if (text.length === 0) {
      if (options.verbose) {
        writeStderr(
          formatTranscriptLines(formatVerboseResponseTranscript(response, responseHeaders))
        );
      }

      return undefined;
    }

    if (options.responseMode === "text") {
      if (options.verbose) {
        writeStderr(
          formatTranscriptLines(formatVerboseResponseTranscript(response, responseHeaders, text))
        );
      }

      return text as TResult;
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
  if (isQueryObject(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      appendQueryValue(searchParams, `${key}[${childKey}]`, childValue);
    }
    return;
  }

  const values = Array.isArray(value) ? value : [value];

  for (const [index, entry] of values.entries()) {
    if (entry === undefined) {
      continue;
    }

    if (isQueryObject(entry)) {
      for (const [childKey, childValue] of Object.entries(entry)) {
        appendQueryValue(searchParams, `${key}[${Array.isArray(value) ? `${index}][` : ""}${childKey}]`, childValue);
      }
      continue;
    }

    searchParams.append(key, entry === null ? "" : String(entry));
  }
}

function serializeFormBody(body: unknown): string {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new UserError("URL-encoded form bodies must be objects.");
  }

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    appendQueryValue(searchParams, key, value as QueryValue);
  }
  return searchParams.toString();
}

function serializeRawBody(body: unknown): string {
  if (typeof body !== "string") {
    throw new UserError("Raw request bodies must be strings.");
  }

  return body;
}

function decodeBase64Body(body: unknown): ArrayBuffer {
  if (typeof body !== "string") {
    throw new UserError("Base64 request bodies must be strings.");
  }

  return Uint8Array.from(Buffer.from(body, "base64")).buffer;
}

function serializeMultipartBody(body: unknown, binaryFields: readonly string[] = []): FormData {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new UserError("Multipart request bodies must be objects.");
  }

  const binary = new Set(binaryFields);
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue;
    if (binary.has(key)) {
      form.append(key, new Blob([decodeBase64Body(value)]), key);
    } else if (Array.isArray(value)) {
      for (const item of value) form.append(key, String(item));
    } else {
      form.append(key, String(value));
    }
  }
  return form;
}

function isQueryObject(value: QueryValue): value is QueryObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createHeaders(
  token: string | undefined,
  hasBody: boolean,
  customHeaders: Record<string, HeaderScalar> | undefined,
  accept = "application/json",
  bodyMode: "json" | "form" | "raw" | "base64" | "multipart" = "json",
  contentType?: string
): Record<string, string> {
  const headers = Object.fromEntries(
    Object.entries(customHeaders ?? {})
      .filter(
        ([name, value]) =>
          value !== undefined &&
          !["accept", "content-type"].includes(name.toLowerCase()) &&
          !(token !== undefined && name.toLowerCase() === "authorization")
      )
      .map(([name, value]) => [name, String(value)])
  );

  return {
    ...headers,
    Accept: accept,
    ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    ...(hasBody && bodyMode !== "multipart"
      ? {
          "Content-Type":
            contentType ??
            (bodyMode === "form" ? "application/x-www-form-urlencoded" : "application/json")
        }
      : {})
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
