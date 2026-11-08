import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";
import { createSandboxClosure } from "../values.js";
import { callStringMethod } from "../methods/string.js";

for (const method of ["padStart", "padEnd"]) {
  it.each([
    ["ordered conversion", "{valueOf(){events.push('length');return 5}}", "{toString(){events.push('fill');return 'xy'}}"],
    ["unused filler", "1", "{toString(){throw 'unreached'}}"],
    ["unused Symbol filler", "1", "Symbol()"],
    ["throwing target", "{valueOf(){throw 'length'}}", "{toString(){throw 'unreached'}}"],
    ["throwing filler", "5", "{toString(){throw 'fill'}}"],
    ["Symbol filler", "5", "Symbol()"],
    ["callable filler", "5", "Object.assign(function(){},{toString(){return 'x'}})"],
    ["callable target", "Object.assign(function(){},{valueOf(){return 5}})", "'x'"],
    ["NaN target", "{valueOf(){return NaN}}", "{toString(){throw 'unreached'}}"],
    ["negative target", "{valueOf(){return -1}}", "{toString(){throw 'unreached'}}"],
    ["fractional target", "{valueOf(){return 5.9}}", "'xy'"],
    ["fractional target needs no padding", "{valueOf(){return 3.9}}", "{toString(){throw 'unreached'}}"],
    ["empty filler", "Infinity", "{toString(){return ''}}"],
    ["default filler", "{valueOf(){return 5}}", "undefined"],
    ["BigInt target", "1n", "'x'"],
    ["ignored extra argument", "5", "'x',()=>{throw 'unreached'}"],
  ])(`${method}: %s`, async (_name, length, filler) => {
    const source = `const events=[];const receiver={toString(){events.push('receiver');return 'abc'}};
      let result;try{result=String.prototype.${method}.call(receiver,${length},${filler})}
      catch(e){result=typeof e==='object'?e.name:e}return [result,events];`;
    expect(await run(source)).toMatchObject({ ok: true,
      returnValue: runInNewContext(`(function(){"use strict";${source}})()`) });
  });
}

it.each(["pending", "completed"])("preserves padding conversion through %s checkpoints", async mode => {
  const source = "const events=[];await 0;const size={valueOf(){events.push('size');return 5}};const fill={toString(){events.push('fill');return 'xy'}};return ['abc'.padStart(size,fill),'abc'.padEnd(size,fill),events];";
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

it.each(["padStart", "padEnd"] as const)("coerces direct %s inputs without interpreter context", async method => {
  const size = { valueOf: createSandboxClosure({ sandbox: true, name: "valueOf", call: () => 5 }) };
  const fill = { toString: createSandboxClosure({ sandbox: true, name: "toString", call: () => "xy" }) };
  expect(await callStringMethod("abc", method, [size, fill], new Budget())).toBe("abc"[method](5, "xy"));
  await expect(callStringMethod("abc", method, [size, fill], new Budget({ stringLength: 4 })))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
});
