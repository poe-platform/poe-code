import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../../core.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

describe("RegExp match indices", () => {
  it("preserves indices and their aliases through checkpoint replay", async () => {
    const source = "const match=/(a)(b)?/d.exec('a');const indices=match.indices;await 0;return [match.indices===indices,indices,indices.groups,Object.hasOwn(indices,'2')];";
    const pending = run(source);
    const completed = pending.catch(error => error);
    try {
      const snapshot = restore(JSON.parse(await dump(pending)), { source });
      const expected = runInNewContext("(async function(){'use strict';" + source + "})()");
      expect(await completed).toMatchObject({ ok: true, returnValue: await expected });
      expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: await expected });
    } finally { await completed; }
  });
  it.each(["return /a/d.exec('a').indices;", "return 'a'.match(/a/d).indices;", "return 'a'.matchAll(/a/dg).next().value.indices;"])("applies array limits to index pairs: %s", async source => {
    await expect(run(source, { budget: new Budget({ arrayLength: 1 }) }))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
    expect(await run(source, { budget: new Budget({ arrayLength: 2 }) }))
      .toMatchObject({ ok: true, returnValue: [[0, 1]] });
  });
  it.each([
    "try{new RegExp('a','dd')}catch(error){return error.name}",
    "const indices=/(a)?b/d.exec('b').indices;return [Object.hasOwn(indices,'1'),indices[1],indices[0]===indices[1]];",
    "return 'ab'.split(/(b)/d);",
    "return /a/d.exec('ba').indices;",
    "return /(a)(b)?/d.exec('a').indices;",
    "return /((a)+)(b)?/d.exec('aaa').indices;",
    "return /()/d.exec('a').indices;",
    "return /(a|ab)c/d.exec('abc').indices;",
    "return /((a)|(b))+/d.exec('ab').indices;",
    "return 'ba'.match(/(a)/d).indices;",
    "return Array.from('aba'.matchAll(/(a)/dg),match=>match.indices);",
    "const regex=/a/dy;regex.lastIndex=1;return [regex.exec('ba').indices,regex.lastIndex,regex.hasIndices,regex.flags];",
    "const match=/a/d.exec('a');const d=Object.getOwnPropertyDescriptor(match,'indices');const g=Object.getOwnPropertyDescriptor(match.indices,'groups');return [d.writable,d.enumerable,d.configurable,g.value,g.writable,g.enumerable,g.configurable];",
    "const regex=/a/d;Object.defineProperty(regex,'hasIndices',{value:false});return [regex.hasIndices,regex.exec('a').indices];",
    "return [Object.hasOwn(/a/.exec('a'),'indices'),/a/d.exec('b')];",
    "const regex=new RegExp('(a)','dg');return [new RegExp(regex).exec('ba').indices,'aba'.match(regex)];"
  ])("matches native: %s", async source => {
    expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(function(){'use strict';" + source + "})()") });
  });
});
