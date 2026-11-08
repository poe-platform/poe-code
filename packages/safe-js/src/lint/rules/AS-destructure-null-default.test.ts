import { describe, expect, it } from "vitest";

import { AS_DESTRUCTURE_NULL_DEFAULT } from "./AS-destructure-null-default.js";

function codes(source: string): string[] {
  return AS_DESTRUCTURE_NULL_DEFAULT(source, { filename: "rule.js" }).map(
    (diagnostic) => diagnostic.code
  );
}

describe("AS_DESTRUCTURE_NULL_DEFAULT", () => {
  it("reports object destructuring defaults for known null properties", () => {
    expect(codes("const { a = 1 } = { a: null };")).toEqual(["AS-DESTRUCTURE-NULL-DEFAULT"]);
  });

  it("allows object destructuring defaults for known undefined properties", () => {
    expect(codes("const { a = 1 } = { a: undefined };")).toEqual([]);
  });

  it("allows object destructuring defaults for missing properties", () => {
    expect(codes("const { a = 1 } = {};")).toEqual([]);
  });

  it("allows object destructuring defaults for dynamic values", () => {
    expect(codes("const { a = 1 } = obj;")).toEqual([]);
  });

  it("reports array destructuring defaults for known null elements", () => {
    expect(codes("const [a = 1] = [null];")).toEqual(["AS-DESTRUCTURE-NULL-DEFAULT"]);
  });

  it("reports nested object destructuring defaults for known null properties", () => {
    const source = "const { x: { a = 1 } } = { x: { a: null } };";
    const diagnostics = AS_DESTRUCTURE_NULL_DEFAULT(source, { filename: "rule.js" });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "AS-DESTRUCTURE-NULL-DEFAULT",
        severity: "warning",
        line: 1,
        column: 14
      })
    ]);
  });

  it("reports assignment expressions with known null properties", () => {
    expect(codes("({ a = 1 } = { a: null });")).toEqual(["AS-DESTRUCTURE-NULL-DEFAULT"]);
  });

  it("allows non-pattern assignment expressions", () => {
    expect(codes("target.value = null;")).toEqual([]);
  });

  it("reports default parameter destructuring against known null properties", () => {
    expect(codes("const f = ({ a = 1 } = { a: null }) => a;")).toEqual([
      "AS-DESTRUCTURE-NULL-DEFAULT"
    ]);
  });

  it("uses the last known object property value", () => {
    expect(codes("const { a = 1 } = { a: null, a: undefined };")).toEqual([]);
    expect(codes("const { a = 1 } = { a: undefined, a: null };")).toEqual([
      "AS-DESTRUCTURE-NULL-DEFAULT"
    ]);
  });

  it("allows values hidden behind later object spreads", () => {
    expect(codes("const { a = 1 } = { a: null, ...obj };")).toEqual([]);
  });

  it("reports known properties after earlier object spreads", () => {
    expect(codes("const { a = 1 } = { ...obj, a: null };")).toEqual([
      "AS-DESTRUCTURE-NULL-DEFAULT"
    ]);
  });

  it("reports nested array defaults inside known object properties", () => {
    expect(codes("const { x: [a = 1] } = { x: [null] };")).toEqual(["AS-DESTRUCTURE-NULL-DEFAULT"]);
  });

  it("allows array elements hidden behind earlier spreads", () => {
    expect(codes("const [a = 1] = [...items];")).toEqual([]);
  });
});
