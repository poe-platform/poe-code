import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {gb2312Codec} from "./gb2312-codec.js";
import {gbkCodec} from "./gbk-codec.js";
import {hzCodec} from "./hz-codec.js";
import {iso2022JpCodec} from "./iso2022-jp-codec.js";
import {iso2022KrCodec} from "./iso2022-kr-codec.js";

const codecs = [gb2312Codec, gbkCodec, hzCodec, iso2022JpCodec, iso2022KrCodec];

it.each(codecs.flatMap(codec => [false, true].map(recovery => ({codec, recovery}))))(
  "$codec.name admits an encoder fault before throwing or recovering (recovery=$recovery)",
  ({codec, recovery}) => {
    const setup = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000});
    const input = CodePointString.fromString("\ud800", setup);
    const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 300});
    let calls = 0;
    const encoder = new DoubleByteIncrementalEncoder(codec, recovery ? () => {
      calls++;
      throw new Error("recovery entered before fault storage was admitted");
    } : "strict");
    expect(() => encoder.encode(input, true, meter)).toThrow(ExecutionLimitError);
    expect(calls).toBe(0);
    for (const operation of [
      () => encoder.getstate(meter),
      () => encoder.reset(meter),
      () => encoder.encode(input, true, meter)
    ]) expect(operation).toThrow(ExecutionLimitError);
  }
);

it.each(codecs)("$name admits a separate fault for an unencodable replacement", codec => {
  const setup = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000});
  const input = CodePointString.fromString("\ud800", setup);
  const replacement = CodePointString.fromString("\udfff", setup);
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000});
  let calls = 0;
  const encoder = new DoubleByteIncrementalEncoder(codec, () => {
    calls++;
    // Leave space for the nested encoder's scratch structures, but not its
    // independently retained fault. The original fault cannot pay for both.
    meter.checkpoint(0, 10000 - meter.usage.allocatedBytes - 256);
    return {replacement, position: -1n};
  });
  expect(() => encoder.encode(input, true, meter)).toThrow(ExecutionLimitError);
  expect(calls).toBe(1);
  expect(() => encoder.getstate(meter)).toThrow(ExecutionLimitError);
});

it.each([-2n, 2n, 1n << 63n].flatMap(position => ["encode", "decode"].map(operation => ({position, operation}))))("admits the $operation recovery position diagnostic after callback allocation: $position", ({position, operation}) => {
  const setup = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000});
  const input = CodePointString.fromString("\ud800", setup);
  const replacement = new Uint8Array();
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000});
  let calls = 0;
  const recover = () => {
    calls++;
    meter.checkpoint(0, 10000 - meter.usage.allocatedBytes);
  };
  const encoder = new DoubleByteIncrementalEncoder(hzCodec, () => {
    recover();
    return {replacement, position};
  });
  const empty = CodePointString.fromString("", setup);
  const bytes = Uint8Array.of(255);
  expect(() => operation === "encode" ? encoder.encode(input, true, meter) : hzCodec.decode(bytes, () => {
    recover();
    return {replacement: empty, position};
  }, meter)).toThrow(ExecutionLimitError);
  expect(calls).toBe(1);
  expect(() => encoder.reset(meter)).toThrow(ExecutionLimitError);
});
