import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {SeededPayloadHash} from "./seeded-payload-hash.js";

it.each(["copy", "host"] as const)("retains compact width during %s construction for the first hash", mode => {
  const construction = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000});
  const value = mode === "copy" ? new CodePointString(new Uint32Array(1000).fill(97), construction) : CodePointString.fromString("a".repeat(1000), construction);
  const meter = new ExecutionBudget({maxSteps: 1140, maxAllocatedBytes: 128});
  const hash = new SeededPayloadHash(0n, 0n);
  expect(hash.string(value, meter)).toBe(7495583249934883926n);
});

it("compares identical immutable payloads without scanning and still checks cancellation", () => {
  const value = new CodePointString(new Uint32Array(1000).fill(97));
  expect(value.compare(value, new ExecutionBudget({maxSteps: 1, maxAllocatedBytes: 0}))).toBe(0);
  const controller = new AbortController();
  controller.abort();
  expect(() => value.compare(value, new ExecutionBudget({maxSteps: 1, maxAllocatedBytes: 0, signal: controller.signal}))).toThrow(ExecutionLimitError);
});

it.each([
  [[], 1], [[255], 1], [[256, 65], 2], [[0xd800, 0xdc00], 2], [[0x10000, 65], 4], [[0x10ffff], 4],
] as const)("retains width for code points %j", (points, width) => {
  const input = Uint32Array.from(points);
  const value = new CodePointString(input);
  input.fill(0);
  expect(value.compactWidth(new ExecutionBudget({maxSteps: 1, maxAllocatedBytes: 0}))).toBe(width);
});

it("scans generated storage once and never caches an interrupted width scan", () => {
  const value = new CodePointString(Uint32Array.of(0x10000, 65));
  const construction = new ExecutionBudget({maxSteps: 100, maxAllocatedBytes: 100});
  const generated = value.repeat(3, construction);
  expect(() => generated.compactWidth(new ExecutionBudget({maxSteps: 3, maxAllocatedBytes: 0}))).toThrow(ExecutionLimitError);
  expect(() => generated.compactWidth(new ExecutionBudget({maxSteps: 1, maxAllocatedBytes: 0}))).toThrow(ExecutionLimitError);
  expect(generated.compactWidth(construction)).toBe(4);
  expect(generated.compactWidth(new ExecutionBudget({maxSteps: 1, maxAllocatedBytes: 0}))).toBe(4);
  expect(value.slice(1n, null, null, construction).compactWidth(construction)).toBe(1);
});
