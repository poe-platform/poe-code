import { expect, it, vi } from "vitest";
import { Budget } from "../budget.js";
import { run } from "../../run.js";

it.each([false, true])("admits JSON before native parsing (reviver: %s)", async reviver => {
  for (const [payload, limits, failure] of [
    ["[" + "{},".repeat(1000) + "{}]", { maxSteps: 100 }, "steps"],
    ["[" + "{},".repeat(20) + "{}]", { arrayLength: 8 }, "arrayLength"],
    ["{" + Array.from({ length: 20 }, (_, i) => `"${i}":{}`).join(",") + "}", { arrayLength: 8 }, "arrayLength"],
    ["[".repeat(50) + "0" + "]".repeat(50), { maxCallDepth: 20 }, "callDepth"],
    ["[" + "{},".repeat(200) + "{}]", { dataSize: 8000 }, "dataSize"]
  ] as const) {
    const native = JSON.parse;
    const parsed: string[] = [];
    const spy = vi.spyOn(JSON, "parse").mockImplementation((text, callback) => {
      parsed.push(text);
      return native(text, callback);
    });
    const budget = new Budget(limits);
    try {
      await expect(run(`return JSON.parse(payload${reviver ? ", (key, value) => value" : ""})`, {
        bindings: { payload }, budget
      })).rejects.toMatchObject({ code: "budgetExceeded", budget: failure });
      expect(parsed).not.toContain(payload);
      expect([...budget.retainedValues()]).toEqual([]);
    } finally { spy.mockRestore(); }
  }
});

it.each([false, true])("handles quoted punctuation and escaped quotes (reviver: %s)", async reviver => {
  const payload = JSON.stringify(["[{},:]\\\"", { "a,:[]": "\\\"}" }]);
  expect(await run(`return JSON.parse(payload${reviver ? ", (key, value) => value" : ""})`, {
    bindings: { payload }, budget: new Budget({ arrayLength: 2 })
  })).toMatchObject({ ok: true, returnValue: JSON.parse(payload) });
});

it("bounds nesting even without a configured call-depth limit", async () => {
  await expect(run("return JSON.parse(payload)", {
    bindings: { payload: "[".repeat(257) + "0" + "]".repeat(257) }, budget: new Budget()
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataDepth" });
});

it("keeps native syntax errors catchable and releases admission state", async () => {
  const budget = new Budget({ dataSize: 100000 });
  expect(await run("try { JSON.parse(payload) } catch (error) { return error instanceof SyntaxError }", {
    bindings: { payload: '["unterminated' }, budget
  })).toMatchObject({ ok: true, returnValue: true });
  expect([...budget.retainedValues()]).toEqual([]);
});

it.each([false, true])("checks expired deadlines before native parsing (reviver: %s)", async reviver => {
  const payload = "[" + "0,".repeat(1024) + "0]";
  const spy = vi.spyOn(JSON, "parse");
  try {
    await expect(run(`return JSON.parse(payload${reviver ? ", (key, value) => value" : ""})`, {
      bindings: { payload }, budget: new Budget({ deadline: Date.now() - 1 })
    })).rejects.toMatchObject({ code: "budgetExceeded", budget: "deadline" });
    expect(spy.mock.calls.map(call => call[0])).not.toContain(payload);
  } finally { spy.mockRestore(); }
});
