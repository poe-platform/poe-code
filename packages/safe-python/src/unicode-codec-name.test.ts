import {expect, it} from "vitest";
import {unicodeCanonicalName} from "./unicode-canonical-name.js";
import {unicodeCodecName} from "./unicode-codec-name.js";
import {ExecutionBudget, ExecutionLimitError} from "./runtime/execution-budget.js";
import reference from "./runtime/__snapshots__/codec-private-names-3.14.7.json";

it("keeps all pinned internal codec names distinct from public canonical names", () => {
  for (const row of reference.rows) {
    const expected = row.replacement.startsWith("\\N{") ? row.replacement.slice(3, -1) : undefined;
    expect(unicodeCodecName(row.point), String(row.point)).toBe(expected);
    expect(unicodeCanonicalName(row.point) ?? null, String(row.point)).toBe(row.canonical);
  }
});

it("meters internal-name results and keeps cancellation terminal", () => {
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 1000});
  expect(unicodeCodecName(0xf0000, meter)).toBe("NULL");
  expect(meter.usage.allocatedBytes).toBeGreaterThan(0);
  const controller = new AbortController();
  controller.abort();
  const cancelled = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 1000, signal: controller.signal});
  expect(() => unicodeCodecName(0xf0000, cancelled)).toThrow(ExecutionLimitError);
  expect(() => unicodeCodecName(65, cancelled)).toThrow(ExecutionLimitError);
});
