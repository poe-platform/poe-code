import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  "[value=(delete globalThis.value,7)]=[]",
  "({value=(delete globalThis.value,7)}={})",
  "[globalThis.value=(delete globalThis.value,7)]=[]",
  "({value:globalThis.value=(delete globalThis.value,7)}={})"
])("preserves strict binding versus property references: %s", async assignment => {
  const source = `globalThis.value=1;try{${assignment}}catch(error){return [error.name,Object.hasOwn(globalThis,'value')]}return ['assigned',globalThis.value]`;
  const expected = runInNewContext(`(function(){'use strict';${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each([
  "[value=(delete globalThis.value,7)]=[]",
  "({value=(delete globalThis.value,7)}={})"
])("allows deleted non-strict bindings to be recreated: %s", async assignment => {
  const body = `globalThis.value=1;${assignment};return [value,globalThis.value]`;
  const source = `return Function(${JSON.stringify(body)})()`;
  expect(await run(source)).toMatchObject({
    ok: true, returnValue: runInNewContext(`(function(){${source}})()`)
  });
});
