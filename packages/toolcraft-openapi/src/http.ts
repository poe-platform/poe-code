import path from "node:path";
import { randomUUID } from "node:crypto";
import { text as designText } from "toolcraft-design";
import {
  HttpError,
  UserError,
  createHttpError,
  type HandlerEnv,
  type HandlerFs,
  type HttpErrorRequest,
  type HttpErrorResponse,
  type RuntimeLogger
} from "toolcraft";
import type { TokenSource } from "./auth/types.js";
import { classifyNetworkError } from "./network-error.js";
import { redactHeaders, redactHeaderValue, redactSensitiveQueryValues } from "./redaction.js";

export { HttpError };
export type { HttpErrorRequest, HttpErrorResponse };

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
  diagnostics?: RuntimeLogger;
  signal?: AbortSignal;
  rawResponse?: boolean;
  retries?: {
    max: number;
    backoff: "exponential";
    retryOn: number[];
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
  };
  idempotency?: {
    header: string;
    enabled: boolean;
    key?: string;
    createKey?: () => string;
  };
}

export interface BinaryHttpResponse {
  contentType: string;
  encoding: "base64";
  byteLength: number;
  data: string;
}

interface MultipartFileInput {
  data: string;
  filename: string;
}

type RuntimeFileSystem = Pick<HandlerFs, "exists" | "readFile" | "writeFile">;
type RuntimeEnvironment = Pick<HandlerEnv, "get">;

