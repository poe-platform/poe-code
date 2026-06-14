import { describe, expect, it } from "vitest";

import { hashParsedAst, hashSource } from "./hash.js";
import { parse } from "./parser.js";

describe("hashSource", () => {
  it("hashes whitespace-equivalent sources the same", () => {
    expectSameHash("[1, user]", "[ 1 , user ]");
  });

  it("hashes comment-equivalent sources the same", () => {
    expectSameHash("a + b", "a /* comment */ + b");
    expectSameHash("a + b", "a + // comment\nb");
  });

  it("hashes numeric literals by numeric value", () => {
    expectSameHash("0x10", "16", "0o20", "0b10000");
  });

  it("ignores numeric separators", () => {
    expectSameHash("1_000", "1000");
  });

  it("hashes exponential numeric notation by numeric value", () => {
    expectSameHash("1e3", "1000");
  });

  it("hashes float and integer forms by numeric value", () => {
    expectSameHash("1.0", "1");
  });

  it("distinguishes positive zero from negative zero", () => {
    expectDifferentHash("0", "-0");
  });

  it("ignores string quote style", () => {
    expectSameHash("'a' + 'b'", '"a" + "b"');
  });

  it("distinguishes renamed identifiers", () => {
    expectDifferentHash("a", "b");
  });

  it("preserves object key order", () => {
    expectDifferentHash("({ a: 1, b: 2 })", "({ b: 2, a: 1 })");
  });

  it("ignores trailing commas", () => {
    expectSameHash("[a, b]", "[a, b,]");
    expectSameHash("({ a: 1, b: 2 })", "({ a: 1, b: 2, })");
  });

  it("ignores semicolons added at ASI boundaries", () => {
    expectSameHash("const a = 1\nconst b = 2", "const a = 1;\nconst b = 2");
  });

  it("distinguishes templates from calls with similar runtime output", () => {
    expectDifferentHash("`${a}`", "String(a)");
  });

  it("ignores untagged template raw formatting when cooked output matches", () => {
    expectSameHash("`a\\nb`", "`a\nb`");
  });

  it("preserves tagged template raw segments", () => {
    expectDifferentHash("tag`a\\nb`", "tag`a\nb`");
  });

  it("ignores source spans, node ids, and raw literal formatting", () => {
    expect(hashSource("'value'")).toBe(hashSource('"value"'));
    expect(hashSource("[1, user]")).toBe(hashSource("[ 1 , user ]"));
    expect(hashSource("0x1f")).toBe(hashSource("31"));
    expect(hashSource("1_000")).toBe(hashSource("1000"));
  });

  it("changes when semantic AST content changes", () => {
    expect(hashSource("[1, user]")).not.toBe(hashSource("[2, user]"));
    expect(hashSource("{ user: 1 }")).not.toBe(hashSource("{ admin: 1 }"));
    expect(hashSource("user?.profile")).not.toBe(hashSource("user.profile"));
    expect(hashSource("({ value = 1 }) => value")).not.toBe(hashSource("({ value = 2 }) => value"));
    expect(hashSource("([, second]) => second")).not.toBe(
      hashSource("([first, second]) => second")
    );
  });

  it("can hash an already parsed AST", () => {
    expect(hashParsedAst(parse("user ? 'a' : 'b'"))).toBe(hashSource('user ? "a" : "b"'));
  });

  it("ignores source metadata when hashing a parsed AST", () => {
    const ast = parse("({ value = 'x' }, ...rest) => `hi ${value}`");
    const baselineHash = hashParsedAst(ast);
    const mutatedAst = structuredClone(ast);

    mutateSourceMetadata(mutatedAst);

    expect(hashParsedAst(mutatedAst)).toBe(baselineHash);
  });
});

function mutateSourceMetadata(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      mutateSourceMetadata(entry);
    }
    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  const record = value as Record<string, unknown>;

  if ("span" in record) {
    record.span = {
      start: { line: 99, column: 99, offset: 99 },
      end: { line: 100, column: 100, offset: 100 }
    };
  }

  if (typeof record.raw === "string") {
    record.raw = `changed:${record.raw}`;
  }

  Object.defineProperty(record, "nodeId", {
    value: 999,
    writable: true,
    configurable: true,
    enumerable: true
  });

  for (const entry of Object.values(record)) {
    mutateSourceMetadata(entry);
  }
}

function expectSameHash(first: string, ...equivalentSources: string[]): void {
  const baseline = hashSource(first);

  for (const source of equivalentSources) {
    expect(hashSource(source)).toBe(baseline);
  }
}

function expectDifferentHash(first: string, second: string): void {
  expect(hashSource(first)).not.toBe(hashSource(second));
}
