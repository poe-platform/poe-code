import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { isSandboxClosure } from "./values.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { releaseObjectPrototype } from "./object-model.js";
import { getRealmGlobalObject, isRealmEval, resolveIntrinsicIdentity } from "./intrinsics.js";

it.each([
  {factory:'Function("return this.marker")',expected:7},
  {factory:'Function("leaked=9;return globalThis.leaked")',expected:9},
  {factory:'Function("({leaked}={leaked:9});return globalThis.leaked")',expected:9},
  {factory:'()=>{const indirect=eval;return indirect("this.marker")}',expected:7},
  {factory:'()=>{const lexical=11;return eval("lexical")}',expected:11}
])("retains the runtime global after cleanup and replay: $factory", async ({factory,expected}) => {
  const source = `globalThis.marker=7;const factory=${factory};await 0;return factory`;
  const original = await run(source);
  expect(original.ok).toBe(true);
  const replayed = await run(source,{snapshot:JSON.parse(await dump(original))});
  expect(replayed.ok).toBe(true);
  for (const result of [original,replayed]) {
    const closure = result.returnValue;
    if (!isSandboxClosure(closure)) throw new Error("Expected exported function");
    expect(await closure.call([],{stack:[],thisValue:undefined})).toBe(expected);
  }
});

it("keeps the intrinsic global separate from a replaced globalThis binding", async () => {
  const result = await run('globalThis.marker=7;const factory=Function("return this.marker");globalThis.globalThis=99;return factory');
  expect(result.ok).toBe(true);
  if (!isSandboxClosure(result.returnValue)) throw new Error("Expected function");
  expect(await result.returnValue.call([],{stack:[],thisValue:undefined})).toBe(7);
});

it("releases snapshot identities and accounting roots while retaining runtime realm identity", () => {
  const first = new Budget();
  const second = new Budget();
  const a = createBuiltinBindings({budget:first});
  const b = createBuiltinBindings({budget:second});
  const global = getRealmGlobalObject(first);
  releaseObjectPrototype(first);
  releaseObjectPrototype(second);
  expect([...first.retainedValues()]).toEqual([]);
  expect(()=>resolveIntrinsicIdentity(first,'["globalThis"]')).toThrow("Unknown intrinsic identity");
  expect(()=>resolveIntrinsicIdentity(first,'["eval"]')).toThrow("Unknown intrinsic identity");
  expect(getRealmGlobalObject(first)).toBe(global);
  expect(isRealmEval(a.eval,first)).toBe(true);
  expect(isRealmEval(b.eval,first)).toBe(false);
  expect(isRealmEval(a.eval,second)).toBe(false);
});
