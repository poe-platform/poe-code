import { runInNewContext } from "node:vm";
import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { Budget } from "./budget.js";
import { createSandboxCollectionIterator, isSandboxCollectionIterator, nextCollectionIterator } from "./collection-iterator.js";
import { createSandboxClosure, createSandboxSet, measureSandboxData } from "./values.js";
import { accessorAdapter } from "./accessors.js";
import { getSandboxPrototype } from "./object-model.js";
import { validateGuestHeapNode } from "../snapshot/guest-heap-validation.js";

const inputs=["new Set([2,4]).values()","new Map([[2,4]]).entries()"];

it("charges data retained by symbol properties on iterators", () => {
  const iterator=createSandboxCollectionIterator(createSandboxSet(), 'values');
  const before=measureSandboxData([iterator]);
  Object.defineProperty(iterator,Symbol.for('retained'),{value:'x'.repeat(100)});
  expect(measureSandboxData([iterator])).toBe(before+110);
});

it("charges captures retained by iterator accessors without invoking them", () => {
  const iterator=createSandboxCollectionIterator(createSandboxSet(), 'values');
  const before=measureSandboxData([iterator]);
  const getter=createSandboxClosure({call:()=>{throw new Error('Getter executed')},retainedValues:()=>['x'.repeat(100)]});
  Object.defineProperty(iterator,'retained',{get:accessorAdapter(getter,'get')});
  expect(measureSandboxData([iterator])).toBeGreaterThanOrEqual(before+100);
});
const checks=[
  "return [it.next===it.next,typeof it[Symbol.iterator],Object.prototype.toString.call(it)]",
  "return it[Symbol.iterator]()===it",
  "return Object.getPrototypeOf(Object.getPrototypeOf(it))===Object.getPrototypeOf(Object.getPrototypeOf([].values()))",
  "const proto=Object.getPrototypeOf(it);const next=Object.getOwnPropertyDescriptor(proto,'next');const tag=Object.getOwnPropertyDescriptor(proto,Symbol.toStringTag);return [Reflect.ownKeys(it),next.writable,next.enumerable,next.configurable,next.value.name,next.value.length,tag]",
  "const proto=Object.getPrototypeOf(it);const original=proto.next;proto.next=function(){return {value:9,done:true}};return [it.next(),original.call(it)]",
  "delete Object.getPrototypeOf(Object.getPrototypeOf(it))[Symbol.iterator];try{return [...it]}catch(error){return error.name}",
  "delete Object.getPrototypeOf(it).next;return ['next' in it,typeof it.next]",
  "delete Object.getPrototypeOf(it)[Symbol.toStringTag];return Object.prototype.toString.call(it)",
  "const next=Object.getPrototypeOf(it).next;return [{},[].values(),'x'[Symbol.iterator]()].map(value=>{try{next.call(value);return 'accepted'}catch(error){return error.name}})"
];

it.each(inputs.flatMap(input=>checks.map(check=>({input,check}))))("exposes the native iterator prototype for $input: $check",async ({input,check})=>{
  const source="const it="+input+";"+check;
  const expected=runInNewContext("(()=>{"+source+"})()");
  const result=await run(source);
  assert(result.ok);
  expect(result.returnValue).toEqual(expected);
});

it.each([
  {collectionKind:'object'}, {method:'next'}, {index:-1}, {index:0.5},
  {exhausted:'yes'}, {exhausted:false}, {index:1}
])("rejects malformed guest iterator state: %j", invalid => {
  const node={kind:'guest-collection-iterator',collectionKind:'set',method:'values',collection:{kind:'undefined'},index:0,exhausted:true,state:{properties:{properties:[],extensible:true}},...invalid};
  expect(()=>validateGuestHeapNode(node,{},100)).toThrow(TypeError);
});

it.each(inputs)("preserves prototype methods and custom descriptors through public replay: %s",async input=>{
  const source="const it="+input+";Object.defineProperty(it,'self',{get(){return it},configurable:true});it[Symbol.for('note')]=it;const first=it.next();await 0;return [first,it.next(),it.self===it,it[Symbol.for('note')]===it,it.next===Object.getPrototypeOf(it).next,Array.from(it)]";
  const expected=await runInNewContext("(async()=>{"+source+"})()");
  const first=await run(source);
  assert(first.ok);
  expect(first.returnValue).toEqual(expected);
  const replay=await run(source,{snapshot:JSON.parse(await dump(first))});
  assert(replay.ok);
  expect(replay.returnValue).toEqual(expected);
});

it.each(["new Set([2,4]).values()","new Map([[2,4],[6,8]]).entries()"])("restores a consumed cursor, prototype and hidden self property: %s",async input=>{
  const source="const it="+input+";Object.defineProperty(it,'self',{value:it});it.next();return it";
  const result=await run(source);
  assert(result.ok);
  assert(isSandboxCollectionIterator(result.returnValue));
  const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:'external',bindings:{it:result.returnValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget=new Budget();
  const binding=restore(JSON.parse(JSON.stringify(snapshot)),{source,budget}).currentScope.lookup('it');
  assert(binding.found);
  assert(isSandboxCollectionIterator(binding.value));
  const iterator=binding.value;
  expect(Object.getOwnPropertyDescriptor(iterator,'self')).toMatchObject({value:iterator,enumerable:false,writable:false,configurable:false});
  expect(getSandboxPrototype(iterator,budget)).not.toBeNull();
  expect(nextCollectionIterator(iterator,budget)).toEqual({value:input.startsWith('new Set')?4:[6,8],done:false});
});
