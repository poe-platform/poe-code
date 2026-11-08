import { describe, expect, it } from "vitest";

import { AS015 } from "./AS015.js";

describe("AS015", () => {
  const reportedLines = (source: string) => AS015(source).map((diagnostic) => diagnostic.line);

  it("reports Promise.race calls with a single-element array literal", () => {
    const source = "const result = Promise.race([runTask()]);";

    expect(AS015(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS015",
        severity: "warning",
        message:
          "Promise.race() with a single-element iterable literal is unnecessary. Use 'await' instead.",
        filename: "rule.js",
        line: 1,
        column: 16,
        span: {
          start: { line: 1, column: 16, offset: source.indexOf("Promise.race") },
          end: {
            line: 1,
            column: 41,
            offset: source.indexOf("Promise.race([runTask()])") + "Promise.race([runTask()])".length
          }
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
        message:
          "Promise.race() with a single-element iterable literal is unnecessary. Use 'await' instead.",
        filename: "rule.js",
        line: 1,
        column: 16,
        span: {
          start: { line: 1, column: 16, offset: source.indexOf('Promise["race"]') },
          end: {
            line: 1,
            column: 44,
            offset:
              source.indexOf('Promise["race"]([runTask()])') + 'Promise["race"]([runTask()])'.length
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
        message:
          "Promise.race() with a single-element iterable literal is unnecessary. Use 'await' instead.",
        filename: "rule.js",
        line: 1,
        column: 1,
        span: {
          start: { line: 1, column: 1, offset: source.indexOf("Promise.race") },
          end: {
            line: 1,
            column: 27,
            offset:
              source.indexOf("Promise.race([runTask(),])") + "Promise.race([runTask(),])".length
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

  it("reports single-element races inside template-literal interpolations", () => {
    const source = "const value = `${Promise.race([task()])}`;";

    expect(reportedLines(source)).toEqual([1]);
  });

  it("reports single-element races inside parameter and destructuring defaults", () => {
    const source = [
      "const readParam = (value = Promise.race([task()])) => value;",
      "const { value = Promise.race([task()]) } = input;",
      "const [item = Promise.race([task()])] = input;"
    ].join("\n");

    expect(reportedLines(source)).toEqual([1, 2, 3]);
  });

  it("reports single-element races inside catch binding pattern defaults", () => {
    const source = "try { fail(); } catch ({ value = Promise.race([task()]) }) { value; }";

    expect(reportedLines(source)).toEqual([1]);
  });

  it("reports single-element races inside inner arrows that are exported handlers", () => {
    const source = "export default () => () => Promise.race([task()]);";

    expect(reportedLines(source)).toEqual([1]);
  });

  it("reports single-element races nested inside call arguments and array elements", () => {
    const source = [
      "consume(Promise.race([task()]));",
      "const values = [Promise.race([otherTask()])];"
    ].join("\n");

    expect(reportedLines(source)).toEqual([1, 2]);
  });

  it("reports single-element races inside computed keys and spread expressions", () => {
    const source =
      "const value = { [Promise.race([keyTask()])]: 1, ...Promise.race([objectTask()]) };";

    expect(reportedLines(source)).toEqual([1, 1]);
  });

  it("reports single-element races at file boundaries", () => {
    const source = [
      "Promise.race([first()]);",
      "const safe = Promise.all([first()]);",
      "Promise.race([last()]);"
    ].join("\n");

    expect(reportedLines(source)).toEqual([1, 3]);
  });
});
