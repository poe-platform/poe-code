import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {Utf7Decoder} from "./utf7.js";
import {Utf8IncrementalDecoder} from "./utf8-incremental.js";
import {Utf8SignatureDecoder} from "./utf8-signature.js";
import {WideUnicodeDecoder} from "./utf-wide-incremental.js";

const decoders = [
  {name: "UTF-7", create: () => new Utf7Decoder()},
  {name: "UTF-8", create: () => new Utf8IncrementalDecoder()},
  {name: "UTF-8-SIG", create: () => new Utf8SignatureDecoder()},
  {name: "UTF-16", create: () => new WideUnicodeDecoder(16)},
  {name: "UTF-32", create: () => new WideUnicodeDecoder(32)}
];

it.each(decoders)("bounds cumulative $name empty decode state allocation", ({create}) => {
  const decoder = create();
  const input = new Uint8Array();
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 1024});
  const output = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 100; index++) output.push(decoder.decode(input, false, meter));
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(output.length).toBeGreaterThan(0);
  expect(output.length).toBeLessThan(100);
  for (const text of output) expect(text.length).toBe(0);
  let retry: unknown;
  try {decoder.decode(input, false, meter);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
});

it.each(decoders)("denies $name empty decode state allocation before publication", ({create}) => {
  const decoder = create();
  const before = decoder.getstate();
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 0});
  let failure: unknown;
  try {decoder.decode(new Uint8Array(), false, meter);} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(decoder.getstate()).toEqual(before);
  let retry: unknown;
  try {decoder.decode(new Uint8Array(), true, meter);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect(decoder.getstate()).toEqual(before);
});
