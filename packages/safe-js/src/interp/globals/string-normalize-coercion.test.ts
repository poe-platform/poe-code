import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget } from "../budget.js";
import { createSandboxClosure } from "../values.js";
import { callStringMethod } from "../methods/string.js";

it.each([
  ["default form", "undefined"],
  ["ordered conversion", "{toString(){events.push('form');return 'NFD'}}"],
  ["throwing conversion", "{toString(){throw 'form'}}"],
  ["primitive hint", "{[Symbol.toPrimitive](hint){events.push(hint);return 'NFC'}}"],
  ["fallback conversion", "{toString(){events.push('toString');return {}},valueOf(){events.push('valueOf');return 'NFKD'}}"],
  ["callable form", "Object.assign(function(){},{toString(){return 'NFKC'}})"],
  ["invalid form", "{toString(){return 'invalid'}}"],
  ["Symbol form", "Symbol()"],
  ["null form", "null"],
  ["ignored extra argument", "'NFC',()=>{throw 'unreached'}"],
])("normalize: %s", async (_name, form) => {
  const source = `const events=[];const receiver={toString(){events.push('receiver');return 'éﬀ'}};
    let result;try{result=String.prototype.normalize.call(receiver,${form})}
    catch(e){result=typeof e==='object'?e.name:e}return [result,events];`;
  expect(await run(source)).toMatchObject({ ok: true,
    returnValue: runInNewContext(`(function(){"use strict";${source}})()`) });
});

it.each(["pending", "completed"])("preserves normalize conversion through %s checkpoints", async mode => {
  const source = "const events=[];await 0;const form={toString(){events.push('form');return 'NFD'}};return ['é'.normalize(form),events];";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    const expected = { ok: true, returnValue: ["é", ["form"]] };
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot })).toMatchObject(expected);
  } finally { await completed; }
});

it("coerces direct normalize form without interpreter context", async () => {
  const form = { toString: createSandboxClosure({ sandbox: true, name: "toString", call: () => "NFKD" }) };
  expect(await callStringMethod("éﬀ", "normalize", [form], new Budget())).toBe("éﬀ".normalize("NFKD"));
});
