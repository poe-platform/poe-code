import { expect, it } from "vitest";
import { CompactModuleAst } from "./compact-module-ast.js";
import { CompactSourcePositions, compactSourceSpan } from "./compact-spans.js";
import type { Position } from "./tokenizer.js";

it.each(["", "a\r\nb\rc\nd\u2028e\u2029😀", "\r\n\r\n\n"])(
  "compares all UTF-16 offsets and line boundaries without changing coordinates: %j",
  (source) => {
    const owner = new CompactSourcePositions(source);
    for (let offset = 0; offset <= source.length; offset++) {
      const point = owner.position(offset);
      expect(owner.matchesPosition(point)).toBe(true);
      expect(owner.matchesPosition({ ...point })).toBe(true);
      expect(owner.matchesPosition({ ...point, line: point.line + 1 })).toBe(false);
      expect(owner.matchesPosition({ ...point, line: point.line - 1 })).toBe(false);
      expect(owner.matchesPosition({ ...point, column: point.column + 1 })).toBe(false);
    }
    for (const offset of [-1, source.length + 1, 0.5, NaN, Infinity])
      expect(owner.matchesPosition({ offset, line: 1, column: 1 })).toBe(false);
  }
);

it("compares source coordinates without granting ownership or evicting decoded points", () => {
  const owner = new CompactSourcePositions("x".repeat(2000));
  const first = owner.position(0);
  for (let offset = 1; offset < 514; offset++) owner.position(offset);
  const foreign = new CompactSourcePositions("x".repeat(2000)).position(1000);
  const copy = { ...foreign };
  expect(owner.matchesPosition(foreign)).toBe(true);
  expect(owner.matchesPosition(copy)).toBe(true);
  expect(compactSourceSpan(first, foreign)).toBeUndefined();
  expect(compactSourceSpan(first, copy)).toBeUndefined();
  expect(owner.position(0)).toBe(first);
  copy.line++;
  expect(owner.matchesPosition(copy)).toBe(false);
  const incompatible = new CompactSourcePositions("\n".repeat(2000)).position(1000);
  expect(owner.matchesPosition(incompatible)).toBe(false);
});

it.each([1, 2])("preserves coordinate getter order and short-circuiting for line %i", (line) => {
  const observe = (compare: boolean) => {
    const owner = new CompactSourcePositions("abc");
    const reads: string[] = [];
    const point = {
      get offset() { reads.push("offset"); return 1; },
      get line() { reads.push("line"); return line; },
      get column() { reads.push("column"); return 2; }
    };
    const matches = compare
      ? owner.matchesPosition(point)
      : owner.compatiblePosition(point) !== undefined;
    return { reads, matches };
  };
  expect(observe(true)).toEqual(observe(false));
});

it("revalidates a getter that changes the final offset before reading its line", () => {
  const owner = new CompactSourcePositions("abc");
  let reads = 0;
  const point = {
    get offset() { return ++reads === 4 ? 4 : 0; },
    get line() { throw new Error("Unexpected line read"); },
    column: 1
  };
  expect(() => owner.matchesPosition(point)).toThrow(RangeError);
});

it("packs matching and rebased spans without losing endpoint data or assignments", () => {
  const source = "a\r\nb\u2028c";
  const positions = new CompactSourcePositions(source);
  const spans = [
    { start: positions.position(0), end: positions.position(source.length) },
    { start: { line: 99, column: 88, offset: 3 }, end: positions.position(4) }
  ];
  const storage = new CompactModuleAst(source);
  const packed = storage.pack(spans);
  storage.finish();
  expect(packed).toEqual(spans);
  const assigned: Position = { line: 7, column: 8, offset: 9 };
  packed[0]!.start = assigned;
  expect(packed[0]!.start).toBe(assigned);
  expect(packed[1]).toEqual(spans[1]);
});