type RequestShape = Partial<Pick<HttpRequestOptions, "pathParams" | "query" | "headers" | "body">>;

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
  const idempotencyHeader =
    options.idempotency?.enabled === true && method !== "GET"
      ? {
          [options.idempotency.header]:
            options.idempotency.key ?? options.idempotency.createKey?.() ?? randomUUID()
        }
      : {};
  const headers = createHeaders(
    token,
    hasBody,
    { ...options.headers, ...idempotencyHeader },
    options.accept,
    options.bodyMode,
    options.contentType
  );
  emitHttpDebug(options, `${method} ${url}`, { method, url });
  emitHttpTrace(
    options,
    "HTTP request transcript",
    formatVerboseRequestTranscript(method, url, headers, options.body)
  );

  const response = await fetchWithRetries(options, url, {
    method,
    headers,
    body: serializedBody,
    signal: options.signal
  });

  const contentType = response.headers.get("content-type");
  const request = createHttpErrorRequest(method, url, headers, options.body);
  const responseHeaders = redactHeaders(serializeHeaders(response.headers));

  if (response.ok && options.responseMode === "binary") {
    const bytes = new Uint8Array(await response.arrayBuffer());

    if (bytes.byteLength === 0) {
      emitHttpTrace(
        options,
        "HTTP response transcript",
        formatVerboseResponseTranscript(response, responseHeaders)
      );

      return formatRawResponseResult(undefined, response, options.rawResponse) as TResult;
    }

    const body: BinaryHttpResponse = {
      contentType: contentType ?? options.accept ?? "application/octet-stream",
      encoding: "base64",
      byteLength: bytes.byteLength,
      data: Buffer.from(bytes).toString("base64")
    };

    emitHttpTrace(
      options,
      "HTTP response transcript",
      formatVerboseResponseTranscript(response, responseHeaders, body)
    );

    return formatRawResponseResult(body, response, options.rawResponse) as TResult;
  }

  const text = await response.text();

  if (response.ok) {
    if (text.length === 0) {
      emitHttpTrace(
        options,
        "HTTP response transcript",
        formatVerboseResponseTranscript(response, responseHeaders)
      );

      return formatRawResponseResult(undefined, response, options.rawResponse) as TResult;
    }

    if (options.responseMode === "text") {
      emitHttpTrace(
        options,
        "HTTP response transcript",
        formatVerboseResponseTranscript(response, responseHeaders, text)
      );

      return formatRawResponseResult(text, response, options.rawResponse) as TResult;
    }

    if (!isJsonContentType(contentType)) {
      throw createHttpError({
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
      throw createHttpError({
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

    emitHttpTrace(
      options,
      "HTTP response transcript",
      formatVerboseResponseTranscript(response, responseHeaders, body)
    );

    return formatRawResponseResult(body, response, options.rawResponse) as TResult;
  }

  if (response.status === 401 && options.auth === "required") {
    await options.tokenSource.invalidate?.(token).catch(() => undefined);
  }

  const body = parseResponseBody(text, contentType);

  throw createHttpError({
    request,
    response: {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body
    },
    code: extractErrorCode(body),
    requestId:
      response.headers.get("x-request-id") ?? response.headers.get("x-requestid") ?? undefined
  });
}

async function fetchWithRetries(
  options: HttpRequestOptions,
  url: string,
  init: RequestInit
): Promise<Response> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const retries = options.retries;
  const maxRetries = retries?.max ?? 0;
  let attempt = 0;

  while (true) {
    try {
      const response = await fetchImpl(url, init);

      if (
        retries === undefined ||
        attempt >= maxRetries ||
        !shouldRetryStatus(response.status, retries.retryOn)
      ) {
        return response;
      }

      emitHttpDebug(options, `Retrying ${String(init.method ?? "GET")} ${url}`, {
        attempt: attempt + 1,
        status: response.status
      });
      await sleepBeforeRetry(response, retries, attempt);
      attempt += 1;
    } catch (error) {
      const classified = classifyNetworkError(error, url) ?? error;
      if (attempt >= maxRetries || retries === undefined) {
        throw classified;
      }

      emitHttpDebug(options, `Retrying ${String(init.method ?? "GET")} ${url}`, {
        attempt: attempt + 1,
        error: classified instanceof Error ? classified.message : String(classified)
      });
      await sleepBeforeRetry(undefined, retries, attempt);
      attempt += 1;
    }
  }
}

function emitHttpDebug(
  options: HttpRequestOptions,
  message: string,
  data?: Record<string, unknown>
): void {
  options.diagnostics?.emit({
    level: "debug",
    message,
    category: "http",
    data
  });
}

function emitHttpTrace(options: HttpRequestOptions, message: string, lines: string[]): void {
  options.diagnostics?.emit({
    level: "trace",
    message,
    category: "http",
    data: {
      transcript: formatTranscriptLines(lines)
    }
  });
}

function shouldRetryStatus(status: number, retryOn: readonly number[] | undefined): boolean {
  return retryOn?.includes(status) === true;
}

async function sleepBeforeRetry(
  response: Response | undefined,
  retries: NonNullable<HttpRequestOptions["retries"]>,
  attempt: number
): Promise<void> {
  const retryAfter = response?.headers.get("retry-after");
  const delay = parseRetryAfter(retryAfter) ?? calculateBackoffDelay(attempt, retries.random);
  await (retries.sleep ?? defaultSleep)(delay);
}

function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }

  return undefined;
}

function calculateBackoffDelay(attempt: number, random: (() => number) | undefined): number {
  const base = 100 * 2 ** attempt;
  return Math.floor(base * (random ?? Math.random)());
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatRawResponseResult<T>(
  data: T,
  response: Response,
  rawResponse: boolean | undefined
): T | { data: T; response: Response } {
  return rawResponse === true ? { data, response } : data;
}

export async function prepareMultipartFileInputs(
  requestShape: RequestShape,
  options: {
    bodyMode?: HttpRequestOptions["bodyMode"];
    multipartBinaryFields?: readonly string[];
    fs?: RuntimeFileSystem;
    env?: RuntimeEnvironment;
  }
): Promise<RequestShape> {
  if (
    options.bodyMode !== "multipart" ||
    options.multipartBinaryFields === undefined ||
    options.multipartBinaryFields.length === 0 ||
    options.fs === undefined ||
    options.env === undefined ||
    requestShape.body === undefined
  ) {
    return requestShape;
  }

  if (
    requestShape.body === null ||
    typeof requestShape.body !== "object" ||
    Array.isArray(requestShape.body)
  ) {
    return requestShape;
  }

  const body = { ...(requestShape.body as Record<string, unknown>) };

  for (const field of options.multipartBinaryFields) {
    const value = body[field];

    if (typeof value !== "string") {
      continue;
    }

    const filePath = resolveUserPath(value, options.env);

    if (!(await options.fs.exists(filePath))) {
      continue;
    }

    body[field] = {
      data: await options.fs.readFile(filePath, "base64"),
      filename: path.basename(filePath) || field
    } satisfies MultipartFileInput;
  }

  return {
    ...requestShape,
    body
  };
}

export async function writeBinaryResponseOutput(
  result: unknown,
  outputPath: unknown,
  runtime: {
    fs?: RuntimeFileSystem;
    env?: RuntimeEnvironment;
  }
): Promise<unknown> {
  if (outputPath === undefined) {
    return result;
  }

  if (runtime.fs === undefined || runtime.env === undefined) {
    throw new UserError("Cannot write binary output without a Toolcraft file runtime.");
  }

  if (!isBinaryHttpResponse(result)) {
    throw new UserError("Cannot write an empty binary response to an output path.");
  }

  const resolvedOutputPath = resolveUserPath(String(outputPath), runtime.env);
  await runtime.fs.writeFile(resolvedOutputPath, result.data, { encoding: "base64" });

  return {
    output: resolvedOutputPath,
    byteLength: result.byteLength,
    contentType: result.contentType
  };
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
        appendQueryValue(
          searchParams,
          `${key}[${Array.isArray(value) ? `${index}][` : ""}${childKey}]`,
          childValue
        );
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

  if (!isValidBase64(body)) {
    throw new UserError("Base64 request bodies must contain valid base64 text.");
  }

  return Uint8Array.from(Buffer.from(body, "base64")).buffer;
}

function isValidBase64(value: string): boolean {
  const paddingLength = getBase64PaddingLength(value);

  if (paddingLength === null) {
    return false;
  }

  const unpaddedLength = value.length - paddingLength;
  if (unpaddedLength % 4 === 1) {
    return false;
  }

  if (paddingLength > 0 && value.length % 4 !== 0) {
    return false;
  }

  for (let index = 0; index < unpaddedLength; index += 1) {
    if (!isBase64Character(value[index] ?? "")) {
      return false;
    }
  }

  const normalized = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return Buffer.from(value, "base64").toString("base64") === normalized;
}

function getBase64PaddingLength(value: string): number | null {
  let paddingLength = 0;

  for (let index = value.length - 1; index >= 0 && value[index] === "="; index -= 1) {
    paddingLength += 1;
  }

  if (paddingLength > 2) {
    return null;
  }

  for (let index = 0; index < value.length - paddingLength; index += 1) {
    if (value[index] === "=") {
      return null;
    }
  }

  return paddingLength;
}

function isBase64Character(value: string): boolean {
  if (value.length !== 1) {
    return false;
  }

  const codePoint = value.charCodeAt(0);
  return (
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    (codePoint >= 0x61 && codePoint <= 0x7a) ||
    (codePoint >= 0x30 && codePoint <= 0x39) ||
    value === "+" ||
    value === "/"
  );
}

function decodeMultipartBinaryValue(value: unknown, fallbackFilename: string): MultipartFileInput {
  if (typeof value === "string") {
    return {
      data: value,
      filename: fallbackFilename
    };
  }

  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as Partial<MultipartFileInput>).data === "string" &&
    typeof (value as Partial<MultipartFileInput>).filename === "string"
  ) {
    return value as MultipartFileInput;
  }

  throw new UserError(
    "Multipart binary request fields must be base64 strings or resolved file inputs."
  );
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
      const file = decodeMultipartBinaryValue(value, key);
      form.append(key, new Blob([decodeBase64Body(file.data)]), file.filename);
    } else if (Array.isArray(value)) {
      for (const item of value) form.append(key, String(item));
    } else {
      form.append(key, String(value));
    }
  }
  return form;
}

