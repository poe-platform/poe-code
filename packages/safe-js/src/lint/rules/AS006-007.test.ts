import { describe, expect, it } from "vitest";

import { AS006_007 } from "./AS006-007.js";

describe("AS006_007", () => {
  const warningNames = (source: string) =>
    AS006_007(source).map((diagnostic) => diagnostic.message.match(/'([^']+)'/)?.[1]);

  it.each([
    "const values = []; return new Set(values);",
    "const input = 2; switch (input) { case 2: return 42; default: return 0; }"
  ])("counts reads in supported expressions: %s", (source) => {
    expect(AS006_007(source)).toEqual([]);
  });

  it("checks switch case bindings in their shared lexical scope", () => {
    expect(
      warningNames(
        "switch (2) { case 1: const unused = 1; break; case 2: const value = 2; return value; }"
      )
    ).toEqual(["unused"]);
  });

  it("does not report unused imports because AS-UNUSED-IMPORT owns them", () => {
    const source = [
      'import value from "api";',
      'import { used, missing as unused, _ignored } from "other";',
      'import * as tools from "tools";',
      "const result = used(value);",
      "tools.run(result);"
    ].join("\n");

    expect(AS006_007(source, { filename: "rule.js" })).toEqual([]);
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

  it("counts reads inside template-literal interpolations", () => {
    const source = ["const used = 1;", "const message = `${used}`;", "message;"].join("\n");

    expect(AS006_007(source)).toEqual([]);
  });

  it("counts reads inside parameter and destructuring defaults", () => {
    const source = [
      "const fallback = 1;",
      "const readParam = (value = fallback) => value;",
      "const readObject = ({ value = fallback } = {}) => value;",
      "const readArray = ([value = fallback] = []) => value;",
      "readParam(); readObject(); readArray();"
    ].join("\n");

    expect(AS006_007(source)).toEqual([]);
  });

  it("counts reads inside catch binding pattern defaults", () => {
    const source = [
      "const fallback = 1;",
      "try {",
      "  fail();",
      "} catch ({ value = fallback }) {",
      "  value;",
      "}"
    ].join("\n");

    expect(warningNames(source)).toEqual([]);
  });

  it("counts reads inside inner arrows that are exported handlers", () => {
    const source = ["const value = 1;", "export default () => () => value;"].join("\n");

    expect(AS006_007(source)).toEqual([]);
  });

  it("counts reads inside computed object keys and spread expressions", () => {
    const source = [
      "const key = 'id';",
      "const source = { id: 1 };",
      "const result = { [key]: 1, ...source };",
      "result;"
    ].join("\n");

    expect(AS006_007(source)).toEqual([]);
  });

  it("reports unread bindings declared at the start and end of a file", () => {
    const source = ["const first = 1;", "const used = 2;", "used;", "const last = 3;"].join("\n");

    expect(warningNames(source)).toEqual(["first", "last"]);
  });

  it("counts reads inside exported arrow parameter defaults", () => {
    const source = ["const fallback = 1;", "export default (value = fallback) => value;"].join(
      "\n"
    );

    expect(AS006_007(source)).toEqual([]);
  });
});
