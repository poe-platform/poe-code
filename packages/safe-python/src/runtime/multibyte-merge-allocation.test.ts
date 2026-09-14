import {expect, it} from "vitest";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {gb2312Codec} from "./gb2312-codec.js";
import {hzCodec} from "./hz-codec.js";
import {iso2022JpCodec} from "./iso2022-jp-codec.js";
import {iso2022KrCodec} from "./iso2022-kr-codec.js";

it("denies unpaid pending buffer metadata before retaining an incomplete sequence", () => {
  const setup = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 100000});
  const decoder = new DoubleByteIncrementalDecoder(gb2312Codec);
  const before = decoder.getstate(setup);
  // The decode work buffer and pending byte fit; the pending buffer header does not.
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 65});
  let failure: unknown;
  try {decoder.decode(Uint8Array.of(0xd6), false, meter);} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(decoder.getstate(setup)).toEqual(before);
  expect(meter.usage.allocatedBytes).toBe(64);
  let retry: unknown;
  try {decoder.decode(Uint8Array.of(0xd0), true, meter);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
});

it.each([
  {codec: gb2312Codec, prefix: [0xd6], suffix: [0xd0]},
  {codec: hzCodec, prefix: [126], suffix: [123, 86, 80, 126, 125]},
  {codec: iso2022JpCodec, prefix: [27], suffix: [36, 66, 36, 34]},
  {codec: iso2022KrCodec, prefix: [27], suffix: [36, 41, 67]}
])("admits all $codec.name merge storage before clearing pending input", ({codec, prefix, suffix}) => {
  const setup = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 100000});
  const decoder = new DoubleByteIncrementalDecoder(codec);
  decoder.decode(Uint8Array.from(prefix), false, setup);
  const before = decoder.getstate(setup);
  expect([...before[0]]).toEqual(prefix);
  // Neither payload alone nor payload plus the merged buffer's metadata pays
  // for the empty pending buffer that is published alongside the merge.
  for (const overhead of [0, 64]) {
    const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: prefix.length + suffix.length + overhead});
    let failure: unknown;
    try {decoder.decode(Uint8Array.from(suffix), false, meter);} catch (error) {failure = error;}
    expect(failure).toBeInstanceOf(ExecutionLimitError);
    expect(failure).toMatchObject({reason: "allocation"});
    expect(meter.usage.allocatedBytes).toBe(0);
    expect(decoder.getstate(setup)).toEqual(before);
    let retry: unknown;
    try {decoder.decode(Uint8Array.from(suffix), true, meter);} catch (error) {retry = error;}
    expect(retry).toBe(failure);
    expect(decoder.getstate(setup)).toEqual(before);
  }
});