function resolveUserPath(userPath: string, env: RuntimeEnvironment): string {
  if (path.isAbsolute(userPath)) {
    return path.normalize(userPath);
  }

  return path.resolve(env.get("INIT_CWD") ?? process.cwd(), userPath);
}

function isBinaryHttpResponse(value: unknown): value is BinaryHttpResponse {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as Partial<BinaryHttpResponse>).encoding === "base64" &&
    typeof (value as Partial<BinaryHttpResponse>).data === "string" &&
    typeof (value as Partial<BinaryHttpResponse>).byteLength === "number" &&
    typeof (value as Partial<BinaryHttpResponse>).contentType === "string"
  );
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

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function extractErrorCode(body: unknown): string | undefined {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }

  const directCode = (body as { code?: unknown }).code;
  if (typeof directCode === "string") {
    return directCode;
  }

  const error = (body as { error?: unknown }).error;
  if (error !== null && typeof error === "object" && !Array.isArray(error)) {
    const nestedCode = (error as { code?: unknown }).code;
    return typeof nestedCode === "string" ? nestedCode : undefined;
  }

  return undefined;
}

function isJsonContentType(contentType: string | null): boolean {
  if (contentType === null) {
    return false;
  }

  const normalized = contentType.toLowerCase();
  return normalized.includes("application/json") || normalized.includes("+json");
}
