import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  "return [typeof eval,eval.name,eval.length,Object.hasOwn(eval,'prototype')]",
  "return [eval(),eval(undefined),eval(null),eval(7),eval(true)]",
  "const value={toString(){throw 1}};return eval(value)===value",
  "const seen=[];const value=eval('1+2',seen.push(1));return [value,seen]",
  "return eval('1+2')",
  "let x=3;return eval('x+2')",
  "let x=3;eval('x=7');return x",
  "let x=3;return [eval('let x=7; x'),x]",
  "eval('var local=7');return typeof local",
  "return Function('eval(\"var local=7\");return local')()",
  `return Function(${JSON.stringify(`eval('"use strict";var local=7');return typeof local`)})()`,
  "return Function('x','eval(\"var x=7\");return x')(2)",
  "globalThis.visible=9;let visible=2;return (0,eval)('visible')",
  "globalThis.visible=9;let visible=2;return eval?.('visible')",
  "globalThis.visible=9;let visible=2;const other=eval;return other('visible')",
  "let visible=2;return (eval)('visible')",
  "const evalLike=(x)=>x;return evalLike('1+2')",
  "return Function('const eval=x=>x;return eval(\"1+2\")')()",
  "const other=eval;return other('this===globalThis')",
  "function f(){return eval('this')};return f.call(3)",
  "function f(){return eval('arguments[0]')};return f(9)",
  "function f(){this.match=eval('new.target')===f};return new f().match",
  "try{eval('return 1')}catch(e){return e.name}",
  "try{eval('with({}){}')}catch(e){return e.name}",
  "try{eval('throw 7')}catch(e){return e}",
  "return (0,eval)('[typeof process,typeof require,typeof Buffer]')"
])("implements guest eval calls and scope: %s", async source => {
  const expected: unknown = runInNewContext(`(function(){'use strict';${source}})()`);
  expect(await run(source)).toMatchObject({ok: true, returnValue: expected});
});
