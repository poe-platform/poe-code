import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each(["x++", "++x", "x--", "--x"].flatMap(expression =>
  ["2", "2n"].map(numeric => ({expression, numeric}))
))("preserves the reference during $expression conversion from $numeric", async ({expression, numeric}) => {
    const body = `eval("var x");x={valueOf(){delete x;return ${numeric}}};const result=${expression};return [result,x,delete x,typeof x]`;
    const expected: unknown = runInNewContext(`Function(${JSON.stringify(body)})()`);
    expect(await run(`return Function(${JSON.stringify(body)})()`)).toMatchObject({ok: true, returnValue: expected});
});

it("rejects recreation through a strict update reference", async () => {
  const body = 'eval("var x");x={valueOf(){delete x;return 2}};return (function(){"use strict";try{return x++}catch(e){return e.name}})()';
  expect(await run(`return Function(${JSON.stringify(body)})()`)).toMatchObject({ok: true, returnValue: "ReferenceError"});
});
