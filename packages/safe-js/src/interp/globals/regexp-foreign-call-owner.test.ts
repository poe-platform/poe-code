import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { isSandboxClosure } from "../values.js";

it.each(["abc","["])("calls foreign RegExp without a mismatched compilation owner: %s", async pattern => {
  const source = `return C=>{try{return C(${JSON.stringify(pattern)}).test("abc")}catch(e){return e.name}}`;
  const nativeCaller = runInNewContext(`(()=>{${source}})()`);
  const nativeConstructor = runInNewContext("RegExp");
  const expected = nativeCaller(nativeConstructor);
  expect(expected).toBe(pattern === "abc" ? true : "SyntaxError");
  const caller = (await run(source)).returnValue;
  const owner = (await run("return RegExp")).returnValue;
  if (!isSandboxClosure(caller) || !isSandboxClosure(owner)) throw new Error("Expected exports");
  expect(await caller.call([owner],{stack:[],thisValue:undefined})).toBe(expected);
});

it.each(["C","C.bind(null)","new Proxy(C,{})"])("supports foreign RegExp after replay: %s", async target => {
  const source = 'const C=RegExp;globalThis.RegExp=undefined;await 0;return C';
  const original = await run(source);
  expect(original.ok).toBe(true);
  const replayed = await run(source,{snapshot:JSON.parse(await dump(original))});
  expect(replayed.ok).toBe(true);
  const caller = (await run(`return C=>(${target})('abc','i').test('ABC')`)).returnValue;
  if (!isSandboxClosure(caller)) throw new Error("Expected caller");
  for (const result of [original,replayed]) {
    expect(await caller.call([result.returnValue],{stack:[],thisValue:undefined})).toBe(true);
  }
});

it("preserves caller coercion errors through foreign RegExp construction", async () => {
  const source = 'return C=>{const sentinel=new TypeError("caller");try{new C({toString(){throw sentinel}})}catch(e){return e===sentinel}}';
  expect(runInNewContext(`(()=>{${source}})()`)(runInNewContext("RegExp"))).toBe(true);
  const caller = (await run(source)).returnValue;
  const owner = (await run("return RegExp")).returnValue;
  if (!isSandboxClosure(caller) || !isSandboxClosure(owner)) throw new Error("Expected exports");
  expect(await caller.call([owner],{stack:[],thisValue:undefined})).toBe(true);
});

it.each(["new C('abc')", "C.bind(null)('abc')", "new Proxy(C,{})('abc')"])("supports foreign RegExp invocation: %s", async expression => {
  const source = `return C=>${expression}.test('abc')`;
  const nativeCaller = runInNewContext(`(()=>{${source}})()`);
  expect(nativeCaller(runInNewContext("RegExp"))).toBe(true);
  const caller = (await run(source)).returnValue;
  const owner = (await run("return RegExp")).returnValue;
  if (!isSandboxClosure(caller) || !isSandboxClosure(owner)) throw new Error("Expected exports");
  expect(await caller.call([owner],{stack:[],thisValue:undefined})).toBe(true);
});

it("supports a borrowed RegExp compile method", async () => {
  const source = "return compile=>{const regex=/before/;compile.call(regex,'after','i');return [regex.source,regex.flags,regex.test('AFTER')]}";
  const nativeCaller = runInNewContext(`(()=>{${source}})()`);
  expect(nativeCaller(runInNewContext("RegExp.prototype.compile"))).toEqual(["after","i",true]);
  const caller = (await run(source)).returnValue;
  const owner = (await run("return RegExp.prototype.compile")).returnValue;
  if (!isSandboxClosure(caller) || !isSandboxClosure(owner)) throw new Error("Expected exports");
  expect(await caller.call([owner],{stack:[],thisValue:undefined})).toEqual(["after","i",true]);
});
