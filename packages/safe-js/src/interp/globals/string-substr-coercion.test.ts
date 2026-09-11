import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";
import { createSandboxClosure } from "../values.js";
import { callStringMethod } from "../methods/string.js";

it.each([
  ["ordered conversion", "'abcd'", "{valueOf(){events.push('start');return 1}}", "{valueOf(){events.push('length');return 2}}"],
  ["throwing start", "'abcd'", "{valueOf(){throw 'start'}}", "{valueOf(){throw 'unreached'}}"],
  ["throwing length", "'abcd'", "1", "{valueOf(){throw 'length'}}"],
  ["empty receiver still converts", "''", "Infinity", "{valueOf(){events.push('length');return 2}}"],
  ["infinite start still converts", "'abcd'", "Infinity", "{valueOf(){events.push('length');return 2}}"],
  ["negative infinite start", "'abcd'", "{valueOf(){return -Infinity}}", "2"],
  ["negative start", "'abcd'", "{valueOf(){return -2}}", "undefined"],
  ["negative length", "'abcd'", "1", "{valueOf(){return -1}}"],
  ["NaN length", "'abcd'", "1", "{valueOf(){return NaN}}"],
  ["fractional length", "'abcd'", "1", "{valueOf(){return 2.9}}"],
  ["callable length", "'abcd'", "1", "Object.assign(function(){},{valueOf(){return 2}})"],
  ["BigInt length", "'abcd'", "1", "1n"],
  ["Symbol start", "'abcd'", "Symbol()", "2"],
  ["ignored extra argument", "'abcd'", "1", "2,()=>{throw 'unreached'}"],
])("substr: %s", async (_name, receiver, start, length) => {
  const source = `const events=[];let result;try{result=String.prototype.substr.call(${receiver},${start},${length})}
    catch(e){result=typeof e==='object'?e.name:e}return [result,events];`;
  expect(await run(source)).toMatchObject({ ok: true,
    returnValue: runInNewContext(`(function(){"use strict";${source}})()`) });
});

it.each(["pending", "completed"])("preserves substr conversion through %s checkpoints", async mode => {
  const source = "const events=[];await 0;const start={valueOf(){events.push('start');return -3}};const length={valueOf(){events.push('length');return 2}};return ['abcd'.substr(start,length),events];";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    const expected = { ok: true, returnValue: ["bc", ["start", "length"]] };
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot })).toMatchObject(expected);
  } finally { await completed; }
});

it("coerces direct substr arguments without interpreter context", async () => {
  const start = { valueOf: createSandboxClosure({ sandbox: true, name: "valueOf", call: () => -3 }) };
  const length = { valueOf: createSandboxClosure({ sandbox: true, name: "valueOf", call: () => 2 }) };
  expect(await callStringMethod("abcd", "substr", [start, length], new Budget())).toBe("bc");
});
