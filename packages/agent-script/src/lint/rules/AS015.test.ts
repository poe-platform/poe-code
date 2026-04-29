import { describe, expect, it } from "vitest";

import { AS015 } from "./AS015.js";

describe("AS015", () => {
  it("reports Promise.race calls with a single-element array literal", () => {
    const source = "const result = Promise.race([runTask()]);";

    expect(AS015(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS015",
        severity: "warning",
        message: "Promise.race() with a single-element iterable literal is unnecessary. Use 'await' instead.",
        filename: "rule.js",
        line: 1,
        column: 16,
        span: {
          start: { line: 1, column: 16, offset: source.indexOf("Promise.race") },
          end: { line: 1, column: 41, offset: source.indexOf("Promise.race([runTask()])") + "Promise.race([runTask()])".length }
        }
      }
    ]);
  });

  it("reports Promise['race'] calls with a single-element array literal", () => {
    const source = 'const result = Promise["race"]([runTask()]);';

    expect(AS015(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS015",
        severity: "warning",
        message: "Promise.race() with a single-element iterable literal is unnecessary. Use 'await' instead.",
        filename: "rule.js",
        line: 1,
        column: 16,
        span: {
          start: { line: 1, column: 16, offset: source.indexOf('Promise["race"]') },
          end: {
            line: 1,
            column: 44,
            offset: source.indexOf('Promise["race"]([runTask()])') + 'Promise["race"]([runTask()])'.length
          }
        }
      }
    ]);
  });

  it("reports single-element array literals with a trailing comma", () => {
    const source = "Promise.race([runTask(),]);";

    expect(AS015(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS015",
        severity: "warning",
        message: "Promise.race() with a single-element iterable literal is unnecessary. Use 'await' instead.",
        filename: "rule.js",
        line: 1,
        column: 1,
        span: {
          start: { line: 1, column: 1, offset: source.indexOf("Promise.race") },
          end: {
            line: 1,
            column: 27,
            offset: source.indexOf("Promise.race([runTask(),])") + "Promise.race([runTask(),])".length
          }
        }
      }
    ]);
  });

  it("allows multi-element, spread, and non-literal iterables", () => {
    const source = [
      "Promise.race([first(), second()]);",
      "Promise.race([...tasks]);",
      "Promise.race(tasks);",
      "Promise.race([only()], timeout);"
    ].join("\n");

    expect(AS015(source, { filename: "rule.js" })).toEqual([]);
  });

  it("ignores other Promise helpers", () => {
    const source = [
      "Promise.all([only()]);",
      "Promise.any([only()]);",
      "Promise.resolve([only()]);"
    ].join("\n");

    expect(AS015(source, { filename: "rule.js" })).toEqual([]);
  });
});
