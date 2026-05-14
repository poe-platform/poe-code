import path from "node:path";
import { UserError } from "toolcraft";
import { renderSourceSnippet } from "toolcraft/source-snippet";

export interface OpenApiLock {
  specSha: string;
}

interface OpenApiLockDocument extends OpenApiLock {
  version: 1;
}

export interface LockFileSystem {
  mkdir(directoryPath: string, options?: { recursive?: boolean }): Promise<unknown>;
  readFile(filePath: string, encoding: BufferEncoding): Promise<string>;
  writeFile(filePath: string, contents: string, encoding: BufferEncoding): Promise<void>;
}

export function parseOpenApiLock(contents: string, lockPath: string): OpenApiLock | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new UserError(formatJsonParseError(lockPath, contents, error), { cause: error });
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 1 ||
    typeof (parsed as { specSha?: unknown }).specSha !== "string" ||
    (parsed as { specSha: string }).specSha.length === 0
  ) {
    return null;
  }

  return {
    specSha: (parsed as { specSha: string }).specSha
  };
}

export function stringifyOpenApiLock(lock: OpenApiLock): string {
  const document: OpenApiLockDocument = {
    version: 1,
    specSha: lock.specSha
  };

  return `${JSON.stringify(document, null, 2)}\n`;
}

export async function readOpenApiLock(
  fs: Pick<LockFileSystem, "readFile">,
  lockPath: string
): Promise<OpenApiLock | null> {
  try {
    return parseOpenApiLock(await fs.readFile(lockPath, "utf8"), lockPath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

export async function writeOpenApiLock(
  fs: LockFileSystem,
  lockPath: string,
  lock: OpenApiLock
): Promise<void> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  try {
    await fs.writeFile(lockPath, stringifyOpenApiLock(lock), "utf8");
  } catch (error) {
    const code = getErrorCode(error);
    throw new UserError(
      `Failed to write lock file "${lockPath}"${code === undefined ? "" : ` (${code})`}: ${getErrorMessage(error)}`,
      { cause: error }
    );
  }
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatJsonParseError(lockPath: string, source: string, error: unknown): string {
  const location = getJsonParseErrorLocation(error, source);
  const message = getErrorMessage(error);

  if (location === null) {
    return `Lock file "${lockPath}" is not valid JSON: ${message}.`;
  }

  return (
    `Lock file "${lockPath}" is not valid JSON: ${message} ` +
    `at line ${location.line} column ${location.column}.\n` +
    renderSourceSnippet({
      source,
      line: location.line,
      column: location.column,
      filePath: lockPath
    })
  );
}

function getJsonParseErrorLocation(
  error: unknown,
  source: string
): { line: number; column: number } | null {
  const causeLocation = getJsonParseCauseLocation(error);

  if (causeLocation !== null) {
    return causeLocation;
  }

  const directPosition = getNumericProperty(error, "position");

  if (directPosition !== null) {
    return getSourceOffsetLocation(source, directPosition);
  }

  const messagePosition = getJsonParseMessagePosition(getErrorMessage(error));

  if (messagePosition !== null) {
    return getSourceOffsetLocation(source, messagePosition);
  }

  return null;
}

function getJsonParseCauseLocation(error: unknown): { line: number; column: number } | null {
  if (typeof error !== "object" || error === null || !("cause" in error)) {
    return null;
  }

  const cause = error.cause;
  const line = getNumericProperty(cause, "line");
  const column = getNumericProperty(cause, "column") ?? getNumericProperty(cause, "col");

  if (line === null || column === null) {
    return null;
  }

  return { line, column };
}

function getNumericProperty(value: unknown, key: string): number | null {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return null;
  }

  const propertyValue = (value as Record<string, unknown>)[key];

  return typeof propertyValue === "number" && Number.isFinite(propertyValue)
    ? propertyValue
    : null;
}

function getJsonParseMessagePosition(message: string): number | null {
  const marker = " at position ";
  const markerIndex = message.indexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  const startIndex = markerIndex + marker.length;
  let endIndex = startIndex;

  while (endIndex < message.length && isAsciiDigit(message[endIndex] ?? "")) {
    endIndex += 1;
  }

  if (endIndex === startIndex) {
    return null;
  }

  return Number.parseInt(message.slice(startIndex, endIndex), 10);
}

function getSourceOffsetLocation(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const boundedOffset = Math.max(0, Math.floor(offset));

  for (let index = 0; index < boundedOffset && index < source.length; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { line, column };
}

function isAsciiDigit(value: string): boolean {
  return value >= "0" && value <= "9";
}

function getErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as NodeJS.ErrnoException).code === "string"
  ) {
    return (error as NodeJS.ErrnoException).code;
  }

  return undefined;
}
