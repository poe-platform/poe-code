import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { UserError } from "toolcraft";
import { renderSourceSnippet } from "toolcraft/source-snippet";
import type { OpenApiDocument } from "./generate.js";
import { classifyNetworkError } from "./network-error.js";

export interface OpenApiSourceFileSystem {
  readFile(filePath: string, encoding: BufferEncoding): Promise<string>;
}

export interface OpenApiSourceServices {
  cwd: string;
  fetch: typeof globalThis.fetch;
  fs: OpenApiSourceFileSystem;
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
      throw new UserError(`Unsupported OpenAPI input URL protocol ${JSON.stringify(inputUrl.protocol)}.`);
    }

    let response: Response;

    try {
      response = await services.fetch(inputUrl.toString());
    } catch (error) {
      throw classifyNetworkError(error, inputUrl.toString()) ?? error;
    }

    if (!response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      const text = await response.text().catch(() => "");
      const snippet = text.length === 0 ? "" : `\n  body: ${truncate(text, 500)}`;

      throw new UserError(
        `Failed to fetch ${JSON.stringify(inputUrl.toString())}: ` +
          `${response.status} ${response.statusText}` +
          (contentType ? ` (content-type: ${contentType})` : "") +
          snippet
      );
    }

    return await response.text();
  } catch (error) {
    if (error instanceof UserError) {
      throw error;
    }

    throw new UserError(
      `Failed to read OpenAPI document ${JSON.stringify(sourceLabel)}: ${getErrorMessage(error)}`
    );
  }
}

export function parseOpenApiDocument(sourceText: string, input: string | URL): OpenApiDocument {
  let parsed: unknown;

  try {
    parsed = parseYaml(sourceText);
  } catch (error) {
    throw new UserError(
      `Failed to parse OpenAPI document ${JSON.stringify(formatSourceLabel(input))}: ${formatParseErrorMessage(error, sourceText, formatSourceLabel(input))}`
    );
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
