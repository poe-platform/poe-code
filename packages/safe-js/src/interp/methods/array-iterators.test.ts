import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";
import { restoreSandboxArrayIterator } from "../array-iterator.js";
import { nextArrayIterator } from "./array-iterator.js";
import { serialize } from "../../snapshot/serialize.js";
import { restore as restoreGraph } from "../../snapshot/restore.js";
import { arrayIteratorState } from "../array-iterator.js";
import { deepCopyFromSandbox, measureSandboxData } from "../values.js";
import { validateGuestHeapNode } from "../../snapshot/guest-heap-validation.js";
import { declareHostOperation } from "../host-bridge.js";
import { runInNewContext } from "node:vm";

it("honors deletion of the default array iterator", async () => {
  const source = "delete Array.prototype[Symbol.iterator];try{for(const value of [1]){}}catch(error){return error.name}";
  expect((await run(source)).returnValue).toEqual(runInNewContext(`(function(){${source}})()`));
});

it("resumes an iterator across a pending host effect", async () => {
  const source = "const values=[1,2];const iterator=values.values();const first=iterator.next();await pause();values.push(3);return [first,iterator.next(),iterator.next(),iterator.next()]";
  let unblock!: () => void;
  let signalEntered!: () => void;
  const pending = new Promise<void>(resolve => { unblock = resolve; });
  const entered = new Promise<void>(resolve => { signalEntered = resolve; });
  const pause = declareHostOperation(async () => { signalEntered(); await pending; }, "re-issue");
  const execution = run(source, { bindings: { pause } });
  void execution.catch(() => undefined);
  let serialized: string;
  try {
    await Promise.race([entered, execution]);
    serialized = await dump(execution, { mode: "replay" });
  } finally { unblock(); }
  const original = await execution;
  const replay = await run(source, { snapshot: restore(JSON.parse(serialized), { source }),
    bindings: { pause: declareHostOperation(async () => undefined, "re-issue") } });
  expect(replay.returnValue).toEqual(original.returnValue);
  expect(replay.returnValue).toEqual([{ value: 1, done: false }, { value: 2, done: false },
    { value: 3, done: false }, { value: undefined, done: true }]);
});

it("rejects execution scopes as forged iterator sources", () => {
  const node = { kind: "array-iterator", source: { kind: "ref", id: 2 }, index: 0, method: "values",
    state: { properties: { properties: [], extensible: true } } };
  expect(() => validateGuestHeapNode(node, { "2": { kind: "scope-frame" } })).toThrow();
});

it("does not charge prototype installation as script execution", async () => {
  expect((await run("return 1", { budget: new Budget({ maxSteps: 2 }) })).returnValue).toBe(1);
});

it("uses internal typed-array length rather than an own length getter", async () => {
  const source = new Float32Array([1, 2]);
  Object.defineProperty(source, "length", { get() { throw new Error("length getter"); } });
  const iterator = restoreSandboxArrayIterator({ source, method: "values", index: 0 });
  expect(await nextArrayIterator(iterator, new Budget())).toEqual({ value: 1, done: false });
});

it("restores a live private cursor from a portable heap snapshot", async () => {
  const source = "await task()";
  const iterator = restoreSandboxArrayIterator({ source: [1, 2, 3], method: "values", index: 1 });
  const snapshot = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { iterator } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restoreGraph(JSON.parse(JSON.stringify(snapshot)), { source });
  const binding = restored.currentScope.lookup("iterator");
  if (!binding.found) throw new Error("Missing iterator");
  expect(await nextArrayIterator(binding.value, restored.budget)).toEqual({ value: 2, done: false });
});

it("accounts for the private source and releases it on exhaustion", async () => {
  const source = ["x".repeat(1000)];
  const iterator = restoreSandboxArrayIterator({ source, method: "values", index: 0 });
  expect(measureSandboxData([iterator])).toBeGreaterThan(1000);
  await nextArrayIterator(iterator, new Budget());
  await nextArrayIterator(iterator, new Budget());
  expect(arrayIteratorState(iterator).source).toBeUndefined();
  expect(measureSandboxData([iterator])).toBeLessThan(1000);
});

