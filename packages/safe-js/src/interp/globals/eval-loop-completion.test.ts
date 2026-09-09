import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  "1;while(false)2",
  "let i=0;while(i++<3)i",
  "1;while(true){2;break}",
  "1;while(true){break}",
  "let i=0;while(i++<3){i;continue}",
  "let i=0;while(i++<3){if(i===2)continue;i}",
  "outer:while(true){2;while(true){3;break outer}}",
  "let i=0;outer:while(i++<2){2;while(true){3;continue outer}}",
  "1;do{}while(false)",
  "1;do{2}while(false)",
  "let i=0;do{i}while(++i<3)",
  "1;do{2;break}while(true)",
  "1;do{break}while(true)",
  "let i=0;do{i;continue}while(++i<3)",
  "outer:do{2;do{3;break outer}while(true)}while(true)",
  "let i=0;outer:do{2;do{3;continue outer}while(true)}while(++i<2)",
  "let i=0;while(i++<2){if(i===1)7}",
  "let i=0;do{if(i===0)7}while(++i<2)"
])("preserves eval loop completion: %s", async source => {
  const program = `eval(${JSON.stringify(source)})`;
  const expected: unknown = runInNewContext(`'use strict';${program}`);
  expect(await run(`return ${program}`)).toMatchObject({ ok: true, returnValue: expected });
});
