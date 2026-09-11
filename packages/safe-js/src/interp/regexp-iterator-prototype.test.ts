import { runInNewContext } from "node:vm";
import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { Budget } from "./budget.js";
import { getSandboxPrototype } from "./object-model.js";
import { isSandboxRegExpIterator, restoreSandboxRegExpIterator } from "./regexp-iterator.js";
import { nextRegExpIterator } from "./methods/regexp-iterator.js";
import { createSandboxClosure, measureSandboxData } from "./values.js";
import { accessorAdapter } from "./accessors.js";
import { validateGuestHeapNode } from "../snapshot/guest-heap-validation.js";

const inputs=["'ab'.matchAll(/./g)","(/./g)[Symbol.matchAll]('ab')",
  "RegExp.prototype[Symbol.matchAll].call({flags:'g',lastIndex:0,constructor:{[Symbol.species]:function(){return {lastIndex:0,exec(text){const index=this.lastIndex++;return index<text.length?Object.assign([text[index]],{index,input:text}):null}}}}},'ab')"];
const checks=[
  "return [it.next===it.next,it[Symbol.iterator]===it[Symbol.iterator],it[Symbol.iterator]()===it,Object.prototype.toString.call(it)]",
  "return Object.getPrototypeOf(Object.getPrototypeOf(it))===Object.getPrototypeOf(Object.getPrototypeOf([].values()))",
  "const proto=Object.getPrototypeOf(it);const next=Object.getOwnPropertyDescriptor(proto,'next');const tag=Object.getOwnPropertyDescriptor(proto,Symbol.toStringTag);return [Reflect.ownKeys(it),next.writable,next.enumerable,next.configurable,next.value.name,next.value.length,tag]",
  "const proto=Object.getPrototypeOf(it);const original=proto.next;proto.next=function(){return {value:9,done:true}};return [it.next(),original.call(it)]",
  "delete Object.getPrototypeOf(it).next;return ['next' in it,typeof it.next]",
  "delete Object.getPrototypeOf(Object.getPrototypeOf(it))[Symbol.iterator];try{return [...it]}catch(error){return error.name}",
  "const next=Object.getPrototypeOf(it).next;return [{},[].values(),'x'[Symbol.iterator]()].map(value=>{try{next.call(value);return 'accepted'}catch(error){return error.name}})"
];

it.each(inputs.flatMap(input=>checks.map(check=>({input,check}))))("exposes the native RegExp iterator prototype for $input: $check",async ({input,check})=>{
  const source="const it="+input+";"+check;
  const expected=runInNewContext("(()=>{"+source+"})()");
  const result=await run(source);
  assert(result.ok);
  expect(result.returnValue).toEqual(expected);
});

it.each(inputs)("preserves custom properties and matcher state in public replay: %s", async input=>{
  const source="const it="+input+";Object.defineProperty(it,'self',{get(){return it}});it[Symbol.for('note')]=it;const first=it.next();await 0;return [first,it.next(),it.self===it,it[Symbol.for('note')]===it,it.next===Object.getPrototypeOf(it).next,it.next().done]";
  const expected=await runInNewContext("(async()=>{"+source+"})()");
  const first=await run(source);
  assert(first.ok);
  expect(first.returnValue).toEqual(expected);
  const replay=await run(source,{snapshot:JSON.parse(await dump(first))});
  assert(replay.ok);
  expect(replay.returnValue).toEqual(expected);
});

it("restores a consumed cursor, prototype and hidden self reference",async()=>{
  const source="const it='ab'.matchAll(/./g);Object.defineProperty(it,'self',{value:it});it.next();return it";
  const result=await run(source);
  assert(result.ok);
  assert(isSandboxRegExpIterator(result.returnValue));
  const snapshot=serialize({source,currentAstNodeId:1,scopeChain:[{id:'external',bindings:{it:result.returnValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget=new Budget();
  const binding=restore(JSON.parse(JSON.stringify(snapshot)),{source,budget}).currentScope.lookup('it');
  assert(binding.found);
  assert(isSandboxRegExpIterator(binding.value));
  expect(getSandboxPrototype(binding.value,budget)).not.toBeNull();
  expect(Object.getOwnPropertyDescriptor(binding.value,'self')).toMatchObject({value:binding.value,enumerable:false,writable:false,configurable:false});
  const next=nextRegExpIterator(binding.value,budget);
  assert(Array.isArray(next.value));
  expect(next.value[0]).toBe('b');
  expect(nextRegExpIterator(binding.value,budget)).toEqual({value:undefined,done:true});
});

it("charges accessor captures without invoking getters",()=>{
  const iterator=restoreSandboxRegExpIterator({matcher:undefined,input:undefined,exhausted:true});
  const before=measureSandboxData([iterator]);
  const getter=createSandboxClosure({call:()=>{throw new Error('Getter executed')},retainedValues:()=>['x'.repeat(100)]});
  Object.defineProperty(iterator,'retained',{get:accessorAdapter(getter,'get')});
  expect(measureSandboxData([iterator])).toBeGreaterThanOrEqual(before+100);
});

it("counts symbol properties once",()=>{
  const iterator=restoreSandboxRegExpIterator({matcher:undefined,input:undefined,exhausted:true});
  const before=measureSandboxData([iterator]);
  Object.defineProperty(iterator,Symbol.for('retained'),{value:'x'.repeat(100)});
  expect(measureSandboxData([iterator])).toBe(before+110);
});

it.each([
  {input:7}, {exhausted:'yes'}, {exhausted:false}, {matcher:7},
  {global:true}, {unicode:false}, {global:'yes',unicode:false},
  {matcher:{kind:'ref',id:7}}
])("rejects malformed guest RegExp iterator state: %j", invalid=>{
  const node={kind:'guest-regexp-iterator',matcher:{kind:'undefined'},input:{kind:'undefined'},exhausted:true,state:{properties:{properties:[],extensible:true}},...invalid};
  expect(()=>validateGuestHeapNode(node,{},100)).toThrow(TypeError);
});
