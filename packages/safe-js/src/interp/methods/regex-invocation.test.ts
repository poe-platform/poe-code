import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../../core.js";
import { Budget } from "../budget.js";
import { createSandboxClosure, createSandboxRegex } from "../values.js";
import { callRegexMethod } from "./regex.js";

async function matchesNative(source: string) {
  const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
}

describe.each(["exec", "test"])("RegExp.%s invocation", method => {
  it.each(["/a/g", "/b/g", "null", "undefined", "1", "true", "'a'", "{}", "[]", "function(){}"])("honors receiver %s", async receiver => {
    await matchesNative(`const lookup=/a/g;const target=${receiver};
      try{const result=lookup.${method}.call(target,'aba');return [result===null?null:${method === "exec" ? "[Array.from(result),result.index,result.input]" : "result"},lookup.lastIndex,target.lastIndex]}
      catch(error){return [error.name,lookup.lastIndex]}`);
  });

  it.each(["direct", "call", "apply", "bind", "bare"])("supports %s calls", async invocation => {
    const call = invocation === "direct" ? `target.${method}('aba')`
      : invocation === "call" ? "saved.call(target,'aba')"
      : invocation === "apply" ? "saved.apply(target,['aba'])"
      : invocation === "bind" ? "saved.bind(target)('aba')" : "saved('aba')";
    await matchesNative(`const lookup=/z/g;const target=/a/g;const saved=lookup.${method};
      try{const result=${call};return [result===null?null:${method === "exec" ? "[Array.from(result),result.index]" : "result"},target.lastIndex,lookup.lastIndex]}
      catch(error){return [error.name,target.lastIndex,lookup.lastIndex]}`);
  });

  it.each(["undefined", "null", "123", "true", "'aba'", "['a']", "[]", "{}", "Object.create(null)",
    "{toString(){seen.push('string');return 'aba'}}",
    "{toString(){seen.push('string');return {}},valueOf(){seen.push('value');return 'aba'}}",
    "Object.create({toString(){seen.push('inherited');return 'aba'}})",
    "{toString:7,valueOf(){seen.push('value');return 'aba'}}",
    "{async toString(){seen.push('async');return 'ignored'},valueOf(){seen.push('value');return 'aba'}}",
    "{toString(){throw marker}}", "{toString(){return {}},valueOf(){return {}}}"
  ])("coerces input %s", async input => {
    await matchesNative(`const seen=[];const marker={id:1};const target=/a/g;const input=${input};
      try{const result=target.${method}(input);return [result===null?null:${method === "exec" ? "[Array.from(result),result.index,result.input]" : "result"},target.lastIndex,seen]}
      catch(error){return [error===marker,error.name,target.lastIndex,seen]}`);
  });

  it.each(["{}", "null", "1"])("preserves rejection order for receiver %s", async receiver => {
    await matchesNative(`const seen=[];try{/a/.${method}.call(${receiver},{toString(){seen.push('string');return 'a'}})}catch(error){return [error.name,seen]}`);
  });

  it("coerces input before reading the execution cursor", async () => {
    await matchesNative(`const target=/a/g;target.lastIndex=2;const result=target.${method}({toString(){target.lastIndex=0;return 'aba'}});
      return [${method === "exec" ? "result.index" : "result"},target.lastIndex]`);
  });
});

describe("RegExp.test custom exec", () => {
  it.each(["null", "[]", "{}", "function(){}", "Promise.resolve(null)", "undefined", "false", "0", "'match'"])("checks the custom result %s", async returned => {
    await matchesNative(`const seen=[];const target={exec(value){seen.push([this===target,value]);return ${returned}}};
      try{return [/a/.test.call(target,{toString(){seen.push('string');return 'a'}}),seen]}
      catch(error){return [error.name,seen]}`);
  });

  it("looks up exec after coercion and follows its prototype", async () => {
    await matchesNative(`const seen=[];const prototype={exec(){throw 'old'}};const target=Object.create(prototype);
      return [/a/.test.call(target,{toString(){prototype.exec=function(value){seen.push([this===target,value]);return null};return 'a'}}),seen]`);
  });

  it("supports callable receivers with their own exec", async () => {
    await matchesNative("const target=function(){};target.exec=function(value){return value==='a'?{}:null};return /z/.test.call(target,'a')");
  });

  it("preserves a thrown custom value", async () => {
    await matchesNative("const marker={id:1};try{/a/.test.call({exec(){throw marker}},'a')}catch(error){return error===marker}");
  });

  it("does not await an async custom exec result", async () => {
    await matchesNative("const seen=[];const target={async exec(){seen.push('exec');return null}};return [/a/.test.call(target,'a'),seen]");
  });

  it.each(["undefined", "null", "0", "'exec'"])("rejects an unbranded receiver with non-callable exec %s", async exec => {
    await matchesNative(`const seen=[];try{/a/.test.call({exec:${exec}},{toString(){seen.push('string');return 'a'}})}catch(error){return [error.name,seen]}`);
  });
});

describe("RegExp method admission", () => {
  it.each(["exec", "test"] as const)("retains the input during %s fallback coercion", async method => {
    const source = `let input={payload:'x'.repeat(4000),toString:()=>{input=null;const temporary='y'.repeat(4000);return {}},valueOf(){return 'a'}};
      return /a/.${method}(input)${method === "exec" ? "[0]" : ""}`;
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: method === "exec" ? "a" : true });
  });

  it("retains the custom receiver during input coercion", async () => {
    const source = "let receiver={payload:'x'.repeat(4000),exec(){return null}};return /a/.test.call(receiver,{toString(){receiver=null;const temporary='y'.repeat(4000);return 'a'}})";
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: false });
  });

  it("preserves existing produced-input accounting during custom exec", async () => {
    const source = "try{/a/.test.call({exec(){const temporary='y'.repeat(4000);throw 'exec failed'}},{toString(){return 'x'.repeat(4000)}})}catch(error){return error}";
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: "exec failed" });
  });

  it.each([false, true])("releases retained values after coercion failure=%s", async fail => {
    const budget = new Budget();
    const target = createSandboxRegex("a");
    const observed: boolean[] = [];
    const input = { toString: createSandboxClosure({ call: () => {
      const retained = [...budget.retainedValues()];
      observed.push(retained.includes(target) && retained.includes(input));
      if (fail) throw new Error("coercion failed");
      return "a";
    } }) };
    const execution = callRegexMethod(target, "exec", [input], budget);
    if (fail) await expect(execution).rejects.toThrow("coercion failed");
    else expect(await execution).toEqual(Object.assign(["a"], { index: 0, input: "a", groups: undefined }));
    expect(observed).toEqual([true]);
    expect([...budget.retainedValues()]).toEqual([]);
    expect(budget.currentDataSize).toBe(0);
  });

  it("keeps custom exec exhaustion fatal", async () => {
    await expect(run("try{return /a/.test.call({exec(){while(true){}return null}},'a')}catch(error){return 'caught'}", {
      budget: new Budget({ maxSteps: 100 })
    })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });
});
