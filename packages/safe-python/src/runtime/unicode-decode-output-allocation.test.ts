import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {decodeUtf8, type Utf8DecodeRecovery} from "./utf8-decode.js";
import {decodeWideUnicode} from "./utf-wide.js";

const decoders = [
  {name: "UTF-8", decode: (input: Uint8Array, meter: ExecutionBudget, recovery?: Utf8DecodeRecovery) => decodeUtf8(input, recovery ?? "strict", meter)},
  ...([16, 32] as const).flatMap(width => ([-1, 0, 1] as const).map(order => ({
    name: `UTF-${width} order ${order}`,
    decode: (input: Uint8Array, meter: ExecutionBudget, recovery?: Utf8DecodeRecovery) => decodeWideUnicode(input, width, order, recovery ?? "strict", meter)
  })))
];

it.each(decoders)("bounds retained empty $name decode results", ({decode}) => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1024});
  const input = new Uint8Array();
  const results = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 100; index++) results.push(decode(input, meter));
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(results.length).toBeGreaterThan(0);
  expect(results.length).toBeLessThan(100);
  expect(new Set(results).size).toBe(results.length);
  expect(new Set(results.map(result => result.text)).size).toBe(results.length);
  for (const result of results) expect({points: [...result.text], consumed: result.consumed}).toEqual({points: [], consumed: 0});
  expect(() => decode(input, meter)).toThrow(failure);
});

it.each(decoders)("denies $name empty output when allocation is exhausted", ({decode}) => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 0});
  expect(() => decode(new Uint8Array(), meter)).toThrow(ExecutionLimitError);
});

it.each(decoders)("owns $name grown recovery output and stops before a cancelled callback", ({decode}) => {
  const controller = new AbortController();
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 100000, signal: controller.signal});
  const replacement = new CodePointString(new Uint32Array(128).fill(65));
  const input = Uint8Array.of(255);
  let calls = 0;
  const recovery: Utf8DecodeRecovery = error => {
    calls++;
    return {replacement, position: error.end, input: error.object};
  };
  const first = decode(input, meter, recovery), second = decode(input, meter, recovery);
  input.fill(0);
  expect([...first.text]).toEqual(new Array<number>(128).fill(65));
  expect([...second.text]).toEqual([...first.text]);
  expect(second.text).not.toBe(first.text);
  expect(first.consumed).toBe(1);
  controller.abort();
  expect(() => decode(Uint8Array.of(255), meter, recovery)).toThrow(ExecutionLimitError);
  expect(calls).toBe(2);
});
