import {expect, it} from "vitest";
import {parseExpression} from "../expression.js";
import {ConstantValues} from "./constant-values.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";

function fixture(signal?: AbortSignal) {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000, signal});
  return {meter, values: new ConstantValues(meter)};
}

it.each(["codec_name", "123", "_", "ASCII_0123456789", ""])("shares interned literal identity for %j", text => {
  const {values} = fixture();
  const literal = parseExpression(JSON.stringify(text));
  if (literal.kind !== "literal") throw Error("expected a literal");
  const first = values.literal(literal);
  expect(values.internString(text)).toBe(first);
  expect(values.literal(literal)).toBe(first);
  expect(fixture().values.internString(text)).not.toBe(first);
});

it.each(["codec.name", "codec-name", "café", "变量", "\ud800", "😀"])("preserves non-interned literals for %j", text => {
  const {values} = fixture();
  const literal = parseExpression(JSON.stringify(text));
  if (literal.kind !== "literal") throw Error("expected a literal");
  expect(values.literal(literal)).not.toBe(values.internString(text));
  expect(values.literal(literal)).not.toBe(values.literal(literal));
});

it("charges a cache miss, reuses hits without allocation, and leaves ordinary strings distinct", () => {
  const {values, meter} = fixture(), ordinary = values.string("codec_name"), before = meter.usage.allocatedBytes;
  const interned = values.internString("codec_name");
  expect(interned).not.toBe(ordinary);
  expect(meter.usage.allocatedBytes).toBeGreaterThan(before);
  const allocated = meter.usage.allocatedBytes;
  expect(values.internString("codec_name")).toBe(interned);
  expect(meter.usage.allocatedBytes).toBe(allocated);
  expect(values.string("codec_name")).not.toBe(interned);
});

it.each(["cached_name", "missing_name"])("keeps cancellation fatal for %s", name => {
  const controller = new AbortController(), {values} = fixture(controller.signal);
  values.internString("cached_name");
  controller.abort();
  expect(() => values.internString(name)).toThrow(ExecutionLimitError);
});

it("rejects intern allocation at the execution budget boundary", () => {
  const values = new ConstantValues(new ExecutionBudget({maxSteps: 100, maxAllocatedBytes: 160}));
  expect(() => values.internString("codec_name")).toThrow(ExecutionLimitError);
});
