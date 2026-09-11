import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each(["then", "finally"])("Promise.%s validates an own constructor property", async method => {
  const result = await run(`
    const value=Promise.resolve(1);value.constructor=42;
    try{value.${method}(()=>0);return false}catch(error){return error instanceof TypeError}
  `);
  expect(result.returnValue === true).toBe(true);
});

it.each(["then", "finally"])("Promise.%s propagates constructor getter errors synchronously", async method => {
  const result = await run(`
    const value=Promise.resolve(1), marker={};let calls=0;
    Object.defineProperty(value,"constructor",{get(){throw marker}});
    try{value.${method}(()=>{calls++});return false}catch(error){return error===marker && calls===0}
  `);
  expect(result.returnValue === true).toBe(true);
});

it("then reads the constructor once with the correct receiver before returning", async () => {
  const result = await run(`
    const value=Promise.resolve(1), events=[];
    Object.defineProperty(value,"constructor",{get(){
      if(this!==value)throw new Error("receiver");events.push("get");return Promise;
    }});
    const pending=value.then(answer=>answer+1);events.push("after");
    return (await pending)===2 && events.join(",")==="get,after";
  `);
  expect(result.returnValue === true).toBe(true);
});

it("finally reads the constructor before its own then", async () => {
  const result = await run(`
    const value=Promise.resolve(1), events=[];
    Object.defineProperty(value,"constructor",{get(){
      if(this!==value)throw new Error("receiver");events.push("constructor");return Promise;
    }});
    Object.defineProperty(value,"then",{get(){events.push("then");return ()=>42}});
    const answer=value.finally(0);events.push("after");
    return answer===42 && events.join(",")==="constructor,then,after";
  `);
  expect(result.returnValue === true).toBe(true);
});

it.each(["then", "finally"])("Promise.%s accepts an undefined own constructor", async method => {
  const result = await run(`
    const value=Promise.resolve(1);value.constructor=undefined;
    return (await value.${method}())===1;
  `);
  expect(result.returnValue === true).toBe(true);
});
