import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, defineExtension, run } from "../core.js";
import { dump } from "../dump.js";

describe("catch bindings use the guest property model", () => {
  it.each([
    "try{throw Object.create({x:7})}catch({x}){return x}",
    "const value=Object.create({x:7});value.y=8;try{throw value}catch({x,...rest}){return [x,rest,Object.keys(rest)]}",
    "const value=Object.create({x:7});value.x=undefined;try{throw value}catch({x=9}){return x}",
    "const value=Object.create({nested:Object.create({x:7})});try{throw value}catch({nested:{x}}){return x}",
    "const value=Object.create({x:7});try{throw value}catch({[{toString(){return 'x'}}]:x}){return x}",
    "function fn(){}fn.x=7;fn.y=8;try{throw fn}catch({x,...rest}){return [x,rest,Object.keys(rest)]}",
    "const fn=function named(value){return value};fn.x=8;try{throw fn}catch({x,name,length,...rest}){return [x,name,length,Object.keys(rest)]}",
    "const fn=()=>7;fn.x=8;try{throw fn}catch({x,...rest}){return [x,Object.keys(rest)]}",
    "try{throw new Map([['x',7]])}catch({size,...rest}){return [size,Object.keys(rest)]}",
    "try{throw new Set([7])}catch({size,...rest}){return [size,Object.keys(rest)]}",
    "try{throw /a/i}catch({source,flags,...rest}){return [source,flags,Object.keys(rest)]}",
    "try{throw new RegExp('')}catch({source}){return source}",
    "try{throw Promise.resolve(7)}catch({...rest}){return Object.keys(rest)}",
    "function* items(){yield 7}try{throw items()}catch({...rest}){return Object.keys(rest)}",
    "try{throw new Error('message')}catch({name,message}){return [name,message]}",
    "const value={y:8};Object.defineProperty(value,'x',{value:7});try{throw value}catch({x,...rest}){return [x,rest]}",
    "try{throw 'ab'}catch({0:first,length,...rest}){return [first,length,rest]}",
    "try{throw 7}catch({toFixed,...rest}){return [toFixed.call(2.5,1),Object.keys(rest)]}",
    "try{throw false}catch({...rest}){return Object.keys(rest)}",
    "try{try{throw null}catch({}){return 'accepted'}}catch(error){return error.name}",
    "try{try{throw undefined}catch({}){return 'accepted'}}catch(error){return error.name}",
    "try{try{throw Object.create({x:7})}catch({x,y=(()=>{throw x})()}){return 'accepted'}}catch(error){return error}"
  ])("matches native property reads and rest enumeration: %s", async (source) => {
    const expected = runInNewContext(`(()=>{${source}})()`, {}, { timeout: 1000 });
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("uses inherited properties in persistent evaluations", async () => {
    const realm = createRealm();
    try {
      expect(await realm.evaluate("const value=Object.create({x:7});")).toMatchObject({ ok: true });
      expect(await realm.evaluate("try{throw value}catch({x}){return x}")).toMatchObject({
        ok: true,
        returnValue: 7
      });
    } finally {
      await realm.close();
    }
  });

  it("preserves property reads in completed replay", async () => {
    const source = "return (()=>{try{throw Object.create({x:7})}catch({x}){return x}})();";
    const first = await run(source);
    expect(first).toMatchObject({ ok: true, returnValue: 7 });
    expect(await run(source, { snapshot: JSON.parse(await dump(first)) })).toMatchObject({
      ok: true,
      returnValue: 7
    });
  });

  it("charges inherited property traversal to the active budget", async () => {
    const source = "let value={x:7};for(let i=0;i<12;i++)value=Object.create(value);try{throw value}catch({x}){return x}";
    const budget = new Budget();
    expect(await run(source, { budget })).toMatchObject({ ok: true, returnValue: 7 });
    await expect(run(source, { budget: new Budget({ maxSteps: budget.stepsUsed - 1 }) })).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "steps"
    });
  });

  it("does not reread an excluded live host property while copying rest", async () => {
    const reads: string[] = [];
    const extension = defineExtension({
      manifest: { version: 1, name: "catch-properties", globals: ["value"] },
      setup(context) {
        const value = context.createHostObject({ properties: {
          x: { get() { reads.push("x"); return 7; } },
          y: { get() { reads.push("y"); return 8; } }
        } });
        return { globals: { value } };
      }
    });
    const realm = createRealm({ extensions: [extension] });
    try {
      expect(await realm.evaluate("try{throw value}catch({x,...rest}){return [x,rest]}"))
        .toMatchObject({ ok: true, returnValue: [7, { y: 8 }] });
      expect(reads).toEqual(["x", "y"]);
    } finally {
      await realm.close();
    }
  });
});
