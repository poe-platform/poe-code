import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../../core.js";

describe("String.split argument coercion", () => {
  it("retains the converted receiver while coercing the separator", async () => {
    let calls = 0;
    const source = "const receiver={toString(){return 'x'.repeat(4000)}};const separator={toString(){const value='y'.repeat(4000);check();return value}};return ''.split.call(receiver,separator);";
    await expect(run(source, { budget: new Budget({ dataSize: 7500 }), bindings: { check: () => { calls++; } } })).rejects.toMatchObject({ budget: "dataSize" });
    expect(calls).toBe(0);
  });

  it("allows bounded coercions at the same budget", async () => {
    let calls = 0;
    const source = "const receiver={toString(){return 'x'}};const separator={toString(){const value='y'.repeat(2000);check();return value}};return ''.split.call(receiver,separator);";
    expect(await run(source, { budget: new Budget({ dataSize: 7500 }), bindings: { check: () => { calls++; } } })).toMatchObject({ ok: true, returnValue: ["x"] });
    expect(calls).toBe(1);
  });

  it.each([
    "return 'a1b2'.split(1);",
    "return 'anullb'.split(null);",
    "return 'atrueb'.split(true);",
    "const log=[];const separator={toString(){log.push('separator');return ','}};const limit={valueOf(){log.push('limit');return 2}};return ['a,b,c'.split(separator,limit),log];",
    "const log=[];const separator={toString(){log.push('separator');return ','}};const limit={valueOf(){log.push('limit');return 0}};return ['a,b'.split(separator,limit),log];",
    "const log=[];const receiver={toString(){log.push('receiver');return 'a,b'}};const separator={get [Symbol.split](){log.push('hook');return null},toString(){log.push('separator');return ','}};const limit={valueOf(){log.push('limit');return 1}};return [''.split.call(receiver,separator,limit),log];",
    "const log=[];const separator={toString(){log.push('separator');return ','}};try{'a,b'.split(separator,{valueOf(){throw 'limit'}})}catch(error){return [error,log]}",
    "return 'a,b'.split(',',{valueOf(){return 1}});",
    "const limit=()=>0;limit.valueOf=()=>1;return 'a,b'.split(',',limit);",
    "const separator=()=>0;separator.toString=()=>',';return 'a,b'.split(separator);",
    "try{return 'abc'.split(Symbol('s'),0)}catch(error){return error.name}",
    "const regex=/a/;regex[Symbol.split]=null;return 'x/a/y'.split(regex);",
    "const regex=/,/g;regex.lastIndex=2;const parts='a,b,c'.split(regex,{valueOf(){return 1}});return [parts,regex.lastIndex];",
    "const log=[];return ['a,b'.split(undefined,{valueOf(){log.push('limit');return 0}}),log];"
  ])("matches native: %s", async source => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([-1, -2, 0, 1.9, 2.9, NaN, Infinity, 4294967297])("normalizes regex split limit %s to uint32", async limit => {
    const source = `return 'a,b,c'.split(/,/,${String(limit)});`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(function(){" + source + "})()") });
  });
});
