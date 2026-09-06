import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../run.js";
import { parseModule } from "../parse/parser.js";

it.each([
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
  "exit:{while(true){continue exit}}"
])("rejects invalid labels as native JavaScript does: %s", source => {
  expect(() => runInNewContext(source)).toThrow();
  expect(() => parseModule(source)).toThrow();
});
