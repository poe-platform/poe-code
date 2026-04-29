import { describe, expect, it } from "vitest";

import { hashParsedAst, hashSource } from "./hash.js";
import { parse } from "./parser.js";

describe("hashSource", () => {
  it("ignores source spans, node ids, and raw literal formatting", () => {
    expect(hashSource("'value'")).toBe(hashSource("\"value\""));
    expect(hashSource("[1, user]")).toBe(hashSource("[ 1 , user ]"));
    expect(hashSource("0x1f")).toBe(hashSource("31"));
    expect(hashSource("1_000")).toBe(hashSource("1000"));
  });

  it("changes when semantic AST content changes", () => {
    expect(hashSource("[1, user]")).not.toBe(hashSource("[2, user]"));
    expect(hashSource("{ user: 1 }")).not.toBe(hashSource("{ admin: 1 }"));
    expect(hashSource("user?.profile")).not.toBe(hashSource("user.profile"));
    expect(hashSource("({ value = 1 }) => value")).not.toBe(hashSource("({ value = 2 }) => value"));
    expect(hashSource("([, second]) => second")).not.toBe(hashSource("([first, second]) => second"));
  });

  it("can hash an already parsed AST", () => {
    expect(hashParsedAst(parse("user ? 'a' : 'b'"))).toBe(hashSource("user ? \"a\" : \"b\""));
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
