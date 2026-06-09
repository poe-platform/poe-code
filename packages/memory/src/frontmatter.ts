import { parse, stringify } from "yaml";
import type { PageFrontmatter, SourceRef } from "./types.js";

export interface ParsedFrontmatter {
  frontmatter: PageFrontmatter;
  body: string;
}

export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const content = markdown.startsWith("\uFEFF") ? markdown.slice(1) : markdown;
  const openingLineBreak = readOpeningLineBreak(content);
  if (openingLineBreak === undefined) {
    return {
      frontmatter: {},
      body: markdown
    };
  }

  const frontmatterStart = 3 + openingLineBreak.length;
  const closingFenceIndex = findClosingFence(content, frontmatterStart);
  const yamlBlock = content.slice(frontmatterStart, closingFenceIndex);
  const bodyStart = closingFenceIndex + 4;

  return {
    frontmatter: parsePageFrontmatter(parseYamlFrontmatter(yamlBlock)),
    body: readBody(content, bodyStart)
  };
}

export function serializeFrontmatter(frontmatter: PageFrontmatter, body: string): string {
  const serialized = {
    ...(frontmatter.name === undefined ? {} : { name: frontmatter.name }),
    ...(frontmatter.description === undefined ? {} : { description: frontmatter.description }),
    ...(frontmatter.lastTouchedAt === undefined
      ? {}
      : { last_touched_at: frontmatter.lastTouchedAt }),
    ...(frontmatter.sources === undefined || frontmatter.sources.length === 0
      ? {}
      : { sources: frontmatter.sources.map((source) => serializeSourceRef(source)) })
  };

  if (Object.keys(serialized).length === 0) {
    return body;
  }

  return `---\n${stringify(serialized).trimEnd()}\n---\n${body}`;
}

export function parseSourceRef(serialized: string): SourceRef {
  const [rawPath, rawAnchor] = serialized.split("#", 2);
  const normalizedPath = rawPath?.trim();
  if (normalizedPath === undefined || normalizedPath.length === 0) {
    throw new Error(`Invalid source ref "${serialized}".`);
  }

  if (rawAnchor === undefined) {
    return { path: normalizedPath };
  }

  const singleLineMatch = /^L(\d+)$/.exec(rawAnchor);
  if (singleLineMatch !== null) {
    const startLine = Number.parseInt(singleLineMatch[1], 10);
    assertValidLineNumber(startLine, serialized);
    return {
      path: normalizedPath,
      startLine
    };
  }

  const rangeMatch = /^L(\d+)-L?(\d+)$/.exec(rawAnchor);
  if (rangeMatch !== null) {
    const startLine = Number.parseInt(rangeMatch[1], 10);
    const endLine = Number.parseInt(rangeMatch[2], 10);
    assertValidLineNumber(startLine, serialized);
    assertValidLineNumber(endLine, serialized);
    if (endLine < startLine) {
      throw new Error(`Invalid source ref "${serialized}": line range is reversed.`);
    }

    return {
      path: normalizedPath,
      startLine,
      endLine
    };
  }

  throw new Error(`Invalid source ref "${serialized}".`);
}

export function serializeSourceRef(source: SourceRef): string {
  if (source.path.trim().length === 0) {
    throw new Error("Source path cannot be empty.");
  }

  if (source.startLine === undefined) {
    if (source.endLine !== undefined) {
      throw new Error("Source endLine requires startLine.");
    }

    return source.path;
  }

  assertValidLineNumber(source.startLine, source.path);
  if (source.endLine === undefined) {
    return `${source.path}#L${source.startLine}`;
  }

  assertValidLineNumber(source.endLine, source.path);
  if (source.endLine < source.startLine) {
    throw new Error(`Invalid source ref "${source.path}": line range is reversed.`);
  }

  return `${source.path}#L${source.startLine}-L${source.endLine}`;
}

function readOpeningLineBreak(markdown: string): "\n" | "\r\n" | undefined {
  if (!markdown.startsWith("---")) {
    return undefined;
  }

  const nextCharacter = markdown[3];
  if (nextCharacter === "\n") {
    return "\n";
  }

  if (nextCharacter === "\r" && markdown[4] === "\n") {
    return "\r\n";
  }

  return nextCharacter === undefined ? "\n" : undefined;
}

