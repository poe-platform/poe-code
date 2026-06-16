import { LineCounter, parse, parseDocument } from "yaml";
import { inspectFrontmatterBlock, splitFrontmatterBlock } from "./fences.js";

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
  const split = inspectFrontmatterBlock(source);
  const lineCounter = createSourceLineCounter(source);

  if (split.kind === "body") {
    return {
      frontmatter: {},
      body: split.body,
      errors: [],
      lineCounter
    };
  }

  if (split.kind === "missing-closing-fence") {
    return {
      frontmatter: {},
      body: split.body,
      errors: [{ message: split.message, pos: [split.position, split.position] }],
      lineCounter
    };
  }

  const yamlLineCounter = new LineCounter();
  const normalizedYaml = normalizeYamlLineEndings(split.raw);
  const document = parseDocument(normalizedYaml, {
    lineCounter: yamlLineCounter,
    prettyErrors: false,
    uniqueKeys: options.uniqueKeys ?? false
  });
  const errors = document.errors.map((error) => ({
    message: error.message,
    ...(error.pos === undefined
      ? {}
      : { pos: translateYamlErrorPosition(error.pos as [number, number], split) })
  }));

  if (errors.length > 0) {
    return {
      frontmatter: {},
      body: split.body,
      errors,
      lineCounter
    };
  }

  try {
    return {
      frontmatter: normalizeYamlFrontmatter(document.toJSON()),
      body: split.body,
      errors,
      lineCounter
    };
  } catch (error) {
    if (error instanceof FrontmatterParseError) {
      return {
        frontmatter: {},
        body: split.body,
        errors: [{ message: error.message }],
        lineCounter
      };
    }

    throw error;
  }
}

function createSourceLineCounter(source: string): LineCounter {
  const lineCounter = new LineCounter();
  lineCounter.addNewLine(0);

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (character === "\n") {
      lineCounter.addNewLine(index + 1);
      continue;
    }

    if (character === "\r") {
      lineCounter.addNewLine(index + (source[index + 1] === "\n" ? 2 : 1));
      if (source[index + 1] === "\n") {
        index += 1;
      }
    }
  }

  return lineCounter;
}

function translateYamlErrorPosition(
  pos: [number, number],
  split: { raw: string; rawStart: number }
): [number, number] {
  return pos.map((offset) => split.rawStart + normalizeYamlErrorOffset(split.raw, offset)) as [
    number,
    number
  ];
}

function normalizeYamlErrorOffset(raw: string, offset: number): number {
  if (offset >= raw.length && endsWithLineBreak(raw)) {
    return findPreviousLineStart(raw, raw.length);
  }

  return offset;
}

function endsWithLineBreak(value: string): boolean {
  return value.endsWith("\n") || value.endsWith("\r");
}

function findPreviousLineStart(value: string, end: number): number {
  let index = end - 1;

  if (value[index] === "\n") {
    index -= 1;
  }

  if (value[index] === "\r") {
    index -= 1;
  }

  while (index >= 0) {
    const character = value[index];

    if (character === "\n" || character === "\r") {
      return index + 1;
    }

    index -= 1;
  }

  return 0;
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

  if (!isPlainRecord(value)) {
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
