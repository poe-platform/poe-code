import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../../core.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

describe("JSON.parse input conversion", () => {
  it.each([
    'return JSON.parse({toString(){return "7"}})',
    'return JSON.parse({toString(){return "[1,true,null]"}})',
    'return JSON.parse({toString(){return "{\\"ok\\":true}"}})',
    'return JSON.parse({toString(){return 7}})',
    'return JSON.parse({toString(){return null}})',
    'return JSON.parse({toString(){return false}})',
    'return JSON.parse({toString(){return {}},valueOf(){return "8"}})',
    'return JSON.parse({toString:null,valueOf(){return "9"}})',
    'return JSON.parse(Object.create({toString(){return "10"}}))',
    'const value=[];value.toString=()=>"11";return JSON.parse(value)',
    'function value(){}value.toString=()=>"12";return JSON.parse(value)',
    'try{return JSON.parse(new Date(0))}catch(error){return error.name}',
    'return JSON.parse(new String("7"))',
    'return JSON.parse(new Number(7))',
    'return JSON.parse(new Boolean(false))',
    'const value=new String("7");value.toString=()=>"8";return JSON.parse(value)',
    'return JSON.parse([[{toString(){return "14"}}]])',
    'const log=[];const value={toString(){log.push(this===value);return "7"},valueOf(){log.push("wrong");return 8}};return [JSON.parse(value),log]',
    'const log=[];const value={async toString(){log.push("prefix");return "7"},valueOf(){log.push("fallback");return 8}};return [JSON.parse(value),log]',
    'const marker={};try{JSON.parse({toString(){throw marker}})}catch(error){return error===marker}',
    'const marker={};try{JSON.parse({toString(){return {}},valueOf(){throw marker}})}catch(error){return error===marker}',
    'const log=[];try{JSON.parse({toString(){log.push("string");return {}},valueOf(){log.push("value");return {}}})}catch(error){return [error.name,log]}',
    'try{return JSON.parse(Object.create(null))}catch(error){return error.name}',
    'try{return JSON.parse({toString(){return undefined}})}catch(error){return error.name}',
    'return [JSON.parse(7),JSON.parse(null),JSON.parse(false),JSON.parse([7]),JSON.parse("1e500")]',
    'try{return JSON.parse()}catch(error){return error.name}',
    'const values=[];values.push(values);try{return JSON.parse(values)}catch(error){return error.name}'
  ])("matches native conversion: %s", async (source) => {
    const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("does not drain jobs during synchronous conversion", async () => {
    const source = 'const log=[];Promise.resolve().then(()=>log.push("job"));const value={toString(){log.push("string");return "7"}};log.push(JSON.parse(value));log.push("after");await 0;return log';
    const expected = await runInNewContext(`(async()=>{${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("reuses stored realm hooks", async () => {
    const realm = createRealm();
    try {
      await realm.evaluate('let calls=0;const value={toString(){calls++;return "7"}};');
      for (let calls = 1; calls <= 2; calls++) {
        expect(await realm.evaluate("return [JSON.parse(value),calls]")).toMatchObject({
          ok: true,
          returnValue: [7, calls]
        });
      }
    } finally {
      await realm.close();
    }
  });

  it("replays completed hook effects once", async () => {
    const source = "return JSON.parse({toString(){return read()}})";
    let reads = 0;
    const bindings = { read() { reads++; return "7"; } };
    const original = await run(source, { bindings });
    const snapshot = restore(JSON.parse(await dump(original)), { source });
    expect(await run(source, { bindings, snapshot })).toMatchObject({ ok: true, returnValue: 7 });
    expect(reads).toBe(1);
  });

  it("keeps step exhaustion fatal and releases roots", async () => {
    const budget = new Budget({ maxSteps: 1000 });
    await expect(
      run("try{return JSON.parse({toString(){while(true){}}})}catch(error){return 0}", { budget })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
    expect([...budget.retainedValues()]).toEqual([]);
  });

  it("bounds recursive conversion", async () => {
    const budget = new Budget({ maxCallDepth: 20 });
    await expect(
      run("const value={toString(){return JSON.parse(value)}};try{return JSON.parse(value)}catch(error){return 0}", { budget })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "callDepth" });
    expect([...budget.retainedValues()]).toEqual([]);
  });
});