function findClosingFence(markdown: string, searchFrom: number): number {
  let currentIndex = searchFrom - 1;

  while (currentIndex < markdown.length) {
    const candidateIndex = markdown.indexOf("\n---", currentIndex);
    if (candidateIndex === -1) {
      throw new Error("Missing YAML frontmatter end delimiter (---).");
    }

    const fenceEnd = candidateIndex + 4;
    const nextCharacter = markdown[fenceEnd];
    if (nextCharacter === "\n" || nextCharacter === undefined) {
      return candidateIndex;
    }

    if (nextCharacter === "\r" && markdown[fenceEnd + 1] === "\n") {
      return candidateIndex;
    }

    currentIndex = fenceEnd;
  }

  throw new Error("Missing YAML frontmatter end delimiter (---).");
}

function readBody(markdown: string, bodyStart: number): string {
  const nextCharacter = markdown[bodyStart];
  if (nextCharacter === "\n") {
    return markdown.slice(bodyStart + 1);
  }

  if (nextCharacter === "\r" && markdown[bodyStart + 1] === "\n") {
    return markdown.slice(bodyStart + 2);
  }

  return markdown.slice(bodyStart);
}

function parseYamlFrontmatter(yamlBlock: string): Record<string, unknown> {
  const normalizedYamlBlock = yamlBlock.includes("\r")
    ? yamlBlock.replaceAll("\r\n", "\n").replaceAll("\r", "")
    : yamlBlock;

  let parsed: unknown;
  try {
    parsed = parse(normalizedYamlBlock);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown YAML parse error";
    throw new Error(`Invalid YAML frontmatter: ${message}`);
  }

  if (parsed === null) {
    return {};
  }

  if (!isRecord(parsed)) {
    throw new Error("YAML frontmatter must parse to an object.");
  }

  return parsed;
}

function parsePageFrontmatter(value: Record<string, unknown>): PageFrontmatter {
  const name = readOptionalString(getOwnEntry(value, "name"), "name");
  const description = readOptionalString(getOwnEntry(value, "description"), "description");
  const lastTouchedAt = readOptionalString(
    getOwnEntry(value, "last_touched_at") ?? getOwnEntry(value, "lastTouchedAt"),
    "last_touched_at"
  );
  const sources = parseSources(getOwnEntry(value, "sources"));

  return {
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    ...(lastTouchedAt === undefined ? {} : { lastTouchedAt }),
    ...(sources === undefined ? {} : { sources })
  };
}

function parseSources(value: unknown): SourceRef[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error('Invalid "sources" frontmatter. Expected an array.');
  }

  return value.map((item) => {
    if (typeof item === "string") {
      return parseSourceRef(item);
    }

    if (!isRecord(item)) {
      throw new Error('Invalid "sources" frontmatter. Expected each source to be a string or object.');
    }

    const path = readRequiredString(getOwnEntry(item, "path"), "sources[].path");
    const startLine = readOptionalPositiveInteger(
      getOwnEntry(item, "startLine"),
      "sources[].startLine"
    );
    const endLine = readOptionalPositiveInteger(getOwnEntry(item, "endLine"), "sources[].endLine");
    return parseSourceRef(serializeSourceRef({ path, ...(startLine === undefined ? {} : { startLine }), ...(endLine === undefined ? {} : { endLine }) }));
  });
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Invalid "${field}" frontmatter. Expected a string.`);
  }

  return value;
}

function readRequiredString(value: unknown, field: string): string {
  const parsed = readOptionalString(value, field);
  if (parsed === undefined) {
    throw new Error(`Invalid "${field}" frontmatter. Expected a string.`);
  }

  return parsed;
}

function readOptionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid "${field}" frontmatter. Expected a positive integer.`);
  }

  return value;
}

function assertValidLineNumber(line: number, value: string): void {
  if (!Number.isInteger(line) || line <= 0) {
    throw new Error(`Invalid source ref "${value}": line numbers must be positive integers.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}
