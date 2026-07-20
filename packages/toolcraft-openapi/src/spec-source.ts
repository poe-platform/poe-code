import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { UserError } from "toolcraft";
import { renderSourceSnippet } from "toolcraft/source-snippet";
import type { OpenApiDocument } from "./generate.js";
import { classifyNetworkError } from "./network-error.js";
import { redactSensitiveQueryValues } from "./redaction.js";

export interface OpenApiSourceFileSystem {
  readFile(filePath: string, encoding: BufferEncoding): Promise<string>;
}

export interface OpenApiSourceServices {
  cwd: string;
  fetch: typeof globalThis.fetch;
  fs: OpenApiSourceFileSystem;
}

export interface OpenApiHttpSourceOptions {
  etag?: string;
  timeoutMs?: number;
}

export type OpenApiHttpSourceResult =
  | {
      status: "modified";
      sourceText: string;
      etag?: string;
      cacheControl?: string;
      age?: string;
    }
  | {
      status: "not-modified";
      etag?: string;
      cacheControl?: string;
      age?: string;
    };

export class OpenApiHttpStatusError extends UserError {}
export class OpenApiTransportError extends UserError {}
export class OpenApiTimeoutError extends OpenApiTransportError {
  constructor(
    message: string,
    readonly timeoutMs: number,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

export async function readOpenApiSourceText(
  input: string | URL,
  services: OpenApiSourceServices
): Promise<string> {
  const inputUrl = input instanceof URL ? input : tryParseUrl(input);
  const sourceLabel = formatSourceLabel(input);

  try {
    if (typeof input === "string" && inputUrl === null) {
      return await services.fs.readFile(path.resolve(services.cwd, input), "utf8");
    }

    if (inputUrl === null) {
      throw new UserError(`Unsupported OpenAPI input ${JSON.stringify(sourceLabel)}.`);
    }

    if (inputUrl.protocol === "file:") {
      return await services.fs.readFile(fileURLToPath(inputUrl), "utf8");
    }

    if (inputUrl.protocol !== "http:" && inputUrl.protocol !== "https:") {
      throw new UserError(
        `Unsupported OpenAPI input URL protocol ${JSON.stringify(inputUrl.protocol)}.`
      );
    }

    const result = await fetchOpenApiHttpSource(inputUrl, services.fetch);
    if (result.status === "not-modified") {
      throw new UserError(
        `Failed to fetch ${JSON.stringify(inputUrl.toString())}: received 304 without a cached document.`
      );
    }

    return result.sourceText;
  } catch (error) {
    if (error instanceof UserError) {
      throw error;
    }

    throw new UserError(
      `Failed to read OpenAPI document ${JSON.stringify(sourceLabel)}: ${getErrorMessage(error)}`
    );
  }
}

export async function fetchOpenApiHttpSource(
  inputUrl: URL,
  fetch: typeof globalThis.fetch,
  options: OpenApiHttpSourceOptions = {}
): Promise<OpenApiHttpSourceResult> {
  validateTimeout(options.timeoutMs);
  const url = inputUrl.toString();
  const timeoutMs = options.timeoutMs;
  const controller = timeoutMs === undefined || timeoutMs === 0 ? undefined : new AbortController();
  const requestInit = createOpenApiRequestInit(options.etag, controller?.signal);

  const request = async (): Promise<OpenApiHttpSourceResult> => {
    let response: Response;
    try {
      response = requestInit === undefined ? await fetch(url) : await fetch(url, requestInit);
    } catch (error) {
      throw toTransportError(error, url) ?? error;
    }

    if (response.status === 304) {
      return {
        status: "not-modified",
        ...readResponseCacheHeaders(response)
      };
    }

    if (!response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      const text = await response.text().catch(() => "");
      const snippet = text.length === 0 ? "" : `\n  body: ${truncate(text, 500)}`;

      throw new OpenApiHttpStatusError(
        `Failed to fetch ${JSON.stringify(url)}: ` +
          `${response.status} ${response.statusText}` +
          (contentType ? ` (content-type: ${contentType})` : "") +
          snippet
      );
    }

    try {
      return {
        status: "modified",
        sourceText: await response.text(),
        ...readResponseCacheHeaders(response)
      };
    } catch (error) {
      throw (
        toTransportError(error, url) ??
        new OpenApiTransportError(
          `Failed to read the OpenAPI response body from ${JSON.stringify(redactSensitiveQueryValues(url))}.`,
          { cause: error }
        )
      );
    }
  };

  if (controller === undefined || timeoutMs === undefined) {
    return await request();
  }

  const timeoutCause = Object.assign(new Error("OpenAPI request timed out"), {
    code: "ETIMEDOUT",
    timeout: timeoutMs
  });
  const classified = classifyNetworkError(timeoutCause, url);
  const timeoutError = new OpenApiTimeoutError(
    classified?.message ?? `OpenAPI request timed out after ${timeoutMs}ms.`,
    timeoutMs,
    { cause: timeoutCause }
  );
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      request(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(timeoutError);
          controller.abort(timeoutError);
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function toTransportError(error: unknown, url: string): OpenApiTransportError | null {
  if (error instanceof OpenApiTransportError) {
    return error;
  }

  const classified = classifyNetworkError(error, url);
  return classified === null
    ? null
    : new OpenApiTransportError(classified.message, { cause: error });
}

function createOpenApiRequestInit(
  etag: string | undefined,
  signal: AbortSignal | undefined
): RequestInit | undefined {
  if (etag === undefined && signal === undefined) {
    return undefined;
  }

  return {
    ...(etag === undefined ? {} : { headers: { "If-None-Match": etag } }),
    ...(signal === undefined ? {} : { signal })
  };
}

function readResponseCacheHeaders(response: Response): {
  etag?: string;
  cacheControl?: string;
  age?: string;
} {
  const etag = response.headers.get("etag") ?? undefined;
  const cacheControl = response.headers.get("cache-control") ?? undefined;
  const age = response.headers.get("age") ?? undefined;
  return {
    ...(etag === undefined ? {} : { etag }),
    ...(cacheControl === undefined ? {} : { cacheControl }),
    ...(age === undefined ? {} : { age })
  };
}

function validateTimeout(timeoutMs: number | undefined): void {
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
    throw new UserError("OpenAPI fetch timeout must be a finite non-negative number.");
  }
}

export function parseOpenApiDocument(sourceText: string, input: string | URL): OpenApiDocument {
  let parsed: unknown;

  try {
    parsed = JSON.parse(sourceText) as unknown;
  } catch {
    try {
      parsed = parseYaml(sourceText);
    } catch (error) {
      throw new UserError(
        `Failed to parse OpenAPI document ${JSON.stringify(formatSourceLabel(input))}: ${formatParseErrorMessage(error, sourceText, formatSourceLabel(input))}`
      );
    }
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new UserError(
      `OpenAPI document ${JSON.stringify(formatSourceLabel(input))} must parse to an object.`
    );
  }

  return parsed as OpenApiDocument;
}

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function formatSourceLabel(source: string | URL): string {
  return source instanceof URL ? source.toString() : source;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function formatParseErrorMessage(error: unknown, sourceText: string, filePath: string): string {
  const message = getErrorMessage(error);
  const linePosition = getYamlLinePosition(error) ?? getYamlOffsetPosition(error, sourceText);

  if (linePosition === null) {
    // yaml parse errors do not always expose positional metadata for every failure mode.
    return message;
  }

  const positionText = `at line ${linePosition.line} column ${linePosition.column}`;

  const messageWithPosition = message.includes(positionText)
    ? message
    : `${message} (${positionText})`;

  return `${messageWithPosition}\n${renderSourceSnippet({
    source: sourceText,
    line: linePosition.line,
    column: linePosition.column,
    filePath
  })}`;
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}

function getYamlLinePosition(error: unknown): { line: number; column: number } | null {
  if (typeof error !== "object" || error === null || !hasOwnProperty(error, "linePos")) {
    return null;
  }

  const linePos = error.linePos;

  if (!Array.isArray(linePos) || linePos.length === 0) {
    return null;
  }

  const firstPosition = linePos[0];

  if (typeof firstPosition !== "object" || firstPosition === null) {
    return null;
  }

  const line = hasOwnProperty(firstPosition, "line") ? firstPosition.line : undefined;
  const column = hasOwnProperty(firstPosition, "col") ? firstPosition.col : undefined;

  if (typeof line !== "number" || typeof column !== "number") {
    return null;
  }

  return { line, column };
}

function getYamlOffsetPosition(
  error: unknown,
  sourceText: string
): { line: number; column: number } | null {
  if (typeof error !== "object" || error === null || !hasOwnProperty(error, "pos")) {
    return null;
  }

  const pos = error.pos;

  if (!Array.isArray(pos) || typeof pos[0] !== "number" || pos[0] < 0) {
    return null;
  }

  return getSourceTextPosition(sourceText, pos[0]);
}

function getSourceTextPosition(
  sourceText: string,
  offset: number
): { line: number; column: number } {
  let line = 1;
  let column = 1;

  for (let index = 0; index < offset && index < sourceText.length; index += 1) {
    if (sourceText[index] === "\n") {
      line += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { line, column };
}

function truncate(value: string, maxLength: number): string {
  const collapsed = collapseToSingleLine(value);

  if (collapsed.length <= maxLength) {
    return collapsed;
  }

  return `${collapsed.slice(0, maxLength)}…`;
}

function collapseToSingleLine(value: string): string {
  const characters: string[] = [];
  let previousWasWhitespace = false;

  for (const character of value) {
    if (isWhitespace(character)) {
      if (!previousWasWhitespace) {
        characters.push(" ");
        previousWasWhitespace = true;
      }

      continue;
    }

    characters.push(character);
    previousWasWhitespace = false;
  }

  return characters.join("").trim();
}

function isWhitespace(character: string): boolean {
  return character.trim().length === 0;
}
