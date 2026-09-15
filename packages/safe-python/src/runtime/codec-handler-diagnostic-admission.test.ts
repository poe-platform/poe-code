import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeValues, type BuiltinInvocationContext, type RuntimeValue} from "./runtime-values.js";

it.each((["encode", "decode"] as const).flatMap(operation =>
  ["none", "list", "empty", "short", "long", "replacement", "overflow", "negative", "positive"].map(shape => ({operation, shape}))))(
  "admits $operation $shape handler diagnostics after guest allocation", ({operation, shape}) => {
    const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
    const values = new RuntimeValues(meter), registry = new RuntimeCodecRegistry(values, meter);
    const replacement = shape === "replacement" ? values.none : values.string("?");
    const position = values.integer(shape === "overflow" ? 1n << 63n : shape === "negative" ? -4n : 4n);
    const result = shape === "none" ? values.none : shape === "list" ? values.list([])
      : ["empty", "short", "long"].includes(shape)
        ? values.tuple(Array.from({length: shape === "empty" ? 0 : shape === "short" ? 1 : 3}, () => values.none))
        : values.tuple([replacement, position]);
    const handler = values.builtinFunction({name: "handler", invoke: () => result});
    let calls = 0;
    const context: BuiltinInvocationContext = {call() {
      calls++;
      meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes);
      return result;
    }};
    let failure: unknown;
    try {registry.handleError(handler, values.none, operation, 3, context);} catch (error) {failure = error;}
    expect(failure, shape).toBeInstanceOf(ExecutionLimitError);
    expect(failure).toMatchObject({reason: "allocation"});
    let retry: unknown;
    try {registry.handleError(handler, values.none, operation, 3, context);} catch (error) {retry = error;}
    expect(retry).toBe(failure);
    expect(calls).toBe(1);
});

it.each((["encode", "decode"] as const).flatMap(operation =>
  [-4n, 4n, 1n << 63n].map(position => ({operation, position}))))(
  "admits $operation position $position diagnostics after __index__ allocation", ({operation, position}) => {
    const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
    const values = new RuntimeValues(meter), registry = new RuntimeCodecRegistry(values, meter);
    const index = values.cell({}), converted = values.integer(position);
    const result = values.tuple([values.string("?"), index]);
    const handler = values.builtinFunction({name: "handler", invoke: () => result});
    let calls = 0, indexes = 0;
    const context: BuiltinInvocationContext = {
      call() {calls++; return result;},
      integerIndex: {
        integer: (value: RuntimeValue) => value.kind === "int" ? value.value : undefined,
        isExactInteger: value => value.kind === "int",
        lookupIndex: value => value === index ? () => {
          indexes++;
          meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes);
          return converted;
        } : undefined,
        typeName: () => "Position",
        warn: () => {throw Error("unexpected warning");}
      }
    };
    let failure: unknown;
    try {registry.handleError(handler, values.none, operation, 3, context);} catch (error) {failure = error;}
    expect(failure).toBeInstanceOf(ExecutionLimitError);
    expect(failure).toMatchObject({reason: "allocation"});
    let retry: unknown;
    try {registry.handleError(handler, values.none, operation, 3, context);} catch (error) {retry = error;}
    expect(retry).toBe(failure);
    expect([calls, indexes]).toEqual([1, 1]);
});
