import { expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { SandboxJobQueue } from "../jobs.js";
import { createWeakRefGlobal } from "./weak-ref.js";
import { measureSandboxData, type SandboxClosure } from "../values.js";
import { getSandboxPrototype } from "../object-model.js";

it("does not charge the same job-kept target once per WeakRef", async () => {
  expect(await run(`const target={payload:'abcdefgh'.repeat(64)};
    for(let index=0;index<32;index++)new WeakRef(target);
    return 'done'`, {budget:new Budget({dataSize:4096})}))
    .toMatchObject({ok:true,returnValue:"done"});
});

it("charges discarded WeakRef targets while their creating guest job is active", async () => {
  await expect(run(`for(let index=0;index<32;index++){
    new WeakRef({payload:'abcdefgh'.repeat(64)});
  }return 'done'`, {budget:new Budget({dataSize:4096})}))
    .rejects.toMatchObject({code:"budgetExceeded",budget:"dataSize"});
});

it("keeps the weak target out of permanent object data roots", async () => {
  const budget = new Budget();
  const constructor = createWeakRefGlobal(budget);
  const queue = new SandboxJobQueue();
  const target = {payload:"x".repeat(1024)};
  let reference: object;
  await queue.run(async () => {
    reference = await constructor.construct!([target]) as object;
    expect([...budget.retainedValues()]).toContain(target);
    expect(measureSandboxData([reference, ...budget.retainedValues()]))
      .toBeGreaterThan(measureSandboxData([reference]));
  });
  expect([...budget.retainedValues()]).not.toContain(target);
  expect(measureSandboxData([reference!])).toBeLessThan(target.payload.length);
});

it("dereference adds a target to the new job's roots and releases it afterward", async () => {
  const budget = new Budget();
  const constructor = createWeakRefGlobal(budget);
  const target = {payload:"retained"};
  const reference = await constructor.construct!([target]) as object;
  const prototype = getSandboxPrototype(reference,budget) as Record<string, SandboxClosure>;
  await new SandboxJobQueue().run(async () => {
    expect([...budget.retainedValues()]).not.toContain(target);
    expect(await prototype.deref!.call([], {stack:[],thisValue:reference as Record<string, never>})).toBe(target);
    expect([...budget.retainedValues()]).toContain(target);
  });
  expect([...budget.retainedValues()]).not.toContain(target);
});
