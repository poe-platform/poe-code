import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  "return delete (1).missing",
  "return delete true.missing",
  "return delete 'abc'.missing",
  "return delete Symbol('x').missing",
  "return delete (1n).missing",
  "try{return delete 'abc'[0]}catch(e){return e.name}",
  "try{return delete 'abc'.length}catch(e){return e.name}",
  "try{return delete null.missing}catch(e){return e.name}",
  "try{return delete undefined.missing}catch(e){return e.name}",
  "return delete 'abc'[3]",
  "return delete 'abc'['01']",
  "let n=0;const result=delete (1)[{toString(){n++;return 'missing'}}];return [result,n]",
  "try{return delete (1)[{toString(){throw new Error('key')}}]}catch(e){return e.message}",
  "return delete (1)?.missing"
])("matches native primitive property deletion: %s", async source => {
  const expected: unknown = runInNewContext(`(function(){'use strict';${source}})()`);
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});
