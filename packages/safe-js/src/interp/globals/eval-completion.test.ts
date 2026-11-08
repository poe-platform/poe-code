import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  "1;{}", "1;{2}", "1;{2;var x=3}", "1;{2;{}}", "1;{2;void 0}",
  "1;if(false)2", "1;if(true){2}", "1;if(true){}", "1;if(false){}else{3}",
  "1;label:{2;break label;}", "1;label:{break label;}",
  "1;try{2;var x=3}finally{}", "1;try{}finally{3}",
  "1;try{throw 7}catch(e){e;var x=3}", "1;try{throw 7}catch(e){}",
  "function f(){3;return;} f()", "function f(){if(true){3}} f()"
])("preserves eval statement completion: %s", async source => {
  const program = `eval(${JSON.stringify(source)})`;
  const expected: unknown = runInNewContext(`'use strict';${program}`);
  expect(await run(`return ${program}`)).toMatchObject({ok: true, returnValue: expected});
});
