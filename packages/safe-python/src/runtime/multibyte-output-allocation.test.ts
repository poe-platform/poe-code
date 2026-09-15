import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {DoubleByteDecodeBuffer, DoubleByteEncodeBuffer} from "./double-byte-codec.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {gb18030Codec} from "./gb18030-codec.js";
import {hzCodec} from "./hz-codec.js";
import {iso2022JpCodec} from "./iso2022-jp-codec.js";

const cases = [gb18030Codec, hzCodec, iso2022JpCodec].flatMap(codec =>
  (["encode", "decode"] as const).map(operation => ({codec, name: codec.name, operation})));

it.each(cases)("bounds retained empty $name $operation output objects", ({codec, operation}) => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 100000});
  const buffer = operation === "encode"
    ? new DoubleByteEncodeBuffer(codec, CodePointString.fromString("", meter), meter)
    : new DoubleByteDecodeBuffer(codec, new Uint8Array(), meter);
  meter.checkpoint(0, 100000 - meter.usage.allocatedBytes - 1024);
  const outputs = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 100; index++) outputs.push(buffer.finish());
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(outputs.length).toBeGreaterThan(0);
  expect(outputs.length).toBeLessThan(100);
  expect(new Set(outputs).size).toBe(outputs.length);
  for (const output of outputs) expect([...output]).toEqual([]);
  expect(buffer.position).toBe(0);
  expect(() => buffer.finish()).toThrow(failure);
});

it.each(cases)("keeps $name $operation results independent and cancellation terminal", ({codec, operation}) => {
  const controller = new AbortController();
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 100000, signal: controller.signal});
  const buffer = operation === "encode"
    ? new DoubleByteEncodeBuffer(codec, CodePointString.fromString("A", meter), meter)
    : new DoubleByteDecodeBuffer(codec, Uint8Array.of(65), meter);
  if (buffer instanceof DoubleByteEncodeBuffer) buffer.feed("strict", true);
  else buffer.feed({errors: "strict"}, true);
  const first = buffer.finish(), second = buffer.finish();
  const expected = [...second];
  expect([...first]).toEqual([...second]);
  expect(first).not.toBe(second);
  if (first instanceof Uint8Array) first.fill(0);
  expect([...buffer.finish()]).toEqual([...second]);
  controller.abort();
  let failure: unknown;
  try {buffer.finish();} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "cancelled"});
  expect(() => buffer.finish()).toThrow(failure);
  expect([...second]).toEqual(expected);
});
