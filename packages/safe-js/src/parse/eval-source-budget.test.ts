import { expect, it } from "vitest";
import { Budget, SandboxError } from "../interp/budget.js";
import { functionSources, functionStrictness } from "./function-source.js";
import { parseEvalScript } from "./parser.js";

it.each([
  {limits: {stringLength: 10}, budget: "stringLength"},
  {limits: {maxSteps: 10}, budget: "steps"}
])("preserves fatal eval $budget compilation limits", ({limits, budget: name}) => {
  const budget = new Budget(limits);
  const operation = budget.acquireCompileOwner();
  try {
    expect(() => parseEvalScript("/* retained source */ 1", {}, operation.owner))
      .toThrow(expect.objectContaining({code: "budgetExceeded", budget: name}));
  } finally { operation.release(); }
});

it("does not translate regular-expression budget failures into catchable syntax errors", () => {
  const budget = new Budget({maxSteps: 50});
  const operation = budget.acquireCompileOwner();
  try {
    expect(() => parseEvalScript("/[a-z]{100}/", {}, operation.owner)).toThrow(SandboxError);
  } finally { operation.release(); }
});

it.each([false, true])("retains original function source and inherited strictness: %s", strict => {
  const source = "/* prefix */ function f(x) { /* keep */ return x; }";
  const {node} = parseEvalScript(source, {strict});
  const fn = node.body[0];
  if (fn?.type !== "FunctionDeclaration") throw new Error("Expected function declaration.");
  const range = functionSources.get(fn)!;
  expect(range.text).toBe(source);
  expect(range.text.slice(range.start, range.end)).toBe("function f(x) { /* keep */ return x; }");
  expect(functionStrictness.get(fn)).toBe(strict);
});

it("records a script strict directive on nested functions", () => {
  const {node} = parseEvalScript("'use strict'; function f(){return 1}");
  const fn = node.body[1];
  if (fn?.type !== "FunctionDeclaration") throw new Error("Expected function declaration.");
  expect(functionStrictness.get(fn)).toBe(true);
});
