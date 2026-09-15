import {expect, it} from "vitest";
import reference from "./__snapshots__/stringprep-3.14.7.json" with {type: "json"};
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {stringprepMask, stringprepMapping, stringprepTableBits} from "./stringprep-tables.js";

it("matches every pinned property transition and its adjacent code points", () => {
  expect(Object.keys(stringprepTableBits)).toEqual(reference.tableNames);
  for (const [index, name] of reference.tableNames.entries()) {
    expect(stringprepTableBits[name as keyof typeof stringprepTableBits]).toBe(1 << index);
  }
  const actual = reference.boundaryCases.map(([point]) => [point, stringprepMask(point)]);
  expect(actual).toEqual(reference.boundaryCases);
});

it.each(["b2", "b3"] as const)("matches every nonidentity %s mapping and preserves unmapped neighbors", table => {
  const rows = reference.mappings[table] as [number, number[]][];
  const expected = new Map(rows);
  const points = new Set(rows.flatMap(([point]) => [point - 1, point, point + 1]));
  for (const point of [0, 0xd800, 0xdfff, 0x10ffff]) points.add(point);
  const actual = [...points].map(point => [point, [...stringprepMapping(table, point)]]);
  expect(actual).toEqual([...points].map(point => [point, expected.get(point) ?? [point]]));
});

it("keeps Unicode 3.2 properties distinct from CPython's Unicode 16 lowercase mappings", () => {
  // Capital sharp S was unassigned in 3.2, but modern str.lower maps it to ß.
  expect(stringprepMask(0x1e9e) & stringprepTableBits.a1).not.toBe(0);
  expect([...stringprepMapping("b3", 0x1e9e)]).toEqual([0xdf]);
  expect([...stringprepMapping("b2", 0x1e9e)]).toEqual([0x73, 0x73]);
  expect(stringprepMask(0x1f600) & stringprepTableBits.a1).not.toBe(0);
});

it("returns owned mapping storage and meters searches, allocation and cancellation", () => {
  const first = stringprepMapping("b2", 0xdf);
  first[0] = 0;
  expect([...stringprepMapping("b2", 0xdf)]).toEqual([115, 115]);
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 1000});
  stringprepMask(0x10ffff, meter);
  expect(meter.usage.steps).toBeGreaterThan(1);
  stringprepMapping("b2", 0xdf, meter);
  expect(meter.usage.allocatedBytes).toBe(8);
  const exhausted = new ExecutionBudget({maxSteps: 0, maxAllocatedBytes: 1000});
  expect(() => stringprepMask(65, exhausted)).toThrow(ExecutionLimitError);
  const noAllocation = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 0});
  expect(() => stringprepMapping("b2", 65, noAllocation)).toThrow(ExecutionLimitError);
  for (const at of [1, 3]) {
    let calls = 0;
    const cancelled = {checkpoint() {if (++calls === at) throw new ExecutionLimitError("cancelled");}};
    expect(() => stringprepMapping("b2", 0xdf, cancelled)).toThrow(ExecutionLimitError);
    calls = 0;
    expect(() => stringprepMask(65, cancelled)).toThrow(ExecutionLimitError);
  }
});
