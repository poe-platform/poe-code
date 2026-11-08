import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../../core.js";
import { dump } from "../../dump.js";

describe("Number guest conversion", () => {
  it.each([
    "return [Number(),Number(undefined),Number(null),Number(false),Number(true),Number(-0),Number('7.5'),Number('invalid')]",
    "const events=[];const value={valueOf(){events.push(this===value);return 7},toString(){events.push('unused');return '8'}};return [Number(value),events]",
    "return Number(Object.create({valueOf(){return 7}}))",
    "const events=[];const value={valueOf(){events.push('valueOf');return {}},toString(){events.push('toString');return '7'}};return [Number(value),events]",
    "return Number({valueOf:null,toString(){return '7'}})",
    "return Number({valueOf(){return false},toString(){throw 7}})",
    "return Number({valueOf(){return null}})",
    "return Number({valueOf(){return undefined}})",
    "return Number({valueOf(){return -0}})",
    "return Number({valueOf(){return '0x10'}})",
    "const reason={};try{Number({valueOf(){throw reason}})}catch(error){return error===reason}",
    "const reason={};try{Number({valueOf(){return {}},toString(){throw reason}})}catch(error){return error===reason}",
    "const value={valueOf(){return {}},toString(){return {}}};try{Number(value)}catch(error){return error.name}",
    "try{Number(Object.create(null))}catch(error){return error.name}",
    "const events=[];const value={async valueOf(){events.push('before');await 0;events.push('after');return 7},toString(){events.push('string');return '8'}};const result=Number(value);events.push('caller');await 0;return [result,events]",
    "const events=[];const value={valueOf(){return Promise.resolve(7)},toString(){events.push('string');return '8'}};return [Number(value),events]",
    "const value=[];value.valueOf=()=>7;return Number(value)",
    "const value=[1];value.join=()=>7;return Number(value)",
    "function value(){}value.valueOf=()=>7;return Number(value)",
    "return [Number(new Date(7)),Number(new Date('invalid')),Number([]),Number([7]),Number([1,2]),Number(new Float32Array([7]))]",
    "return Number(7,{valueOf(){throw 'unused'}})",
    "let calls=0;const value={valueOf(){calls++;return 7}};return [Number.isNaN(value),Number.isFinite(value),Number.isInteger(value),Number.isSafeInteger(value),calls]"
  ])("matches native conversion: %s", async (source) => {
    const wrapped = `try{${source}}catch(error){return ['uncaught',error.name]}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${wrapped}})()`, {}, { timeout: 1000 });
    expect(await run(wrapped)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("uses stored guest hooks across realm evaluations", async () => {
    const realm = createRealm();
    try {
      await realm.evaluate("let calls=0;const value={valueOf(){calls++;return 7}};");
      expect(await realm.evaluate("return [Number(value),calls]"))
        .toMatchObject({ ok: true, returnValue: [7, 1] });
      expect(await realm.evaluate("return [Number(value),calls]"))
        .toMatchObject({ ok: true, returnValue: [7, 2] });
    } finally {
      await realm.close();
    }
  });

  it("preserves completed conversion replay", async () => {
    const source = "let calls=0;const value={valueOf(){calls++;return 7}};return [Number(value),calls]";
    const first = await run(source);
    expect(first).toMatchObject({ ok: true, returnValue: [7, 1] });
    expect(await run(source, { snapshot: JSON.parse(await dump(first)) }))
      .toMatchObject({ ok: true, returnValue: [7, 1] });
  });

  it("keeps a guest hook's step budget fatal", async () => {
    await expect(run("try{return Number({valueOf(){while(true){}}})}catch(error){return 'caught'}", {
      budget: new Budget({ maxSteps: 1000 })
    })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });

  it("keeps recursive conversion within the call-depth budget", async () => {
    await expect(run("const value={valueOf(){return Number(value)}};try{return Number(value)}catch(error){return 'caught'}", {
      budget: new Budget({ maxCallDepth: 20 })
    })).rejects.toMatchObject({ code: "budgetExceeded", budget: "callDepth" });
  });
});
