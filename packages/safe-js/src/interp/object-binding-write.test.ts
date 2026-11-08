import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each(["x=9", "x+=2", "x++", "++x", "x--", "--x"])("checks the object binding before writing %s", async expression => {
  const body=`const trace=[];const target={x:7};const p=new Proxy(target,{
    has(t,k){if(k==='x')trace.push('has');return Reflect.has(t,k)},
    get(t,k,r){if(k===Symbol.unscopables)trace.push('unscopables');if(k==='x')trace.push('get');return Reflect.get(t,k,r)},
    set(t,k,v){if(k==='x')trace.push('set');t[k]=v;return true}});
    with(p){${expression};}return trace;`;
  expect(await run(`return Function(${JSON.stringify(body)})();`)).toMatchObject({ok:true,
    returnValue:expression==="x=9"?["has","unscopables","has","set"]:["has","unscopables","has","get","has","set"]});
});

it.each(["x++", "++x", "x--", "--x"])("rejects a strict update after coercion deletes %s", async expression => {
  const body=`const target={x:{valueOf(){delete target.x;return 7}}};let result;
    with(target){try{(function(){'use strict';${expression}})()}catch(e){result=e.name}}
    return [result,Object.hasOwn(target,'x')];`;
  expect(await run(`return Function(${JSON.stringify(body)})();`)).toMatchObject({ok:true,returnValue:["ReferenceError",false]});
});

it("replays a retained with-environment update with its source and authority", async () => {
  const body=`const trace=[];const target={x:7};const p=new Proxy(target,{
    has(t,k){if(k==='x')trace.push('has');return Reflect.has(t,k)},
    get(t,k,r){if(k===Symbol.unscopables)trace.push('unscopables');if(k==='x')trace.push('get');return Reflect.get(t,k,r)},
    set(t,k,v){if(k==='x')trace.push('set');t[k]=v;return true}});with(p){return [()=>x++,trace]}`;
  const source=`const pair=Function(${JSON.stringify(body)})();await 0;return [pair[0](),pair[1],pair[0].toString(),pair[0].constructor("return typeof process+','+typeof require")()];`;
  const expected={ok:true,returnValue:[7,["has","unscopables","has","get","has","set"],"()=>x++","undefined,undefined"]};
  let pending=run(source);
  for(let i=0;i<3;i++){
    const settled=pending.catch(error=>error);
    try{const saved=JSON.parse(await dump(pending));expect(await settled).toMatchObject(expected);
      pending=run(source,{snapshot:restore(saved,{source})});}finally{await settled;}
  }
  expect(await pending).toMatchObject(expected);
  expect(await run(source,{snapshot:restore(JSON.parse(await dump(pending)),{source})})).toMatchObject(expected);
});
