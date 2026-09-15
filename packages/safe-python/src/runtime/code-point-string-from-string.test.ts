import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";

it.each([
  ["", []], ["a\0é", [97, 0, 233]], ["A🐍", [65, 0x1f40d]],
  ["\ud800X\udc00", [0xd800, 88, 0xdc00]], ["\ud800\udc00", [0x10000]],
] as const)("copies host text %j once into owned code-point storage", (text, points) => {
  const meter = new ExecutionBudget({maxSteps: 100, maxAllocatedBytes: text.length * 4});
  expect([...CodePointString.fromString(text, meter)]).toEqual(points);
  expect(meter.usage.allocatedBytes).toBe(text.length * 4);
});

it("reserves its buffer and observes cancellation before publishing text", () => {
  const meter = new ExecutionBudget({maxSteps: 100, maxAllocatedBytes: 3});
  expect(() => CodePointString.fromString("x", meter)).toThrow(ExecutionLimitError);
  expect(meter.usage.allocatedBytes).toBe(0);
  const controller = new AbortController();
  controller.abort();
  expect(() => CodePointString.fromString("", new ExecutionBudget({maxSteps: 100, maxAllocatedBytes: 100, signal: controller.signal}))).toThrow(ExecutionLimitError);
});
