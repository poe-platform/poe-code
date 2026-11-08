import { expect, it } from "vitest";
import { run } from "../../run.js";

it("Promise.catch invokes the receiver's own then", async () => {
  expect((await run(`
    const value=Promise.resolve(1);
    value.then=function(onFulfilled,onRejected){
      return this===value && onFulfilled===undefined && onRejected===42;
    };
    return value.catch(42);
  `)).returnValue).toBe(true);
});

it("reads the own getter once and preserves call order", async () => {
  expect((await run(`
    const value=Promise.resolve(1), events=[];
    Object.defineProperty(value,"then",{get(){
      if(this!==value)throw new Error("getter receiver");
      events.push("get");
      return function(a,b){events.push("call");return this===value && a===undefined && b===42};
    }});
    const result=value.catch(42);events.push("after");
    return result===true && events.join(",")==="get,call,after";
  `)).returnValue).toBe(true);
});

it.each(["undefined", "null", "42"])("rejects non-callable own then %s synchronously", async value => {
  expect((await run(`
    const promise=Promise.resolve(1);promise.then=${value};
    try{promise.catch(()=>0);return false}catch(error){return error instanceof TypeError}
  `)).returnValue).toBe(true);
});

it("propagates getter errors synchronously", async () => {
  expect((await run(`
    const value=Promise.resolve(1), marker={};
    Object.defineProperty(value,"then",{get(){throw marker}});
    try{value.catch(()=>0);return false}catch(error){return error===marker}
  `)).returnValue).toBe(true);
});
