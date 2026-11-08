import { expect, it } from "vitest";
import { Budget } from "../budget.js";
import { run } from "../../run.js";

const source = `const functions=[];
  try {
    for(let i=0;i<6;i++) functions.push(eval("/*"+"x".repeat(4000)+"*/()=>1"));
  } catch(error) { return "caught"; }
  return functions.length;`;

it("keeps retained eval source within fatal data limits", async () => {
  await expect(run(source, {budget: new Budget({dataSize: 25000})}))
    .rejects.toMatchObject({code: "budgetExceeded", budget: "dataSize", limit: 25000});
});

it("permits the same retained-source workload with sufficient budget", async () => {
  expect(await run(source, {budget: new Budget({dataSize: 60000})}))
    .toMatchObject({ok: true, returnValue: 6});
});
