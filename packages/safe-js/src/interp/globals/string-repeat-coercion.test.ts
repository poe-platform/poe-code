import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";
import { createSandboxClosure } from "../values.js";
import { callStringMethod } from "../methods/string.js";

it.each([
  ["throwing count", "{valueOf(){throw 'count'}}"],
  ["ordered conversion", "{valueOf(){events.push('count');return 2}}"],
  ["primitive hint", "{[Symbol.toPrimitive](hint){events.push(hint);return 2}}"],
  ["fallback string conversion", "{valueOf(){events.push('valueOf');return {}},toString(){events.push('toString');return '2'}}"],
  ["function count", "Object.assign(function(){},{valueOf(){return 2}})"],
  ["BigInt primitive", "1n"],
  ["BigInt object", "Object(1n)"],
  ["Symbol count", "Symbol()"],
  ["negative fraction", "{valueOf(){return -0.5}}"],
  ["negative integer", "{valueOf(){return -1}}"],
  ["infinite count", "{valueOf(){return Infinity}}"],
  ["NaN count", "{valueOf(){return NaN}}"],
  ["ignored extra argument", "2,()=>{throw 'unreached'}"],
])("repeat: %s", async (_name, count) => {
  const source = `const events=[];const receiver={toString(){events.push('receiver');return 'ab'}};
    let result;try{result=String.prototype.repeat.call(receiver,${count})}
    catch(e){result=typeof e==='object'?e.name:e}return [result,events];`;
  expect(await run(source)).toMatchObject({ ok: true,
    returnValue: runInNewContext(`(function(){"use strict";${source}})()`) });
});

it.each(["null", "undefined", "''", "{toString(){throw 'receiver'}}"])("validates repeat receiver %s before count", async receiver => {
  const source = `const events=[];let result;try{result=String.prototype.repeat.call(${receiver},{valueOf(){events.push('count');return Infinity}})}
    catch(e){result=typeof e==='object'?e.name:e}return [result,events];`;
  expect(await run(source)).toMatchObject({ ok: true,
    returnValue: runInNewContext(`(function(){"use strict";${source}})()`) });
});

it.each(["pending", "completed"])("preserves repeat conversion through %s checkpoints", async mode => {
  const source = "const events=[];await 0;const result='ab'.repeat({valueOf(){events.push('count');return 2}});return [result,events];";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    const expected = { ok: true, returnValue: ["abab", ["count"]] };
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot })).toMatchObject(expected);
  } finally { await completed; }
});

it("coerces direct repeat arguments without interpreter context", async () => {
  const count = { valueOf: createSandboxClosure({ sandbox: true, name: "valueOf", call: () => 2 }) };
  expect(await callStringMethod("ab", "repeat", [count], new Budget())).toBe("abab");
  await expect(callStringMethod("ab", "repeat", [count], new Budget({ stringLength: 3 })))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
});
