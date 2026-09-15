import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each(["x", "x()"])("checks the binding again before reading %s", async expression => {
  const code=`const trace=[];const target={x:${expression==="x"?"7":"function(){return 7}"}};
    const p=new Proxy(target,{has(t,k){if(k==='x')trace.push('has');return Reflect.has(t,k)},
      get(t,k,r){if(k===Symbol.unscopables)trace.push('unscopables');if(k==='x')trace.push('get');return Reflect.get(t,k,r)}});
    with(p){${expression};} return trace;`;
  expect(await run(`return Function(${JSON.stringify(code)})();`)).toMatchObject({ok:true,returnValue:["has","unscopables","has","get"]});
});

it.each([false,true])("handles a binding removed by unscopables (strict=%s)", async strict => {
  const code=`const trace=[];const target={x:7};const p=new Proxy(target,{
    has(t,k){if(k==='x')trace.push('has');return Reflect.has(t,k)},
    get(t,k,r){if(k===Symbol.unscopables){trace.push('unscopables');delete t.x;return undefined;}if(k==='x')trace.push('get');return Reflect.get(t,k,r)}});
    let result;try{with(p){result=(function(){${strict?'"use strict";':''}return x;})()}}catch(e){result=e.name}
    return [result,trace];`;
  const expected=[strict?"ReferenceError":undefined,["has","unscopables","has"]];
  expect(await run(`return Function(${JSON.stringify(code)})();`)).toMatchObject({ok:true,returnValue:expected});
});

it("restores an object environment without exposing host authority", async () => {
  const code=`const trace=[];const p=new Proxy({x:7},{has(t,k){if(k==='x')trace.push('has');return Reflect.has(t,k)},
    get(t,k,r){if(k===Symbol.unscopables)trace.push('unscopables');if(k==='x')trace.push('get');return Reflect.get(t,k,r)}});
    with(p){return [()=>x,trace]}`;
  const source=`const pair=Function(${JSON.stringify(code)})();await 0;
    return [pair[0](),pair[1],pair[0].toString(),pair[0].constructor("return typeof process+','+typeof require")()];`;
  const expected={ok:true,returnValue:[7,["has","unscopables","has","get"],"()=>x","undefined,undefined"]};
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
