import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

const methods = ["from", "fromAsync", "of"] as const;

it.each(methods)("Array.%s defines elements through a constructor result Proxy", async method => {
  const source = `
    const events=[];
    const target={};
    function C(){return new Proxy(target,{
      defineProperty(t,key,d){
        events.push([key,d.value,d.writable,d.enumerable,d.configurable]);
        return Reflect.defineProperty(t,key,d);
      }
    })}
    const value=await Array.${method}.call(C,${method === "of" ? "3,4" : "[3,4]"});
    return [events,value[0],value[1],value.length,value===target];
  `;
  const expected = [
    [["0", 3, true, true, true], ["1", 4, true, true, true], ["length", 2, true, true, true]],
    3, 4, 2, false
  ];
  if (runInNewContext(`typeof Array.${method}`) === "function") {
    expect(await runInNewContext(`(async()=>{${source}})()`)).toEqual(expected);
  }
  const result = await run(source);
  expect(result).toMatchObject({ ok: true, returnValue: expected });
  expect(await run(source, { snapshot: JSON.parse(await dump(result)) }))
    .toMatchObject({ ok: true, returnValue: expected });
});

it.each(methods)("Array.%s stops when a result Proxy refuses an element", async method => {
  const source = `
    const events=[];
    function C(){return new Proxy({}, {
      defineProperty(t,key,d){events.push(key);return key!=='1'&&Reflect.defineProperty(t,key,d)}
    })}
    try{await Array.${method}.call(C,${method === "of" ? "3,4,5" : "[3,4,5]"})}
    catch(error){events.push(error.name)}
    return events;
  `;
  const expected = ["0", "1", "TypeError"];
  if (runInNewContext(`typeof Array.${method}`) === "function") {
    expect(await runInNewContext(`(async()=>{${source}})()`)).toEqual(expected);
  }
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each(["from", "fromAsync"])("Array.%s closes the source after a result definition failure", async method => {
  const source = `
    const events=[];
    function C(){return new Proxy({}, {defineProperty(){events.push('define');throw 'definition failed'}})}
    let sent=false;
    const source={
      [Symbol.iterator](){return this},
      next(){events.push('next');if(sent)return {done:true};sent=true;return {done:false,value:3}},
      return(){events.push('close');throw 'close failed'}
    };
    try{await Array.${method}.call(C,source)}catch(error){events.push(error)}
    return events;
  `;
  const expected = ["next", "define", "close", "definition failed"];
  // Native fromAsync on Node 22/26 spins when both definition and close throw.
  // Keep the guest regression, with a synchronous native control only here.
  if (method === "from") {
    expect(await runInNewContext(`(async()=>{${source}})()`)).toEqual(expected);
  }
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});
