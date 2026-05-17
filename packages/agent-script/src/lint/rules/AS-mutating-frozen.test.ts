import { describe, expect, it } from "vitest";

import { AS_MUTATING_FROZEN } from "./AS-mutating-frozen.js";

function codes(source: string): string[] {
  return AS_MUTATING_FROZEN(source, { filename: "rule.js" }).map((diagnostic) => diagnostic.code);
}

describe("AS_MUTATING_FROZEN", () => {
  it("reports mutating calls on direct Object.freeze results", () => {
    const source = "Object.freeze([1, 2]).push(3);";

    expect(AS_MUTATING_FROZEN(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS-MUTATING-FROZEN",
        severity: "warning",
        message: "Mutating array method 'push' cannot be called on an immutable array.",
        filename: "rule.js",
        line: 1,
        column: 1,
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: source.length, offset: source.length - 1 }
        }
      }
    ]);
  });

  it("reports mutating calls on bindings initialized from Object.freeze results", () => {
    const source = "const a = Object.freeze([1]); a.push(2);";

    expect(AS_MUTATING_FROZEN(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS-MUTATING-FROZEN",
        severity: "warning",
        message: "Mutating array method 'push' cannot be called on an immutable array.",
        filename: "rule.js",
        line: 1,
        column: source.indexOf("a.push") + 1,
        span: {
          start: {
            line: 1,
            column: source.indexOf("a.push") + 1,
            offset: source.indexOf("a.push")
          },
          end: { line: 1, column: source.length, offset: source.length - 1 }
        }
      }
    ]);
  });

  it("reports mutating calls on direct Array.of results", () => {
    expect(codes("Array.of(1, 2).pop();")).toEqual(["AS-MUTATING-FROZEN"]);
  });

  it("reports every mutating array method on frozen receivers", () => {
    const mutatingMethods = [
      "push",
      "pop",
      "shift",
      "unshift",
      "splice",
      "sort",
      "reverse",
      "fill",
      "copyWithin"
    ];

    for (const method of mutatingMethods) {
      expect(codes(`const a = Object.freeze([1, 2]); a.${method}(3);`)).toEqual([
        "AS-MUTATING-FROZEN"
      ]);
    }
  });

  it("reports string-literal computed mutating calls on frozen receivers", () => {
    expect(codes('const a = Object.freeze([1]); a["push"](2);')).toEqual(["AS-MUTATING-FROZEN"]);
  });

  it("reports aliases and reassignment to immutable array origins", () => {
    expect(codes("let a = [1]; a = Object.freeze([1]); const b = a; b.reverse();")).toEqual([
      "AS-MUTATING-FROZEN"
    ]);
  });

  it("allows mutating calls on plain array literals", () => {
    expect(codes("const a = [1, 2]; a.push(3);")).toEqual([]);
  });

  it("allows mutating calls on unknown receivers", () => {
    expect(codes("const a = someHostFn(); a.push(3);")).toEqual([]);
  });

  it("allows non-mutating calls on frozen receivers", () => {
    expect(codes("const a = Object.freeze([1]); a.concat([2]);")).toEqual([]);
  });

  it("allows computed calls that are not literal mutating method names", () => {
    expect(codes("const a = Object.freeze([1]); const method = 'push'; a[method](2);")).toEqual([]);
  });

  it("allows factory names shadowed by local bindings", () => {
    expect(codes("const Object = { freeze: someHostFn }; Object.freeze([1]).push(2);")).toEqual([]);
    expect(codes("const Array = someHostFn(); Array.of(1, 2).pop();")).toEqual([]);
    expect(codes('import Object from "host"; Object.freeze([1]).push(2);')).toEqual([]);
  });
});
