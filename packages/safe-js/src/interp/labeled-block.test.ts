import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../run.js";
import { parseModule } from "../parse/parser.js";

it.each([
  "let n=0;exit:if(true){n++;break exit;n+=10}return n",
  "let n=0;exit:switch(1){case 1:n++;break exit;default:n+=10}return n",
  "let n=0;exit:n++;return n",
  "let n=0;first:second:if(true){n++;break first}return n",
  "let n=0;exit:try{n++;break exit}finally{n++}return n",
  "let n=0;exit:var value=++n;return [value,n]",
  "let n=0;exit:;return n",
  "exit:return 7",
  "try{exit:throw 7}catch(error){return error}",
  "let n=0;while(n<2){exit:if(true){n++;continue}}return n",
  "let n=0;outer:while(n<2){n++;exit:continue outer}return n",
  "let n=0;exit:{n++;break exit;n+=10}return n",
  "let n=0;first:second:{n++;break first;n+=10}return n",
  "let n=0;exit:{for(let i=0;i<3;i++){n++;if(i===1)break exit}}return n",
  "let n=0;outer:while(n<3){inner:{n++;continue outer}}return n"
])("matches native labeled block execution: %s", async source => {
  const expected = runInNewContext(`(function(){${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each([
  "exit:{break}", "exit:{continue exit}", "exit:exit:{}",
  "exit:{function f(){break exit}}", "while(true){break missing}",
  "exit:{while(true){continue exit}}",
  "exit:if(true){continue exit}", "exit:switch(1){case 1:continue exit}",
  "exit:let value=1", "exit:const value=1", "exit:class Value{}",
  "exit:function value(){}", "exit:async function value(){}"
])("rejects invalid labels as native JavaScript does: %s", source => {
  expect(() => runInNewContext(`"use strict";${source}`)).toThrow();
  expect(() => parseModule(source)).toThrow();
});
