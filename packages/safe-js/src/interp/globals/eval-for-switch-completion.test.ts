import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  "1;for(;false;)2",
  "1;for(7;false;8)2",
  "for(let i=0;i<3;i++)i",
  "1;for(;;){2;break}",
  "1;for(;;){break}",
  "for(let i=0;i<3;i++){i;continue}",
  "outer:for(;;){2;for(;;){3;break outer}}",
  "outer:for(let i=0;i<2;i++){2;for(;;){3;continue outer}}",
  "for(let i=0;i<2;i++){if(i===0)7}",
  "1;switch(0){}",
  "1;switch(0){case 1:2}",
  "1;switch(0){case 0:2}",
  "1;switch(0){case 0:2;break}",
  "1;switch(0){case 0:break}",
  "1;switch(0){case 0:2;case 1:3}",
  "1;switch(0){case 0:2;case 1:var x}",
  "1;switch(0){default:3;case 1:4}",
  "1;switch(0){default:3;case 0:4;break}",
  "outer:{switch(0){case 0:2;break outer}}",
  "for(let i=0;i<2;i++){switch(i){case 0:3;continue;case 1:4;continue}}",
  "1;switch(0){case 0:2;void 0}",
  "1;switch(0){case 0:2;if(false)3}"
])("preserves eval for/switch completion: %s", async source => {
  const program = `eval(${JSON.stringify(source)})`;
  const expected: unknown = runInNewContext(`'use strict';${program}`);
  expect(await run(`return ${program}`)).toMatchObject({ ok: true, returnValue: expected });
});
