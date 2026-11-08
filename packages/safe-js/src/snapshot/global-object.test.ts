import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { isSandboxClosure } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import { isSandboxPromise } from "../interp/values.js";

it("rejects a non-global intrinsic as an object environment", async () => {
  const source = "return ()=>globalThis";
  const result = await run(source);
  assert(result.ok);
  const wire = serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"module",bindings:{reader:result.returnValue as RuntimeSnapshotValue}}],
    callStack:[],pendingPromises:[],moduleBindings:{}});
  const frame = Object.values(wire.heap).find(node=>node.kind === "scope-frame" && node.objectEnvironment !== undefined);
  const math = Object.entries(wire.heap).find(([,node])=>node.kind === "intrinsic" && node.id === '["Math"]');
  assert(frame?.kind === "scope-frame" && math);
  frame.objectEnvironment = {kind:"ref",id:Number(math[0])};
  expect(()=>restore(wire,{source})).toThrow("Invalid global object environment");
});

it("preserves global object identity and identifier storage through repeated snapshots", async () => {
  const source = `
    globalThis.value = 7;
    const original = globalThis;
    Object.defineProperty(globalThis, 'reading', {
      get() { return this.value; }
    });
    return () => [++value, reading, original === globalThis, original.value];
  `;
  const result = await run(source);
  assert(result.ok);
  let reader = result.returnValue as RuntimeSnapshotValue;
  for (let repeat = 0; repeat < 3; repeat++) {
    const snapshot = serialize({
      source, currentAstNodeId: 1,
      scopeChain: [{id: "module", bindings: {reader}}],
      callStack: [], pendingPromises: [], moduleBindings: {}
    });
    const budget = new Budget();
    const restored = restore(JSON.parse(JSON.stringify(snapshot)), {source, budget});
    const binding = restored.currentScope.lookup("reader");
    assert(binding.found && isSandboxClosure(binding.value));
    const expected = 8 + repeat;
    expect(await invokeBuiltinClosure(binding.value, [], budget, undefined, undefined))
      .toEqual([expected, expected, true, expected]);
    reader = binding.value;
  }
});

it.each([false,true])("restores a global compound assignment suspended in a generator (async=%s)", async async => {
  const source = `globalThis.value=2;${async ? "async " : ""}function* values(){value+=(globalThis.value=10,yield 1);return [value,globalThis.value]}const iterator=values();await iterator.next();return iterator`;
  const original = await run(source);
  assert(original.ok);
  const snapshot = serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"module",bindings:{iterator:original.returnValue as RuntimeSnapshotValue}}],
    callStack:[],pendingPromises:[],moduleBindings:{}});
  const restored = restore(JSON.parse(JSON.stringify(snapshot)),{source});
  const binding = restored.currentScope.lookup("iterator");
  assert(binding.found);
  const next = await interpret(parseModule("{return iterator.next(4)}").body[0],{
    budget:restored.budget,bindings:{iterator:binding.value}
  });
  assert(next.ok);
  const value = isSandboxPromise(next.returnValue) ? await next.returnValue.promise : next.returnValue;
  expect(value).toEqual({done:true,value:[6,6]});
});
