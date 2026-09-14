import {expect, it} from "vitest";
import {decodeBase64, encodeBase64} from "./base64.js";
import {ExecutionBudget, ExecutionLimitError, type ExecutionMeter} from "./execution-budget.js";

it.each([
  {name: "empty encoder", run: (meter: ExecutionMeter) => encodeBase64(new Uint8Array(), false, meter)},
  {name: "empty decoder", run: (meter: ExecutionMeter) => decodeBase64(new Uint8Array(), false, meter)},
  {name: "encoder payload", run: (meter: ExecutionMeter) => encodeBase64(Uint8Array.of(65), false, meter)},
  {name: "decoder payload", run: (meter: ExecutionMeter) => decodeBase64(Uint8Array.of(81, 81, 61, 61), false, meter)}
])("admits $name array storage before allocating", ({run}) => {
  // The largest payload is four bytes. A payload-only budget cannot admit
  // even the first independently owned typed-array object.
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 4});
  expect(() => run(meter)).toThrow(ExecutionLimitError);
  expect(meter.usage.allocatedBytes).toBe(0);
  expect(() => meter.checkpoint()).toThrow(ExecutionLimitError);
});

it("admits the decoder's independently owned result after its scratch buffer", () => {
  // One array header fits, but the empty result still needs a second owner.
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 64});
  expect(() => decodeBase64(new Uint8Array(), false, meter)).toThrow(ExecutionLimitError);
  expect(meter.usage.allocatedBytes).toBe(64);
});

it.each([false, true])("retains cancellation identity at result admission, strict=%s", strict => {
  const failure = new ExecutionLimitError("cancelled");
  let allocations = 0;
  const meter: ExecutionMeter = {checkpoint(_steps, bytes = 0) {
    if (bytes > 0 && ++allocations === 2) throw failure;
  }};
  let actual: unknown;
  try {decodeBase64(new Uint8Array(), strict, meter);} catch (error) {actual = error;}
  expect(actual).toBe(failure);
});
