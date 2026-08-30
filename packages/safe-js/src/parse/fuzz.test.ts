// Set SAFEJS_PARSE_FUZZ=1 to run this deterministic parser fuzz harness.
// It is intentionally skipped by default so local `npm run test` remains fast.
import { TextDecoder } from "node:util";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";

import { parse, type ParseResult } from "../parse.js";
import { tokenize, type Token } from "./tokenizer.js";

const RUN_FUZZ = process.env.SAFEJS_PARSE_FUZZ === "1";
const FUZZ_SEED = 0x5eed_f022;
const RANDOM_CASE_COUNT = 1_000;
const TRUNCATED_CASE_COUNT = 100;
const MAX_RANDOM_BYTE_LENGTH = 128;
const MAX_TOTAL_DURATION_MS = 5_000;
const RESERVED_IDENTIFIERS = new Set([
  "as",
  "async",
  "await",
  "break",
  "catch",
  "const",
  "continue",
  "delete",
  "do",
  "else",
  "false",
  "finally",
  "for",
  "from",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "null",
  "of",
  "return",
  "throw",
  "true",
  "try",
  "typeof",
  "undefined",
  "void",
  "while"
]);

type AstNode = {
  nodeId?: number;
  span: {
    start: {
      offset: number;
    };
    end: {
      offset: number;
    };
  };
  type: string;
  [key: string]: unknown;
};

type StepResult<T> = { ok: true; value: T } | { error: Error; ok: false };

describe.skipIf(!RUN_FUZZ)("parse fuzz", () => {
  it("handles deterministic random sources without parser crashes", () => {
    const start = performance.now();

    assertRandomAsciiSources();
    assertRandomUtf8Sources();
    assertMinimallyValidSkeletons();
    assertTruncatedSources();

    expect(performance.now() - start).toBeLessThan(MAX_TOTAL_DURATION_MS);
  });
});

function assertRandomAsciiSources(): void {
  const random = createRandom(FUZZ_SEED ^ 0xa5c1_1);
  for (let index = 0; index < RANDOM_CASE_COUNT; index += 1) {
    const source = Buffer.from(randomBytes(random, MAX_RANDOM_BYTE_LENGTH, 0x80)).toString("utf8");
    assertTokenizeAndParseCleanly(source, `ascii-${index}`);
  }
}

function assertRandomUtf8Sources(): void {
  const random = createRandom(FUZZ_SEED ^ 0x8f8_2);
  for (let index = 0; index < RANDOM_CASE_COUNT; index += 1) {
    const bytes =
      index % 2 === 0
        ? Buffer.from(randomUnicodeSource(random), "utf8")
        : randomInvalidUtf8Bytes(random);
    const invalidUtf8 = !isValidUtf8(bytes);
    const source = Buffer.from(bytes).toString("utf8");
    const result = assertTokenizeAndParseCleanly(source, `utf8-${index}`);

    if (invalidUtf8) {
      expect(result.parse.ok, `utf8-${index} should reject invalid UTF-8`).toBe(false);
      if (!result.parse.ok) {
        assertLocatedParseError(result.parse.error, source);
      }
    }
  }
}

function assertMinimallyValidSkeletons(): void {
  const random = createRandom(FUZZ_SEED ^ 0x51ce_3);
  for (let index = 0; index < RANDOM_CASE_COUNT; index += 1) {
    const source = randomExpression(random, 0);
    const tokenized = capture(() => tokenize(source, { allowRegexLiterals: true }));
    expect(tokenized.ok).toBe(true);

    const parsed = capture(() => parse(source));
    expect(parsed.ok, source).toBe(true);
    if (parsed.ok) {
      assertAstNodeIds(parsed.value);
    }
  }
}

