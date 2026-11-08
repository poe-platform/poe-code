import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";
import { createSandboxClosure } from "../values.js";
import { callStringMethod } from "../methods/string.js";

for (const method of ["at", "charAt", "charCodeAt", "codePointAt"]) {
  it.each([
    ["ordered conversion", "{valueOf(){events.push('index');return 1}}"],
    ["throwing conversion", "{valueOf(){throw 'index'}}"],
    ["primitive hint", "{[Symbol.toPrimitive](hint){events.push(hint);return 1}}"],
    ["fallback conversion", "{valueOf(){events.push('valueOf');return {}},toString(){events.push('toString');return '1'}}"],
    ["callable index", "Object.assign(function(){},{valueOf(){return 1}})"],
    ["negative index", "{valueOf(){return -1}}"],
    ["fractional index", "{valueOf(){return 1.9}}"],
    ["NaN index", "{valueOf(){return NaN}}"],
    ["infinite index", "{valueOf(){return Infinity}}"],
    ["BigInt index", "1n"],
    ["Symbol index", "Symbol()"],
    ["ignored extra argument", "1,()=>{throw 'unreached'}"],
  ])(`${method}: %s`, async (_name, index) => {
    const source = `const events=[];const receiver={toString(){events.push('receiver');return 'a😀b'}};
      let result;try{result=String.prototype.${method}.call(receiver,${index})}
      catch(e){result=typeof e==='object'?e.name:e}return [result,events];`;
    expect(await run(source)).toMatchObject({ ok: true,
      returnValue: runInNewContext(`(function(){"use strict";${source}})()`) });
  });
}

it.each(["pending", "completed"])("preserves character index conversion through %s checkpoints", async mode => {
  const source = "const events=[];await 0;const index={valueOf(){events.push('index');return 1}};return ['a😀b'.at(index),'a😀b'.charAt(index),'a😀b'.charCodeAt(index),'a😀b'.codePointAt(index),events];";
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

it.each(["at", "charAt", "charCodeAt", "codePointAt"] as const)("coerces direct %s indexes without interpreter context", async method => {
  const index = { valueOf: createSandboxClosure({ sandbox: true, name: "valueOf", call: () => 1 }) };
  expect(await callStringMethod("a😀b", method, [index], new Budget())).toBe("a😀b"[method](1));
});
