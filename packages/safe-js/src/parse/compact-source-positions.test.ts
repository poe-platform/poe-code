import { expect, it } from "vitest";
import { CompactSourcePositions, compactSourceSpan } from "./compact-spans.js";
it("keeps own enumerable fields, assignments, sealing and freezing", () => {
  const owner = new CompactSourcePositions("a\r\nb\u2028c");
  const span = owner.span(0, 6);
  expect(Object.keys(span)).toEqual(["start", "end"]);
  expect(JSON.parse(JSON.stringify(span))).toEqual({
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 3, column: 2, offset: 6 }
  });
  const point = { line: 99, column: 88, offset: 77 };
  span.start = point;
  expect(span.start).toBe(point);
  span.end = owner.position(3);
  expect(span.end).toEqual({ line: 2, column: 1, offset: 3 });
  Object.seal(span);
  span.start = owner.position(0);
  expect(span.start.offset).toBe(0);
  Object.freeze(span);
  expect(() => {
    span.start = point;
  }).toThrow("frozen");
  expect(() => {
    span.end = point;
  }).toThrow("frozen");
});

it("keeps saved coordinates immutable and correct after bounded cache eviction", () => {
  const owner = new CompactSourcePositions("x".repeat(2000));
  const span = owner.span(1, 2);
  const saved = span.start;
  for (let offset = 0; offset < 1500; offset++) owner.position(offset);
  expect(span.start).toEqual(saved);
  expect(Object.isFrozen(saved)).toBe(true);
  expect(() => {
    saved.offset = 9;
  }).toThrow(TypeError);
});

it("keeps deleted endpoint fields absent until assigned again", () => {
  const owner = new CompactSourcePositions("abc");
  const span = owner.span(0, 3);
  delete (span as Partial<typeof span>).start;
  expect(span.start).toBeUndefined();
  expect(Object.keys(span)).toEqual(["end"]);
  span.start = owner.position(1);
  expect(span.start.offset).toBe(1);
});

it("rejects foreign and forged ownership and keeps separate source coordinates", () => {
  const first = new CompactSourcePositions("a\nb");
  const second = new CompactSourcePositions("abc");
  expect(compactSourceSpan(first.position(0), second.position(3))).toBeUndefined();
  expect(compactSourceSpan({ ...first.position(0) }, { ...first.position(3) })).toBeUndefined();
  expect(compactSourceSpan(first.position(0), first.position(3))?.end).toEqual({
    line: 2,
    column: 2,
    offset: 3
  });
  expect(compactSourceSpan(second.position(0), second.position(3))?.end).toEqual({
    line: 1,
    column: 4,
    offset: 3
  });
});

it("rejects offsets outside their source before publishing owned coordinates", () => {
  const owner = new CompactSourcePositions("abc");
  for (const offset of [-1, 4, 0.5, NaN, Infinity]) {
    expect(() => owner.position(offset)).toThrow(RangeError);
    expect(() => owner.span(0, offset)).toThrow(RangeError);
  }
  expect(owner.position(3)).toEqual({ line: 1, column: 4, offset: 3 });
});

it("preserves FIFO identity through repeated cache wraparound without promoting hits", () => {
  const owner = new CompactSourcePositions("x\r\ny\u2028".repeat(500));
  const retained = Array.from({ length: 514 }, (_, offset) => owner.position(offset));
  for (let offset = 514; offset < 2200; offset++) {
    const oldest = retained.shift()!;
    const next = retained[0]!;
    expect(owner.position(oldest.offset)).toBe(oldest);
    const incoming = owner.position(offset);
    expect(owner.position(next.offset)).toBe(next);
    expect(owner.position(offset)).toBe(incoming);
    retained.push(incoming);
  }
  const saved = retained[0]!;
  owner.position(2200);
  const decoded = owner.position(saved.offset);
  expect(decoded).not.toBe(saved);
  expect(decoded).toEqual(saved);
  expect(Object.isFrozen(decoded)).toBe(true);
  expect(compactSourceSpan(saved, decoded)?.start).toBe(decoded);
});