it("does not export a live cursor as an empty host object", () => {
  const iterator = restoreSandboxArrayIterator({ source: [1], method: "values", index: 0 });
  expect(() => deepCopyFromSandbox(iterator)).toThrow(/iterators/);
});

it("does not read generic length after exhaustion (ECMAScript 2026)", async () => {
  const source = "let reads=0;const values={0:1,get length(){reads++;return 1}};const iterator=Array.prototype.values.call(values);const initial=reads;iterator.next();iterator.next();iterator.next();return [initial,reads]";
  expect((await run(source)).returnValue).toEqual([0, 2]);
});

it("preserves an iterator cursor and source alias in a completed snapshot", async () => {
  const source = "const values=[1,2];const iterator=values.values();iterator.next();await 0;values.push(3);return [iterator.next(),iterator.next(),iterator.next()]";
  const initial = await run(source);
  const snapshot = restore(JSON.parse(await dump(initial)), { source });
  expect((await run(source, { snapshot })).returnValue).toEqual(initial.returnValue);
});

it.each([
  "return [Array.prototype.values.name,Array.prototype.keys.length,Array.prototype.entries.length,Array.prototype[Symbol.iterator]===Array.prototype.values]",
  "return [Array.prototype].map(value=>value)[0]===Array.prototype",
  "const iterator=[1,2].values();return [iterator.next(),iterator.next(),iterator.next(),iterator.next()]",
  "const iterator=[1,2].values();iterator.index=99;iterator.source=[];iterator.method='keys';Object.freeze(iterator);return [iterator.next(),iterator.next()]",
  "const values=new Float32Array([1,2]);const iterator=Array.prototype.entries.call(values);return [iterator.next(),iterator.next(),iterator.next()]",
  "let reads=0;const values={0:1,get length(){if(reads++===0)throw 'length';return 1}};const iterator=Array.prototype.values.call(values);let failure;try{iterator.next()}catch(error){failure=error}return [failure,iterator.next()]",
  "const iterator=[1,,3].entries();return [iterator.next(),iterator.next(),iterator.next(),iterator.next()]",
  "const values=[1];const iterator=values.values();const first=iterator.next();values.push(2);const second=iterator.next();const end=iterator.next();values.push(3);return [first,second,end,iterator.next()]",
  "const values=[1,2];const iterator=values.values();iterator.next();values.length=0;return iterator.next()",
  "const values={get 0(){throw 1},length:1};const iterator=Array.prototype.keys.call(values);return [iterator.next(),iterator.next()]",
  "const values={0:'first',1:'second',length:2};const iterator=Array.prototype.values.call(values);iterator.next();values[1]='changed';return iterator.next()",
  "const iterator=Array.prototype.values.call('ab');return [iterator.next(),iterator.next(),iterator.next()]",
  "const iterator=[1].values();return [iterator[Symbol.iterator]()===iterator,Object.prototype.toString.call(iterator)]",
  "const next=[1].values().next;try{next.call({})}catch(error){return error.name}",
  "const values=[1,2];const iterator=values.entries();const first=iterator.next().value;const second=iterator.next().value;return [first,second,first!==second]",
  "let entered=false;let iterator;const values={0:'first',1:'second',get length(){if(!entered){entered=true;iterator.next()}return 2}};iterator=Array.prototype.values.call(values);return [iterator.next(),iterator.next()]",
  "const values=[1,2];Object.defineProperty(values,'0',{get(){throw 'failed'}});const iterator=values.values();let error;try{iterator.next()}catch(value){error=value}return [error,iterator.next()]"
])("implements public Array iterators: %s", async source => {
  expect((await run(source)).returnValue).toEqual(new Function(source)());
});
