import { describe, expect, it } from "vitest";

import { AS011 } from "./AS011.js";

describe("AS011", () => {
  const forbiddenSnippets = (source: string) =>
    AS011(source).map((diagnostic) =>
      source.slice(diagnostic.span.start.offset, diagnostic.span.end.offset)
    );

  it("reports dotted access to forbidden property names", () => {
    const source = ["value.__proto__;", "value.prototype;", "value.constructor;"].join("\n");

    expect(AS011(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS011",
        severity: "error",
        message: "Property access to '__proto__', 'prototype', and 'constructor' is not allowed.",
        filename: "rule.js",
        line: 1,
        column: 7,
        span: {
          start: { line: 1, column: 7, offset: source.indexOf("__proto__") },
          end: { line: 1, column: 16, offset: source.indexOf("__proto__") + "__proto__".length }
        }
      },
      {
        code: "AS011",
        severity: "error",
        message: "Property access to '__proto__', 'prototype', and 'constructor' is not allowed.",
        filename: "rule.js",
        line: 2,
        column: 7,
        span: {
          start: { line: 2, column: 7, offset: source.indexOf("prototype") },
          end: { line: 2, column: 16, offset: source.indexOf("prototype") + "prototype".length }
        }
      },
      {
        code: "AS011",
        severity: "error",
        message: "Property access to '__proto__', 'prototype', and 'constructor' is not allowed.",
        filename: "rule.js",
        line: 3,
        column: 7,
        span: {
          start: { line: 3, column: 7, offset: source.indexOf("constructor") },
          end: { line: 3, column: 18, offset: source.indexOf("constructor") + "constructor".length }
        }
      }
    ]);
  });

  it("reports computed access with string literal keys and ignores other members", () => {
    const source = [
      'value["__proto__"];',
      "value['prototype'];",
      'value["constructor"];',
      "value[key];",
      'value["safe"];'
    ].join("\n");

    expect(AS011(source)).toEqual([
      {
        code: "AS011",
        severity: "error",
        message: "Property access to '__proto__', 'prototype', and 'constructor' is not allowed.",
        filename: "<input>",
        line: 1,
        column: 7,
        span: {
          start: { line: 1, column: 7, offset: source.indexOf('"__proto__"') },
          end: { line: 1, column: 18, offset: source.indexOf('"__proto__"') + '"__proto__"'.length }
        }
      },
      {
        code: "AS011",
        severity: "error",
        message: "Property access to '__proto__', 'prototype', and 'constructor' is not allowed.",
        filename: "<input>",
        line: 2,
        column: 7,
        span: {
          start: { line: 2, column: 7, offset: source.indexOf("'prototype'") },
          end: { line: 2, column: 18, offset: source.indexOf("'prototype'") + "'prototype'".length }
        }
      },
      {
        code: "AS011",
        severity: "error",
        message: "Property access to '__proto__', 'prototype', and 'constructor' is not allowed.",
        filename: "<input>",
        line: 3,
        column: 7,
        span: {
          start: { line: 3, column: 7, offset: source.indexOf('"constructor"') },
          end: {
            line: 3,
            column: 20,
            offset: source.indexOf('"constructor"') + '"constructor"'.length
          }
        }
      }
    ]);
  });

  it("reports forbidden access through optional chains and destructuring targets", () => {
    const source = ["value?.__proto__?.trim;", '({ safe: target["constructor"] } = source);'].join(
      "\n"
    );

    expect(AS011(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS011",
        severity: "error",
        message: "Property access to '__proto__', 'prototype', and 'constructor' is not allowed.",
        filename: "rule.js",
        line: 1,
        column: 8,
        span: {
          start: { line: 1, column: 8, offset: source.indexOf("__proto__") },
          end: { line: 1, column: 17, offset: source.indexOf("__proto__") + "__proto__".length }
        }
      },
      {
        code: "AS011",
        severity: "error",
        message: "Property access to '__proto__', 'prototype', and 'constructor' is not allowed.",
        filename: "rule.js",
        line: 2,
        column: 17,
        span: {
          start: { line: 2, column: 17, offset: source.indexOf('"constructor"') },
          end: {
            line: 2,
            column: 30,
            offset: source.indexOf('"constructor"') + '"constructor"'.length
          }
        }
      }
    ]);
  });

  it("ignores matching names when they are not property access", () => {
    const source = [
      "const __proto__ = value;",
      "const prototype = value;",
      "const constructor = value;",
      "({ __proto__: alias } = source);",
      '({ ["prototype"]: value });',
      "value[safeKey];",
      "value[`constructor`];"
    ].join("\n");

    expect(AS011(source)).toEqual([]);
  });

  it("reports forbidden access inside template-literal interpolations", () => {
    expect(forbiddenSnippets("const value = `${record.constructor}`;")).toEqual(["constructor"]);
  });

  it("reports forbidden access inside parameter and destructuring defaults", () => {
    const source = [
      "const readParam = (value = record.__proto__) => value;",
      "const { value = record.prototype } = input;",
      "const [item = record.constructor] = input;"
    ].join("\n");

    expect(forbiddenSnippets(source)).toEqual(["__proto__", "prototype", "constructor"]);
  });

  it("reports forbidden access inside catch binding pattern defaults", () => {
    const source = ["try { fail(); } catch ({ value = record.constructor }) { value; }"].join("\n");

    expect(forbiddenSnippets(source)).toEqual(["constructor"]);
  });

  it("reports forbidden access inside inner arrows that are exported handlers", () => {
    const source = "export default () => () => record.constructor;";

    expect(forbiddenSnippets(source)).toEqual(["constructor"]);
  });

  it("reports forbidden access inside computed object keys and spread operands", () => {
    const source = "const value = { [record.constructor]: 1, ...record.__proto__ };";

    expect(forbiddenSnippets(source)).toEqual(["constructor", "__proto__"]);
  });

  it("reports forbidden access at file boundaries", () => {
    const source = ["record.__proto__;", "const safe = 1;", "record.constructor;"].join("\n");

    expect(forbiddenSnippets(source)).toEqual(["__proto__", "constructor"]);
  });

  it("reports forbidden access inside assignment targets and values", () => {
    const source = "record.prototype = source.constructor;";

    expect(forbiddenSnippets(source)).toEqual(["prototype", "constructor"]);
  });
});
