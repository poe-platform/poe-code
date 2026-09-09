import { expect, it } from "vitest";
import { run } from "../../run.js";
import { getSandboxPropertyDescriptor } from "../object-model.js";
import { isSandboxClosure } from "../values.js";

it.each([
  'new Proxy({*[Symbol.iterator](){yield 7;yield 9}}, {})',
  '({[Symbol.iterator]:new Proxy(function*(){yield 7;yield 9},{apply(t,r,a){return Reflect.apply(t,r,a)}})})',
  'new Proxy({next(){return {done:false,value:7}}}, {})',
  '({next:new Proxy(()=>({done:false,value:7}),{apply(t,r,a){return Reflect.apply(t,r,a)}})})',
  'Object.create(new Proxy({next(){return {done:false,value:7}}},{}))'
])("observes SDK Iterator.from Proxy operations: %s", async input => {
  const native = new Function(`return Iterator.from(${input}).next()`)();
  expect(native).toEqual({done:false,value:7});
  const values = (await run(`return [Iterator.from,${input}]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Expected SDK method");
  const iterator = await values[0].call([values[1]], {stack:[],thisValue:undefined});
  const next = getSandboxPropertyDescriptor(iterator,"next")?.value;
  if (!isSandboxClosure(next)) throw new Error("Expected iterator next");
  expect(await next.call([], {stack:[],thisValue:iterator})).toEqual(native);
});

it("caches next and reads return lazily in SDK Proxy wrappers", async () => {
  const setup = 'const events=[];const input=new Proxy({next(){events.push(this===input?"next":"wrong receiver");return {done:false,value:7}}},{get(t,k,r){events.push(String(k));return Reflect.get(t,k,r)}});';
  const native = new Function(`${setup}const iterator=Iterator.from(input);input.next=()=>({done:false,value:99});input.return=new Proxy(function(){events.push(this===input?"return":"wrong receiver");return {done:true,value:9}},{});return [iterator.next(),iterator.return(),events]`)();
  const values = (await run(`${setup}return [Iterator.from,input,events,()=>{input.next=()=>({done:false,value:99});input.return=new Proxy(function(){events.push(this===input?"return":"wrong receiver");return {done:true,value:9}},{});} ]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0]) || !isSandboxClosure(values[3])) throw new Error("Expected SDK closures");
  const iterator = await values[0].call([values[1]], {stack:[],thisValue:undefined});
  await values[3].call([], {stack:[],thisValue:undefined});
  const next = getSandboxPropertyDescriptor(iterator,"next")?.value;
  const close = getSandboxPropertyDescriptor(iterator,"return")?.value;
  if (!isSandboxClosure(next) || !isSandboxClosure(close)) throw new Error("Expected wrapper methods");
  expect([await next.call([], {stack:[],thisValue:iterator}),await close.call([], {stack:[],thisValue:iterator}),values[2]]).toEqual(native);
});

it("rejects an SDK iterator revoked after wrapping", async () => {
  const setup = 'const pair=Proxy.revocable({next(){return {done:false,value:7}}},{});';
  expect(() => new Function(`${setup}const iterator=Iterator.from(pair.proxy);pair.revoke();return iterator.return()`)()).toThrow(TypeError);
  const values = (await run(`${setup}return [Iterator.from,pair.proxy,pair.revoke]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0]) || !isSandboxClosure(values[2])) throw new Error("Expected SDK closures");
  const iterator = await values[0].call([values[1]], {stack:[],thisValue:undefined});
  await values[2].call([], {stack:[],thisValue:undefined});
  const close = getSandboxPropertyDescriptor(iterator,"return")?.value;
  if (!isSandboxClosure(close)) throw new Error("Expected wrapper return");
  await expect(close.call([], {stack:[],thisValue:iterator})).rejects.toThrow(TypeError);
});
