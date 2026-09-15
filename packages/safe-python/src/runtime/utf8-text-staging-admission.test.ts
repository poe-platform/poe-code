import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {Utf8TextDecoder} from "./utf8-text-decoder.js";

it.each([null, "", "\n", "\r", "\r\n"])("admits temporary decoder ownership before UTF-8 text state copying (%j)", newline => {
  const decoder = new Utf8TextDecoder(newline);
  decoder.decode(Uint8Array.of(10, 13, 0xe2));
  const observed = decoder.newlines;
  // A decoder record plus its initially empty owned byte buffer needs 128
  // bytes, independently of the subsequent state snapshot and copied payload.
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 127});
  const suffix = Uint8Array.of(0x82, 0xac);
  let failure: unknown;
  try {decoder.decode(suffix, true, meter);} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(meter.usage.allocatedBytes).toBe(0);
  expect(decoder.newlines).toEqual(observed);
  let retry: unknown;
  try {decoder.decode(suffix, true, meter);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect(decoder.newlines).toEqual(observed);
  expect([...decoder.decode(suffix, true)])
    .toEqual(newline === null ? [10, 0x20ac] : newline === "" ? [13, 0x20ac] : [0x20ac]);
});

it.each([null, "", "\n", "\r", "\r\n"])("includes staged decoder storage in repeated empty text reads (%j)", newline => {
  const decoder = new Utf8TextDecoder(newline);
  // Existing state/result/buffer ownership alone costs 480 bytes per empty
  // call. Two calls must not fit once both temporary decoder owners count.
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 1024});
  expect([...decoder.decode(new Uint8Array(), false, meter)]).toEqual([]);
  expect(() => decoder.decode(new Uint8Array(), false, meter))
    .toThrow(expect.objectContaining({reason: "allocation"}));
  expect(decoder.newlines).toBeNull();
  expect([...decoder.decode(Uint8Array.of(65), true)]).toEqual([65]);
});
