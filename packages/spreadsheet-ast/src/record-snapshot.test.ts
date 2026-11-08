import { expect, it } from "vitest";
import { createRecordSnapshot } from "./model.js";

const limits = { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 2, operations: 20 };

it.each(["workbookNodes", "workbookTextBytes", "workbookDepth"] as const)("forks preserve %s admission without sharing later charges", key => {
  const metadata = { name: "😀Data", rows: [{ index: 0, hidden: true }] };
  const cell = { row: 0, column: 0, value: { kind: "string", value: "é" } };
  for (let budget = 0; budget < 90; budget++) {
    const config = { ...limits, [key]: budget };
    const base = createRecordSnapshot(config);
    try { base(metadata); } catch { continue; }
    const first = base.fork(), second = base.fork();
    // A later charge in one fork (or its parent) must not change its siblings.
    try { base("extra".repeat(100)); } catch { /* deliberately exhausted */ }
    for (const copy of [first, second]) {
      const reference = createRecordSnapshot(config); reference(metadata);
      for (let index = 0; index < 3; index++) {
        let failure: string | undefined;
        try { reference(cell, 4); } catch (error) { failure = (error as Error).message; }
        if (failure) expect(() => copy(cell, 4)).toThrow(failure);
        else expect(copy(cell, 4)).toEqual(cell);
      }
    }
  }
});

it("forks retain ownership and reject accessors, cycles and nonfinite values", () => {
  const base = createRecordSnapshot(limits); base({ metadata: "owned" });
  const copy = base.fork(), supplied = { nested: { value: 1 } };
  const owned = copy(supplied); supplied.nested.value = 2;
  expect(owned.nested.value).toBe(1); expect(Object.isFrozen(owned.nested)).toBe(true);
  let reads = 0;
  expect(() => base.fork()({ get value() { reads++; return 1; } })).toThrow("accessor");
  expect(reads).toBe(0);
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
  expect(() => base.fork()(cyclic)).toThrow("Cyclic");
  expect(() => base.fork()(Infinity)).toThrow("Nonfinite");
});
