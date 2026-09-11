import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { validateDumpEnvelope } from "./validation.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { awaitSandboxValue } from "../interp/cancel.js";
import { getClosureOrigin } from "../interp/closure-origin.js";
import { constructionStates } from "../interp/construction-state.js";
import { isSandboxClosure } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each(["binding", "nested", "shared-reference"])("rejects an internal construction environment exposed through %s", async location => {
  const pending = run("class C{constructor(){this.read=()=>this}}const read=new C().read;await 0;return read()");
  try {
    const snapshot = JSON.parse(await dump(pending));
    const nodes = Object.values(snapshot.heap) as Array<{kind: string; environment?: {construction?: {kind: string; id: number}}}>;
    const closure = nodes.find(node => node.kind === "guest-function" && node.environment?.construction !== undefined);
    assert(closure?.environment?.construction !== undefined);
    const reference = location === "shared-reference" ? closure.environment.construction : structuredClone(closure.environment.construction);
    snapshot.bindings.leak = location === "nested" ? [{nested: reference}] : reference;
    expect(() => validateDumpEnvelope(snapshot)).toThrow("Internal construction environments cannot be guest data");
  } finally {
    await pending;
  }
});

it("rejects capture while a retained constructor environment is active", async () => {
  const source = "class C{constructor(){this.read=()=>this}}return new C().read";
  const result = await run(source);
  assert(result.ok && isSandboxClosure(result.returnValue));
  const environment = getClosureOrigin(result.returnValue)?.environment?.construction;
  assert(environment !== undefined);
  const state = constructionStates.get(environment);
  assert(state !== undefined);
  state.activeCalls++;
  try {
    expect(() => serialize({source, currentAstNodeId: 1,
      scopeChain: [{id: "module", bindings: {read: result.returnValue as RuntimeSnapshotValue}}],
      callStack: [], pendingPromises: [], moduleBindings: {}})).toThrow("Active class construction environments");
  } finally {
    state.activeCalls--;
  }
});

it.each([
  ["let finish;class B{constructor(){this.value=1}}class Other{constructor(){this.value=9}}class D extends B{constructor(){finish=()=>super();return {}}}new D();return ()=>{Object.setPrototypeOf(D,Other);return finish().value}", 9],
  ["let read;class C{constructor(){this.value=4;read=()=>this.value;throw 1}}try{new C()}catch{}return read", 4],
  ["let finish;let read;let effects=0;class B{}class D extends B{value=(()=>{effects++;throw 1})();constructor(){finish=()=>super();read=()=>this;return {}}}new D();return ()=>{try{finish()}catch{}let repeated=false;try{finish()}catch(e){repeated=e instanceof ReferenceError}return [effects,read() instanceof D,repeated]}", [1, true, true]],
  ["class C{constructor(){this.value=7;this.read=()=>[this.value,new.target===C]}}return new C().read", [7, true]],
  ["let calls=0;let again;class B{constructor(){calls++}}class D extends B{constructor(){super();again=()=>super()}}new D();return ()=>{try{again()}catch(error){return [calls,error instanceof ReferenceError]}}", [2, true]],
  ["let finish;let read;class B{constructor(){this.value=7}}class D extends B{#field=11;constructor(){finish=()=>super();read=()=>this.#field;return {marker:9}}}const returned=new D();return ()=>{const receiver=finish();return [receiver.value,read(),returned.marker]}", [7, 11, 9]],
  ["let constructions=0;class P extends Promise{constructor(executor){constructions++;super((resolve,reject)=>executor(value=>resolve(value),reason=>reject(reason)))}}const c=Promise.withResolvers();const result=P.all([c.promise]);return async()=>{const before=constructions;c.resolve(7);return [await result,before,constructions]}", undefined]
] as const)("restores retained constructor state: %s", async (source, expected) => {
  const native = await (new Function(source)() as () => unknown)();
  if (expected !== undefined) expect(native).toEqual(expected);
  const control = await run(source);
  assert(control.ok && isSandboxClosure(control.returnValue));
  const budget = new Budget();
  expect(await awaitSandboxValue(await invokeBuiltinClosure(control.returnValue, [], budget, undefined, undefined), undefined, budget)).toEqual(native);
  const fresh = await run(source);
  assert(fresh.ok);
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {read: fresh.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  const restoredBudget = new Budget();
  const binding = restore(JSON.parse(JSON.stringify(snapshot)), {source, budget: restoredBudget}).currentScope.lookup("read");
  assert(binding.found && isSandboxClosure(binding.value));
  expect(await awaitSandboxValue(await invokeBuiltinClosure(binding.value, [], restoredBudget, undefined, undefined), undefined, restoredBudget)).toEqual(native);
});

it.each(["scope-state", "scope-owner", "prototype"])("rejects inconsistent construction %s metadata", async corruption => {
  const source = "class C{constructor(){this.value=7;this.read=()=>this.value}}return new C().read";
  const result = await run(source);
  assert(result.ok);
  const snapshot = serialize({source, currentAstNodeId: 1,
    scopeChain: [{id: "module", bindings: {read: result.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  assert(snapshot.heap !== undefined);
  const node = Object.values(snapshot.heap).find(node => node.kind === "construction-environment");
  assert(node?.kind === "construction-environment");
  const scope = snapshot.heap[(node.thisScope as {id: number}).id];
  assert(scope?.kind === "scope-frame");
  if (corruption === "prototype") node.prototype = node.thisValue;
  else if (corruption === "scope-owner") scope.parent = {kind: "undefined"};
  else {
    const binding = scope.bindings.find(([name]) => name === "this");
    assert(binding !== undefined);
    const cell = scope.cells[binding[1]];
    assert(cell !== undefined);
    Object.assign(cell, {initialized: false});
    Reflect.deleteProperty(cell, "value");
  }
  expect(() => restore(JSON.parse(JSON.stringify(snapshot)), {source, budget: new Budget()})).toThrow("Invalid construction");
});
