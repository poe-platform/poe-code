import { describe, expect, it } from "vitest";

import { AS_AWAIT_NON_PROMISE } from "./AS-await-non-promise.js";

function codes(source: string): string[] {
  return AS_AWAIT_NON_PROMISE(source, { filename: "rule.js" }).map((diagnostic) => diagnostic.code);
}

describe("AS_AWAIT_NON_PROMISE", () => {
  it.each([
    ["await 1;", "1"],
    ['await "x";', '"x"'],
    ["await true;", "true"],
    ["await null;", "null"],
    ["await { a: 1 };", "{ a: 1 }"],
    ["await [1, 2];", "[1, 2]"]
  ])("reports awaiting a known non-promise expression in %s", (source, expression) => {
    expect(AS_AWAIT_NON_PROMISE(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS-AWAIT-NON-PROMISE",
        severity: "warning",
        message: "Awaiting a known non-promise value has no effect.",
        filename: "rule.js",
        line: 1,
        column: source.indexOf(expression) + 1,
        span: {
          start: {
            line: 1,
            column: source.indexOf(expression) + 1,
            offset: source.indexOf(expression)
          },
          end: {
            line: 1,
            column: source.indexOf(expression) + expression.length + 1,
            offset: source.indexOf(expression) + expression.length
          }
        }
      }
    ]);
  });

  it("reports only the inner await for nested awaits", () => {
    const source = "await await 1;";

    expect(AS_AWAIT_NON_PROMISE(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS-AWAIT-NON-PROMISE",
        severity: "warning",
        message: "Awaiting a known non-promise value has no effect.",
        filename: "rule.js",
        line: 1,
        column: 13,
        span: {
          start: { line: 1, column: 13, offset: source.indexOf("1") },
          end: { line: 1, column: 14, offset: source.indexOf("1") + "1".length }
        }
      }
    ]);
  });

  it("allows calls and mixed conditional expressions", () => {
    const source = [
      "await someFn();",
      "await Promise.resolve(1);",
      "await fn?.();",
      "await (x ? Promise.resolve() : 1);"
    ].join("\n");

    expect(codes(source)).toEqual([]);
  });

  it.each([
    ["await `x`;", "`x`"],
    ["await `x${1}`;", "`x${1}`"],
    ["await -1;", "-1"],
    ["await !ready;", "!ready"],
    ["await (1 + 2);", "(1 + 2)"],
    ["await (() => 1);", "(() => 1)"]
  ])("reports awaiting a statically non-promise expression in %s", (source, expression) => {
    const diagnostics = AS_AWAIT_NON_PROMISE(source, { filename: "rule.js" });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "AS-AWAIT-NON-PROMISE",
      severity: "warning",
      line: 1,
      column: source.indexOf(expression) + 1,
      span: {
        start: {
          line: 1,
          column: source.indexOf(expression) + 1,
          offset: source.indexOf(expression)
        },
        end: {
          line: 1,
          column: source.indexOf(expression) + expression.length + 1,
          offset: source.indexOf(expression) + expression.length
        }
      }
    });
  });
});
