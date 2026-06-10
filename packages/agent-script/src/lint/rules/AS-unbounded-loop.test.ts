import { describe, expect, it } from "vitest";

import { AS_UNBOUNDED_LOOP } from "./AS-unbounded-loop.js";

function codes(source: string): string[] {
  return AS_UNBOUNDED_LOOP(source, { filename: "rule.js" }).map((diagnostic) => diagnostic.code);
}

describe("AS_UNBOUNDED_LOOP", () => {
  it("reports while true loops with no exit", () => {
    expect(codes("while (true) { x = x + 1; }")).toEqual(["AS-UNBOUNDED-LOOP"]);
  });

  it("allows while true loops with a break", () => {
    expect(codes("while (true) { if (cond) break; }")).toEqual([]);
  });

  it("allows for forever loops with a return", () => {
    expect(codes("for (;;) { return; }")).toEqual([]);
  });

  it("allows while true loops with a throw", () => {
    expect(codes('while (true) { throw Error("x"); }')).toEqual([]);
  });

  it("allows labeled breaks that exit nested unbounded loops and their enclosing loop", () => {
    expect(codes("outer: while (true) { while (true) { break outer; } }")).toEqual([]);
  });

  it("allows multiple labels that exit the unbounded loop", () => {
    expect(codes("outer: inner: while (true) { break outer; }")).toEqual([]);
  });

  it("reports an outer loop when only an inner loop has an unlabeled break", () => {
    expect(codes("outer: while (true) { while (true) { break; } }")).toEqual(["AS-UNBOUNDED-LOOP"]);
  });

  it("allows nested returns that exit enclosing unbounded loops", () => {
    expect(codes("while (true) { for (;;) { return; } }")).toEqual([]);
  });

  it("allows bounded while loops regardless of body", () => {
    expect(codes("while (i < n) { x = x + 1; }")).toEqual([]);
  });

  it("treats for...in loops as bounded", () => {
    expect(codes("for (const key in value) { x = x + 1; }")).toEqual([]);
  });

  it("does not count exits inside nested functions", () => {
    expect(codes("while (true) { const later = () => { return; }; }")).toEqual([
      "AS-UNBOUNDED-LOOP"
    ]);
  });

  it("reports do while true loops with no exit", () => {
    expect(codes("do { x = x + 1; } while (true);")).toEqual(["AS-UNBOUNDED-LOOP"]);
  });

  it("allows do while true loops with a break", () => {
    expect(codes("do { if (cond) break; } while (true);")).toEqual([]);
  });
});
