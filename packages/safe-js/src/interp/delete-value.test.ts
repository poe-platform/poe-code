import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  "return delete 1",
  "return delete null",
  "return delete 'text'",
  "return delete ({value:1})",
  "return delete (()=>1)",
  "const o={get value(){throw new Error('read')}};return [delete o.value,'value' in o]",
  "const o=null;return delete o?.value",
  "let evaluations=0;function base(){evaluations++;return null}return [delete base()?.value,evaluations]",
  "let evaluations=0;function base(){evaluations++;return null}try{return delete base().value}catch(error){return [error.name,evaluations]}",
  "let n=0;const result=delete(n++);return [result,n]",
  "let n=0;const result=delete(n=3);return [result,n]",
  "let n=0;const result=delete (n++,n++);return [result,n]",
  "const o={get value(){throw new Error('read')}};try{return delete (0,o.value)}catch(e){return e.message}",
  "let n=0;const result=delete await Promise.resolve(++n);return [result,n]",
  "function* f(){return delete (yield 7)}const g=f();return [g.next(),g.next(9)]",
  "const o={value:3};return [delete (0,o.value),o.value]"
])("matches native deletion of a value expression: %s", async source => {
  const expected: unknown = await runInNewContext(`(async function(){'use strict';${source}})()`);
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});
