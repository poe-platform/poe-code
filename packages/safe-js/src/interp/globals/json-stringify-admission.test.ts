import { afterEach, expect, it, vi } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";

afterEach(() => vi.restoreAllMocks());

it.each(["return JSON.stringify(input)", "return JSON.stringify({[input]: 1})"])(
  "rejects escape expansion before native quoting: %s", async source => {
    const input = "\x01".repeat(64);
    const native = vi.spyOn(JSON, "stringify");
    await expect(run(source, { bindings: { input }, budget: new Budget({ stringLength: 128 }) }))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
    expect(native.mock.calls.some(([value]) => value === input)).toBe(false);
  }
);

it("charges scanning work before native quoting", async () => {
  const input = "\x01".repeat(256);
  const native = vi.spyOn(JSON, "stringify");
  await expect(run("return JSON.stringify(input)", {
    bindings: { input }, budget: new Budget({ maxSteps: 64, stringLength: 2048 })
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  expect(native.mock.calls.some(([value]) => value === input)).toBe(false);
});

it("admits expanded memory before native quoting", async () => {
  const input = "\x01".repeat(1024);
  const native = vi.spyOn(JSON, "stringify");
  await expect(run("return JSON.stringify(input)", {
    bindings: { input }, budget: new Budget({ dataSize: 5000 })
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
  expect(native.mock.calls.some(([value]) => value === input)).toBe(false);
});

it.each(["", "ordinary text", "\x00\x01\b\t\n\f\r\"\\", "😀", "\ud800", "\udc00", "\ud800x\udc00"])(
  "preserves native quoting at the exact output limit for %j", async input => {
    const expected = JSON.stringify(input);
    expect(await run("return JSON.stringify(input)", {
      bindings: { input }, budget: new Budget({ stringLength: expected.length })
    })).toMatchObject({ ok: true, returnValue: expected });
  }
);
