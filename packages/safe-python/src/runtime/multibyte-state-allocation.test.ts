import {expect, it} from "vitest";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {gbkCodec} from "./gbk-codec.js";
import {gb18030Codec} from "./gb18030-codec.js";
import {hzCodec} from "./hz-codec.js";
import {iso2022JpCodec} from "./iso2022-jp-codec.js";
import {iso2022KrCodec} from "./iso2022-kr-codec.js";

const codecs = [gbkCodec, gb18030Codec, hzCodec, iso2022JpCodec, iso2022KrCodec];
const budget = () => new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000});

it.each(codecs)("bounds retained empty $name decoder snapshots", codec => {
  const decoder = new DoubleByteIncrementalDecoder(codec);
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
  let retry: unknown;
  try {decoder.getstate(meter);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
});

it.each(codecs.flatMap(codec => (["setstate", "reset"] as const).map(operation => ({codec, name: codec.name, operation}))))(
  "denies $name $operation storage before mutating pending bytes or shift flags", ({codec, operation}) => {
    const decoder = new DoubleByteIncrementalDecoder(codec);
    decoder.setstate([Uint8Array.of(65), 42n], budget());
    const before = decoder.getstate(budget());
    const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 0});
    const mutate = () => operation === "reset" ? decoder.reset(meter)
      : decoder.setstate([new Uint8Array(), 0n], meter);
    let failure: unknown;
    try {mutate();} catch (error) {failure = error;}
    expect(failure).toBeInstanceOf(ExecutionLimitError);
    expect(failure).toMatchObject({reason: "allocation"});
    expect(decoder.getstate(budget())).toEqual(before);
    let retry: unknown;
    try {mutate();} catch (error) {retry = error;}
    expect(retry).toBe(failure);
    expect(decoder.getstate(budget())).toEqual(before);
});

it.each(codecs)("keeps $name state buffers independent and observes cancellation", codec => {
  const decoder = new DoubleByteIncrementalDecoder(codec);
  const pending = Uint8Array.of(65);
  decoder.setstate([pending, 42n], budget());
  pending[0] = 66;
  const snapshot = decoder.getstate(budget());
  expect(snapshot).toEqual([Uint8Array.of(65), 42n]);
  snapshot[0][0] = 67;
  const controller = new AbortController();
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000, signal: controller.signal});
  controller.abort();
  let failure: unknown;
  for (const invoke of [() => decoder.getstate(meter), () => decoder.reset(meter),
    () => decoder.setstate([new Uint8Array(), 0n], meter)]) {
    let error: unknown;
    try {invoke();} catch (caught) {error = caught;}
    expect(error).toBeInstanceOf(ExecutionLimitError);
    expect(error).toMatchObject({reason: "cancelled"});
    if (failure === undefined) failure = error;
    else expect(error).toBe(failure);
    expect(decoder.getstate(budget())).toEqual([Uint8Array.of(65), 42n]);
  }
});
