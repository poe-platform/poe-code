import { describe, expect, it } from "vitest";
import { parseExpression } from "../expression.js";
import type { Expression } from "../ast.js";
import { evaluateExpression, type ExpressionContext } from "./expression-evaluation.js";
import { ExecutionBudget } from "./execution-budget.js";
import { integerDivmod } from "./integer-arithmetic.js";
import { parseModule } from "../module.js";
import { executeStatements } from "./statement-execution.js";

type Value = bigint | boolean | null | string;

function environment(initial: ReadonlyMap<string, Value> = new Map()) {
  const names = new Map(initial), events: string[] = [];
  const context: ExpressionContext<Value> = {
    literal: node => {
      if (node.literalKind === "integer" || node.literalKind === "boolean" || node.literalKind === "none") return node.value as Value;
      throw new Error("fixture literal unsupported");
    },
    load: name => { events.push(`load:${name}`); if (!names.has(name)) throw new Error(`missing:${name}`); return names.get(name)!; },
    store: (name, value) => { events.push(`store:${name}`); names.set(name, value); },
    unary: (operator, value) => operator === "not" ? !context.truth(value) : operator === "-" ? -(value as bigint) : operator === "~" ? ~(value as bigint) : value,
    binary: (operator, left, right) => {
      events.push(`binary:${operator}`);
      if (operator === "+") return (left as bigint) + (right as bigint);
      if (operator === "*") return (left as bigint) * (right as bigint);
      if (operator === "//") return integerDivmod(left as bigint, right as bigint).quotient;
      throw new Error("fixture binary unsupported");
    },
    compare: (operator, left, right) => { events.push(`compare:${operator}`); return operator === "<" ? (left as bigint) < (right as bigint) : left === right; },
    truth: value => { events.push("truth"); return Boolean(value); },
    boolean: value => value,
    beginCall: () => { throw new Error("fixture calls unsupported"); },
    beginSet: () => { throw new Error("fixture sets unsupported"); },
    beginDictionary: () => { throw new Error("fixture dictionaries unsupported"); },
    tuple: () => { throw new Error("fixture tuples unsupported"); },
    list: () => { throw new Error("fixture lists unsupported"); },
    slice: () => { throw new Error("fixture slices unsupported"); },
    getItem: () => { throw new Error("fixture subscriptions unsupported"); },
    iterate: () => { throw new Error("fixture iteration unsupported"); },
    attribute: (value, name) => { events.push(`attribute:${name}`); return `${value}.${name}`; }
  };
  return { context, names, events };
}

const budget = () => new ExecutionBudget({ maxSteps: 1000000, maxAllocatedBytes: 1000000 });

