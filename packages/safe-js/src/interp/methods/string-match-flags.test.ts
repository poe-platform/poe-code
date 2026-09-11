import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../../core.js";

describe("String.match observable flags without custom exec", () => {
  it.each([
    "const regex=/a/g;Object.defineProperty(regex,'global',{value:false});const matches='aa'.match(regex);return [Array.from(matches),matches.index];",
    "const regex=/a/g;Object.defineProperty(regex,'global',{get(){throw 'global'}});try{return 'a'.match(regex)}catch(error){return error}",
    "const regex=/a/g;regex.lastIndex=1;Object.defineProperty(regex,'global',{value:false});const matches='aa'.match(regex);return [matches.index,regex.lastIndex];",
    "const regex=/()/g;Object.defineProperty(regex,'unicode',{value:true});return '😀'.match(regex);",
    "const regex=/a/g;Object.defineProperty(regex,'global',{get(){regex.exec=()=>null;return true}});return 'a'.match(regex);",
    "const regex=/a/g;Object.defineProperty(regex,'global',{get(){delete regex.global;return false},configurable:true});return 'aa'.match(regex).index;"
  ])("matches native: %s", async source => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  // Current ECMA-262 reads flags, unlike Node 22's older match algorithm.
  // https://tc39.es/ecma262/#sec-regexp-prototype-%symbol.match%
  it.each(['hasIndices', 'global', 'ignoreCase', 'multiline', 'dotAll', 'unicode', 'unicodeSets', 'sticky'])("observes %s getter failures through flags", async key => {
    const source = `const regex=/a/g;Object.defineProperty(regex,${JSON.stringify(key)},{get(){throw 'flag'}});try{return 'a'.match(regex)}catch(error){return error}`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: 'flag' });
  });

  it("uses and converts an own flags property before execution", async () => {
    const source = "const regex=/a/g;const log=[];Object.defineProperty(regex,'flags',{get(){log.push('flags');return {toString(){log.push('string');return ''}}}});const matches='aa'.match(regex);return [Array.from(matches),matches.index,log];";
    expect(await run(source)).toMatchObject({ ok: true, returnValue: [['a'], 0, ['flags', 'string']] });
  });
});
