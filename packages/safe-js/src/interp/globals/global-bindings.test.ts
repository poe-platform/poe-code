import { expect, it } from "vitest";
import { run } from "../../run.js";
import { createRealm } from "../../realm.js";
import { Budget } from "../budget.js";
import { Scope } from "../scope.js";
import { createBuiltinBindings } from "../globals.js";

it.each(["Math", "JSON", "Array", "Object", "Promise"])("allows replacing the writable %s global binding", async name => {
  const source = `try{${name}=7;return ${name}}catch(error){return error.name}`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:7});
});

it("keeps an injected host binding immutable", async () => {
  expect(await run("try{host=7}catch(error){return error.name}", {bindings:{host:1}}))
    .toMatchObject({ok:true,returnValue:"TypeError"});
});

it.each(["Infinity", "NaN"])("keeps the read-only %s global immutable", async name => {
  expect(await run(`try{${name}=7}catch(error){return error.name}`))
    .toMatchObject({ok:true,returnValue:"TypeError"});
});

it("isolates replacements between runs", async () => {
  expect(await run("try{Math=7;return Math}catch(error){return error.name}"))
    .toMatchObject({ok:true,returnValue:7});
  expect(await run("return Math.abs(-3)")).toMatchObject({ok:true,returnValue:3});
});

it("preserves lexical shadowing of a writable global", async () => {
  expect(await run("let Math=7;{const Math=9;}return Math"))
    .toMatchObject({ok:true,returnValue:7});
});

it("preserves replacements across evaluations in a persistent realm", async () => {
  const realm = createRealm();
  try {
    expect(await realm.evaluate("try{Math=7;return Math}catch(error){return error.name}"))
      .toMatchObject({ok:true,returnValue:7});
    expect(await realm.evaluate("return Math")).toMatchObject({ok:true,returnValue:7});
  } finally {await realm.close();}
});

it("retains replaced global values without charging pristine intrinsic bindings", () => {
  const budget = new Budget();
  const bindings = createBuiltinBindings({budget});
  const scope = new Scope(bindings,undefined,undefined,{chargeData:false});
  expect(scope.retainedValues()).toEqual([]);
  scope.assign("Math", bindings.Math);
  expect(scope.retainedValues()).toEqual([]);
  const replacement = "x".repeat(10000);
  scope.assign("Math", replacement);
  // The global object now owns these roots, including property-only writes.
  expect([...budget.retainedValues()]).toEqual(["Math", replacement]);
  const restored = new Scope({},undefined,undefined,{chargeData:false});
  restored.hydrateFrame(scope.captureFrame());
  expect([...budget.retainedValues()]).toEqual(["Math", replacement]);
  expect(restored.lookup("Math")).toMatchObject({found:true,value:replacement});
  restored.assign("Math", bindings.Math);
  expect(restored.retainedValues()).toEqual([]);
  expect([...budget.retainedValues()]).toEqual([]);
});

it("enforces the aggregate data budget for values retained only by replaced globals", async () => {
  expect(await run("Math='x'.repeat(15000);return Math.length", {budget:new Budget({dataSize:100000})}))
    .toMatchObject({ok:true,returnValue:15000});
  const names = ["Math","JSON","Array","Object","Promise","Date","Map","Set"];
  const source = names.map(name => `${name}='x'.repeat(15000);`).join("") + "return 7";
  await expect(run(source,{budget:new Budget({dataSize:100000})}))
    .rejects.toMatchObject({code:"budgetExceeded",budget:"dataSize"});
});
