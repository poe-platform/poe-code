import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {encodeUtf8} from "./utf8-encode.js";
import {encodeUtf8Signature, Utf8SignatureEncoder} from "./utf8-signature.js";

it.each(["utf8", "signature", "incremental"] as const)("bounds retained empty %s encoder outputs", kind => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 100000});
  const input = CodePointString.fromString("", meter);
  const encoder = new Utf8SignatureEncoder();
  encoder.encode(input, false, meter);
  const encode = () => kind === "utf8" ? encodeUtf8(input, "strict", meter)
    : kind === "signature" ? encodeUtf8Signature(input, "strict", meter)
      : encoder.encode(input, false, meter);
  meter.checkpoint(0, 100000 - meter.usage.allocatedBytes - 1024);
  const outputs: Uint8Array[] = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 100; index++) outputs.push(encode());
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(outputs.length).toBeGreaterThan(0);
  expect(outputs.length).toBeLessThan(100);
  expect(new Set(outputs).size).toBe(outputs.length);
  for (const output of outputs) expect([...output]).toEqual(kind === "signature" ? [239, 187, 191] : []);
  expect(() => encode()).toThrow(failure);
});

it("keeps UTF-8 output independent across buffer growth and terminal cancellation", () => {
  const controller = new AbortController();
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 100000, signal: controller.signal});
  const input = CodePointString.fromString("\ud800", meter);
  const replacement = new Uint8Array(100).fill(65);
  let calls = 0;
  const recover = () => {calls++; return {replacement, position: 1};};
  const first = encodeUtf8(input, recover, meter);
  const second = encodeUtf8Signature(input, recover, meter);
  first.fill(0);
  replacement.fill(0);
  expect([...second]).toEqual([239, 187, 191, ...new Array<number>(100).fill(65)]);
  expect(calls).toBe(2);
  controller.abort();
  expect(() => encodeUtf8(input, recover, meter)).toThrow(ExecutionLimitError);
  expect(() => encodeUtf8Signature(input, recover, meter)).toThrow(ExecutionLimitError);
  expect(calls).toBe(2);
});
