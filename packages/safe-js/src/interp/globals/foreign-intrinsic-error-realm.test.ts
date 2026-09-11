import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { isSandboxClosure } from "../values.js";

it.each([
  {name:"Function",expression:"Function",call:'C("return )")',error:"SyntaxError"},
  {name:"AsyncFunction",expression:"(async function(){}).constructor",call:'C("await )")',error:"SyntaxError"},
  {name:"GeneratorFunction",expression:"(function*(){}).constructor",call:'C("yield )")',error:"SyntaxError"},
  {name:"AsyncGeneratorFunction",expression:"(async function*(){}).constructor",call:'C("yield )")',error:"SyntaxError"},
  {name:"eval",expression:"eval",call:'C(")")',error:"SyntaxError"},
  {name:"Array",expression:"Array",call:"C(-1)",error:"RangeError"},
  {name:"RegExp",expression:"RegExp",call:'C("[")',error:"SyntaxError"},
  {name:"Number.toFixed",expression:"Number.prototype.toFixed",call:"C.call(1,101)",error:"RangeError"},
  {name:"Map.get",expression:"Map.prototype.get",call:"C.call({})",error:"TypeError"},
  {name:"JSON.parse",expression:"JSON.parse",call:'C("{")',error:"SyntaxError"},
  {name:"Object.keys",expression:"Object.keys",call:"C(null)",error:"TypeError"}
])("creates borrowed $name errors in the intrinsic owner realm", async ({expression,call,error}) => {
  const source = `return C=>{try{${call}}catch(e){return Object.getPrototypeOf(e)}}`;
  const ownerSource = `return [${expression},${error}.prototype]`;
  const nativeCaller = runInNewContext(`(()=>{${source}})()`);
  const nativeOwner = runInNewContext(`(()=>{${ownerSource}})()`);
  expect(nativeCaller(nativeOwner[0])).toBe(nativeOwner[1]);
  const caller = (await run(source)).returnValue;
  const owner = (await run(ownerSource)).returnValue;
  if (!isSandboxClosure(caller) || !Array.isArray(owner)) throw new Error("Expected exports");
  expect(await caller.call([owner[0]],{stack:[],thisValue:undefined}) === owner[1]).toBe(true);
});

it.each(["C","C.bind(null)","new Proxy(C,{})"])("retains foreign parser error prototypes after replay: %s", async target => {
  const source = 'const C=JSON.parse;const prototype=SyntaxError.prototype;globalThis.SyntaxError=undefined;globalThis.JSON=undefined;await 0;return [C,prototype]';
  const original = await run(source);
  expect(original.ok).toBe(true);
  const replayed = await run(source,{snapshot:JSON.parse(await dump(original))});
  expect(replayed.ok).toBe(true);
  const caller = (await run(`return C=>{try{(${target})('{')}catch(e){return Object.getPrototypeOf(e)}}`)).returnValue;
  if (!isSandboxClosure(caller)) throw new Error("Expected caller");
  for (const result of [original,replayed]) {
    const owner = result.returnValue;
    if (!Array.isArray(owner)) throw new Error("Expected owner exports");
    expect(await caller.call([owner[0]],{stack:[],thisValue:undefined}) === owner[1]).toBe(true);
  }
});

it.each([
  {expression:"Array.from",call:"C([1],()=>missingFromCaller)",error:"ReferenceError"},
  {expression:"Number",call:"C({get valueOf(){throw new TypeError('caller getter')}})",error:"TypeError"}
])("preserves caller error realms inside borrowed $expression", async ({expression,call,error}) => {
  const source = `return C=>{try{${call}}catch(e){return Object.getPrototypeOf(e)===${error}.prototype}}`;
  const nativeCaller = runInNewContext(`(()=>{${source}})()`);
  expect(nativeCaller(runInNewContext(expression))).toBe(true);
  const caller = (await run(source)).returnValue;
  const owner = (await run(`return ${expression}`)).returnValue;
  if (!isSandboxClosure(caller) || !isSandboxClosure(owner)) throw new Error("Expected exports");
  expect(await caller.call([owner],{stack:[],thisValue:undefined})).toBe(true);
});

it("preserves a caller error thrown during foreign Number coercion", async () => {
  const source = 'return C=>{const sentinel=new TypeError("caller");try{C({valueOf(){throw sentinel}})}catch(e){return e===sentinel}}';
  const ownerSource = 'return Number';
  const nativeCaller = runInNewContext(`(()=>{${source}})()`);
  const nativeOwner = runInNewContext(`(()=>{${ownerSource}})()`);
  expect(nativeCaller(nativeOwner)).toBe(true);
  const caller = (await run(source)).returnValue;
  const owner = (await run(ownerSource)).returnValue;
  if (!isSandboxClosure(caller) || !isSandboxClosure(owner)) throw new Error("Expected exports");
  expect(await caller.call([owner],{stack:[],thisValue:undefined})).toBe(true);
});
