import { afterEach, expect, it, vi } from "vitest";
import { run } from "../core.js";
import { Budget } from "./budget.js";

afterEach(() => vi.restoreAllMocks());

it.each([undefined, Infinity])("does not scan each node of unlimited straight-line code (%s)", async dataSize => {
  const budget = new Budget({ dataSize });
  const scans = vi.spyOn(budget, "reconcileCompileData");
  const result = await run(`const unused = new Array(1000).fill(0); let sum = 0; ${"sum += 1;".repeat(100)} return sum;`, { budget });
  expect(result).toMatchObject({ ok: true, returnValue: 100 });
  expect(scans.mock.calls.length).toBeLessThan(30);
});

it("does not rescan the retained heap for finite-budget primitive literals", async () => {
  const budget = new Budget({ dataSize: 1000000 });
  const scans = vi.spyOn(budget, "reconcileCompileData");
  const result = await run(`const unused = new Array(1000).fill(0); return [${Array(100).fill("1").join(",")}].length;`, { budget });
  expect(result).toMatchObject({ ok: true, returnValue: 100 });
  expect(scans.mock.calls.length).toBeLessThan(50);
});

it("still checks a primitive transient against an explicit data limit", async () => {
  await expect(run(`return "${"x".repeat(1000)}";`, { budget: new Budget({ dataSize: 500 }) }))
    .rejects.toMatchObject({ budget: "dataSize" });
});

it.each([
  "const values = []; for (let i = 0; i < 100; i++) values.push(i); return values.length;",
  "const values = Array.from({ length: 100 }, (_, i) => i); return values.length;",
  "const unused = new Array(1000).fill(0); let sum = 0; for (let i = 0; i < 100; i++) sum++; return sum;"
])("keeps unlimited construction and scalar loops free of per-node scans: %s", async source => {
  const budget = new Budget();
  const scans = vi.spyOn(budget, "reconcileCompileData");
  expect(await run(source, { budget })).toMatchObject({ ok: true, returnValue: 100 });
  expect(scans.mock.calls.length).toBeLessThan(30);
});
