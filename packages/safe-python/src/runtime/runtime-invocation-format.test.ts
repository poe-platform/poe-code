import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { formatObject } from "./format-protocol.js";
import { representationObject } from "./representation-protocol.js";
import { createRuntimeFormatContext } from "./runtime-format.js";
import { createRuntimeInvocationFormatContext } from "./runtime-invocation-format.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const fallback = createRuntimeFormatContext(v, meter, { defaultRepr() { throw Error("missing representation policy"); } });
  return { meter, v, fallback };
}

it("resolves live methods without caching a bound slot and preserves invocation ownership", () => {
  const { meter, v, fallback } = fixture(), receiver = v.cell({}), first = v.cell({}), second = v.cell({}), spec = v.string("spec"); let method: RuntimeValue | undefined = first;
  const invocation = {
    lookupSpecial(value: RuntimeValue, name: string) { expect(this).toBe(invocation); expect(value).toBe(receiver); expect(name).toBe("__format__"); return method; },
    typeName() { expect(this).toBe(invocation); return "Guest"; },
    call(value: RuntimeValue, args: readonly RuntimeValue[]) { expect(this).toBe(invocation); expect(value).toBe(method); expect(args).toEqual([spec]); return v.string(value === first ? "first" : "second"); },
    isStopIteration: () => false
  };
  const context = createRuntimeInvocationFormatContext(v, meter, invocation, fallback);
  expect(formatObject(receiver, spec, context, meter)).toEqual(v.string("first"));
  method = second; expect(formatObject(receiver, spec, context, meter)).toEqual(v.string("second"));
  method = undefined; expect(() => formatObject(receiver, spec, context, meter)).toThrow("Type Guest doesn't define __format__");
});

it("propagates descriptor errors without falling back to native representation", () => {
  const { meter, v, fallback } = fixture(), failure = new PythonRuntimeError("AttributeError", "descriptor failed");
  const context = createRuntimeInvocationFormatContext(v, meter, {
    lookupSpecial() { throw failure; }, call() { throw Error("unexpected call"); }, isStopIteration: () => false
  }, fallback);
  expect(() => formatObject(v.cell({}), v.string(""), context, meter)).toThrow(failure);
});

it.each(["format", "str", "repr", "ascii"] as const)("checks cancellation after guest %s lookup and call", operation => {
  for (const phase of ["lookup", "call"]) {
    const { v, fallback } = fixture(); let cancelled = false;
    const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
    const context = createRuntimeInvocationFormatContext(v, meter, {
      lookupSpecial() { if (phase === "lookup") cancelled = true; return v.none; },
      call() { if (phase === "lookup") throw Error("must stop before call"); cancelled = true; return v.string("result"); }, isStopIteration: () => false
    }, fallback);
    const run = () => operation === "format" ? formatObject(v.cell({}), v.string("spec"), context, meter) : representationObject(v.cell({}), operation, context, meter);
    expect(run).toThrow(ExecutionLimitError);
  }
});

it("uses the supplied default representation only after both str and repr are absent", () => {
  const { meter, v, fallback } = fixture(), receiver = v.cell({}), names: string[] = [], result = v.string("default");
  const defaults = { ...fallback, defaultRepr(value: RuntimeValue) { expect(this).toBe(defaults); expect(value).toBe(receiver); expect(names).toEqual(["__str__", "__repr__"]); return result; } };
  const context = createRuntimeInvocationFormatContext(v, meter, {
    lookupSpecial(value, name) { expect(value).toBe(receiver); names.push(name); return undefined; },
    call() { throw Error("must not call absent method"); }, isStopIteration: () => false
  }, defaults);
  expect(representationObject(receiver, "str", context, meter)).toBe(result);
});
