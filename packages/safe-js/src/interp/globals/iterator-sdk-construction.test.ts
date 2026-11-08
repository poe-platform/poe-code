import { expect, it } from "vitest";
import { run } from "../../run.js";
import { getSandboxPrototype } from "../object-model.js";
import { isSandboxClosure } from "../values.js";

it.each([
  'new Proxy(Target,{get(t,k,r){return k==="prototype"?prototype:Reflect.get(t,k,r)}})',
  'new Proxy(new Proxy(Target,{get(t,k,r){return k==="prototype"?prototype:Reflect.get(t,k,r)}}),{})',
  'new Proxy(Target,{get get(){return (t,k,r)=>k==="prototype"?prototype:Reflect.get(t,k,r)}})'
])("uses SDK Iterator newTarget prototype: %s", async target => {
  const setup = `const prototype={marker:7};function Target(){};const NewTarget=${target};`;
  expect(new Function(`${setup}return Object.getPrototypeOf(Reflect.construct(Iterator,[],NewTarget))===prototype`)()).toBe(true);
  const values = (await run(`${setup}return [Iterator,NewTarget,prototype]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0]) || !isSandboxClosure(values[1])) throw new Error("Expected SDK constructors");
  const output = await values[0].construct!([], {stack:[],thisValue:undefined,newTarget:values[1]});
  expect(getSandboxPrototype(output)).toBe(values[2]);
});

it.each(["undefined", "null", "7"])("uses the SDK Iterator intrinsic fallback for %s", async prototype => {
  const setup = `function Target(){};Target.prototype=${prototype};`;
  expect(new Function(`${setup}return Object.getPrototypeOf(Reflect.construct(Iterator,[],Target))===Iterator.prototype`)()).toBe(true);
  const values = (await run(`${setup}return [Iterator,Target,Iterator.prototype]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0]) || !isSandboxClosure(values[1])) throw new Error("Expected SDK constructors");
  expect(getSandboxPrototype(await values[0].construct!([], {stack:[],thisValue:undefined,newTarget:values[1]}))).toBe(values[2]);
});

it("keeps SDK Iterator construction abstract", async () => {
  expect(() => new Function("return new Iterator()")()).toThrow(TypeError);
  const value = (await run("return Iterator")).returnValue;
  if (!isSandboxClosure(value)) throw new Error("Expected SDK constructor");
  await expect(value.construct!([], {stack:[],thisValue:undefined,newTarget:value})).rejects.toThrow(TypeError);
});

it("rejects revoked SDK Iterator newTarget", async () => {
  const setup = 'const pair=Proxy.revocable(function(){},{});pair.revoke();';
  expect(() => new Function(`${setup}return Reflect.construct(Iterator,[],pair.proxy)`)()).toThrow(TypeError);
  const values = (await run(`${setup}return [Iterator,pair.proxy]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0]) || !isSandboxClosure(values[1])) throw new Error("Expected SDK constructors");
  await expect(values[0].construct!([], {stack:[],thisValue:undefined,newTarget:values[1]})).rejects.toThrow(TypeError);
});
