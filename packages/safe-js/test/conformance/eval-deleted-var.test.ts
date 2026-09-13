import { expect, it } from "vitest";
import { createTest262Realm } from "./realm.js";
import { run } from "../../src/run.js";
import { dump } from "../../src/dump.js";
import { restore } from "../../src/restore.js";

// ECMA-262 2025 14.3.2.1: a var declaration without an initializer
// returns empty; it neither resolves nor assigns its binding at evaluation.
it.each(["var x;", "for(var x;false;){}"])("does not recreate a deleted eval binding at %s", async declaration => {
  const realm = createTest262Realm();
  try {
    expect(await realm.evaluate(`var read;
      (function(){eval(${JSON.stringify(`delete x; read=()=>x; ${declaration}`)})})();
      var result;try{read()}catch(error){result=error.name}
      [result,Object.hasOwn(globalThis,"x")].join(",")`))
      .toEqual({status:"normal",value:"ReferenceError,false"});
  } finally { await realm.dispose(); }
});

it("keeps a deleted eval binding absent across repeated suspension and replay", async () => {
  const source = `const read=Function("eval('delete x;var x');return ()=>{try{return x}catch(e){return e.name}}")();
    await 0;return [read(),Object.hasOwn(globalThis,"x")];`;
  let pending = run(source);
  for (let cycle = 0; cycle < 3; cycle++) {
    const settled = pending.catch(error => error);
    try {
      const saved = JSON.parse(await dump(pending));
      expect(await settled).toMatchObject({ok:true,returnValue:["ReferenceError",false]});
      pending = run(source, {snapshot:restore(saved,{source})});
    } finally { await settled; }
  }
  expect(await pending).toMatchObject({ok:true,returnValue:["ReferenceError",false]});
  const completed = JSON.parse(await dump(pending));
  expect(await run(source,{snapshot:restore(completed,{source})}))
    .toMatchObject({ok:true,returnValue:["ReferenceError",false]});
});

it.each([
  ["var x;", "undefined,false"],
  ["delete x; var x=7;", "number,true"]
])("preserves hoisting and initialized assignment: %s", async (body, expected) => {
  const realm = createTest262Realm();
  try {
    expect(await realm.evaluate(`var result;(function(){eval(${JSON.stringify(body + ';result=typeof x;')})})();
      [result,Object.hasOwn(globalThis,"x")].join(",")`))
      .toEqual({status:"normal",value:expected});
  } finally { await realm.dispose(); }
});
