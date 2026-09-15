import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRecovery} from "./runtime-codec-recovery.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeValues, type BuiltinInvocationContext, type RuntimeValue} from "./runtime-values.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeExceptionExecution} from "./runtime-exception-execution.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonDecodeError} from "./decode-error.js";

it.each(["encode-text", "encode-bytes", "decode"] as const)(
  "admits the final %s recovery record after callback services use the allocation allowance", operation => {
    const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
    const values = new RuntimeValues(meter), registry = new RuntimeCodecRegistry(values, meter);
    const types = new RuntimeTypeRegistry(values, {hash: () => 0n, equal: (a: RuntimeValue, b: RuntimeValue) => a === b}, meter);
    const exceptions = new RuntimeExceptionExecution(types, values, meter);
    const source = values.string("\ud800");
    const fault = operation === "decode"
      ? new PythonDecodeError("utf-8", Uint8Array.of(255), 0, 1, "invalid start byte", meter)
      : new PythonEncodeError("utf-8", source.value, 0, 1, "surrogates not allowed");
    const prepared = exceptions.prepare(fault, {unraised: true});
    const replacement = operation === "encode-bytes" ? values.bytes([63]) : values.string("?");
    const result = values.tuple([replacement, values.integer(-1)]);
    let calls = 0;
    const context: BuiltinInvocationContext = {
      isCallable: () => true,
      prepareException: () => prepared,
      call() {
        calls++;
        if (operation !== "decode") {
          // Enough for the registry's validated pair and raised-exception
          // wrapper, but no room for the adapter's own record and closure.
          meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes - 81);
        }
        return result;
      },
      isException() {
        // Classification is the last explicit decoder service. Leave room for
        // the validated pair and input byte, but not the adapter's record.
        meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes - 49);
        return true;
      }
    };
    registry.registerError("custom", values.cell({}), context);
    const recovery = new RuntimeCodecRecovery(registry, "custom", source, context);
    const run = () => fault instanceof PythonEncodeError ? recovery.encode(fault) : recovery.decode(fault);
    let failure: unknown;
    try {run();} catch (error) {failure = error;}
    expect(failure).toBeInstanceOf(ExecutionLimitError);
    expect(failure).toMatchObject({reason: "allocation"});
    expect(calls).toBe(1);
    let retry: unknown;
    try {run();} catch (error) {retry = error;}
    expect(retry).toBe(failure);
    expect(calls).toBe(1);
  }
);
