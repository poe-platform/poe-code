import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";
import { createSandboxClosure } from "../values.js";
import { callStringMethod } from "../methods/string.js";

for (const method of ["slice", "substring"]) {
  it.each([
    ["ordered conversion", "{valueOf(){events.push('start');return 1}}", "{valueOf(){events.push('end');return 3}}"],
    ["throwing start", "{valueOf(){throw 'start'}}", "{valueOf(){throw 'unreached'}}"],
    ["throwing end", "1", "{valueOf(){throw 'end'}}"],
    ["empty-result conversion", "Infinity", "{valueOf(){events.push('end');return 2}}"],
    ["callable start", "Object.assign(function(){},{valueOf(){return 1}})", "3"],
    ["negative start", "{valueOf(){return -2}}", "undefined"],
    ["negative end", "0", "{valueOf(){return -1}}"],
    ["NaN start", "{valueOf(){return NaN}}", "2"],
    ["NaN end", "1", "{valueOf(){return NaN}}"],
    ["reversed bounds", "{valueOf(){return 3}}", "{valueOf(){return 1}}"],
    ["BigInt start", "1n", "undefined"],
    ["Symbol end", "0", "Symbol()"],
    ["ignored extra argument", "1", "3,()=>{throw 'unreached'}"],
  ])(`${method}: %s`, async (_name, start, end) => {
    const source = `const events=[];const receiver={toString(){events.push('receiver');return 'abcd'}};
      let result;try{result=String.prototype.${method}.call(receiver,${start},${end})}
      catch(e){result=typeof e==='object'?e.name:e}return [result,events];`;
    expect(await run(source)).toMatchObject({ ok: true,
      returnValue: runInNewContext(`(function(){"use strict";${source}})()`) });
  });
}

it.each(["pending", "completed"])("preserves range conversion through %s checkpoints", async mode => {
  const source = "const events=[];await 0;const start={valueOf(){events.push('start');return 3}};const end={valueOf(){events.push('end');return 1}};return ['abcd'.slice(start,end),'abcd'.substring(start,end),events];";
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

it.each(["slice", "substring"] as const)("coerces direct %s bounds without interpreter context", async method => {
  const start = { valueOf: createSandboxClosure({ sandbox: true, name: "valueOf", call: () => 1 }) };
  const end = { valueOf: createSandboxClosure({ sandbox: true, name: "valueOf", call: () => 3 }) };
  expect(await callStringMethod("abcd", method, [start, end], new Budget())).toBe("bc");
  await expect(callStringMethod("abcd", method, [start, end], new Budget({ stringLength: 1 })))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
});
