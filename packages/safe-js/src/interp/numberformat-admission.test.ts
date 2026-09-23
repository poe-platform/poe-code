import { afterEach, expect, it, vi } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { createSandboxNumberFormat, formatNumberValue } from "./intl-numberformat.js";

afterEach(() => vi.restoreAllMocks());

it("pre-admits BigInts created entirely by guest code", async () => {
  const native = vi.spyOn(Intl.NumberFormat.prototype, "formatToParts");
  await expect(run("return new Intl.NumberFormat('en').formatToParts(BigInt('9'.repeat(2000)))", {
    budget: new Budget({ arrayLength: 2 })
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
  expect(native.mock.calls.length).toBe(0);
});

it("releases the preflight reservation when native formatting throws", () => {
  const formatter = createSandboxNumberFormat("en", {});
  const budget = new Budget();
  budget.currentDataSize = 100;
  vi.spyOn(Intl.NumberFormat.prototype, "formatToParts").mockImplementation(() => { throw new Error("native failure"); });
  expect(() => formatNumberValue(formatter, "formatToParts", [BigInt("9".repeat(2000))], budget)).toThrow("native failure");
  expect(budget.currentDataSize).toBe(100);
});

it.each(["formatToParts", "formatRangeToParts"])("rejects oversized %s before native allocation", async method => {
  const native = vi.spyOn(Intl.NumberFormat.prototype, method);
  await expect(run(`export default value=>new Intl.NumberFormat('en').${method}(value,value+1n)`, {
    entryPointArgs: [BigInt("9".repeat(2000))], budget: new Budget({ arrayLength: 2 })
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
  expect(native.mock.calls.length).toBe(0);
});

it("pre-admits retained bytes even with grouping disabled", async () => {
  const native = vi.spyOn(Intl.NumberFormat.prototype, "formatToParts");
  await expect(run("export default value=>new Intl.NumberFormat('en',{useGrouping:false}).formatToParts(value)", {
    entryPointArgs: [BigInt("9".repeat(2000))], budget: new Budget({ dataSize: 10000 })
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
  expect(native.mock.calls.length).toBe(0);
});

it("enforces a native allocation ceiling without optional guest limits", async () => {
  const native = vi.spyOn(Intl.NumberFormat.prototype, "formatToParts");
  await expect(run("export default value=>new Intl.NumberFormat('en').formatToParts(value)", {
    entryPointArgs: [BigInt("9".repeat(40000))]
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
  expect(native.mock.calls.length).toBe(0);
});

it.each([{ useGrouping: false }, { notation: "scientific" }, { notation: "engineering" }])("allows bounded large magnitude output: %j", async options => {
  const value = BigInt("9".repeat(2000));
  const result = await run(`export default value=>new Intl.NumberFormat('en',${JSON.stringify(options)}).formatToParts(value)`, {
    entryPointArgs: [value]
  });
  expect(result).toMatchObject({ ok: true, returnValue: new Intl.NumberFormat("en", options as Intl.NumberFormatOptions).formatToParts(value) });
});