function assertTruncatedSources(): void {
  const random = createRandom(FUZZ_SEED ^ 0x7c0_4);
  for (let index = 0; index < TRUNCATED_CASE_COUNT; index += 1) {
    const expression = randomExpression(random, 0);
    const fullSource = `const output = (${expression});`;
    const firstExpressionOffset = fullSource.indexOf("(") + 1;
    const closingOffset = fullSource.lastIndexOf(")");
    const offset = randomInt(random, firstExpressionOffset, closingOffset);
    const source = fullSource.slice(0, offset);
    const parsed = capture(() => parse(source, `truncated-${index}.SafeJS`));

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      assertLocatedParseError(parsed.error, source);
    }
  }
}

function assertTokenizeAndParseCleanly(
  source: string,
  label: string
): { parse: StepResult<ParseResult>; tokenize: StepResult<Token[]> } {
  const tokenized = capture(() => tokenize(source, { allowRegexLiterals: true }));
  if (tokenized.ok) {
    assertCleanTokens(tokenized.value);
  } else {
    assertLocatedError(tokenized.error, source, label);
  }

  const parsed = capture(() => parse(source, `${label}.SafeJS`));
  if (parsed.ok) {
    assertAstNodeIds(parsed.value);
  } else {
    assertLocatedError(parsed.error, source, label);
  }

  return { parse: parsed, tokenize: tokenized };
}

function assertCleanTokens(tokens: Token[]): void {
  expect(tokens.length).toBeGreaterThan(0);
  expect(tokens.at(-1)).toMatchObject({ type: "eof" });

  let previousOffset = 0;
  for (const token of tokens) {
    expect(token.start.offset).toBeGreaterThanOrEqual(previousOffset);
    expect(token.end.offset).toBeGreaterThanOrEqual(token.start.offset);
    previousOffset = token.end.offset;
  }
}

function assertAstNodeIds(root: ParseResult): void {
  const nodes = collectAstNodes(root);
  expect(nodes.length).toBeGreaterThan(0);
  expect(nodes.map((node) => node.nodeId).sort((left, right) => left! - right!)).toEqual(
    nodes.map((_, index) => index)
  );
}

function collectAstNodes(root: ParseResult): AstNode[] {
  const nodes: AstNode[] = [];
  const seen = new Set<AstNode>();
  const stack: AstNode[] = [root as AstNode];

  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined || seen.has(node)) {
      continue;
    }

    seen.add(node);
    expect(node.nodeId).toEqual(expect.any(Number));
    expect(node.span.end.offset).toBeGreaterThanOrEqual(node.span.start.offset);
    nodes.push(node);

    const children: AstNode[] = [];
    for (const [key, value] of Object.entries(node)) {
      if (key === "span" || key === "type") {
        continue;
      }
      collectAstChild(value, children);
    }

    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]!);
    }
  }

  return nodes;
}

function collectAstChild(value: unknown, children: AstNode[]): void {
  if (isAstNode(value)) {
    children.push(value);
    return;
  }

  if (!Array.isArray(value)) {
    return;
  }

  for (const entry of value) {
    if (isAstNode(entry)) {
      children.push(entry);
    }
  }
}

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type?: unknown }).type === "string" &&
    "span" in value &&
    typeof (value as { span?: AstNode["span"] }).span?.start.offset === "number" &&
    typeof (value as { span?: AstNode["span"] }).span?.end.offset === "number"
  );
}

function assertLocatedParseError(error: Error, source: string): void {
  expect(error).toMatchObject({
    column: expect.any(Number),
    line: expect.any(Number)
  });
  expect((error as { caret?: unknown }).caret).toEqual(expect.any(String));
  assertErrorLocationPointsIntoSource(error, source);
}

function assertLocatedError(error: Error, source: string, label: string): void {
  expect(error.message, label).toMatch(/ at line \d+, column \d+\./);
  assertErrorLocationPointsIntoSource(error, source);
}

function assertErrorLocationPointsIntoSource(error: Error, source: string): void {
  const location = getErrorLocation(error);
  expect(location).not.toBeUndefined();
  if (location === undefined) {
    return;
  }

  const offset = offsetFromLineColumn(source, location.line, location.column);
  expect(offset).toBeGreaterThanOrEqual(0);
  expect(offset).toBeLessThanOrEqual(source.length);
}

