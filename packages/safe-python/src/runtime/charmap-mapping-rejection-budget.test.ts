import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCharmap} from "./runtime-charmap.js";
import {RuntimeValues, type BuiltinInvocationContext} from "./runtime-values.js";

const cases = [
  {operation: "encode", value: -1, message: "character mapping must be in range(256)"},
  {operation: "encode", value: 256, message: "character mapping must be in range(256)"},
  {operation: "encode", value: "invalid", message: "character mapping must return integer, bytes or None, not str"},
  {operation: "decode", value: -1, message: "character mapping must be in range(0x110000)"},
  {operation: "decode", value: 0x110000, message: "character mapping must be in range(0x110000)"},
  {operation: "decode", value: 1.5, message: "character mapping must return integer, None or str"},
] as const;

it.each(cases.flatMap(row => [false, true].map(exhaust => ({...row, exhaust}))))(
  "charmap $operation rejects $value after mapping callback, exhausted=$exhaust",
  ({operation, value, message, exhaust}) => {
    const maxAllocatedBytes = 1000000;
    const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes});
    const values = new RuntimeValues(meter), codec = new RuntimeCharmap(values, meter);
    const mapping = values.cell({}), input = CodePointString.fromString("A", meter);
    const result = typeof value === "string" ? values.string(value)
      : Number.isInteger(value) ? values.integer(value) : values.float(value);
    let calls = 0;
    const context: BuiltinInvocationContext = {
      lookupSpecial: () => mapping,
      call() {
        calls++;
        if (exhaust) meter.checkpoint(0, maxAllocatedBytes - meter.usage.allocatedBytes);
        return result;
      },
      typeName: () => "str"
    };
    const run = () => operation === "encode"
      ? codec.encode(input, mapping, "strict", context)
      : codec.decode(Uint8Array.of(65), mapping, "strict", context);
    let failure: unknown;
    try {run();} catch (error) {failure = error;}
    expect(calls).toBe(1);
    if (exhaust) {
      expect(failure).toBeInstanceOf(ExecutionLimitError);
      expect(failure).toMatchObject({reason: "allocation"});
      let retry: unknown;
      try {run();} catch (error) {retry = error;}
      expect(retry).toBe(failure);
      expect(calls).toBe(1);
    } else expect(failure).toMatchObject({name: "TypeError", message});
  }
);
