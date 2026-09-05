import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../../core.js";

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
