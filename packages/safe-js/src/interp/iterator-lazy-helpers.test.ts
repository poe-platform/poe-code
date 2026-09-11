import { runInNewContext } from "node:vm";
import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { iteratorHelperStates } from "./iterator-helper.js";
import { isSandboxClosure, measureSandboxData } from "./values.js";
import { getSandboxPropertyDescriptor } from "./object-model.js";
import { invokeBuiltinClosure } from "./builtin-call.js";
import { serialize, type RuntimeSnapshotValue } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { Budget } from "./budget.js";
import { validateGuestHeapNode } from "../snapshot/guest-heap-validation.js";

const cases=[
  "return [Object.prototype.toString.call([].values().map(x=>x)),Reflect.ownKeys([].values().take(1)),Iterator.prototype.map.length]",
  "return [1,2,3].values().take(1.9).toArray()",
  "return [1,2,3].values().drop(1.9).toArray()",
  "return [1,2,3].values().take(-0.5).toArray()",
  "return [1,2,3].values().drop(Infinity).toArray()",
  "const log=[];const source={i:0,next(){log.push(arguments.length);return {value:this.i++,done:false}},return(){log.push(arguments.length);return {done:true}}};const it=Iterator.prototype.map.call(source,x=>x);source.next=()=>{throw 99};const first=it.next(7);it.return(8);return [first,log]",
  "const log=[];const source={i:0,next(){const i=this.i++;return {done:i>2,get value(){log.push(i);return i}}}};return [Iterator.prototype.drop.call(source,2).toArray(),log]",
  "const log=[];const source={next(){return {value:1,done:false}},return(){log.push('closed');throw 'cleanup'}};const it=Iterator.prototype.map.call(source,()=>{throw 'callback'});let error;try{it.next()}catch(e){error=e}return [error,log,it.next()]",
  "const log=[];const source={next(){throw 'step'},return(){log.push('closed');return {done:true}}};const it=Iterator.prototype.filter.call(source,()=>true);let error;try{it.next()}catch(e){error=e}return [error,log,it.next()]",
  "let it;const log=[];it=[1].values().map(value=>{try{it.next()}catch(e){log.push(e.name)}return value});return [it.next(),log]",
  "let it;const log=[];it=[1].values().map(value=>{try{it.return()}catch(e){log.push(e.name)}return value});return [it.next(),log]",
  "const next=[].values().map(x=>x).next;try{next.call({})}catch(e){return e.name}",
  "const log=[];const it=[1,2].values().map(function(value,index){log.push([this,value,index,arguments.length]);return value});return [it.toArray(),log]",
  "const log=[];const source={next(){return {value:1,done:false}},return(){log.push('outer');return {done:true}}};const it=Iterator.prototype.flatMap.call(source,()=>({next(){throw 'inner'}}));let error;try{it.next()}catch(e){error=e}return [error,log]",
  "const log=[];const source={next(){return {value:1,done:false}},return(){log.push('outer');throw 'outer'}};const it=Iterator.prototype.flatMap.call(source,()=>({next(){return {value:2,done:false}},return(){log.push('inner');throw 'inner'}}));it.next();let error;try{it.return()}catch(e){error=e}return [error,log,it.next()]",
  "return [1,2,3].values().map((value,index)=>value+index).toArray()",
  "return [1,2,3].values().filter(value=>value>1).toArray()",
  "return [1,2,3].values().take(2).toArray()",
  "return [1,2,3].values().drop(2).toArray()",
  "return [1,2].values().flatMap(value=>[value,value+1]).toArray()",
  "const log=[];const source={next(){log.push('next');return {value:1,done:false}},return(){log.push('return');return {done:true}}};const it=Iterator.prototype.map.call(source,value=>value);const before=log.slice();it.return();return [before,log]",
  "const events=[];function* source(){try{yield 1;yield 2}finally{events.push('closed')}}const it=source().map(value=>value*2);return [it.next(),it.return(),it.next(),events]",
  "const events=[];function* outer(){try{yield [1,2];yield [3]}finally{events.push('outer')}}function* inner(values){try{yield* values}finally{events.push('inner')}}const it=outer().flatMap(inner);const first=it.next();it.return();return [first,events]"
];

