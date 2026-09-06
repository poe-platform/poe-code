import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../../core.js";

describe.each([
  ['string replace', 'replace', "'a'"],
  ['string replaceAll', 'replaceAll', "'a'"],
  ['regex replace', 'replace', '/a/g'],
  ['regex replaceAll', 'replaceAll', '/a/g']
])("replacement result coercion: %s", (_name, method, pattern) => {
  it.each([
    "({toString(){return 'b'}})",
    "({[Symbol.toPrimitive](hint){return hint}})",
    "({toString(){return {}},valueOf(){return 7}})",
    "({get toString(){throw 'getter'}})",
    "Symbol('replacement')",
    "Promise.resolve('b')",
    "undefined"
  ])("matches native result %s", async expression => {
    const source = `try{return 'aa'.${method}(${pattern},()=>${expression})}catch(error){return typeof error==='string'?error:error.name}`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(function(){'use strict';" + source + "})()") });
  });

  it("converts each result before the next callback", async () => {
    const source = `const log=[];const result='aa'.${method}(${pattern},(match,index)=>{log.push('call'+index);return {toString(){log.push('string'+index);return '$&'}}});return [result,log];`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(function(){'use strict';" + source + "})()") });
  });

  it("stringifies rather than awaits an async callback result", async () => {
    const source = `return 'aa'.${method}(${pattern},async()=>{await 0;return 'b'});`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(function(){'use strict';" + source + "})()") });
  });
});

describe.each(["'a'", '/a/g'])("replacement accumulated data: %s", pattern => {
  it("does not count the completed output twice", async () => {
    const source = `return 'a'.replaceAll(${pattern},()=> 'x'.repeat(4000));`;
    expect(await run(source, { budget: new Budget({ dataSize: 6000 }) })).toMatchObject({ ok: true, returnValue: 'x'.repeat(4000) });
  });

  it("keeps previous replacement text live during later callbacks", async () => {
    const source = `return 'aa'.replaceAll(${pattern},(match,index)=>{if(index===0)return 'x'.repeat(4000);const temporary='y'.repeat(4000);return 'y'});`;
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: 'budgetExceeded', budget: 'dataSize' });
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: 'x'.repeat(4000) + 'y' });
  });
});
