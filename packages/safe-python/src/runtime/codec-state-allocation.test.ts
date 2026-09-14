import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {Utf8IncrementalDecoder} from "./utf8-incremental.js";
import {Utf7Decoder} from "./utf7.js";
import {Utf8SignatureDecoder} from "./utf8-signature.js";
import {WideUnicodeDecoder} from "./utf-wide-incremental.js";

const decoders = [
  {name: "UTF-7", create: () => new Utf7Decoder()},
  {name: "UTF-8", create: () => new Utf8IncrementalDecoder()},
  {name: "UTF-8-SIG", create: () => new Utf8SignatureDecoder()},
  {name: "UTF-16", create: () => new WideUnicodeDecoder(16)},
  {name: "UTF-32", create: () => new WideUnicodeDecoder(32)}
];

it.each(decoders)("bounds retained empty $name state snapshots", ({create}) => {
  const decoder = create();
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 1024});
  const snapshots = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 100; index++) snapshots.push(decoder.getstate(meter));
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(snapshots.length).toBeGreaterThan(0);
  expect(snapshots.length).toBeLessThan(100);
  expect(() => decoder.getstate(meter)).toThrow(failure);
});

it.each(decoders)("preserves $name pending bytes and byte order when empty state allocation is denied", ({create}) => {
  for (const operation of ["setstate", "reset"] as const) {
    const decoder = create();
    decoder.setstate([new Uint8Array([65]), 1n]);
    const before = decoder.getstate();
    const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 0});
    const mutate = () => operation === "reset" ? decoder.reset(meter)
      : decoder.setstate([new Uint8Array(), 0n], meter);
    let failure: unknown;
    try {mutate();} catch (error) {failure = error;}
    expect(failure).toBeInstanceOf(ExecutionLimitError);
    expect(failure).toMatchObject({reason: "allocation"});
    expect(decoder.getstate()).toEqual(before);
    let retry: unknown;
    try {mutate();} catch (error) {retry = error;}
    expect(retry).toBe(failure);
    expect(decoder.getstate()).toEqual(before);
  }
});
