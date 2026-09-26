import { expect, it, vi } from "vitest";
import { isJsonValue } from "./index.js";

it("allows callers to bound a large valid JSON tree without changing the default budget", () => {
  const value = Array.from({ length: 3_000 }, (_, index) => ({ name: `item_${index}`, values: [index, null] }));
  expect(isJsonValue(value)).toBe(false);
  expect(isJsonValue(value, { maxNodes: 20_000 })).toBe(true);
  expect(isJsonValue(value)).toBe(false);
});

it("counts array slots and every occurrence of shared JSON objects against the caller's budget", () => {
  const shared = { value: "text" };
  expect(isJsonValue([shared, shared], { maxNodes: 4 })).toBe(false);
  expect(isJsonValue([shared, shared], { maxNodes: 5 })).toBe(true);
  expect(isJsonValue([1], { maxNodes: 1 })).toBe(false);
});

it("keeps depth bounded independently of the node budget", () => {
  let value: unknown = 1;
  for (let index = 0; index < 80; index++) value = { nested: value };
  expect(isJsonValue(value, { maxNodes: 20_000 })).toBe(false);
  expect(isJsonValue(value, { maxNodes: 100, maxDepth: 80 })).toBe(true);
  expect(isJsonValue(value, { maxNodes: 100, maxDepth: 79 })).toBe(false);
});

it("supports primitive-only depth zero", () => {
  expect(isJsonValue("text", { maxDepth: 0 })).toBe(true);
  expect(isJsonValue({ value: "text" }, { maxDepth: 0 })).toBe(false);
});

it.each([0, -1, 1.5, NaN])("rejects invalid node budgets %s", maxNodes => {
  expect(() => isJsonValue(1, { maxNodes })).toThrow("maxNodes");
});

it.each([-1, 1.5, -Infinity, NaN])("rejects invalid depth budgets %s", maxDepth => {
  expect(() => isJsonValue(1, { maxDepth })).toThrow("maxDepth");
});

it("validates deep JSON iteratively with explicit unlimited budgets", () => {
  let value: unknown = null;
  for (let depth = 0; depth < 20_000; depth++) value = { nested: value };
  expect(isJsonValue(value, { maxNodes: Infinity, maxDepth: Infinity })).toBe(true);
  expect(isJsonValue(value, { maxNodes: Infinity, maxDepth: 20_000 })).toBe(true);
  expect(isJsonValue(value, { maxNodes: Infinity, maxDepth: 19_999 })).toBe(false);
  expect(isJsonValue(value, { maxNodes: 20_000, maxDepth: Infinity })).toBe(false);
  const cycle: Record<string, unknown> = { value }; cycle.self = cycle;
  expect(isJsonValue(cycle, { maxNodes: Infinity, maxDepth: Infinity })).toBe(false);
});

it("retains cycle, prototype, getter and serialization-hook guards under an expanded budget", () => {
  const getter = vi.fn(() => "secret");
  const accessor = Object.defineProperty({}, "value", { enumerable: true, get: getter });
  const hook = vi.fn(() => "secret");
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const value of [accessor, { toJSON: hook }, cycle, new Date(), [Infinity], new Array(1)])
    expect(isJsonValue(value, { maxNodes: 20_000 })).toBe(false);
  expect(getter).not.toHaveBeenCalled();
  expect(hook).not.toHaveBeenCalled();
});

it("accepts an unlimited node budget", () => { expect(isJsonValue([1, 2], { maxNodes: Infinity })).toBe(true); });

it("validates unlimited depth without exhausting the call stack and still rejects cycles", () => {
  const root: Record<string, unknown> = {};
  let leaf = root;
  for (let depth = 0; depth < 20_000; depth++) leaf = leaf.nested = {};
  expect(isJsonValue(root, { maxNodes: Infinity, maxDepth: Infinity })).toBe(true);
  expect(isJsonValue(root, { maxNodes: Infinity, maxDepth: 19_999 })).toBe(false);
  leaf.cycle = root;
  expect(isJsonValue(root, { maxNodes: Infinity, maxDepth: Infinity })).toBe(false);
});
