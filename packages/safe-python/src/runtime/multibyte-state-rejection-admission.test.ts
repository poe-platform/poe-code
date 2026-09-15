import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {Gb2312IncrementalEncoder} from "./gb2312-incremental-encoder.js";
import {hzCodec} from "./hz-codec.js";

const encoders = [
  {name: "GB2312", create: () => new Gb2312IncrementalEncoder()},
  {name: "shared multibyte", create: () => new DoubleByteIncrementalEncoder(hzCodec)}
];
const budget = () => new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 100000});

it.each(encoders.flatMap(encoder => [-1n, 1n << 136n, 9n].map(state => ({...encoder, state}))))(
  "$name admits a state rejection before exposing a catchable error: $state", ({create, state}) => {
    const encoder = create(), setup = budget();
    const saved = 1n | (65n << 8n) | (1n << 16n);
    encoder.setstate(saved, setup);
    const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 64});
    let failure: unknown;
    try {encoder.setstate(state, meter);} catch (error) {failure = error;}
    expect(failure).toBeInstanceOf(ExecutionLimitError);
    expect(failure).toMatchObject({reason: "allocation"});
    for (const retry of [() => encoder.setstate(0n, meter), () => encoder.getstate(meter), () => encoder.reset(meter)]) {
      expect(retry).toThrow(failure as Error);
    }
    expect(encoder.getstate(setup)).toBe(saved);
  }
);

it.each([-1n, 1n << 64n])("admits decoder state overflow before exposing it: %s", state => {
  const decoder = new DoubleByteIncrementalDecoder(hzCodec), setup = budget();
  const saved = [Uint8Array.of(33), 1n] as const;
  decoder.setstate(saved, setup);
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 64});
  let failure: unknown;
  try {decoder.setstate([new Uint8Array(), state], meter);} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  for (const retry of [() => decoder.decode(new Uint8Array(), true, meter), () => decoder.getstate(meter), () => decoder.reset(meter)]) {
    expect(retry).toThrow(failure as Error);
  }
  expect(decoder.getstate(setup)).toEqual(saved);
});
