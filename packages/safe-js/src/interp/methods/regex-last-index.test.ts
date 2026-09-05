import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../../core.js";
import { Budget } from "../budget.js";

const cursors = ["undefined", "null", "false", "true", "'2'", "[]", "[2]", "{}", "Infinity", "-Infinity", "NaN", "-0", "1.7",
  "{valueOf(){seen.push('value');return 2}}",
  "{valueOf(){seen.push('value');return {}},toString(){seen.push('string');return '2'}}",
  "Object.create({valueOf(){seen.push('inherited');return 2}})",
  "{async valueOf(){seen.push('async');return 2},toString(){seen.push('string');return '2'}}",
  "{valueOf(){seen.push('throw');throw marker}}"];

async function matchesNative(source: string) {
  const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
}

describe("RegExp lastIndex storage", () => {
  it.each(cursors)("stores %s without coercion", async cursor => {
    await matchesNative(`const seen=[];const marker={id:1};const cursor=${cursor};const regex=/a/g;
      try{regex.lastIndex=cursor;return [typeof regex.lastIndex,Object.is(regex.lastIndex,cursor),seen]}
      catch(error){return [error===marker,error.name,seen]}`);
  });

  it("clones without coercing the original cursor", async () => {
    await matchesNative("const seen=[];const cursor={valueOf(){seen.push('cursor');throw 'coerced'}};const regex=/a/g;regex.lastIndex=cursor;const copy=new RegExp(regex);return [RegExp(regex)===regex,copy.lastIndex,regex.lastIndex===cursor,seen]");
  });
});

for (const flags of ["", "g"]) {
  const methods = flags === "g" ? ["exec", "test", "match", "search", "matchAll", "replace", "replaceAll", "split"]
    : ["exec", "test", "match", "search", "replace", "split"];
  describe.each(methods)(`RegExp /a/${flags} cursor during %s`, method => {
    it.each(cursors)("coerces %s at the native observation point", async cursor => {
      const operation = method === "exec" || method === "test" ? `regex.${method}('aba')`
        : method === "matchAll" ? "Array.from('aba'.matchAll(regex)).map(match=>[Array.from(match),match.index])"
        : `'aba'.${method}(regex${method === "replace" || method === "replaceAll" ? ",'X'" : ""})`;
      await matchesNative(`const seen=[];const marker={id:1};const cursor=${cursor};const regex=/a/${flags};let assigned=false;
        try{regex.lastIndex=cursor;assigned=true;const result=${operation};
          return [Array.isArray(result)?[Array.from(result),result.index,result.input]:result,
            Object.is(regex.lastIndex,cursor),typeof regex.lastIndex,typeof regex.lastIndex==='number'?String(regex.lastIndex):null,seen]}
        catch(error){return [assigned,error===marker,error.name,seen]}`);
    });
  });
}

describe("RegExp cursor coercion order", () => {
  it("converts the input before reading the cursor", async () => {
    await matchesNative("const seen=[];const regex=/a/g;regex.lastIndex={valueOf(){seen.push('old');return 2}};const result=regex.exec({toString(){seen.push('input');regex.lastIndex={valueOf(){seen.push('new');return 0}};return 'aba'}});return [result.index,regex.lastIndex,seen]");
  });

  it("uses the converted cursor even when its hook changes lastIndex", async () => {
    await matchesNative("const regex=/a/g;regex.lastIndex={valueOf(){regex.lastIndex=0;return 2}};const result=regex.exec('aba');return [result.index,regex.lastIndex]");
  });
});

describe("RegExp cursor admission", () => {
  it.each(["exec", "match", "matchAll", "replace"])("retains a replaced cursor during %s fallback coercion", async method => {
    const operation = method === "exec" ? "regex.exec('aba')"
      : `'aba'.${method}(regex${method === "replace" ? ",'X'" : ""})`;
    const source = `const regex=/a/${method === "matchAll" ? "g" : ""};regex.lastIndex={payload:'x'.repeat(4000),
      valueOf:()=>{regex.lastIndex=0;const temporary='y'.repeat(4000);return {}},toString(){return '2'}};
      ${operation};return true`;
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: true });
  });
});
