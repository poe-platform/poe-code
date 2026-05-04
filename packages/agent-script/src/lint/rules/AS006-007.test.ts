import { describe, expect, it } from "vitest";

import { AS006_007 } from "./AS006-007.js";

describe("AS006_007", () => {
  it("reports unused imports as AS006 warnings and skips underscore-prefixed names", () => {
    const source = [
      'import value from "api";',
      'import { used, missing as unused, _ignored } from "other";',
      'import * as tools from "tools";',
      "const result = used(value);",
      "tools.run(result);"
    ].join("\n");

    expect(AS006_007(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS006",
        severity: "warning",
        message: "Import 'unused' is never referenced.",
        filename: "rule.js",
        line: 2,
        column: 27,
        span: {
          start: { line: 2, column: 27, offset: source.indexOf("unused") },
          end: { line: 2, column: 33, offset: source.indexOf("unused") + "unused".length }
        }
      }
    ]);
  });

  it("counts reads inside named and default export declarations", () => {
    const source = [
      'import { S } from "schema";',
      'import { run } from "agent";',
      "export const schema = S.Object({ name: S.String() });",
      "export default (input) => run(input.name);"
    ].join("\n");

    expect(AS006_007(source, { filename: "rule.js" })).toEqual([]);
  });

  it("reports unread const and let bindings as AS007 warnings but ignores writes and underscore-prefixed names", () => {
    const source = [
      "const used = 1;",
      "const unused = 2;",
      "let assigned = 0;",
      "assigned = used;",
      "let _ignored = 3;",
      "const { kept, _skipped } = data;",
      "print(used);"
    ].join("\n");

    expect(AS006_007(source)).toEqual([
      {
        code: "AS007",
        severity: "warning",
        message: "Binding 'unused' is declared but never read.",
        filename: "<input>",
        line: 2,
        column: 7,
        span: {
          start: { line: 2, column: 7, offset: source.indexOf("unused") },
          end: { line: 2, column: 13, offset: source.indexOf("unused") + "unused".length }
        }
      },
      {
        code: "AS007",
        severity: "warning",
        message: "Binding 'assigned' is declared but never read.",
        filename: "<input>",
        line: 3,
        column: 5,
        span: {
          start: { line: 3, column: 5, offset: source.indexOf("assigned") },
          end: { line: 3, column: 13, offset: source.indexOf("assigned") + "assigned".length }
        }
      },
      {
        code: "AS007",
        severity: "warning",
        message: "Binding 'kept' is declared but never read.",
        filename: "<input>",
        line: 6,
        column: 9,
        span: {
          start: { line: 6, column: 9, offset: source.indexOf("kept") },
          end: { line: 6, column: 13, offset: source.indexOf("kept") + "kept".length }
        }
      }
    ]);
  });

  it("does not count self-references in initializers as reads, but still counts deferred reads in closures", () => {
    const source = [
      "const self = self;",
      "let current = current;",
      "const { retry = retry } = config;",
      "const fn = () => fn;"
    ].join("\n");

    expect(AS006_007(source)).toEqual([
      {
        code: "AS007",
        severity: "warning",
        message: "Binding 'self' is declared but never read.",
        filename: "<input>",
        line: 1,
        column: 7,
        span: {
          start: { line: 1, column: 7, offset: source.indexOf("self") },
          end: { line: 1, column: 11, offset: source.indexOf("self") + "self".length }
        }
      },
      {
        code: "AS007",
        severity: "warning",
        message: "Binding 'current' is declared but never read.",
        filename: "<input>",
        line: 2,
        column: 5,
        span: {
          start: { line: 2, column: 5, offset: source.indexOf("current") },
          end: { line: 2, column: 12, offset: source.indexOf("current") + "current".length }
        }
      },
      {
        code: "AS007",
        severity: "warning",
        message: "Binding 'retry' is declared but never read.",
        filename: "<input>",
        line: 3,
        column: 9,
        span: {
          start: { line: 3, column: 9, offset: source.indexOf("retry") },
          end: { line: 3, column: 14, offset: source.indexOf("retry") + "retry".length }
        }
      }
    ]);
  });
});
