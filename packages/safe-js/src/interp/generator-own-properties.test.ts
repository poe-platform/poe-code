import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { declareHostOperation } from "./host-bridge.js";
import { Budget, SandboxError } from "./budget.js";
import { createSandboxClosure, createSandboxGenerator, measureSandboxData, reconcileCompiledValues } from "./values.js";
import { createGeneratorChannel } from "./generator.js";
import { getGeneratorProperties } from "./generator-properties.js";
import { interpret } from "./interpreter.js";
import { parseModule } from "../parse/parser.js";
import { serialize, type RuntimeSnapshotValue } from "../snapshot/serialize.js";
import { restore as restoreGraph } from "../snapshot/restore.js";
import { isSandboxGenerator } from "./values.js";
import { getSandboxDataProperty, setSandboxPrototype } from "./object-model.js";
import { validateGuestHeapNode } from "../snapshot/guest-heap-validation.js";
import { generatorIterator, restoreSandboxIterator } from "./iteration.js";

it.each([
  "const value=(function*(){yield 1})();value.extra=2;return value.extra",
  "const value=(function*(){yield 1})();value.channel='changed';return [value.channel,value.next()]",
  "const value=(function*(){yield 1})();Object.defineProperty(value,'extra',{value:2});return [value.extra,value.next()]",
  "const value=(function*(){yield 1})();Object.assign(value,{extra:2});return [value.extra,value.next()]",
  "function Result(){return (function*(){yield 1})()}const value=Array.of.call(Result,2);return [value[0],value.length,value.next()]",
  "const values=[1,2];values.constructor={[Symbol.species]:function(){return (function*(){yield 3})()}};const result=values.map(value=>value);return [result[0],result[1],result.next()]",
  "const value=(function*(){yield 1})();value.next=()=>({value:9,done:true});return value.next()",
  "const value=(function*(){yield 1})();value[Symbol.iterator]=()=>({next(){return {done:true}}});return Array.from(value)",
  "const value=(function*(){yield 1})();delete value.channel;return value.next()",
  "const value=(function*(){yield 1})();value.extra=2;return [Object.keys(value),Object.getOwnPropertyDescriptor(value,'extra'),Object.hasOwn(value,'channel')]",
  "const value=(function*(){yield 1})();value.extra=2;const removed=delete value.extra;return [removed,value.extra,Object.keys(value),value.next()]",
  "const value=(function*(){yield 1})();Object.freeze(value);return [Object.isFrozen(value),value.next(),value.next()]",
  "const value=(function*(){yield 1})();Object.preventExtensions(value);return [Object.isExtensible(value),value.next()]",
  "const value=(function*(){yield 1})();let writes=0;Object.defineProperty(value,'extra',{get(){return writes},set(next){writes=next}});value.extra=3;return [value.extra,writes,value.next()]",
  "const value=(function*(){yield 1})();const key=Symbol('own');value[key]=3;return [value[key],Object.getOwnPropertySymbols(value).length,value.next()]"
])("preserves generator public properties: %s", async source => {
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});

it("keeps async generator state separate from frozen public properties", async () => {
  const source = "const value=(async function*(){yield 1})();value.channel='own';Object.freeze(value);return [value.channel,await value.next(),await value.next()]";
  const native = new Function(`return async function(){${source}}`)() as () => Promise<unknown>;
  expect((await run(source)).returnValue).toEqual(await native());
});

it("retains generator metadata under the data budget", () => {
  const generator = createSandboxGenerator(createGeneratorChannel(async () => undefined));
  const properties = getGeneratorProperties(generator);
  properties.extra = "x".repeat(1000);
  properties.self = generator;
  expect(measureSandboxData([generator])).toBe(1012);
  expect(() => reconcileCompiledValues(new Budget({ dataSize: 100 }), [generator])).toThrow(SandboxError);
});

