import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";
import { createSandboxClosure } from "../values.js";
import { callStringMethod } from "../methods/string.js";

for (const method of ["indexOf", "lastIndexOf"]) {
  it.each([
    ["Symbol search", "Symbol()", "undefined"],
    ["throwing search", "{toString(){throw 'search'}}", "0"],
    ["ordered conversion", "{toString(){events.push('search');return 'a'}}", "{valueOf(){events.push('position');return 1}}"],
    ["throwing position", "'a'", "{valueOf(){throw 'position'}}"],
    ["function search", "Object.assign(function(){},{toString(){return 'a'}})", "undefined"],
    ["no match-hook read", "{get [Symbol.match](){throw 'unreached'},toString(){return 'a'}}", "undefined"],
    ["RegExp string conversion", "/a/", "undefined"],
    ["NaN position", "'a'", "{valueOf(){return NaN}}"],
    ["undefined position", "'a'", "undefined"],
    ["fractional position", "'a'", "1.9"],
    ["negative infinity", "'a'", "-Infinity"],
    ["positive infinity", "'a'", "Infinity"],
    ["BigInt position", "'a'", "1n"],
    ["ignored extra argument", "'a'", "1,()=>{throw 'unreached'}"],
  ])(`${method}: %s`, async (_name, search, position) => {
    const source = `const events=[];const receiver={toString(){events.push('receiver');return 'aba'}};
      let result;try{result=String.prototype.${method}.call(receiver,${search},${position})}
      catch(e){result=typeof e==='object'?e.name:e}return [result,events];`;
    expect(await run(source)).toMatchObject({ ok: true,
      returnValue: runInNewContext(`(function(){"use strict";${source}})()`) });
  });
}

it.each(["pending", "completed"])("preserves index conversion through %s checkpoints", async mode => {
  const source = "const events=[];await 0;const search={toString(){events.push('search');return 'a'}};const position={valueOf(){events.push('position');return NaN}};return ['aba'.indexOf(search,position),'aba'.lastIndexOf(search,position),events];";
  const expected = await runInNewContext(`(async function(){"use strict";${source}})()`);
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: expected });
  } finally { await completed; }
});

it.each(["indexOf", "lastIndexOf"] as const)("coerces direct %s arguments without interpreter context", async method => {
  const search = { toString: createSandboxClosure({ sandbox: true, name: "toString", call: () => "a" }) };
  const position = { valueOf: createSandboxClosure({ sandbox: true, name: "valueOf", call: () => NaN }) };
  expect(await callStringMethod("aba", method, [search, position], new Budget())).toBe("aba"[method]("a", NaN));
});
