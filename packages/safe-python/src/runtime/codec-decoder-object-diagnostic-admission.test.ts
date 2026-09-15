import {expect, it} from "vitest";
import {PythonDecodeError} from "./decode-error.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeExceptionExecution, RuntimeRaisedException} from "./runtime-exception-execution.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues, type BuiltinInvocationContext, type RuntimeValue} from "./runtime-values.js";

it.each(["deleted", "none", "str", "int"].flatMap(shape => ["handler", "index"].map(phase => ({shape, phase}))))(
  "admits the diagnostic after decoder $phase leaves an invalid $shape object", ({shape, phase}) => {
    const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
    const values = new RuntimeValues(meter), registry = new RuntimeCodecRegistry(values, meter);
    const types = new RuntimeTypeRegistry(values, {hash: () => 0n, equal: (a: RuntimeValue, b: RuntimeValue) => a === b}, meter);
    const exceptions = new RuntimeExceptionExecution(types, values, meter);
    const prepared = exceptions.prepare(new PythonDecodeError("utf-8", Uint8Array.of(255), 0, 1, "invalid start byte", meter), {unraised: true});
    if (!(prepared instanceof RuntimeRaisedException)) throw Error("expected a native decoder exception");
    const state = runtimeExceptionPayload(prepared.value)!;
    const object = shape === "deleted" ? undefined : shape === "none" ? values.none : shape === "str" ? values.string("x") : values.integer(1);
    const index = values.cell({}), position = values.integer(-1);
    const result = values.tuple([values.string("?"), phase === "index" ? index : position]);
    const handler = values.builtinFunction({name: "handler", invoke: () => result});
    let calls = 0, indexes = 0;
    const mutate = () => {
      state.assignMember("object", object, meter);
      // The native exception-classification wrapper needs 32 bytes. The
      // following object diagnostic must also be admitted before it escapes.
      meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes - 32);
    };
    const context: BuiltinInvocationContext = {
      call() {
        calls++;
        if (phase === "handler") mutate();
        return result;
      },
      integerIndex: {
        integer: value => value.kind === "int" ? value.value : undefined,
        isExactInteger: value => value.kind === "int",
        lookupIndex: value => value === index ? () => {indexes++; mutate(); return position;} : undefined,
        typeName: () => "Position",
        warn: () => {throw Error("unexpected warning");}
      },
      isException: exceptions.matches.bind(exceptions)
    };
    const run = () => registry.handleError(handler, prepared.value, "decode", 1, context);
    let failure: unknown;
    try {run();} catch (error) {failure = error;}
    expect(failure).toBeInstanceOf(ExecutionLimitError);
    expect(failure).toMatchObject({reason: "allocation"});
    let retry: unknown;
    try {run();} catch (error) {retry = error;}
    expect(retry).toBe(failure);
    expect(calls).toBe(1);
    expect(indexes).toBe(phase === "index" ? 1 : 0);
  }
);