it("restores public generator descriptors from the portable heap without reexecution", async () => {
  const source = "{function* values(){yield 1;yield 2}const iterator=values();iterator.extra=7;iterator.self=iterator;iterator.next();return iterator}";
  const ast = parseModule(source);
  const initial = await interpret(ast.body[0]);
  if (!initial.ok || !isSandboxGenerator(initial.returnValue)) throw new Error("Missing generator");
  const properties = getGeneratorProperties(initial.returnValue);
  const key = Symbol("metadata");
  properties[key] = 9;
  Object.freeze(properties);
  const snapshot = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
    scopeChain: [{ id: "external", bindings: { iterator: initial.returnValue as RuntimeSnapshotValue, key } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restoreGraph(JSON.parse(JSON.stringify(snapshot)), { source });
  const binding = restored.currentScope.lookup("iterator");
  if (!binding.found || !isSandboxGenerator(binding.value)) throw new Error("Missing restored generator");
  const metadata = getGeneratorProperties(binding.value);
  const restoredKey = restored.currentScope.lookup("key");
  if (!restoredKey.found || typeof restoredKey.value !== "symbol") throw new Error("Missing restored key");
  expect(metadata.extra).toBe(7);
  expect(metadata.self).toBe(binding.value);
  expect(metadata[restoredKey.value]).toBe(9);
  expect(Object.isFrozen(metadata)).toBe(true);
  expect(await interpret(parseModule("{return iterator.next()}").body[0], {
    budget: restored.budget, bindings: { iterator: binding.value }
  })).toMatchObject({ ok: true, returnValue: { value: 2, done: false } });
});

it.each([
  { source: "const value=(function*(){yield 1;yield 2})();value.extra=7;value.self=value;const key=Symbol('own');value[key]=9;Object.freeze(value);const first=value.next();await pause();return [value.extra,value.self===value,value[key],Object.isFrozen(value),first,value.next()]",
    expected: [7, true, 9, true, { value: 1, done: false }, { value: 2, done: false }] },
  { source: "const value=(function*(){yield 1})();let count=0;value.next=()=>({done:count++>0,value:9});const items=[];for(const item of value){items.push(item);await pause()}return [items,count]",
    expected: [[9], 2] },
  { source: "const value=(function*(){yield 1})();let closed=0;value.return=()=>{closed++;return {done:true}};for(const item of value){await pause();break}return closed",
    expected: 1 },
  { source: "const value=(function*(){yield 1})();Object.defineProperty(value,'extra',{get(){return this.self===this?7:0}});value.self=value;Object.setPrototypeOf(value,{inherited:3});await pause();return [value.extra,value.inherited,value.self===value]",
    expected: [7, 3, true] },
  { source: "const value=(function*(){yield 1;yield 2})();const items=[];for(const item of value){items.push(item);Object.setPrototypeOf(value,null);await pause()}return items",
    expected: [1, 2] },
  { source: "const value=(async function*(){yield 1;yield 2})();const items=[];for await(const item of value){items.push(item);Object.setPrototypeOf(value,null);await pause()}return items",
    expected: [1, 2] }
])("preserves generator property protocols across a pending effect: $source", async ({ source, expected }) => {
  let release!: () => void;
  let signalEntered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { signalEntered = resolve; });
  const pause = declareHostOperation(async () => { signalEntered(); await pending; }, "re-issue");
  const execution = run(source, { bindings: { pause } });
  void execution.catch(() => undefined);
  let serialized: string;
  try {
    await Promise.race([entered, execution]);
    serialized = await dump(execution, { mode: "replay" });
  } finally { release(); }
  const initial = await execution;
  expect(initial.ok).toBe(true);
  const resumed = await run(source, { snapshot: restore(JSON.parse(serialized), { source }),
    bindings: { pause: declareHostOperation(async () => undefined, "re-issue") } });
  expect(resumed.returnValue).toEqual(initial.returnValue);
  expect(resumed.returnValue).toEqual(expected);
});

it.each([
  "const value=(function*(){yield 1})();value.extra=2;return [{...value},JSON.stringify(value),Object.getOwnPropertyNames(value)]",
  "const value=(function*(){yield 1})();value[Symbol.toPrimitive]=()=>7;return +value",
  "const value=(function*(){yield 1})();Object.setPrototypeOf(value,{extra:3});return [value.extra,typeof value.next]",
  "const value=(function*(){yield 1})();value.next=()=>({done:true});return Array.from(value)",
  "const value=(function*(){yield 1})();let closed=0;value.return=()=>{closed++;return {done:true}};for(const item of value){break}return closed",
  "const value=(function*(){yield 1})();let reads=0;let calls=0;Object.defineProperty(value,'next',{get(){reads++;return ()=>({done:calls++>0,value:9})}});return [Array.from(value),reads,calls]",
  "const value=(function*(){yield 1})();value.return=()=>1;try{for(const item of value){break}}catch(error){return error.name}",
  "const value=(function*(){yield 1})();Object.setPrototypeOf(value,null);try{for(const item of value){}}catch(error){return error.name}",
  "const value=(function*(){yield 1})();Object.defineProperty(value,'extra',{get(){return this===value?3:0},enumerable:true});const keys=[];for(const key in value)keys.push(key);return [{...value},Object.assign({},value),keys]",
  "const value=(function*(){yield 1})();Object.freeze(value);let failed=false;try{value.extra=2}catch(error){failed=error.name==='TypeError'}return [failed,value.next()]",
  "const value=(function*(){yield 1})();Object.setPrototypeOf(value,{extra:undefined});return ['extra' in value,'missing' in value]",
  "const parent=(function*(){yield 1})();Object.defineProperty(parent,'extra',{value:3});const value=Object.create(parent);let failed=false;try{value.extra=4}catch(error){failed=error.name==='TypeError'}return [failed,value.extra]"
])("honors generator properties across object protocols: %s", async source => {
  expect((await run(source)).returnValue).toEqual(new Function(`'use strict';${source}`)());
});

it("captures metadata descriptors before retained callbacks change later fields", () => {
  const generator = createSandboxGenerator(createGeneratorChannel(async () => undefined));
  const properties = getGeneratorProperties(generator);
  properties.first = createSandboxClosure({ call: () => undefined, retainedValues: () => {
    properties.later = "x".repeat(1000);
    return [];
  } });
  properties.later = "initial";
  expect(measureSandboxData([generator])).toBe(21);
});

it("honors async generator iterator-operation overrides", async () => {
  const source = "const value=(async function*(){yield 1})();let closed=0;value.return=async()=>{closed++;return {done:true}};for await(const item of value){break}const other=(async function*(){yield 2})();other.next=async()=>({done:true});const items=[];for await(const item of other){items.push(item)}return [closed,items]";
  const native = new Function(`return async function(){${source}}`)() as () => Promise<unknown>;
  expect((await run(source)).returnValue).toEqual(await native());
});

it("looks up inherited generator data without exposing internal state", () => {
  const generator = createSandboxGenerator(createGeneratorChannel(async () => undefined));
  setSandboxPrototype(generator, { extra: 3 });
  expect(getSandboxDataProperty(generator, "extra")).toBe(3);
  expect(getSandboxDataProperty(generator, "channel")).toBeUndefined();
});

it("rejects forged generator metadata flags", () => {
  const scope = { kind: "ref", id: 1 };
  const node = { kind: "guest-generator", state: "start", astNodeId: 1, async: false,
    scope, closureScope: scope, sent: [], objectState:
      { properties: { properties: [["extra", { kind: "data", value: 1, writable: "yes", enumerable: true, configurable: true }]], extensible: true } } };
  expect(() => validateGuestHeapNode(node, { "1": { kind: "scope-frame" } })).toThrow();
});

it("rejects execution scopes in public generator properties at the restore boundary", async () => {
  const source = "function* values(){yield 1}const value=values();value.extra=1;return 1";
  const snapshot = JSON.parse(await dump(await run(source)));
  const node = snapshot.heap[String(snapshot.bindings.value.id)];
  node.objectState.prototype = node.scope;
  expect(() => restore(snapshot, { source })).toThrow("Internal scopes cannot be guest data");
});

it("accepts legacy generator heap nodes without public metadata", () => {
  const scope = { kind: "ref", id: 1 };
  expect(validateGuestHeapNode({ kind: "guest-generator", state: "start", astNodeId: 1,
    async: false, scope, closureScope: scope, sent: [] }, { "1": { kind: "scope-frame" } })).toBe(true);
});

it.each([false, true])("restores an acquired generator cursor after prototype replacement (async=%s)", async async => {
  const generator = createSandboxGenerator(createGeneratorChannel(async yieldValue => {
    await yieldValue(1);
    return 2;
  }), { async });
  const budget = new Budget();
  const iterator = generatorIterator(generator, budget);
  try {
    expect(await iterator.next()).toEqual({ value: 1, done: false });
    setSandboxPrototype(generator, null);
    const restored = await restoreSandboxIterator(iterator.snapshot!(), budget, { stack: [], thisValue: undefined });
    expect(await restored.next()).toEqual({ value: 2, done: true });
  } finally { await iterator.return?.(); }
});
