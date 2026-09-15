import {expect, it} from "vitest";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {iso2022Jp2Codec} from "./iso2022-jp-2-codec.js";

it.each([0, 74, 194])("admits the ISO-2022-JP-2 G2 fault before exposing it (charset %i)", charset => {
  const setup = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 100000});
  const decoder = new DoubleByteIncrementalDecoder(iso2022Jp2Codec);
  const state = 0x4242n | BigInt(charset) << 16n;
  decoder.setstate([new Uint8Array(), state], setup);
  const input = Uint8Array.of(27, 78, 65);
  expect(() => decoder.decode(input, true, setup)).toThrow(expect.objectContaining({
    name: "RuntimeError", message: "internal codec error"
  }));
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 128});
  let failure: unknown;
  try {decoder.decode(input, true, meter);} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(() => decoder.decode(new Uint8Array(), true, meter)).toThrow(failure as Error);
  expect(decoder.getstate(setup)).toEqual([new Uint8Array(), state]);
});
