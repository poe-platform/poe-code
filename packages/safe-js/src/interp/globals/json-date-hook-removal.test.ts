import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each([
  ["deleted prototype hook", "delete Date.prototype.toJSON;"],
  ["null prototype", "Object.setPrototypeOf(date,null);"],
  ["replacement prototype", "Object.setPrototypeOf(date,{marker:1});"],
  ["undefined hook", "date.toJSON=undefined;"],
  ["inherited replacement hook", "Object.setPrototypeOf(date,{toJSON(){return 'custom'}});"],
  ["Proxy inherited hook", "Object.setPrototypeOf(date,new Proxy({},{get(t,key){return key==='toJSON'?()=> 'proxy':undefined}}));"],
])("serializes a Date with %s", async (_name, change) => {
  const source = `const date=new Date(0);date.extra=7;${change}
    return JSON.stringify([date,{date}]);`;
  const expected = runInNewContext(`(function(){"use strict";${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each(["pending", "completed"])("preserves a removed Date hook through %s checkpoints", async mode => {
  const source = "const date=new Date(0);date.extra=7;delete Date.prototype.toJSON;await 0;return JSON.stringify(date);";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: '{"extra":7}' });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: '{"extra":7}' });
  } finally {
    await completed;
  }
});
