import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../../core.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

// Global predicates perform ToNumber; Number.isNaN/isFinite deliberately do not.
describe.each(["isNaN", "isFinite"])("global %s conversion", (predicate) => {
  it.each([
    "return PREDICATE({valueOf(){return 7}})",
    "return PREDICATE({valueOf(){return 'bad'}})",
    "return PREDICATE({valueOf(){return Infinity}})",
    "return PREDICATE({valueOf(){return -Infinity}})",
    "return PREDICATE({valueOf(){return undefined}})",
    "return PREDICATE({valueOf(){return null}})",
    "return PREDICATE({valueOf(){return false}})",
    "return PREDICATE({valueOf(){return {}},toString(){return '  12  '}})",
    "return PREDICATE({valueOf:null,toString(){return '12'}})",
    "const value=Object.create({valueOf(){return 7}});return PREDICATE(value)",
    "function value(){}value.valueOf=()=> 7;return PREDICATE(value)",
    "const value=[];value.valueOf=()=> 7;return PREDICATE(value)",
    "const log=[];const value={valueOf(){log.push(this===value);return 7},toString(){log.push('wrong');return 'bad'}};return [PREDICATE(value),log]",
    "const log=[];const value={async valueOf(){log.push('prefix');return 7},toString(){log.push('fallback');return 'bad'}};return [PREDICATE(value),log]",
    "const marker={};try{PREDICATE({valueOf(){throw marker}})}catch(error){return error===marker}",
    "const log=[];try{PREDICATE({valueOf(){log.push('value');return {}},toString(){log.push('string');return {}}})}catch(error){return [error.name,log]}",
    "try{return PREDICATE(Object.create(null))}catch(error){return error.name}",
    "return [PREDICATE(),PREDICATE(null),PREDICATE(true),PREDICATE(''),PREDICATE('bad'),PREDICATE(Infinity),PREDICATE(-0)]",
    "let calls=0;const value={valueOf(){calls++;return 7}};return [Number.isNaN(value),Number.isFinite(value),calls]"
  ])("matches native conversion: %s", async (template) => {
    const source = template.replaceAll("PREDICATE", predicate);
    const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("does not drain jobs during synchronous conversion", async () => {
    const source = `const log=[];Promise.resolve().then(()=>log.push('job'));const value={valueOf(){log.push('value');return 7}};log.push(${predicate}(value));log.push('after');await 0;return log`;
    const expected = await runInNewContext(`(async()=>{${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("reuses stored realm hooks", async () => {
    const realm = createRealm();
    try {
      await realm.evaluate("let calls=0;const value={valueOf(){calls++;return 7}};");
      for (let calls = 1; calls <= 2; calls++) {
        expect(await realm.evaluate(`return [${predicate}(value),calls]`)).toMatchObject({
          ok: true,
          returnValue: [predicate === "isFinite", calls]
        });
      }
    } finally {
      await realm.close();
    }
  });

  it("replays completed hook effects once", async () => {
    const source = `return ${predicate}({valueOf(){return read()}})`;
    let reads = 0;
    const bindings = {
      read() {
        reads++;
        return 7;
      }
    };
    const original = await run(source, { bindings });
    const snapshot = restore(JSON.parse(await dump(original)), { source });
    expect(await run(source, { bindings, snapshot })).toMatchObject({
      ok: true,
      returnValue: predicate === "isFinite"
    });
    expect(reads).toBe(1);
  });

  it("keeps step exhaustion fatal and releases roots", async () => {
    const budget = new Budget({ maxSteps: 1000 });
    await expect(
      run(`try{return ${predicate}({valueOf(){while(true){}}})}catch(error){return 0}`, { budget })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
    expect([...budget.retainedValues()]).toEqual([]);
  });

  it("bounds recursive coercion", async () => {
    const budget = new Budget({ maxCallDepth: 20 });
    await expect(
      run(
        `const value={valueOf(){return ${predicate}(value)}};try{return ${predicate}(value)}catch(error){return 0}`,
        { budget }
      )
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "callDepth" });
    expect([...budget.retainedValues()]).toEqual([]);
  });
});
