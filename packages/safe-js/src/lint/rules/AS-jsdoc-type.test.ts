import { describe, expect, it } from "vitest";

import { AS_JSDOC_TYPE } from "./AS-jsdoc-type.js";
import type { Modules } from "./module-registry.js";

function diagnostics(source: string) {
  return AS_JSDOC_TYPE(source, {
    filename: "rule.ajs",
    modules: typedModules(source)
  });
}

function typedModules(source: string): Modules {
  return {
    current: {
      exports: {
        default: "unknown"
      },
      filename: "rule.ajs",
      source
    }
  };
}

describe("AS_JSDOC_TYPE", () => {
  it("allows a string @type declaration assigned a string literal", () => {
    expect(diagnostics('/** @type {string} */ const x = "y";')).toEqual([]);
  });

  it("warns when a string @type declaration is assigned a number literal", () => {
    const source = "/** @type {string} */ const x = 1;";

    expect(diagnostics(source)).toEqual([
      {
        code: "AS-JSDOC-TYPE",
        severity: "warning",
        message: "JSDoc type 'string' does not match number value.",
        filename: "rule.ajs",
        line: 1,
        column: source.indexOf("1") + 1,
        span: {
          start: { line: 1, column: source.indexOf("1") + 1, offset: source.indexOf("1") },
          end: {
            line: 1,
            column: source.indexOf("1") + 2,
            offset: source.indexOf("1") + "1".length
          }
        }
      }
    ]);
  });

  it("allows number array @type declarations assigned number arrays", () => {
    expect(diagnostics("/** @type {number[]} */ const xs = [1, 2];")).toEqual([]);
  });

  it("warns on the mismatched element in a number array @type declaration", () => {
    const source = '/** @type {number[]} */ const xs = ["a"];';

    expect(diagnostics(source)).toEqual([
      {
        code: "AS-JSDOC-TYPE",
        severity: "warning",
        message: "JSDoc type 'number[]' does not match string array element.",
        filename: "rule.ajs",
        line: 1,
        column: source.indexOf('"a"') + 1,
        span: {
          start: { line: 1, column: source.indexOf('"a"') + 1, offset: source.indexOf('"a"') },
          end: {
            line: 1,
            column: source.indexOf('"a"') + '"a"'.length + 1,
            offset: source.indexOf('"a"') + '"a"'.length
          }
        }
      }
    ]);
  });

  it("allows @param annotations on arrow functions", () => {
    expect(diagnostics("/** @param {string} name */ const greet = (name) => name;")).toEqual([]);
  });

  it("warns on mismatched object field values", () => {
    const source =
      '/** @type {{name: string, count: number}} */ const item = { name: "ok", count: false };';

    expect(diagnostics(source)).toMatchObject([
      {
        code: "AS-JSDOC-TYPE",
        message:
          "JSDoc type '{name: string, count: number}' does not match boolean value for property 'count'.",
        line: 1,
        column: source.indexOf("false") + 1,
        span: {
          start: { line: 1, column: source.indexOf("false") + 1, offset: source.indexOf("false") },
          end: {
            line: 1,
            column: source.indexOf("false") + "false".length + 1,
            offset: source.indexOf("false") + "false".length
          }
        }
      }
    ]);
  });

  it("supports multiline JSDoc object annotations", () => {
    const source = [
      "/**",
      " * @type {{name: string, count: number}}",
      " */",
      'const item = { name: "ok", count: false };'
    ].join("\n");

    expect(diagnostics(source)).toMatchObject([
      {
        code: "AS-JSDOC-TYPE",
        message:
          "JSDoc type '{name: string, count: number}' does not match boolean value for property 'count'.",
        line: 4,
        column: source.indexOf("false") - source.lastIndexOf("\n", source.indexOf("false"))
      }
    ]);
  });

  it("ignores unsupported complex types instead of guessing", () => {
    expect(
      diagnostics('/** @type {Record<string, number>} */ const item = { count: "wrong" };')
    ).toEqual([]);
    expect(diagnostics("/** @type {string | number} */ const value = true;")).toEqual([]);
    expect(diagnostics("/** @type {{items: string[]}} */ const item = { items: [1] };")).toEqual(
      []
    );
    expect(
      diagnostics("/** @type {{meta: {ready: boolean}}} */ const item = { meta: 1 };")
    ).toEqual([]);
  });

  it("validates assignment expressions with leading @type annotations", () => {
    const source = "/** @type {boolean} */ ready = 1;";

    expect(diagnostics(source)).toMatchObject([
      {
        code: "AS-JSDOC-TYPE",
        message: "JSDoc type 'boolean' does not match number value.",
        line: 1,
        column: source.indexOf("1") + 1
      }
    ]);
  });

  it("ignores unknown JSDoc tags", () => {
    expect(diagnostics("/** @unknown {number} */ const x = 1;")).toEqual([]);
  });

  it("does not attach a JSDoc block across intervening code", () => {
    expect(diagnostics('/** @type {string} */ const y = "ok"; const x = 1;')).toEqual([]);
  });

  it("validates arrow parameter default values when @param is explicit", () => {
    const source = "/** @param {string} name */ const greet = (name = 1) => name;";

    expect(diagnostics(source)).toMatchObject([
      {
        code: "AS-JSDOC-TYPE",
        message: "JSDoc type 'string' does not match number value.",
        line: 1,
        column: source.indexOf("1") + 1
      }
    ]);
  });

  it("emits one parse warning for malformed JSDoc and continues", () => {
    const source = '/** @type {syntax error} */ const x = "y";\n/** @type {number} */ const y = 1;';

    expect(diagnostics(source)).toEqual([
      {
        code: "AS-JSDOC-TYPE",
        severity: "warning",
        message: "Could not parse JSDoc @type annotation 'syntax error'.",
        filename: "rule.ajs",
        line: 1,
        column: 12,
        span: {
          start: { line: 1, column: 12, offset: source.indexOf("syntax error") },
          end: {
            line: 1,
            column: 24,
            offset: source.indexOf("syntax error") + "syntax error".length
          }
        }
      }
    ]);
  });

  it("is disabled until a typed module registration opts in", () => {
    expect(
      AS_JSDOC_TYPE("/** @type {string} */ const x = 1;", {
        filename: "rule.ajs",
        modules: {
          current: {
            exports: ["default"],
            filename: "rule.ajs",
            source: "/** @type {string} */ const x = 1;"
          }
        }
      })
    ).toEqual([]);
  });
});
