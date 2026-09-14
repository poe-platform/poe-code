import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {Utf8IncrementalDecoder} from "./utf8-incremental.js";
import {Utf8SignatureDecoder} from "./utf8-signature.js";
import {WideUnicodeDecoder} from "./utf-wide-incremental.js";
import {Utf7Decoder} from "./utf7.js";

const cases = [
  {name: "UTF-7", create: () => new Utf7Decoder(), prefix: [43, 73], suffix: [75, 119, 45]},
  {name: "UTF-8", create: () => new Utf8IncrementalDecoder(), prefix: [0xe2], suffix: [0x82, 0xac]},
  {name: "UTF-8-SIG", create: () => new Utf8SignatureDecoder(), prefix: [0xef], suffix: [0xbb, 0xbf]},
  ...([16, 32] as const).flatMap(width => ([-1, 0, 1] as const).map(order => ({
    name: `UTF-${width}, order=${order}`, create: () => new WideUnicodeDecoder(width, order),
    prefix: [order === 1 ? 0 : 0xff],
    suffix: width === 16 ? [order === 1 ? 65 : 0xfe] : [order === 1 ? 0 : 0xfe, 0, order === 1 ? 65 : 0]
  })))
];

it.each(cases)("denies an unaffordable $name merge before changing state", ({create, prefix, suffix}) => {
  const decoder = create();
  decoder.decode(Uint8Array.from(prefix));
  const before = decoder.getstate();
  // The payload fits, but its separately owned typed-array storage does not.
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: prefix.length + suffix.length});
  let failure: unknown;
  try {decoder.decode(Uint8Array.from(suffix), false, meter);} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(meter.usage.allocatedBytes).toBe(0);
  expect(decoder.getstate()).toEqual(before);
  let retry: unknown;
  try {decoder.decode(Uint8Array.from(suffix), true, meter);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect(decoder.getstate()).toEqual(before);
});