it.each(cases)("implements standard lazy iterator behavior: %s",async source=>{
  const expected=runInNewContext("(()=>{'use strict';"+source+"})()");
  const result=await run(source);
  assert(result.ok);
  expect(result.returnValue).toEqual(expected);
});

it("rejects structured cloning of a lazy helper", async () => {
  const result = await run("const it=[1].values().map(x=>x);try{structuredClone(it);return 'cloned'}catch(error){return error.name}");
  assert(result.ok);
  expect(result.returnValue).toBe("DataCloneError");
});

it.each(["map(value=>value*2)", "flatMap(value=>[value,value*10])", "take(Infinity)"])("replays %s across await", async expression => {
  const source = "const it=[1,2,3].values()." + expression + ";const first=it.next();await 0;return [first,it.toArray()]";
  const expected = await runInNewContext("(async()=>{" + source + "})()");
  const result = await run(source);
  assert(result.ok);
  expect(result.returnValue).toEqual(expected);
  const replay = await run(source, { snapshot: JSON.parse(await dump(result)) });
  assert(replay.ok);
  expect(replay.returnValue).toEqual(expected);
});

it.each([
  ["map(value=>value*2)", "map", 1, [4, 6]],
  ["filter(value=>value>1)", "filter", 2, [3]],
  ["take(2)", "take", 0, [2]],
  ["take(Infinity)", "take", 0, [2, 3]],
  ["drop(1)", "drop", 0, [3]],
  ["flatMap(value=>[value,value*10])", "flatMap", 1, [10, 2, 20, 3, 30]]
] as const)("resumes %s through a JSON snapshot", async (expression, method, index, remaining) => {
  const source = "const it=[1,2,3].values()." + expression + ";it.next();return it";
  const result = await run(source);
  assert(result.ok);
  const snapshot = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "external", bindings: { it: result.returnValue as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const budget = new Budget();
  const binding = restore(JSON.parse(JSON.stringify(snapshot)), { source, budget }).currentScope.lookup("it");
  assert(binding.found);
  assert(binding.value !== null && typeof binding.value === "object");
  const state = iteratorHelperStates.get(binding.value);
  expect(state?.status).toBe("yield");
  expect(state?.index).toBe(index);
  expect(state?.method).toBe(method);
  const descriptor = getSandboxPropertyDescriptor(binding.value, "next", budget);
  assert(descriptor !== undefined && "value" in descriptor && isSandboxClosure(descriptor.value));
  for (const value of remaining)
    expect(await invokeBuiltinClosure(descriptor.value, [], budget, undefined, binding.value)).toEqual({ value, done: false });
  expect(await invokeBuiltinClosure(descriptor.value, [], budget, undefined, binding.value)).toEqual({ value: undefined, done: true });
});

it.each([
  { status: "executing" }, { method: "unknown" }, { index: -1 },
  { remaining: -1 }, { remaining: 0.5 }, { remaining: null },
  { outer: { iterator: { kind: "ref", id: 99 }, next: { kind: "undefined" } } },
  { callback: 7 }
])("rejects malformed helper snapshots: %j", patch => {
  const node = { kind: "iterator-helper", method: "map", status: "done", index: 0,
    remaining: 0, callback: { kind: "undefined" },
    state: { properties: { properties: [], extensible: true } }, ...patch };
  expect(() => validateGuestHeapNode(node, {})).toThrow(TypeError);
});

it.each(["outer", "inner", "callback"] as const)("charges private helper %s retention to the data budget", field => {
  const helper = {};
  const payload = "x".repeat(200);
  iteratorHelperStates.set(helper, {
    method: "flatMap", status: "yield", remaining: 0, index: 1,
    outer: { iterator: field === "outer" ? { payload } : {}, next: undefined },
    inner: field === "inner" ? { iterator: { payload }, next: undefined } : undefined,
    callback: field === "callback" ? payload : undefined
  });
  expect(measureSandboxData([helper])).toBeGreaterThanOrEqual(200);
});
