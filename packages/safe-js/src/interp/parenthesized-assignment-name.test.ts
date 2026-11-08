import { Script } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each(["function(){}", "()=>0", "function*(){}", "async function(){}", "class {}"])(
  "does not infer a name through a parenthesized assignment target: %s", async expression => {
    const source=`let fn; (fn)=${expression}; return [fn.name,Object.getOwnPropertyDescriptor(fn,'name')];`;
    const native=new Script(`(()=>{${source}})()`).runInNewContext();
    expect(native[0]).toBe("");
    expect(await run(source)).toMatchObject({ok:true,returnValue:["",{value:"",writable:false,enumerable:false,configurable:true}]});
  }
);

it.each(["=", "||=", "??=", "&&="])("keeps named neighbors and logical assignment semantics: %s", async operator => {
  const source=`let a=${operator==="&&="?"true":"undefined"};let b=a;
    (a) ${operator} function(){}; b ${operator} function(){};return [a.name,b.name];`;
  expect(new Script(`(()=>{${source}})()`).runInNewContext()).toEqual(["","b"]);
  expect(await run(source)).toMatchObject({ok:true,returnValue:["","b"]});
});

it("preserves inferred and explicit names, source and generator replay", async () => {
  const source=`let fn;((fn))=function*(){yield 7;};let named; named=function(){};
    let explicit;(explicit)=function kept(){};const g=fn();const first=g.next();await 0;
    return [fn.name,named.name,explicit.name,fn.toString(),first.value,g.next().done,
      fn.constructor.constructor("return typeof process+','+typeof require")()];`;
  const expected={ok:true,returnValue:["","named","kept","function*(){yield 7;}",7,true,"undefined,undefined"]};
  let pending=run(source);
  for(let i=0;i<3;i++){
    const settled=pending.catch(error=>error);
    try{const saved=JSON.parse(await dump(pending));expect(await settled).toMatchObject(expected);
      pending=run(source,{snapshot:restore(saved,{source})});}finally{await settled;}
  }
  expect(await pending).toMatchObject(expected);
  const saved=JSON.parse(await dump(pending));
  expect(await run(source,{snapshot:restore(saved,{source})})).toMatchObject(expected);
});
