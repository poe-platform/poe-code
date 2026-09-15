import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {Gb2312IncrementalEncoder} from "./gb2312-incremental-encoder.js";
import {gbkCodec} from "./gbk-codec.js";

const encoders = [
  {name: "GB2312", create: () => new Gb2312IncrementalEncoder()},
  {name: "shared multibyte", create: () => new DoubleByteIncrementalEncoder(gbkCodec)}
];

it.each(encoders)("$name admits temporary storage before returning an empty state", ({create}) => {
  const encoder = create();
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 64});
  expect(() => encoder.getstate(meter)).toThrow(ExecutionLimitError);
  expect(() => encoder.reset(meter)).toThrow(ExecutionLimitError);
});

it.each(encoders)("$name admits the pending byte buffer before UTF-8 decoding", ({create}) => {
  const encoder = create();
  const setup = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 10000});
  const state = 1n | (65n << 8n) | (42n << 16n);
  encoder.setstate(state, setup);
  // A 64-byte UTF-8 scratch buffer cannot be admitted when the state
  // conversion already owns a distinct 64-byte pending input buffer.
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 100});
  expect(() => encoder.setstate(0n, meter)).toThrow(ExecutionLimitError);
  expect(meter.usage.allocatedBytes).toBeGreaterThanOrEqual(64);
  expect(encoder.getstate(setup)).toBe(state);
});
