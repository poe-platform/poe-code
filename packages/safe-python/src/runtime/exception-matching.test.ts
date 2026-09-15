import { describe, expect, it } from "vitest";
import { matchExceptionType, type ExceptionMatchContext } from "./exception-matching.js";
import { ExecutionBudget } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { parseModule } from "../module.js";
import { executeStatements } from "./statement-execution.js";

const root = { name: "BaseException" }, ordinary = { name: "Exception" }, valueError = { name: "ValueError" }, typeError = { name: "TypeError" }, custom = { name: "Custom" };
type Class = typeof root;
const mros = new Map<Class, readonly Class[]>([[root, [root]], [ordinary, [ordinary, root]], [valueError, [valueError, ordinary, root]], [typeError, [typeError, ordinary, root]], [custom, [custom]]]);
function fixture() {
  const events: string[] = [];
  const context: ExceptionMatchContext<unknown, Class> = {
    exceptionClass: value => { events.push("class"); return mros.has(value as Class) ? value as Class : undefined; },
    tupleItems: value => Array.isArray(value) ? value : undefined,
    mro: cls => { events.push(`mro:${cls.name}`); return mros.get(cls)!; }
  };
  return { context, events };
}
const budget = (maxSteps = 10000) => new ExecutionBudget({ maxSteps, maxAllocatedBytes: 10000 });
const diagnostic = "catching classes that do not inherit from BaseException is not allowed";

describe("ordinary exception type matching", () => {
  it.each([root, ordinary, valueError])("matches actual inherited exception classes: $name", target => {
    expect(matchExceptionType(valueError, target, fixture().context, budget())).toBe(true);
  });

  it("does not match unrelated classes", () => {
    expect(matchExceptionType(valueError, typeError, fixture().context, budget())).toBe(false);
  });

  it.each([null, 1, "ValueError", {}, { name: "ValueError" }])("rejects non-exception-class targets: %j", target => {
    expect(() => matchExceptionType(valueError, target, fixture().context, budget())).toThrow(expect.objectContaining({ name: "TypeError", message: diagnostic }));
  });

  it.each([[valueError, null], [valueError, [typeError]], [[valueError]]].map(target => ({ target })))("validates all tuple entries before matching: %j", ({ target }) => {
    const { context, events } = fixture();
    expect(() => matchExceptionType(valueError, target, context, budget())).toThrow(diagnostic);
    expect(events.some(event => event.startsWith("mro:"))).toBe(false);
  });

  it("accepts tuples of classes and does not invoke their iteration overrides", () => {
    const target = [typeError, valueError, valueError];
    target[Symbol.iterator] = () => { throw new Error("must not iterate guest tuple"); };
    expect(matchExceptionType(valueError, target, fixture().context, budget())).toBe(true);
  });

  it("does not inspect the raised MRO for an empty handler tuple", () => {
    const { context, events } = fixture();
    expect(matchExceptionType(valueError, [], context, budget())).toBe(false);
    expect(events).toEqual([]);
  });

  it("keeps internal exception-class eligibility separate from a customized MRO", () => {
    expect(matchExceptionType(custom, custom, fixture().context, budget())).toBe(true);
    expect(matchExceptionType(custom, root, fixture().context, budget())).toBe(false);
  });

  it("checks budgets before classification and throughout MRO traversal", () => {
    const { context, events } = fixture();
    expect(() => matchExceptionType(valueError, ordinary, context, budget(0))).toThrow("execution step limit exceeded");
    expect(events).toEqual([]);
    context.mro = () => Array(1000).fill(custom);
    expect(() => matchExceptionType(valueError, ordinary, context, budget(20))).toThrow("execution step limit exceeded");
  });

  it("lets the statement engine catch a validation failure in an outer handler", () => {
    const { context } = fixture(), meter = budget(), events: unknown[] = [];
    executeStatements(parseModule("try:\n  try:\n    raise\n  except bad:\n    99\nexcept TypeError:\n  7").body, {
      evaluate: expression => { if (expression.kind !== "name") throw new Error("fixture"); return expression.name === "bad" ? [valueError, null] : typeError; },
      test: () => false, iterate: () => { throw new Error("unused"); }, assign: () => { throw new Error("unused"); },
      execute: statement => { if (statement.kind === "raise") throw new PythonRuntimeError("ValueError", "original"); if (statement.kind === "expression-statement" && statement.expression.kind === "literal") events.push(statement.expression.value); },
      exceptions: {
        isGuest: error => error instanceof PythonRuntimeError, enter: () => () => {},
        handlers: { match: (error, handler) => matchExceptionType((error as Error).name === "TypeError" ? typeError : valueError, handler, context, meter), bind: () => {}, clear: () => {} }
      }
    }, meter);
    expect(events).toEqual([7n]);
  });
});
