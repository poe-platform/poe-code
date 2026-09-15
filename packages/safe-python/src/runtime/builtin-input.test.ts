import { expect, it } from "vitest";
import { createInputBuiltin } from "./builtin-input.js";
import { PythonRuntimeError } from "./error.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { RuntimeExceptionExecution, RuntimeRaisedException } from "./runtime-exception-execution.js";
import { RuntimeExceptionState } from "./runtime-exception-state.js";
import { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { RuntimeValues, type BuiltinInvocationContext, type RuntimeValue } from "./runtime-values.js";
import reference from "./__snapshots__/input-stream-errors-3.14.7.json";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 2000000 });
  const values = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, values, meter).value };
  const registry = new RuntimeTypeRegistry(values, keys, meter);
  const exceptions = new RuntimeExceptionExecution(registry, values, meter);
  const invocation: BuiltinInvocationContext = {
    call() { throw Error("unexpected guest call"); },
    isStopIteration: error => exceptions.matches(error, "StopIteration"),
    isException: exceptions.matches.bind(exceptions)
  };
  const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  return { meter, values, registry, invocation, keywords };
}

// CPython 3.14.7 clears stdout.flush failures before readline, including
// BaseException subclasses. Other stages retain their original failures.
for (const name of ["ValueError", "TypeError", "MemoryError", "KeyboardInterrupt", "SystemExit"] as const) {
  for (const carrier of ["native", "guest"] as const) {
    it.each(["write", "flush", "read"] as const)(`handles ${carrier} ${name} from %s in input order`, phase => {
      const { meter, values, registry, invocation, keywords } = fixture();
      const expected = reference.rows.find(row => row.name === name && row.phase === phase)!;
      const failure = carrier === "native" ? new PythonRuntimeError(name, "stream failed")
        : new RuntimeRaisedException(values.instance(registry.exceptionType(name), undefined,
          new RuntimeExceptionState(values.tuple([values.string("stream failed")]), meter)), meter);
      const events: string[] = [];
      const builtin = createInputBuiltin(values, meter, { streams() {
        return {
          write() { events.push("write"); if (phase === "write") throw failure; },
          flush() { events.push("flush"); if (phase === "flush") throw failure; },
          readLine() { events.push("read"); if (phase === "read") throw failure; return "answer\n"; }
        };
      } });
      const call = () => builtin.value.invoke([values.string("prompt")], keywords, meter, invocation);
      if (phase === "flush") {
        expect(expected.result.status).toBe("ok");
        expect(call()).toEqual(values.string(expected.result.value!));
      }
      else {
        let observed: unknown;
        try { call(); } catch (error) { observed = error; }
        expect(observed).toBe(failure);
        expect(expected.result).toEqual({ status: "exception", type: name, args: ["stream failed"] });
      }
      expect(events).toEqual(expected.events);
    });
  }
}

it.each([new ExecutionLimitError("cancelled"), new Error("host failure")])("retains fatal flush failures: %s", failure => {
  const { meter, values, invocation, keywords } = fixture();
  const events: string[] = [];
  const builtin = createInputBuiltin(values, meter, { streams() {
    return { write() {}, flush() { events.push("flush"); throw failure; }, readLine() { events.push("read"); return "answer\n"; } };
  } });
  let observed: unknown;
  try { builtin.value.invoke([], keywords, meter, invocation); } catch (error) { observed = error; }
  expect(observed).toBe(failure);
  expect(events).toEqual(["flush"]);
});

it("checks cancellation after clearing a guest flush failure before reading", () => {
  const controller = new AbortController();
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 2000000, signal: controller.signal });
  const values = new RuntimeValues(meter);
  const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const events: string[] = [];
  const builtin = createInputBuiltin(values, meter, { streams() {
    return { write() {}, flush() { controller.abort(); throw new PythonRuntimeError("ValueError", "flush failed"); },
      readLine() { events.push("read"); return "answer\n"; } };
  } });
  expect(() => builtin.value.invoke([], keywords, meter)).toThrow(new ExecutionLimitError("cancelled"));
  expect(events).toEqual([]);
});
