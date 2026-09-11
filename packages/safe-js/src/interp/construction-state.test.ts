import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { getClosureOrigin } from "./closure-origin.js";
import { constructionStates } from "./construction-state.js";
import { isSandboxClosure, measureSandboxData } from "./values.js";
import { materializeFunctionProperties } from "./object-model.js";

it("tracks delayed initialization and releases activity after repeated super calls", async () => {
  const result = await run("let finish;class B{constructor(){this.value=7}}class D extends B{constructor(){finish=()=>super();return {}}}new D();return finish");
  assert(result.ok && isSandboxClosure(result.returnValue));
  const environment = getClosureOrigin(result.returnValue)?.environment?.construction;
  assert(environment !== undefined);
  const state = constructionStates.get(environment);
  assert(state !== undefined);
  expect(state.activeCalls).toBe(0);
  expect(state.initialized).toBe(false);
  const budget = new Budget();
  const receiver = await invokeBuiltinClosure(result.returnValue, [], budget, undefined, undefined);
  expect(state.thisValue).toBe(receiver);
  expect(state.thisScope?.lookup("this")).toMatchObject({found: true, value: receiver});
  expect(state.initialized).toBe(true);
  expect(state.activeCalls).toBe(0);
  await expect(invokeBuiltinClosure(result.returnValue, [], budget, undefined, undefined)).rejects.toThrow("Super constructor may only initialize this once");
  expect(state.activeCalls).toBe(0);
});

it("accounts for the construction owner after its ordinary guest references are removed", async () => {
  const result = await run("let C=class{constructor(){this.read=()=>this}};function T(){}const value=Reflect.construct(C,[],T);delete C.prototype.constructor;C=null;return value.read");
  assert(result.ok && isSandboxClosure(result.returnValue));
  const environment = getClosureOrigin(result.returnValue)?.environment?.construction;
  assert(environment !== undefined);
  const state = constructionStates.get(environment);
  assert(state !== undefined);
  const properties = materializeFunctionProperties(state.constructor);
  Object.defineProperty(properties, "payload", {value: "", writable: true, configurable: true});
  const before = measureSandboxData([result.returnValue]);
  properties.payload = "x".repeat(400);
  expect(measureSandboxData([result.returnValue]) - before).toBe(400);
});
