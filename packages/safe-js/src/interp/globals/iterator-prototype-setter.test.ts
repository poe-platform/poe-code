import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

for (const key of ["'constructor'", "Symbol.toStringTag"]) {
  it.each([
    "Object.defineProperty(target,key,{value:1,writable:true,configurable:false});",
    "Object.defineProperty(target,key,{set(v){events.push(v)},configurable:false});",
    "Object.defineProperty(target,key,{value:1,writable:false,configurable:false});",
  ])(`preserves existing ordinary ${key} descriptors: %s`, async setup => {
    const source = `const key=${key};const target={};const events=[];${setup}
      let error;try{Object.getOwnPropertyDescriptor(Iterator.prototype,key).set.call(target,7)}catch(e){error=e.name}
      const d=Object.getOwnPropertyDescriptor(target,key);return [error,events,d.value,d.writable,d.enumerable,d.configurable];`;
    expect(await run(source)).toMatchObject({ ok: true,
      returnValue: runInNewContext(`(function(){"use strict";${source}})()`) });
  });
  it.each([
    ["new property", ""],
    ["existing writable property", "Object.defineProperty(target,key,{value:1,writable:true,configurable:false});"],
    ["existing accessor", "Object.defineProperty(target,key,{set(value){events.push(['setter',value,this===proxy])},configurable:false});"],
    ["refused definition", "handler.defineProperty=()=>{events.push('refuse');return false};"],
    ["descriptor throws", "handler.getOwnPropertyDescriptor=()=>{throw 'descriptor'};"],
  ])(`uses receiver operations for ${key}: %s`, async (_name, setup) => {
    const source = `const key=${key};const events=[];const target={};
      const handler={
        getOwnPropertyDescriptor(t,k){events.push('descriptor');return Reflect.getOwnPropertyDescriptor(t,k)},
        defineProperty(t,k,d){events.push(['define',d.value,d.writable,d.enumerable,d.configurable]);return Reflect.defineProperty(t,k,d)},
        set(t,k,v,r){events.push('set');return Reflect.set(t,k,v,r)}
      };
      const proxy=new Proxy(target,handler);${setup}
      const setter=Object.getOwnPropertyDescriptor(Iterator.prototype,key).set;
      let error;try{setter.call(proxy,7)}catch(e){error=typeof e==='object'?e.name:e}
      return [error,events,Object.getOwnPropertyDescriptor(target,key)?.value];`;
    const expected = runInNewContext(`(function(){"use strict";${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
}

it.each(["pending", "completed"])("retains Proxy setter writes through %s checkpoints", async mode => {
  const source = "const target={};const proxy=new Proxy(target,{});Object.getOwnPropertyDescriptor(Iterator.prototype,Symbol.toStringTag).set.call(proxy,'custom');await 0;return [target[Symbol.toStringTag],proxy[Symbol.toStringTag]];";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    if (mode === "completed") await completed;
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ ok: true, returnValue: ["custom", "custom"] });
    expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: ["custom", "custom"] });
  } finally {
    await completed;
  }
});
