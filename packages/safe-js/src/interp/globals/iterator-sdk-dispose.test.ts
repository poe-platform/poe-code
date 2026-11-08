import { expect, it } from "vitest";
import { run } from "../../run.js";
import { isSandboxClosure } from "../values.js";

it.each([
  'new Proxy({return(){events.push(this===input?"closed":"wrong receiver")}}, {})',
  '({return:new Proxy(function(){events.push(this===input?"closed":"wrong receiver")},{apply(t,r,a){return Reflect.apply(t,r,a)}})})',
  'Object.create(new Proxy({get return(){events.push(this===input?"get":"wrong receiver");return function(){events.push(this===input?"closed":"wrong receiver")}}},{}))',
  'new Proxy({return(){events.push("closed")}}, {get get(){return (t,k,r)=>Reflect.get(t,k,r)}})'
])("observes SDK Iterator disposal: %s", async input => {
  const setup = `const events=[];const input=${input};`;
  // Node 22 may not expose iterator disposal; use the specified ordinary
  // property-read/call sequence as a native receiver and trap control.
  const native = new Function(`${setup}const method=input.return;if(method!=null)Reflect.apply(method,input,[]);return events`)();
  const values = (await run(`${setup}return [Iterator.prototype[Symbol.dispose],input,events]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Expected SDK dispose");
  expect(await values[0].call([], {stack:[],thisValue:values[1]})).toBeUndefined();
  expect(values[2]).toEqual(native);
});

it.each(["{}", "{return:null}", "{return:undefined}", "{return(){return 7}}"])("returns undefined for SDK disposal of %s", async input => {
  const values = (await run(`return [Iterator.prototype[Symbol.dispose],${input}]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Expected SDK dispose");
  expect(await values[0].call([], {stack:[],thisValue:values[1]})).toBeUndefined();
});

it.each([
  'new Proxy({return:7},{})',
  '(()=>{const pair=Proxy.revocable({},{});pair.revoke();return pair.proxy})()',
  '({return:(()=>{const pair=Proxy.revocable(function(){},{});pair.revoke();return pair.proxy})()})'
])("rejects invalid or revoked SDK disposal: %s", async input => {
  const values = (await run(`return [Iterator.prototype[Symbol.dispose],${input}]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Expected SDK dispose");
  await expect(values[0].call([], {stack:[],thisValue:values[1]})).rejects.toThrow(TypeError);
});