describe("expression execution order", () => {
  it("returns host truth in branch mode while preserving ordinary value mode", () => {
    const { context } = environment(new Map([["a", 7n]]));
    expect(evaluateExpression(parseExpression("a"), context, budget(), "branch")).toBe(true);
    expect(evaluateExpression(parseExpression("a"), context, budget())).toBe(7n);
  });

  it.each(["a and missing", "not (a and missing)", "(a and missing) if True else missing"])("does not repeat a stateful truth conversion at the branch boundary: %s", source => {
    const { context } = environment(new Map([["a", 0n]]));
    let calls = 0;
    context.truth = value => typeof value === "boolean" ? value : ++calls > 1;
    expect(evaluateExpression(parseExpression(source), context, budget(), "branch")).toBe(source.startsWith("not"));
    expect(calls).toBe(1);
  });

  it("preserves the walrus value boundary inside branch mode", () => {
    const { context, names } = environment(new Map([["a", 0n]]));
    let calls = 0;
    context.truth = () => ++calls > 1;
    expect(evaluateExpression(parseExpression("(x := (a and missing))"), context, budget(), "branch")).toBe(true);
    expect(calls).toBe(2);
    expect(names.get("x")).toBe(0n);
  });

  it("does not retest a short-circuited comparison chain in branch mode", () => {
    const { context } = environment();
    let calls = 0;
    context.compare = () => "comparison";
    context.truth = () => ++calls > 1;
    expect(evaluateExpression(parseExpression("1 < 2 < missing"), context, budget(), "branch")).toBe(false);
    expect(calls).toBe(1);
  });

  it("checks the budget before the final guest truth conversion", () => {
    const { context, events } = environment();
    expect(() => evaluateExpression(parseExpression("1"), context, new ExecutionBudget({ maxSteps: 1, maxAllocatedBytes: 1000 }), "branch")).toThrow("execution step limit exceeded");
    expect(events).toEqual([]);
    context.truth = () => { throw new Error("guest truth failed"); };
    expect(() => evaluateExpression(parseExpression("1"), context, budget(), "branch")).toThrow("guest truth failed");
  });

  it("drives statement branches without converting an already-tested value again", () => {
    const { context } = environment(new Map([["a", 0n]])), meter = budget(), outputs: Value[] = [];
    let calls = 0;
    context.truth = () => ++calls > 1;
    executeStatements(parseModule("if a and missing:\n  1\nelse:\n  2").body, {
      evaluate: expression => evaluateExpression(expression, context, meter),
      test: expression => evaluateExpression(expression, context, meter, "branch"),
      iterate: () => { throw new Error("unused"); },
      assign: () => { throw new Error("unused"); },
      execute: statement => {
        if (statement.kind !== "expression-statement") throw new Error("unused");
        outputs.push(evaluateExpression(statement.expression, context, meter));
      }
    }, meter);
    expect(outputs).toEqual([2n]);
    expect(calls).toBe(1);
  });

  it("executes parsed arithmetic using runtime operations", () => {
    const { context } = environment();
    expect(evaluateExpression(parseExpression("-7 // 3 + 2 * 5"), context, budget())).toBe(7n);
  });

  it("evaluates operands left to right", () => {
    const { context, events } = environment(new Map([["a", 2n], ["b", 3n], ["c", 4n]]));
    expect(evaluateExpression(parseExpression("a + b * c"), context, budget())).toBe(14n);
    expect(events).toEqual(["load:a", "load:b", "load:c", "binary:*", "binary:+"]);
  });

  it("short-circuits and/or and returns the selected operand without coercion", () => {
    const { context, events } = environment();
    expect(evaluateExpression(parseExpression("0 and missing"), context, budget())).toBe(0n);
    expect(evaluateExpression(parseExpression("5 or missing"), context, budget())).toBe(5n);
    expect(evaluateExpression(parseExpression("0 or 9"), context, budget())).toBe(9n);
    expect(events).toEqual(["truth", "truth", "truth"]);
  });

  it("selects only one conditional branch, including unsupported inactive syntax", () => {
    const { context, events } = environment();
    expect(evaluateExpression(parseExpression("7 if True else (lambda: missing)"), context, budget())).toBe(7n);
    expect(evaluateExpression(parseExpression("missing if False else 8"), context, budget())).toBe(8n);
    expect(events).toEqual(["truth", "truth"]);
  });

  it("does not repeat a truth test through nested logical and conditional contexts", () => {
    const { context, events } = environment(new Map([["a", 0n]]));
    expect(evaluateExpression(parseExpression("a and missing and missing"), context, budget())).toBe(0n);
    expect(events).toEqual(["load:a", "truth"]);
    events.length = 0;
    expect(evaluateExpression(parseExpression("9 if (a and missing) else 8"), context, budget())).toBe(8n);
    expect(events).toEqual(["load:a", "truth"]);
  });

  it("retests a value after a walrus value boundary", () => {
    const { context, events } = environment(new Map([["a", 0n]]));
    expect(evaluateExpression(parseExpression("(x := (a and missing)) or 9"), context, budget())).toBe(9n);
    expect(events).toEqual(["load:a", "truth", "store:x", "truth"]);
  });

  it("propagates truth-test context through not without repeating guest truth conversion", () => {
    const { context, events } = environment(new Map([["a", 0n]]));
    expect(evaluateExpression(parseExpression("7 if not (a and missing) else 8"), context, budget())).toBe(7n);
    expect(events).toEqual(["load:a", "truth"]);
  });

  it("preserves value-context truth calls for not used as a boolean operand", () => {
    const { context, events } = environment(new Map([["a", 0n]]));
    evaluateExpression(parseExpression("(not (a and missing)) and 9"), context, budget());
    expect(events.filter(event => event === "truth")).toHaveLength(3);
  });

  it("retests a declined comparison chain used as a value-producing boolean operand", () => {
    const { context, events } = environment();
    context.compare = () => 0n;
    expect(evaluateExpression(parseExpression("(1 < 2 < missing) and 9"), context, budget())).toBe(0n);
    expect(events).toEqual(["truth", "truth"]);
  });

  it("retests the selected conditional value in a value-producing boolean expression", () => {
    const { context, events } = environment(new Map([["a", 1n]]));
    expect(evaluateExpression(parseExpression("((a or missing) if True else missing) and 9"), context, budget())).toBe(9n);
    expect(events).toEqual(["truth", "load:a", "truth", "truth"]);
  });

  it("retains the alternate branch short-circuit test through a surrounding logical expression", () => {
    const { context, events } = environment(new Map([["a", 1n]]));
    expect(evaluateExpression(parseExpression("(missing if False else (a or missing)) and 9"), context, budget())).toBe(9n);
    expect(events).toEqual(["truth", "load:a", "truth"]);
  });

  it("evaluates chained comparison intermediates once and does not truth-test the last result", () => {
    const { context, events } = environment(new Map([["a", 1n], ["b", 2n], ["c", 3n]]));
    expect(evaluateExpression(parseExpression("a < b < c"), context, budget())).toBe(true);
    expect(events).toEqual(["load:a", "load:b", "compare:<", "truth", "load:c", "compare:<"]);
  });

  it("returns a false-like comparison result unchanged and skips later operands", () => {
    const { context, events } = environment();
    context.compare = () => "";
    expect(evaluateExpression(parseExpression("1 < 2 < missing"), context, budget())).toBe("");
    expect(events).toEqual(["truth"]);
  });

  it("stores a walrus value once and returns it", () => {
    const { context, names, events } = environment();
    expect(evaluateExpression(parseExpression("(x := 3) + x"), context, budget())).toBe(6n);
    expect(names.get("x")).toBe(3n);
    expect(events).toEqual(["store:x", "load:x", "binary:+"]);
  });

  it("resolves attributes after evaluating their objects", () => {
    const { context, events } = environment(new Map([["obj", "value"]]));
    expect(evaluateExpression(parseExpression("obj.first.second"), context, budget())).toBe("value.first.second");
    expect(events).toEqual(["load:obj", "attribute:first", "attribute:second"]);
  });

  it("propagates operation failures without evaluating subsequent operands", () => {
    const { context, events } = environment();
    expect(() => evaluateExpression(parseExpression("missing + (x := 1)"), context, budget())).toThrow("missing:missing");
    expect(events).toEqual(["load:missing"]);
  });

  it("uses an explicit work stack for deeply nested expression trees", () => {
    const leaf = parseExpression("1");
    let expression: Expression = leaf;
    for (let depth = 0; depth < 20000; depth++) expression = { ...leaf, kind: "unary", operator: "+", operand: expression };
    expect(evaluateExpression(expression, environment().context, budget())).toBe(1n);
  });

  it("stops before operations on cancellation or step exhaustion", () => {
    const { context, events } = environment();
    expect(() => evaluateExpression(parseExpression("(x := 1)"), context, new ExecutionBudget({ maxSteps: 2, maxAllocatedBytes: 1000 }))).toThrow("execution step limit exceeded");
    expect(events).toEqual([]);
    const controller = new AbortController(); controller.abort();
    expect(() => evaluateExpression(parseExpression("missing"), context, new ExecutionBudget({ maxSteps: 10, maxAllocatedBytes: 1000, signal: controller.signal }))).toThrow("execution cancelled");
  });

  it("reports unimplemented expression families explicitly", () => {
    expect(() => evaluateExpression(parseExpression("lambda: 1"), environment().context, budget())).toThrow(expect.objectContaining({ name: "UnsupportedExpressionError", kind: "lambda" }));
  });
});
