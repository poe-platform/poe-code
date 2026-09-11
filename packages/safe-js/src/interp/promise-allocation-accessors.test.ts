import { describe, expect, it, vi } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { resolveSandboxValue } from "./promise.js";

describe.each(["fulfilled", "rejected"] as const)("Promise %s allocation", status => {
it.each([false, true])("does not evaluate unrelated accessors during Promise resolution, array=%s", async array => {
  const source = `let reads=0;const value=${array ? "[0]" : "{}"};
    Object.defineProperty(value,${array ? "'0'" : "'field'"},{enumerable:true,get(){reads++;return 7;}});
    const resolved=await Promise.${status === "fulfilled" ? "resolve(value)" : "reject(value).catch(value=>value)"};return [reads,resolved===value];`;
  const native = await Function(`return (async()=>{${source}})()`)();
  expect(native).toEqual([0, true]);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: native });
});

it.each([false, true])("checks hidden fulfilled data against Promise allocation limits, array=%s", async array => {
  const value = Object.defineProperty(array ? [] : {}, "hidden", { value: "x".repeat(17) });
  await expect(resolveSandboxValue(status === "fulfilled" ? value : Promise.reject(value), { budget: new Budget({ stringLength: 16 }) }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
});

it("does not read a host data accessor during Promise allocation validation", async () => {
  const getter = vi.fn(() => "value");
  const value = Object.defineProperty({}, "field", { enumerable: true, get: getter });
  const result = resolveSandboxValue(status === "fulfilled" ? value : Promise.reject(value), { budget: new Budget() });
  if (status === "fulfilled") await expect(result).resolves.toBe(value);
  else await expect(result).rejects.toBe(value);
  expect(getter).not.toHaveBeenCalled();
});
});
