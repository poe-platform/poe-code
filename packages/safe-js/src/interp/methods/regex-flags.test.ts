import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../../core.js";

const properties = ["hasIndices", "global", "ignoreCase", "multiline", "dotAll", "unicode", "unicodeSets", "sticky"];
const combinations = Array.from({ length: 16 }, (_, mask) => [..."gims"].filter((_, index) => mask & (1 << index)).join(""));

async function matchesNative(source: string) {
  const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
}

describe.each(combinations)("RegExp /a/%s flag properties", flags => {
  it("reads native booleans and reports inherited property existence", async () => {
    await matchesNative(`const regex=new RegExp('a',${JSON.stringify(flags)});
      return ${JSON.stringify(properties)}.map(key=>[regex[key],key in regex,Object.hasOwn(regex,key)])`);
  });

  it("preserves read-only assignment, flags text and enumeration", async () => {
    await matchesNative(`const regex=new RegExp('a',${JSON.stringify(flags)});const rejected=[];
      for(const key of ${JSON.stringify(properties)}){try{regex[key]=true;rejected.push(false)}catch(error){rejected.push(error.name==='TypeError')}}
      return [regex.flags,Object.keys(regex),rejected]`);
  });
});

describe("RegExp flags property reads", () => {
  it.each([
    "const regex=/a/g;Object.defineProperty(regex,'global',{value:false});return regex.flags;",
    "const regex=/a/;Object.defineProperty(regex,'global',{value:{valueOf(){throw 'coercion'},toString(){throw 'coercion'}}});return regex.flags;",
    "const regex=/a/g;Object.defineProperty(regex,'global',{get(){Object.defineProperty(regex,'ignoreCase',{value:true});return false}});return regex.flags;",
    "const regex=/a/;const log=[];Object.defineProperty(regex,'global',{get(){throw 'global'}});Object.defineProperty(regex,'ignoreCase',{get(){log.push('ignoreCase');return true}});try{return regex.flags}catch(error){return [error,log]}",
    "const regex=/a/g;Object.defineProperty(regex,'global',{value:false});try{return Array.from('a'.matchAll(regex)).length}catch(error){return error.name}",
    "const regex=/a/g;Object.defineProperty(regex,'global',{value:false});try{return 'a'.replaceAll(regex,'b')}catch(error){return error.name}",
    "const regex=/a/g;Object.defineProperty(regex,'global',{value:false});Object.defineProperty(regex,'sticky',{value:true});return String(regex);",
    "const regex=/a/g;Object.defineProperty(regex,'global',{value:false});return [regex.flags,regex.exec('a')[0],regex.lastIndex];",
    "const regex=/a/;Object.defineProperty(regex,'global',{value:Symbol('truthy')});Object.defineProperty(regex,'ignoreCase',{value:NaN});return regex.flags;"
  ])("matches native: %s", async source => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("reads all flag properties in specification order", async () => {
    // Node 22 reads sticky before unicodeSets; ECMA-262 specifies the reverse.
    // https://tc39.es/ecma262/#sec-get-regexp.prototype.flags
    const keys = ['hasIndices', 'global', 'ignoreCase', 'multiline', 'dotAll', 'unicode', 'unicodeSets', 'sticky'];
    const source = `const regex=/a/;const log=[];for(const key of ${JSON.stringify(keys)})Object.defineProperty(regex,key,{get(){log.push(key);return true}});return [regex.flags,log];`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: ['dgimsuvy', keys] });
  });

  it("bounds recursive flag getters", async () => {
    const source = "const regex=/a/;Object.defineProperty(regex,'global',{get(){return regex.flags}});return regex.flags;";
    await expect(run(source, { budget: new Budget({ maxCallDepth: 20 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "callDepth" });
  });
});
