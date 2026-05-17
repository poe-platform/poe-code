import { describe, expect, it } from "vitest";

import { AS_UNUSED_IMPORT, fixASUnusedImports } from "./AS-unused-import.js";

describe("AS_UNUSED_IMPORT", () => {
  it("allows a referenced named import", () => {
    expect(AS_UNUSED_IMPORT('import { a } from "x"; return a;')).toEqual([]);
  });

  it("warns at the named import specifier span when it is never referenced", () => {
    const source = 'import { a } from "x";';

    expect(AS_UNUSED_IMPORT(source, { filename: "rule.js" })).toMatchObject([
      {
        code: "AS-UNUSED-IMPORT",
        severity: "warning",
        message: "Import 'a' is never referenced.",
        filename: "rule.js",
        line: 1,
        column: 10,
        span: {
          start: { line: 1, column: 10, offset: source.indexOf("a") },
          end: { line: 1, column: 11, offset: source.indexOf("a") + "a".length }
        }
      }
    ]);
  });

  it("warns only for the unreferenced specifier in a named import list", () => {
    const source = 'import { a, b } from "x"; return a;';

    expect(AS_UNUSED_IMPORT(source, { filename: "rule.js" })).toMatchObject([
      {
        code: "AS-UNUSED-IMPORT",
        severity: "warning",
        message: "Import 'b' is never referenced.",
        filename: "rule.js",
        line: 1,
        column: 13,
        span: {
          start: { line: 1, column: 13, offset: source.indexOf("b") },
          end: { line: 1, column: 14, offset: source.indexOf("b") + "b".length }
        }
      }
    ]);
  });

  it("uses the local alias name when checking named import references", () => {
    expect(AS_UNUSED_IMPORT('import { a as alias } from "x"; return alias;')).toEqual([]);
  });

  it("warns at the full aliased specifier span when the local alias is unused", () => {
    const source = 'import { a as alias } from "x";';

    expect(AS_UNUSED_IMPORT(source, { filename: "rule.js" })).toMatchObject([
      {
        code: "AS-UNUSED-IMPORT",
        severity: "warning",
        message: "Import 'alias' is never referenced.",
        filename: "rule.js",
        line: 1,
        column: 10,
        span: {
          start: { line: 1, column: 10, offset: source.indexOf("a as alias") },
          end: {
            line: 1,
            column: 20,
            offset: source.indexOf("a as alias") + "a as alias".length
          }
        }
      }
    ]);
  });

  it("counts references inside nested arrow functions", () => {
    expect(AS_UNUSED_IMPORT('import { a } from "x"; const fn = () => () => a; return fn;')).toEqual(
      []
    );
  });

  it("counts references inside template literal interpolations", () => {
    expect(AS_UNUSED_IMPORT('import { a } from "x"; return `${a}`;')).toEqual([]);
  });

  it("counts references inside object shorthand and computed members", () => {
    expect(
      AS_UNUSED_IMPORT('import { a, key } from "x"; return { a, value: target[key] };')
    ).toEqual([]);
  });

  it("does not count object property keys as references", () => {
    const source = 'import { a } from "x"; return { a: 1 };';

    expect(AS_UNUSED_IMPORT(source, { filename: "rule.js" })).toMatchObject([
      {
        code: "AS-UNUSED-IMPORT",
        message: "Import 'a' is never referenced.",
        line: 1,
        column: 10
      }
    ]);
  });

  it("does not count shadowed nested bindings as import references", () => {
    const source = 'import { a } from "x"; const fn = (a) => a; return fn;';

    expect(AS_UNUSED_IMPORT(source, { filename: "rule.js" })).toMatchObject([
      {
        code: "AS-UNUSED-IMPORT",
        message: "Import 'a' is never referenced.",
        line: 1,
        column: 10
      }
    ]);
  });

  it("warns for unused default imports", () => {
    const source = 'import value from "x";';

    expect(AS_UNUSED_IMPORT(source, { filename: "rule.js" })).toMatchObject([
      {
        code: "AS-UNUSED-IMPORT",
        severity: "warning",
        message: "Import 'value' is never referenced.",
        filename: "rule.js",
        line: 1,
        column: 8,
        span: {
          start: { line: 1, column: 8, offset: source.indexOf("value") },
          end: { line: 1, column: 13, offset: source.indexOf("value") + "value".length }
        }
      }
    ]);
  });

  it("warns for unused namespace imports and allows namespace member access", () => {
    const unused = 'import * as ns from "x";';

    expect(AS_UNUSED_IMPORT('import * as ns from "x"; return ns.run();')).toEqual([]);
    expect(AS_UNUSED_IMPORT(unused, { filename: "rule.js" })).toMatchObject([
      {
        code: "AS-UNUSED-IMPORT",
        severity: "warning",
        message: "Import 'ns' is never referenced.",
        filename: "rule.js",
        line: 1,
        column: 8,
        span: {
          start: { line: 1, column: 8, offset: unused.indexOf("* as ns") },
          end: { line: 1, column: 15, offset: unused.indexOf("* as ns") + "* as ns".length }
        }
      }
    ]);
  });

  it("fixes unused specifiers and deletes imports that become empty", () => {
    expect(fixASUnusedImports('import { a, b } from "x"; return a;')).toBe(
      'import { a } from "x"; return a;'
    );
    expect(fixASUnusedImports('import { a, b, c } from "x"; return b;')).toBe(
      'import { b } from "x"; return b;'
    );
    expect(fixASUnusedImports('import { a, b, } from "x"; return a;')).toBe(
      'import { a } from "x"; return a;'
    );
    expect(fixASUnusedImports(['import { a } from "x";', "return 1;"].join("\n"))).toBe(
      "return 1;"
    );
    expect(fixASUnusedImports(['import value from "x";', "return 1;"].join("\n"))).toBe(
      "return 1;"
    );
  });

  it("fixes every unused specifier in an import list in one pass", () => {
    expect(fixASUnusedImports('import { a, b, c } from "x"; return b;')).toBe(
      'import { b } from "x"; return b;'
    );
    expect(fixASUnusedImports('import { a, b, c } from "x"; return 1;')).toBe("return 1;");
  });
});
