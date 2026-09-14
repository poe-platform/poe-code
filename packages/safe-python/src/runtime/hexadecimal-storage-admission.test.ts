import {expect, it} from "vitest";
import {BinasciiError} from "./binascii-error.js";
import {ExecutionBudget, ExecutionLimitError, type ExecutionMeter} from "./execution-budget.js";
import {decodeHexadecimal, encodeHexadecimal} from "./hexadecimal.js";

it.each([
  {name: "empty encoder", run: (meter: ExecutionMeter) => encodeHexadecimal(new Uint8Array(), undefined, 1, meter)},
  {name: "empty decoder", run: (meter: ExecutionMeter) => decodeHexadecimal(new Uint8Array(), meter)},
  {name: "grouped encoder", run: (meter: ExecutionMeter) => encodeHexadecimal(Uint8Array.of(65, 66), 58, -1, meter)},
  {name: "decoder", run: (meter: ExecutionMeter) => decodeHexadecimal(Uint8Array.of(52, 49), meter)}
])("admits $name storage before allocating", ({run}) => {
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 5});
  expect(() => run(meter)).toThrow(ExecutionLimitError);
  expect(meter.usage.allocatedBytes).toBe(0);
  expect(() => meter.checkpoint()).toThrow(ExecutionLimitError);
});

it.each(["encode", "decode"] as const)("preserves cancellation identity at empty %s storage admission", operation => {
  const failure = new ExecutionLimitError("cancelled");
  const meter: ExecutionMeter = {checkpoint(_steps, bytes = 0) {
    if (bytes > 0) throw failure;
  }};
  let actual: unknown;
  try {
    if (operation === "encode") encodeHexadecimal(new Uint8Array(), undefined, 1, meter);
    else decodeHexadecimal(new Uint8Array(), meter);
  } catch (error) {actual = error;}
  expect(actual).toBe(failure);
});

it("rejects odd input before admitting result storage", () => {
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 256});
  expect(() => decodeHexadecimal(Uint8Array.of(120), meter)).toThrow(new BinasciiError("Odd-length string"));
  expect(meter.usage.allocatedBytes).toBe(256);
  expect(() => meter.checkpoint()).not.toThrow();
});

it.each([
  {input: [120], message: "Odd-length string", scratch: 0},
  {input: [120, 48], message: "Non-hexadecimal digit found", scratch: 65},
  {input: [48, 120], message: "Non-hexadecimal digit found", scratch: 65},
  {input: [52, 49, 48, 120], message: "Non-hexadecimal digit found", scratch: 66}
])("admits malformed hexadecimal fault storage: $input", ({input, message, scratch}) => {
  const source = Uint8Array.from(input);
  const exhausted = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: scratch + 255});
  expect(() => decodeHexadecimal(source, exhausted)).toThrow(ExecutionLimitError);
  expect(exhausted.usage.allocatedBytes).toBe(scratch);
  expect(() => exhausted.checkpoint()).toThrow(ExecutionLimitError);
  expect([...source]).toEqual(input);
  const sufficient = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: scratch + 256});
  expect(() => decodeHexadecimal(source, sufficient)).toThrow(new BinasciiError(message));
  expect(sufficient.usage.allocatedBytes).toBe(scratch + 256);
});

it.each([{input: [120]}, {input: [48, 120]}])("preserves cancellation identity at hexadecimal fault admission: $input", ({input}) => {
  const failure = new ExecutionLimitError("cancelled");
  const meter: ExecutionMeter = {checkpoint(_steps, bytes = 0) {
    if (bytes === 256) throw failure;
  }};
  let actual: unknown;
  try { decodeHexadecimal(Uint8Array.from(input), meter); }
  catch (error) { actual = error; }
  expect(actual).toBe(failure);
});
