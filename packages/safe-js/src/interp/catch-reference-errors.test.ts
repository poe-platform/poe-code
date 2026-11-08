import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  'try{missing}catch(e){return [e.name,e instanceof ReferenceError]}',
  'try{missing()}catch(e){return e.name}',
  'try{missing++}catch(e){return e.name}',
  'let finalized=false;try{try{missing}finally{finalized=true}}catch(e){return [e.name,finalized]}',
  'let finalized=false;try{try{throw 1}catch(e){missing}finally{finalized=true}}catch(e){return [e.name,finalized]}',
  'try{try{throw 1}finally{missing}}catch(e){return e.name}',
  'try{try{missing}finally{return 7}}catch(e){return e.name}',
  'try{typeof missing;return "ok"}catch(e){return e.name}'
])("catches source reference errors: %s", async source => {
  const expected: unknown = runInNewContext(`(function(){'use strict';${source}})()`);
  expect(await run(source)).toMatchObject({ok: true, returnValue: expected});
});

it("preserves the public diagnostic for an unhandled bare reference", async () => {
  expect(await run("return missing")).toMatchObject({ok: false, error: {code: "UNBOUND_IDENTIFIER", name: "ReferenceError"}});
});