function getErrorLocation(error: Error): { column: number; line: number } | undefined {
  const structured = error as { column?: unknown; line?: unknown };
  if (typeof structured.line === "number" && typeof structured.column === "number") {
    return { column: structured.column, line: structured.line };
  }

  const match = / at line (\d+), column (\d+)\./.exec(error.message);
  if (match === null) {
    return undefined;
  }

  return { column: Number(match[2]), line: Number(match[1]) };
}

function offsetFromLineColumn(source: string, line: number, column: number): number {
  let currentLine = 1;
  let currentColumn = 1;

  for (let offset = 0; offset < source.length; offset += 1) {
    if (currentLine === line && currentColumn === column) {
      return offset;
    }

    const char = source[offset];
    if (char === "\r") {
      if (source[offset + 1] === "\n") {
        offset += 1;
      }
      currentLine += 1;
      currentColumn = 1;
      continue;
    }

    if (char === "\n") {
      currentLine += 1;
      currentColumn = 1;
      continue;
    }

    currentColumn += 1;
  }

  return currentLine === line && currentColumn === column ? source.length : source.length + 1;
}

function capture<T>(callback: () => T): StepResult<T> {
  try {
    return { ok: true, value: callback() };
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return { error: error as Error, ok: false };
  }
}

function randomBytes(
  random: () => number,
  maxLength: number,
  exclusiveMaxByte: number
): Uint8Array {
  const length = randomInt(random, 0, maxLength + 1);
  const bytes = new Uint8Array(length);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = randomInt(random, 0, exclusiveMaxByte);
  }
  return bytes;
}

function randomInvalidUtf8Bytes(random: () => number): Uint8Array {
  const bytes = randomBytes(random, MAX_RANDOM_BYTE_LENGTH, 256);
  const output = new Uint8Array(Math.max(bytes.length, 2));
  output.set(bytes.slice(0, output.length));
  // U+FFFD can be tokenized as an identifier, so keep invalid UTF-8 cases visibly invalid.
  output[0] = 0x00;
  output[1] = 0xff;
  return output;
}

function randomUnicodeSource(random: () => number): string {
  const length = randomInt(random, 0, MAX_RANDOM_BYTE_LENGTH + 1);
  let source = "";
  for (let index = 0; index < length; index += 1) {
    const bucket = randomInt(random, 0, 10);
    if (bucket < 7) {
      source += String.fromCharCode(randomInt(random, 0x20, 0x7f));
      continue;
    }
    source += String.fromCodePoint(randomInt(random, 0x80, 0xd800));
  }
  return source;
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function randomExpression(random: () => number, depth: number): string {
  if (depth >= 4 || random() < 0.3) {
    return randomIdentifier(random);
  }

  const left = randomExpression(random, depth + 1);
  const right = randomExpression(random, depth + 1);
  const operator = randomChoice(random, ["+", "-", "*", "%", "<", "<=", ">", ">=", "===", "!=="]);
  return `(${left} ${operator} ${right})`;
}

function randomIdentifier(random: () => number): string {
  while (true) {
    const first = randomChoice(random, "abcdefghijklmnopqrstuvwxyz_".split(""));
    const length = randomInt(random, 1, 10);
    let identifier = first;
    for (let index = 1; index < length; index += 1) {
      identifier += randomChoice(random, "abcdefghijklmnopqrstuvwxyz0123456789_".split(""));
    }
    if (!RESERVED_IDENTIFIERS.has(identifier)) {
      return identifier;
    }
  }
}

function randomChoice<T>(random: () => number, values: T[]): T {
  return values[randomInt(random, 0, values.length)]!;
}

function randomInt(random: () => number, min: number, max: number): number {
  return Math.floor(random() * (max - min)) + min;
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b_79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
