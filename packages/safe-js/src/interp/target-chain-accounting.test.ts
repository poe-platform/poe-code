import { expect, it, vi } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";

it.each(["new Proxy(f, {})", "f.bind(null)"])("does not repeatedly walk retained roots while building %s without a data limit", async expression => {
  for (const loop of [
    `for (let i=0; i<100; i++) f=${expression};`,
    `let i=0; while (i++<100) f=${expression};`,
    `let i=0; do { f=${expression}; } while (++i<100);`
  ]) {
    const budget = new Budget();
    const scans = vi.spyOn(budget, "retainedValues");
    await run(`let f = () => 1; ${loop} return 1;`, { budget });
    expect(scans.mock.calls.length).toBeLessThan(30);
  }
});

it.each(["new Proxy(f, {})", "f.bind(null)"])("still enforces finite data budgets for %s", async expression => {
  await expect(run(`let f=()=>1; for(let i=0;i<100;i++) f=${expression}; return 1;`, {
    budget: new Budget({ dataSize: 1000 })
  })).rejects.toThrow("dataSize");
});
