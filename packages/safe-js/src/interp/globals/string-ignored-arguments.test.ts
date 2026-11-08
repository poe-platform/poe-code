import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

for (const method of ["toLowerCase", "toUpperCase", "trim", "trimStart", "trimEnd", "trimLeft", "trimRight"]) {
  it.each([
    ["function", "function(){throw 'unreached'}"],
    ["throwing conversion object", "{[Symbol.toPrimitive](){throw 'unreached'}}"],
    ["Symbol", "Symbol()"],
    ["evaluated expression", "(events.push('argument'),function(){})"],
  ])(`${method} ignores %s argument`, async (_name, argument) => {
    const source = `const events=[];const receiver={toString(){events.push('receiver');return '  ÄbC  '}};
      let result;try{result=String.prototype.${method}.call(receiver,${argument})}
      catch(e){result=typeof e==='object'?e.name:e}return [result,events];`;
    expect(await run(source)).toMatchObject({ ok: true,
      returnValue: runInNewContext(`(function(){"use strict";${source}})()`) });
  });
}
