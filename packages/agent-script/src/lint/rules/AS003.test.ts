import { describe, expect, it } from "vitest";

import { AS003 } from "./AS003.js";

describe("AS003", () => {
  it("allows runtime globals by default", () => {
    expect(AS003('String("x");')).toEqual([]);
    expect(AS003("Math.PI;")).toEqual([]);
    expect(AS003("JSON.stringify({});")).toEqual([]);
    expect(AS003("Number.isFinite(1); Number.isNaN(0 / 0); Number.isInteger(1);")).toEqual([]);
  });

  it("suggests nearby runtime globals for unresolved identifiers", () => {
    const source = "Maths.PI;";

    expect(AS003(source)).toEqual([
      {
        code: "AS003",
        severity: "error",
        message: "Unknown identifier 'Maths'. Did you mean 'Math'?",
        filename: "<input>",
        line: 1,
        column: 1,
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 6, offset: "Maths".length }
        }
      }
    ]);
  });

  it("keeps unknown member objects unresolved when no suggestion matches", () => {
    const source = "Unknown.thing;";

    expect(AS003(source)).toEqual([
      {
        code: "AS003",
        severity: "error",
        message: "Unknown identifier 'Unknown'. No names are in scope.",
        filename: "<input>",
        line: 1,
        column: 1,
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 8, offset: "Unknown".length }
        }
      }
    ]);
  });

  it("allows additional caller-provided globals", () => {
    expect(AS003("Custom.x;", { allowedGlobals: ["Custom"] })).toEqual([]);
  });

  it("lets local bindings shadow runtime globals", () => {
    const source = 'const String = (value) => value; String("x");';

    expect(AS003(source)).toEqual([]);
  });

  it("does not treat module names as global bindings", () => {
    const source = 'import { value } from "String"; value;';

    expect(AS003(source)).toEqual([]);
  });

  it("allows identifiers that resolve through the current scope chain and imports", () => {
    const source = [
      'import { fetchData as importedFetch } from "api";',
      "const count = 1;",
      "({ value } = { value: count }) => importedFetch(value + count);"
    ].join("\n");

    expect(AS003(source, { filename: "rule.js" })).toEqual([]);
  });

  it("suggests nearby in-scope names for unresolved identifiers", () => {
    const source = [
      'import { fetchData } from "api";',
      "const counter = 1;",
      "(value) => {",
      "  return couter + fetchData + value;",
      "};"
    ].join("\n");

    expect(AS003(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS003",
        severity: "error",
        message: "Unknown identifier 'couter'. Did you mean 'counter'?",
        filename: "rule.js",
        line: 4,
        column: 10,
        span: {
          start: { line: 4, column: 10, offset: source.indexOf("couter") },
          end: { line: 4, column: 16, offset: source.indexOf("couter") + "couter".length }
        }
      }
    ]);
  });

  it("lists in-scope names when there is no nearby match", () => {
    const source = [
      'import { fetchData as request } from "api";',
      "const counter = 1;",
      "(value) => {",
      "  return missing + request + counter + value;",
      "};"
    ].join("\n");

    expect(AS003(source)).toEqual([
      {
        code: "AS003",
        severity: "error",
        message: "Unknown identifier 'missing'. In-scope names: counter, request, value.",
        filename: "<input>",
        line: 4,
        column: 10,
        span: {
          start: { line: 4, column: 10, offset: source.indexOf("missing") },
          end: { line: 4, column: 17, offset: source.indexOf("missing") + "missing".length }
        }
      }
    ]);
  });

  it("uses scope-chain names for suggestions without flagging property access", () => {
    const source = [
      "const outer = 1;",
      "() => {",
      "  const inner = { outer };",
      "  return inner.outer + otuer;",
      "};"
    ].join("\n");

    expect(AS003(source)).toEqual([
      {
        code: "AS003",
        severity: "error",
        message: "Unknown identifier 'otuer'. Did you mean 'outer'?",
        filename: "<input>",
        line: 4,
        column: 24,
        span: {
          start: { line: 4, column: 24, offset: source.indexOf("otuer") },
          end: { line: 4, column: 29, offset: source.indexOf("otuer") + "otuer".length }
        }
      }
    ]);
  });

  it("reports unresolved identifiers when no names are in scope", () => {
    const source = "missing;";

    expect(AS003(source)).toEqual([
      {
        code: "AS003",
        severity: "error",
        message: "Unknown identifier 'missing'. No names are in scope.",
        filename: "<input>",
        line: 1,
        column: 1,
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 8, offset: "missing".length }
        }
      }
    ]);
  });

  it("suggests each nearby visible name once, sorted by distance and name", () => {
    const source = [
      "const count = 1;",
      "() => {",
      "  const counter = count + 1;",
      "  return countr;",
      "};"
    ].join("\n");

    expect(AS003(source)).toEqual([
      {
        code: "AS003",
        severity: "error",
        message: "Unknown identifier 'countr'. Did you mean one of: 'count', 'counter'?",
        filename: "<input>",
        line: 4,
        column: 10,
        span: {
          start: { line: 4, column: 10, offset: source.indexOf("countr") },
          end: { line: 4, column: 16, offset: source.indexOf("countr") + "countr".length }
        }
      }
    ]);
  });

  it("checks computed member expressions against the current scope chain", () => {
    const source = ["const key = 'id';", "const record = { id: 1 };", "() => record[keyy];"].join(
      "\n"
    );

    expect(AS003(source)).toEqual([
      {
        code: "AS003",
        severity: "error",
        message: "Unknown identifier 'keyy'. Did you mean 'key'?",
        filename: "<input>",
        line: 3,
        column: 14,
        span: {
          start: { line: 3, column: 14, offset: source.indexOf("keyy") },
          end: { line: 3, column: 18, offset: source.indexOf("keyy") + "keyy".length }
        }
      }
    ]);
  });

  it("does not treat body-local bindings as visible inside parameter defaults", () => {
    const source = [
      "(value = fallback) => {",
      "  const fallback = 1;",
      "  return value;",
      "};"
    ].join("\n");

    expect(AS003(source)).toEqual([
      {
        code: "AS003",
        severity: "error",
        message: "Unknown identifier 'fallback'. In-scope names: value.",
        filename: "<input>",
        line: 1,
        column: 10,
        span: {
          start: { line: 1, column: 10, offset: source.indexOf("fallback") },
          end: { line: 1, column: 18, offset: source.indexOf("fallback") + "fallback".length }
        }
      }
    ]);
  });
});
