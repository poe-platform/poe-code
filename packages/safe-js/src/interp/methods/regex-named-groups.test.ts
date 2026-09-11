import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../../core.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

describe("RegExp named captures and references", () => {
  it("retains a groups object detached by a replacement callback", async () => {
    const source = "try{return 'a'.replace(/(?<x>a)/,(match,capture,index,input,groups)=>{groups.payload='x'.repeat(4000);return {toString(){const temporary='y'.repeat(4000);throw 'coercion'}}})}catch(error){return error}";
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: "coercion" });
  });
  it("preserves groups prototypes and index aliases across checkpoint replay", async () => {
    const source = "const iterator='aa'.matchAll(/(?<x>a)/dg);const match=iterator.next().value;const pair=match.indices.groups.x;await 0;return [Object.getPrototypeOf(match.groups),Object.getPrototypeOf(match.indices.groups),pair===match.indices[1],iterator.next().value.groups.x];";
    const pending = run(source);
    const completed = pending.catch(error => error);
    try {
      const snapshot = restore(JSON.parse(await dump(pending)), { source });
      const expected = await runInNewContext("(async function(){'use strict';" + source + "})()");
      expect(await completed).toMatchObject({ ok: true, returnValue: expected });
      expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: expected });
    } finally { await completed; }
  });
  it.each([
    "try{new RegExp('(?<a>a)[\\\\k]')}catch(error){return error.name}",
    "try{new RegExp('(?<a>a)\\\\k')}catch(error){return error.name}",
    "try{new RegExp('(?<a>a)(?<\\\\u0061>b)')}catch(error){return error.name}",
    "const match=/(?<a>a)/d.exec('a');const d=Object.getOwnPropertyDescriptor(match.groups,'a');return [d.writable,d.enumerable,d.configurable];",
    "return /(?<word>a+)/d.exec('baa');",
    "const match=/(?<a>a)(?<b>b)?/d.exec('a');return [match.groups,match.indices.groups,Object.getPrototypeOf(match.groups),match.indices.groups.a===match.indices[1],Object.hasOwn(match.groups,'b')];",
    "return /(?<__proto__>a)(?<constructor>b)/.exec('ab').groups;",
    "return /(?<π>a)(?<𐐀>b)/.exec('ab').groups;",
    "return /(?<\\u0061>a)\\k<a>/.exec('aa').groups;",
    "return /(?<\\u{61}>a)\\k<\\u0061>/.exec('aa').groups;",
    "return /(?<a>a)\\k<a>/d.exec('aa');",
    "return /\\k<a>(?<a>a)/.exec('a');",
    "return /(?<a>a)?b\\k<a>/.exec('b');",
    "return /(?<a>a)\\1/.exec('aa');",
    "return /\\1(?<a>a)/.exec('a');",
    "return /(?<=(?<a>a))b/d.exec('ab');",
    "return /(?<=\\k<a>(?<a>a))b/d.exec('aab');",
    "return /(?=(?<a>a))a/d.exec('a');",
    "return 'aba'.match(/(?<a>a)/).groups;",
    "return Array.from('aba'.matchAll(/(?<a>a)/dg),match=>[match.groups,match.indices.groups]);",
    "return 'ab'.replace(/(?<a>a)(?<b>b)/,'$<b>$<a>$<missing>');",
    "return 'ab'.replace(/(?<a>a)(?<b>b)/,(match,a,b,index,input,groups)=>[match,a,b,index,input,groups.a,groups.b,Object.getPrototypeOf(groups)].join('|'));",
    "return 'aba'.replaceAll(/(?<a>a)/g,'[$<a>]');",
    "return 'aba'.split(/(?<a>a)/);",
    "return /\\k<a>/.test('k<a>');",
    "try{new RegExp('(?<a>a)\\\\k<b>')}catch(error){return error.name}",
    "try{new RegExp('(?<a>a)(?<a>b)')}catch(error){return error.name}",
    "try{new RegExp('(?<1a>a)')}catch(error){return error.name}",
    "try{new RegExp('(?<>a)')}catch(error){return error.name}"
  ])("matches native: %s", async source => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  // The installed Node version predates relaxed duplicate names. These cases
  // follow ECMAScript's MightBothParticipate rule instead of that older oracle.
  it.each([
    ["const match=/(?<x>a)|(?<x>b)/d.exec('b');return [match.groups.x,match.indices.groups.x,match.indices.groups.x===match.indices[2]];", ["b", [0, 1], true]],
    ["return /(?:(?<x>a)|(?<x>b))\\k<x>/.exec('bb').groups.x;", "b"],
    ["return /(?:(?<x>a)|(?<x>b))+\\k<x>/.exec('abb').groups.x;", "b"],
    ["try{new RegExp('(?:(?<x>a)|b)(?<x>c)')}catch(error){return error.name}", "SyntaxError"]
  ])("implements the current duplicate-name rule: %s", async (source, expected) => {
    expect(await run(String(source))).toMatchObject({ ok: true, returnValue: expected });
  });
});
