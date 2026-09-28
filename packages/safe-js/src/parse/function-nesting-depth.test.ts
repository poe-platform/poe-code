import { describe, expect, it } from "vitest";

import { Budget } from "../interp/budget.js";
import { parseModule } from "./parser.js";

function parseWithDepth(source: string, maxCallDepth = 4): void {
  const lease = new Budget({ maxCallDepth }).acquireCompileOwner();
  try {
    parseModule(source, "boundaries.ajs", lease.owner);
  } finally {
    lease.release();
  }
}

const ternary = "true ? (true ? (true ? (true ? 1 : 2) : 3) : 4) : 5";
const outerTernary = (inner: string) => `return true ? (true ? (true ? (true ? (${inner}) : 0) : 0) : 0) : 0;`;
const outerIf = (inner: string) => `if (true) { if (true) { if (true) { if (true) { ${inner} } } } }`;

describe("parser nesting at execution boundaries", () => {
  it.each([
    `return ${ternary};`,
    `return (() => (${ternary})) ? 10 : 20;`,
    `return (function() { return ${ternary}; }) ? 10 : 20;`,
    `return (class { method() { return ${ternary}; } }) ? 10 : 20;`,
    `return (class { field = ${ternary}; }) ? 10 : 20;`,
    `return (class { static { const value = ${ternary}; } }) ? 10 : 20;`,
    outerTernary("() => (true ? 1 : 2)"),
    outerTernary("() => { return true ? 1 : 2; }"),
    outerTernary("function(value = true ? 1 : 2) { return true ? 1 : 2; }"),
    outerTernary("class { method(value = true ? 1 : 2) { return true ? 1 : 2; } }"),
    outerTernary("class { field = true ? 1 : 2; static { const x = true ? 1 : 2; } }"),
    outerTernary("{ method() { return true ? 1 : 2; } }"),
    outerIf("const f = function() { if (true) return 1; }; return 10;"),
    outerIf("function f() { if (true) return 1; } return 10;"),
    outerIf("const f = () => { if (true) return 1; }; return 10;"),
    outerIf("class C { method() { if (true) return 1; } static { if (true) {} } }"),
    "while (true) { const f = () => { while (true) { break; } }; break; }"
  ])("accepts independently bounded nested bodies: %s", source => {
    expect(() => parseWithDepth(source)).not.toThrow();
  });

  it.each([
    "() => (true ? 1 : 2)",
    "function() { return true ? 1 : 2; }",
    "class { method() { return true ? 1 : 2; } }"
  ])("restores outer ternary depth after a nested body: %s", expression => {
    expect(() => parseWithDepth(outerTernary(`${expression}, true ? 1 : 2`)))
      .toThrow("Conditional expression nesting limit exceeded");
  });

  it("restores outer if depth after a nested body", () => {
    expect(() => parseWithDepth(outerIf("function f() { if (true) return 1; } if (true) {}")))
      .toThrow("If statement nesting limit exceeded");
  });

  it.each([
    `return (() => (true ? (${ternary}) : 0)) ? 10 : 20;`,
    outerIf("function f() { if (true) if (true) if (true) if (true) if (true) return 1; }"),
    `return (class extends (${ternary}) {}) ? 10 : 20;`,
    `return (class { [${ternary}]() {} }) ? 10 : 20;`,
    `return (class { [${ternary}] = 0; }) ? 10 : 20;`,
    outerTernary("class extends (true ? Object : Object) {}"),
    outerTernary("class { [true ? 1 : 2]() {} }")
  ])("still rejects excessive depth in evaluated expressions or nested bodies: %s", source => {
    expect(() => parseWithDepth(source)).toThrow("nesting limit exceeded");
  });

  it.each([
    "while (true) { function f() { break; } }",
    "while (true) { const f = () => { continue; }; }"
  ])("does not inherit loop control into functions: %s", source => {
    expect(() => parseWithDepth(source)).toThrow();
  });

  it("restores outer loop control after a function", () => {
    expect(() => parseWithDepth("while (true) { function f() {} continue; }"))
      .not.toThrow();
  });
});
