import { expect, it } from "vitest";
import { run } from "../run.js";
import { serialize, type RuntimeSnapshotValue } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { disposableStackStates } from "./disposable-stack.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { captureGuestHeapNode } from "../snapshot/guest-heap.js";
import { SnapshotNotReadyError } from "../snapshot/not-ready.js";
import { validateGuestHeapNode } from "../snapshot/guest-heap-validation.js";

it("retains private resource data and releases it after disposal", () => {
  const stack = {};
  const method = createSandboxClosure({call:()=>undefined});
  const baseline = measureSandboxData([stack, method]);
  const resources = [{method, receiver: undefined, args:['x'.repeat(1000)]}];
  disposableStackStates.set(stack, {disposed:false,active:false,resources});
  expect(measureSandboxData([stack, method]) - baseline).toBeGreaterThanOrEqual(1000);
  resources.length = 0;
  expect(measureSandboxData([stack, method])).toBe(baseline);
});

it("defers snapshots while synchronous cleanup is active", () => {
  const stack={};
  disposableStackStates.set(stack,{disposed:true,active:true,resources:[]});
  expect(()=>captureGuestHeapNode(stack,value=>value)).toThrow(SnapshotNotReadyError);
});

it("validates private resource records in untrusted snapshots", () => {
  const state={properties:{properties:[],extensible:true}};
  const node={kind:'disposable-stack',disposed:false,resources:[{method:{kind:'undefined'},receiver:{kind:'undefined'},args:[]}],state};
  expect(()=>validateGuestHeapNode(node,{})).toThrow('Missing disposer');
  expect(()=>validateGuestHeapNode({...node,disposed:'false'},{})).toThrow('Invalid disposable stack');
});

it("restores moved resources, captured methods, and aliases through JSON snapshots", async () => {
  const source = `
    const calls=[];const original=new DisposableStack();const value={id:7};
    const resource={[Symbol.dispose](){calls.push(this===resource)}};
    original.use(resource);original.adopt(value,v=>calls.push(v===value));
    resource[Symbol.dispose]=()=>{throw 'wrong'};
    const moved=original.move();
    return ()=>{moved.dispose();return [original.disposed,moved.disposed,calls]};
  `;
  const result = await run(source);
  if (!result.ok) throw result.error;
  const snapshot = serialize({source,currentAstNodeId:1,
    scopeChain:[{id:'module',bindings:{read:result.returnValue as RuntimeSnapshotValue}}],
    callStack:[],pendingPromises:[],moduleBindings:{}});
  const binding=restore(JSON.parse(JSON.stringify(snapshot)),{source}).currentScope.lookup('read');
  if (!binding.found || !isSandboxClosure(binding.value)) throw new Error('missing reader');
  expect(await binding.value.call([])).toEqual([true,true,[true,true]]);
  expect(await binding.value.call([])).toEqual([true,true,[true,true]]);
});
