import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  "1;for(const x of [])2",
  "for(const x of [1,2,3])x",
  "1;for(const x of [1]){2;break}",
  "1;for(const x of [1]){break}",
  "for(const x of [1,2,3]){x;continue}",
  "outer:for(const x of [1]){2;for(const y of [1]){3;break outer}}",
  "outer:for(const x of [1,2]){2;for(const y of [1]){3;continue outer}}",
  "for(const x of [1,2]){if(x===1)7}",
  "1;for(const x in {})2",
  "1;for(const x in null)2",
  "1;for(const x in undefined)2",
  "for(const x in {a:1,b:2})x",
  "1;for(const x in {a:1}){2;break}",
  "1;for(const x in {a:1}){break}",
  "for(const x in {a:1,b:2}){x;continue}",
  "outer:for(const x in {a:1}){2;for(const y in {a:1}){3;break outer}}",
  "outer:for(const x in {a:1,b:2}){2;for(const y in {a:1}){3;continue outer}}",
  "for(const x in {a:1,b:2}){if(x==='a')7}",
  "let closed=0;function* g(){try{yield 1}finally{closed++}}const v=eval('for(const x of g()){7;break}');[v,closed]",
  "let closed=0;function* g(){try{yield 1}finally{closed++;throw 9}}try{eval('for(const x of g()){7;break}')}catch(e){[e,closed]}"
])("preserves eval iteration completion: %s", async source => {
  const program = `eval(${JSON.stringify(source)})`;
  const expected: unknown = runInNewContext(`'use strict';${program}`);
  expect(await run(`return ${program}`)).toMatchObject({ ok: true, returnValue: expected });
});
