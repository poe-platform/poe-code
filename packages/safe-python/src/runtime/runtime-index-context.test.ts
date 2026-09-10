import { expect, it } from "vitest";
import { createRuntimeIndexContext } from "./runtime-index-context.js";
import { integerIndex } from "./index-protocol.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues } from "./runtime-values.js";

it.each(["lookup", "call", "warning"])("checks cancellation after index %s callbacks", phase => {
  const initialMeter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(initialMeter), receiver = v.cell({}), method = v.cell({}); let cancelled = false;
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  const invocation = {
    lookupSpecial(value: unknown, name: string) { expect(this).toBe(invocation); expect(value).toBe(receiver); expect(name).toBe("__index__"); if (phase === "lookup") cancelled = true; return method; },
    call(value: unknown, args: readonly unknown[]) { expect(this).toBe(invocation); expect(value).toBe(method); expect(args).toEqual([]); if (phase === "lookup") throw Error("must stop before call"); if (phase === "call") cancelled = true; return phase === "warning" ? v.true : v.integer(1); },
    warn() { expect(this).toBe(invocation); cancelled = true; }, isStopIteration: () => false
  };
  const context = createRuntimeIndexContext(invocation, meter);
  expect(() => integerIndex(receiver, context, meter)).toThrow(ExecutionLimitError);
});
