import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "../interp/budget.js";
import { invokeBuiltinClosure } from "../interp/builtin-call.js";
import { awaitSandboxValue } from "../interp/cancel.js";
import { isSandboxClosure } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each([
  ["let calls=0;const value={};const p=Promise.resolve(value);await p;Object.defineProperty(value,'then',{get(){calls++;return undefined},configurable:true});return ()=>calls", 0],
  ["let p;{const {promise,reject}=Promise.withResolvers();p=promise;reject(p)}try{await p}catch{}return async()=>{try{await p}catch(e){return e===p}}", true],
  ["const value={};const p=Promise.resolve(value);value.p=p;await p;return async()=> (await p).p===p", true],
  ["const p=Promise.resolve(7);Object.defineProperty(p,'label',{value:9});await p;return async()=>[await p,p.label,Object.getOwnPropertyDescriptor(p,'label').writable]", [7,9,false]],
  ["const key=Symbol('label');const p=Promise.resolve(7);p[key]=9;await p;return async()=>[await p,p[key]]", [7,9]],
  ["class C extends Promise{#x=9;read(){return this.#x}}const p=C.resolve(7);await p;return async()=>[await p,p instanceof C,p.read()]", [7,true,9]],
  ["const p=Promise.resolve(7);await p;return async()=>await p", 7],
  ["const p=Promise.reject('reason');try{await p}catch{}return async()=>{try{return await p}catch(e){return e}}", "reason"],
  ["const value={x:7};const p=Promise.resolve(value);await p;return async()=>[(await p)===value,(await p).x]", [true,7]],
  ["class Base{constructor(value){return value}}class C extends Base{#x=9;static read(o){return o.#x}}const p=Promise.resolve(7);new C(p);await p;return async()=>[await p,C.read(p)]", [7,9]]
] as const)("directly restores settled promises captured by closures: %s", async (source, expected) => {
  const result = await run(source);
  assert(result.ok);
  const snapshot = serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{read:result.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const budget = new Budget();
  const binding = restore(JSON.parse(JSON.stringify(snapshot)), {source,budget}).currentScope.lookup("read");
  assert(binding.found && isSandboxClosure(binding.value));
  const value = await invokeBuiltinClosure(binding.value, [], budget, undefined, undefined);
  expect(await awaitSandboxValue(value, undefined, budget)).toEqual(expected);
});

it("rejects a promise snapshot fulfilled directly with itself", async () => {
  const source = "const p=Promise.resolve(7);await p;return async()=>await p";
  const result = await run(source);
  assert(result.ok);
  const snapshot = serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{read:result.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  assert(snapshot.heap !== undefined);
  const entry = Object.entries(snapshot.heap).find(([, node]) => node.kind === "guest-promise");
  assert(entry !== undefined && entry[1].kind === "guest-promise");
  entry[1].value = {kind: "ref", id: Number(entry[0])};
  expect(() => restore(JSON.parse(JSON.stringify(snapshot)), {source, budget: new Budget()})).toThrow();
});
