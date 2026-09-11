import { assert, expect, it, vi } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { isSandboxClosure, isSandboxPromise } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import type { CallerInjectedBinding } from "../interp/host-bridge.js";

it.each([false,true])("restores dynamic module access in a closure (already loaded=%s)", async loaded => {
  const source = `${loaded ? "const original=await import('fixture');" : ""}
    return async()=>{const namespace=await import('fixture');return [namespace.value,${loaded ? "namespace===original" : "namespace===await import('fixture')"}]}`;
  const modules = {fixture:{value:7}};
  const result = await run(source,{modules});
  assert(result.ok);
  let reader = result.returnValue as RuntimeSnapshotValue;
  for (let repeat=0;repeat<3;repeat++) {
    const wire=serialize({source,currentAstNodeId:1,
      scopeChain:[{id:"module",bindings:{reader}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const budget=new Budget();
    const restored=restore(JSON.parse(JSON.stringify(wire)),{source,budget,modules});
    const binding=restored.currentScope.lookup("reader");
    assert(binding.found && isSandboxClosure(binding.value));
    const pending=await invokeBuiltinClosure(binding.value,[],budget,undefined,undefined);
    assert(isSandboxPromise(pending));
    expect(await pending.promise).toEqual([7,true]);
    reader=binding.value;
  }
});

it.each([false,true])("restores a closure using a host export (already loaded=%s)", async loaded => {
  const source=`${loaded ? "await import('fixture');" : ""}return async()=>await(await import('fixture')).read()`;
  const modules={fixture:{read:()=>7}};
  const original=await run(source,{modules});
  assert(original.ok);
  let reader=original.returnValue as RuntimeSnapshotValue;
  for(let repeat=0;repeat<3;repeat++) {
    const wire=serialize({source,currentAstNodeId:1,
      scopeChain:[{id:"module",bindings:{reader}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const budget=new Budget();
    const resumed=restore(JSON.parse(JSON.stringify(wire)),{source,budget,modules});
    const binding=resumed.currentScope.lookup("reader");
    assert(binding.found && isSandboxClosure(binding.value));
    const pending=await invokeBuiltinClosure(binding.value,[],budget,undefined,undefined);
    assert(isSandboxPromise(pending));
    expect(await pending.promise).toBe(7);
    reader=binding.value;
  }
});

it("preserves host-export property cycles and reconnects only supplied capabilities", async () => {
  const source = `const namespace=await import('fixture');
    return async()=>{const loaded=await import('fixture');
      return [loaded.read===namespace.read,loaded.read.self===loaded.read,await loaded.read()]}`;
  const originalCall = vi.fn(() => 7);
  Object.assign(originalCall, { self: originalCall });
  const original = await run(source, { modules: { fixture: { read: originalCall } } });
  assert(original.ok);
  let reader = original.returnValue as RuntimeSnapshotValue;
  const replacement = vi.fn(() => 11);
  for (let repeat=1;repeat<=3;repeat++) {
    const wire = serialize({source,currentAstNodeId:1,
      scopeChain:[{id:"module",bindings:{reader}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    expect(() => restore(wire, { source })).toThrow();
    const resumed = restore(JSON.parse(JSON.stringify(wire)), {source,modules:{fixture:{read:replacement}}});
    const binding = resumed.currentScope.lookup("reader");
    assert(binding.found && isSandboxClosure(binding.value));
    const pending = await invokeBuiltinClosure(binding.value, [], resumed.budget, undefined, undefined);
    assert(isSandboxPromise(pending));
    expect(await pending.promise).toEqual([true,true,11]);
    reader = binding.value;
  }
  expect(originalCall).not.toHaveBeenCalled();
  expect(replacement).toHaveBeenCalledTimes(3);
});

it.each(["empty path", "non-string path", "extra field", "unregistered path"])(
  "rejects a forged module-function reference: %s", async mutation => {
    const source = "const namespace=await import('fixture');return ()=>namespace.read()";
    const read = vi.fn(() => 7);
    const result = await run(source, {modules:{fixture:{read}}});
    assert(result.ok);
    const wire = serialize({source,currentAstNodeId:1,
      scopeChain:[{id:"module",bindings:{reader:result.returnValue as RuntimeSnapshotValue}}],
      callStack:[],pendingPromises:[],moduleBindings:{}});
    const reference = Object.values(wire.heap).find(node => node.kind === "module-function");
    assert(reference?.kind === "module-function");
    if (mutation === "empty path") reference.path = [];
    else if (mutation === "non-string path") Object.assign(reference, {path:[1]});
    else if (mutation === "extra field") Object.assign(reference, {native:"process"});
    else reference.path = ["__proto__", "constructor"];
    expect(() => restore(wire, {source,modules:{fixture:{read}}})).toThrow(
      mutation === "unregistered path" ? "Missing module function" : "Invalid snapshot");
    expect(read).not.toHaveBeenCalled();
  });

it("does not grant snapshot authority to arbitrary functions returned by a module", async () => {
  const source = "const namespace=await import('fixture');const callback=namespace.make();return ()=>callback()";
  const result = await run(source, {modules:{fixture:{make:()=>()=>7}}});
  assert(result.ok);
  expect(() => serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"module",bindings:{reader:result.returnValue as RuntimeSnapshotValue}}],
    callStack:[],pendingPromises:[],moduleBindings:{}})).toThrow("Cannot serialize host reference");
});

it.each([
  ["object", (read: () => number) => ({read}), "namespace.nested.read()"],
  ["array", (read: () => number) => [read], "namespace.nested[0]()"],
  ["map", (read: () => number) => new Map([["read",read]]), "namespace.nested.get('read')()"],
  ["set", (read: () => number) => new Set([read]), "namespace.nested.values().next().value()"]
] as const)("restores a registered module function nested in a %s", async (_kind, container, expression) => {
  const source = `const namespace=await import('fixture');return ()=>${expression}`;
  const original = await run(source, {modules:{fixture:{nested:container(()=>7) as CallerInjectedBinding}}});
  assert(original.ok);
  const wire = serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"module",bindings:{reader:original.returnValue as RuntimeSnapshotValue}}],
    callStack:[],pendingPromises:[],moduleBindings:{}});
  const resumed = restore(JSON.parse(JSON.stringify(wire)), {
    source,modules:{fixture:{nested:container(()=>11) as CallerInjectedBinding}}
  });
  const binding = resumed.currentScope.lookup("reader");
  assert(binding.found && isSandboxClosure(binding.value));
  expect(await invokeBuiltinClosure(binding.value, [], resumed.budget, undefined, undefined)).toBe(11);
});

it.each([false,true])("does not reevaluate a specifier when import options resume (async=%s)", async async => {
  const source=`let calls=0;${async ? "async " : ""}function* values(){
    return import((calls++,'fixture'),yield 1).then(namespace=>namespace.value+calls);
  }const iterator=values();await iterator.next();return iterator`;
  const modules={fixture:{value:7}};
  const result=await run(source,{modules});
  assert(result.ok);
  const wire=serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"module",bindings:{iterator:result.returnValue as RuntimeSnapshotValue}}],
    callStack:[],pendingPromises:[],moduleBindings:{}});
  const restored=restore(JSON.parse(JSON.stringify(wire)),{source,modules});
  const iterator=restored.currentScope.lookup("iterator");
  assert(iterator.found);
  const next=await interpret(parseModule("{return iterator.next(undefined)}").body[0],{
    budget:restored.budget,bindings:{iterator:iterator.value}
  });
  assert(next.ok);
  const value=isSandboxPromise(next.returnValue) ? await next.returnValue.promise : next.returnValue;
  expect(value).toMatchObject({done:true});
  assert(value!==null && typeof value==="object" && "value" in value);
  expect(isSandboxPromise(value.value) ? await value.value.promise : value.value).toEqual(8);
});

it.each(["duplicate names","invalid namespace"])("rejects a forged module environment: %s", async mutation => {
  const source="await import('fixture');return ()=>import('fixture')";
  const result=await run(source,{modules:{fixture:{value:7}}});
  assert(result.ok);
  const wire=serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"module",bindings:{reader:result.returnValue as RuntimeSnapshotValue}}],
    callStack:[],pendingPromises:[],moduleBindings:{}});
  const frame=Object.values(wire.heap).find(node=>node.kind==="scope-frame" && node.moduleEnvironment!==undefined);
  assert(frame?.kind==="scope-frame" && frame.moduleEnvironment);
  if (mutation==="duplicate names") frame.moduleEnvironment.available.push("fixture");
  else {
    const reference=frame.moduleEnvironment.namespaces;
    assert(reference.kind==="ref");
    const cache=wire.heap[String(reference.id)];
    assert(cache.kind==="object");
    cache.entries.fixture={kind:"undefined"};
  }
  expect(()=>restore(wire,{source,modules:{fixture:{value:7}}})).toThrow("Invalid snapshot");
});
