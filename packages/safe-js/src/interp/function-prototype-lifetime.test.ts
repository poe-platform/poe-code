import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { isSandboxClosure } from "./values.js";

it.each(["function(){}","()=>7","async function(){}","async()=>7","function*(){}","async function*(){}",
  "class {}", "Number", "Object.keys", "Math.max", "(function(){}).bind(null)", "({method(){}}).method"]
  .flatMap(expression=>["initial","later"].map(phase=>({expression,phase}))))(
  "preserves function creation prototypes: $expression $phase", async ({expression,phase}) => {
    const source = `return [()=>(${expression}),(${expression}),Object.getPrototypeOf(${expression})]`;
    const native = runInNewContext(`(()=>{${source}})()`);
    expect(Object.getPrototypeOf(phase === "initial" ? native[1] : native[0]())).toBe(native[2]);
    const values = (await run(source)).returnValue;
    const getter = (await run("return Object.getPrototypeOf")).returnValue;
    if (!Array.isArray(values) || !isSandboxClosure(values[0]) || !isSandboxClosure(getter)) throw new Error("Expected function exports");
    const context = {stack:[],thisValue:undefined};
    const fn = phase === "initial" ? values[1] : await values[0].call([],context);
    expect(await getter.call([fn],context)).toBe(values[2]);
  }
);

it.each(["()=>7","async()=>7","class {}","(function(){}).bind(null)"])(
  "keeps function defaults through replay and replaced globals: %s", async expression => {
    const source = `const prototype=Object.getPrototypeOf(${expression});const make=()=>(${expression});
      globalThis.Function=undefined;await 0;return [make,prototype]`;
    const original = await run(source);
    expect(original.ok).toBe(true);
    const replayed = await run(source,{snapshot:JSON.parse(await dump(original))});
    expect(replayed.ok).toBe(true);
    const getter = (await run("return Object.getPrototypeOf")).returnValue;
    if (!isSandboxClosure(getter)) throw new Error("Expected prototype getter");
    const context = {stack:[],thisValue:undefined};
    for (const result of [original,replayed]) {
      const values = result.returnValue;
      if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Expected factory");
      const fn = await values[0].call([],context);
      expect(await getter.call([fn],context)).toBe(values[1]);
    }
  }
);

it.each(["null","({custom:true})"])("preserves explicit function prototypes: %s", async prototype => {
  const values = (await run(`const fn=()=>7;const prototype=${prototype};Object.setPrototypeOf(fn,prototype);return [fn,prototype]`)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(getter)) throw new Error("Expected exports");
  expect(await getter.call([values[0]],{stack:[],thisValue:undefined})).toBe(values[1]);
});

it("reads inherited function properties from the owning realm", async () => {
  const fn = (await run('Function.prototype.marker="owner";return ()=>7')).returnValue;
  const getter = (await run('Function.prototype.marker="caller";return fn=>fn.marker')).returnValue;
  if (!isSandboxClosure(getter)) throw new Error("Expected property getter");
  expect(await getter.call([fn],{stack:[],thisValue:undefined})).toBe("owner");
});
