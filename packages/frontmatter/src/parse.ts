import { LineCounter, parse, parseDocument } from "yaml";
import { splitFrontmatterBlock } from "./fences.js";

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface ParsedFrontmatterDocument extends ParsedFrontmatter {
  errors: readonly { message: string; pos?: [number, number] }[];
  lineCounter: LineCounter;
}

export interface ParseFrontmatterOptions {
  uniqueKeys?: boolean;
}

export class FrontmatterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontmatterParseError";
  }
}

export function parseFrontmatter(
  source: string,
  options: ParseFrontmatterOptions = {}
): ParsedFrontmatter {
  const split = splitFrontmatter(source);

  if (split.raw === undefined) {
    return {
      frontmatter: {},
      body: split.body
    };
  }

  return {
    frontmatter: parseYamlFrontmatter(split.raw, options),
    body: split.body
  };
}

export function parseFrontmatterDocument(
  source: string,
  options: ParseFrontmatterOptions = {}
): ParsedFrontmatterDocument {
  const split = splitFrontmatter(source);
  const lineCounter = new LineCounter();

  if (split.raw === undefined) {
    return {
      frontmatter: {},
      body: split.body,
      errors: [],
      lineCounter
    };
  }

  const document = parseDocument(normalizeYamlLineEndings(split.raw), {
    lineCounter,
    prettyErrors: false,
    uniqueKeys: options.uniqueKeys ?? false
  });
  const errors = document.errors.map((error) => ({
    message: error.message,
    ...(error.pos === undefined ? {} : { pos: error.pos as [number, number] })
  }));

  if (errors.length > 0) {
    return {
      frontmatter: {},
      body: split.body,
      errors,
      lineCounter
    };
  }

  return {
    frontmatter: normalizeYamlFrontmatter(document.toJSON()),
    body: split.body,
    errors,
    lineCounter
  };
}

function splitFrontmatter(source: string): { raw?: string; body: string } {
  try {
    return splitFrontmatterBlock(source);
  } catch (error) {
    if (error instanceof Error) {
      throw new FrontmatterParseError(error.message);
    }

    throw error;
  }
}

function parseYamlFrontmatter(
  yamlBlock: string,
  options: ParseFrontmatterOptions
): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = parse(normalizeYamlLineEndings(yamlBlock), {
      uniqueKeys: options.uniqueKeys ?? false
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown YAML parse error";
    throw new FrontmatterParseError(`Invalid YAML frontmatter: ${message}`);
  }

  return normalizeYamlFrontmatter(parsed);
}

function normalizeYamlLineEndings(value: string): string {
  if (!value.includes("\r")) {
    return value;
  }

  let normalized = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (character !== "\r") {
      normalized += character;
      continue;
    }

    if (value[index + 1] === "\n") {
      normalized += "\r\n";
      index += 1;
      continue;
    }

    normalized += "\n";
  }

  return normalized;
}

function normalizeYamlFrontmatter(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new FrontmatterParseError("YAML frontmatter must parse to an object.");
  }

  return normalizeYamlValue(value) as Record<string, unknown>;
}

function normalizeYamlValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeYamlValue(item));
  }

  if (!isPlainRecord(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};

  for (const [key, entryValue] of Object.entries(value)) {
    Object.defineProperty(normalized, key, {
      configurable: true,
      enumerable: true,
      value: normalizeYamlValue(entryValue),
      writable: true
    });
  }

  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
