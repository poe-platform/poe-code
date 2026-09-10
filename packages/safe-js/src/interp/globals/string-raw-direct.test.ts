import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { Budget } from "../budget.js";
import { createSandboxClosure, type SandboxClosure } from "../values.js";
import { setSandboxPrototype } from "../object-model.js";
import { createObjectArrayGlobals } from "./object-array.js";

it.each([false, true])("rejects Symbol raw text or substitution: %s", async substitution => {
  const raw = createObjectArrayGlobals({ budget: new Budget() }).String.properties!.raw as SandboxClosure;
  await expect(async () => await raw.call(substitution ? [{ raw: ["a", "b"] }, Symbol()] : [{ raw: [Symbol()] }])).rejects.toThrow(TypeError);
});

it("accepts an array-like raw object", async () => {
  const raw = createObjectArrayGlobals({ budget: new Budget() }).String.properties!.raw as SandboxClosure;
  expect(await raw.call([{ raw: { 0: "a", 1: "b", length: 2 } }, 3])).toBe("a3b");
});

it("accepts a primitive raw string", async () => {
  const raw = createObjectArrayGlobals({ budget: new Budget() }).String.properties!.raw as SandboxClosure;
  expect(await raw.call([{ raw: "ab" }, 3])).toBe("a3b");
});

it("reads inherited guest raw properties", async () => {
  const budget = new Budget();
  const raw = createObjectArrayGlobals({ budget }).String.properties!.raw as SandboxClosure;
  const template = {};
  setSandboxPrototype(template, { raw: ["a", "b"] }, budget);
  expect(await raw.call([template, 3])).toBe("a3b");
});

it("uses guest string coercion for raw entries and substitutions", async () => {
  const raw = createObjectArrayGlobals({ budget: new Budget() }).String.properties!.raw as SandboxClosure;
  const value = { toString: createSandboxClosure({ sandbox: true, name: "toString", call: () => "guest" }) };
  expect(await raw.call([{ raw: [value, "!"] }, value])).toBe("guestguest!");
});

it("bounds direct raw iteration even when the output is empty", async () => {
  const budget = new Budget({ maxSteps: 2 });
  const raw = createObjectArrayGlobals({ budget }).String.properties!.raw as SandboxClosure;
  await expect(async () => await raw.call([{ raw: ["", "", ""] }])).rejects.toMatchObject({ code: "budgetExceeded" });
  expect([...budget.retainedValues()]).toEqual([]);
});

it.each([0, -1, NaN, 1.9, 2, "2", null, undefined])("converts raw length once: %s", async length => {
  const raw = createObjectArrayGlobals({ budget: new Budget() }).String.properties!.raw as SandboxClosure;
  const template = { raw: { 0: "a", 1: "b", length } };
  expect(await raw.call([template, "-"])).toBe(String.raw(template as unknown as TemplateStringsArray, "-"));
});

it("propagates guest coercion failure before later entries", async () => {
  const budget = new Budget();
  const raw = createObjectArrayGlobals({ budget }).String.properties!.raw as SandboxClosure;
  const value = { toString: createSandboxClosure({ sandbox: true, name: "toString", call: () => { throw "stop"; } }) };
  await expect(raw.call([{ raw: ["a", value, Symbol()] }, "-"])).rejects.toBe("stop");
  expect([...budget.retainedValues()]).toEqual([]);
});

it.each([
  `const log=[]; const raw=new Proxy({0:'a',1:'b',length:2},{get(t,k){log.push(k);return t[k]}}); return [String.raw({raw},'-'),log]`,
  `const log=[]; const raw={0:'a',1:'b',get length(){log.push('length');return {valueOf(){log.push('number');return 2}}}}; return [String.raw({raw},{toString(){log.push('sub');raw[1]='c';return '-'}}),log]`,
  `Object.defineProperty(Number.prototype,'raw',{get(){'use strict';return [typeof this,Object.prototype.toString.call(this)]}}); return String.raw(3,'-')`,
  `Object.defineProperty(Number.prototype,'length',{get(){'use strict';if(typeof this!=='object')throw 'unboxed';return 0}}); return String.raw({raw:3})`,
  `return String.raw({raw:{length:0}},Symbol())`,
  `try{return String.raw({raw:{length:1n}})}catch(e){return e.name}`,
  `const raw=[{toString(){raw.length=0;return 'a'}},'b'];return String.raw({raw},'-')`,
  `const log=[];Promise.resolve().then(()=>log.push('job'));log.push(String.raw({raw:['a','b']},{toString(){log.push('sub');return '-'}}));await 0;return log`
])("preserves guest String.raw semantics: %s", async source => {
  const expected = await runInNewContext(`(async()=>{${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it("replays raw conversion effects without repeating host calls", async () => {
  const source = `const result=String.raw({raw:['a','b']},{toString(){return text()}});await 0;return result`;
  let calls = 0;
  const bindings = { text() { calls++; return "-"; } };
  const first = await run(source, { bindings });
  expect(first).toMatchObject({ ok: true, returnValue: "a-b" });
  expect(await run(source, { bindings, snapshot: JSON.parse(await dump(first)) })).toMatchObject({ ok: true, returnValue: "a-b" });
  expect(calls).toBe(1);
});
