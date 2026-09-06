import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each(["new Promise(resolve=>resolve(value))","(value.constructor={},Promise.resolve(value))"])("uses own then when resolving through %s", async create => {
  const source=`const value=Promise.resolve(1);value.then=resolve=>resolve(42);return await ${create}`;
  expect((await run(source)).returnValue).toBe(42);
});

it("reads then once with the promise receiver and honors first settlement", async () => {
  expect((await run(`
    const value=Promise.resolve(1);
    let reads=0;
    Object.defineProperty(value,"then",{get(){
      if(this!==value)throw new Error("receiver");
      reads++;
      return function(resolve,reject){
        if(this!==value)throw new Error("call receiver");
        resolve(42);reject(2);throw new Error("late");
      };
    }});
    const answer=await new Promise(resolve=>resolve(value));
    return answer===42 && reads===1;
  `)).returnValue).toBe(true);
});

it("rejects when the then getter throws", async () => {
  expect((await run(`
    const value=Promise.resolve(1), error={};
    Object.defineProperty(value,"then",{get(){throw error}});
    try {await new Promise(resolve=>resolve(value));return false}
    catch(caught){return caught===error}
  `)).returnValue).toBe(true);
});

it("keeps same-constructor Promise.resolve identity without reading then", async () => {
  expect((await run(`
    const value=Promise.resolve(1);
    Object.defineProperty(value,"then",{get(){throw new Error("unexpected")}});
    return Promise.resolve(value)===value;
  `)).returnValue).toBe(true);
});

it("fulfills with the promise object when its own then is not callable", async () => {
  expect((await run(`
    const value=Promise.resolve(1);value.then=0;
    return await new Promise(resolve=>resolve(value)).then(result=>result===value);
  `)).returnValue).toBe(true);
});

it("reads the getter before resolve returns but invokes then in a job", async () => {
  expect((await run(`
    const events=[], value=Promise.resolve(1);
    Object.defineProperty(value,"then",{get(){events.push("get");return resolve=>{events.push("call");resolve(42)}}});
    const result=new Promise(resolve=>{resolve(value);events.push("after")});
    await result;
    return events.join(",");
  `)).returnValue).toBe("get,after,call");
});

it("rejects indirect self-resolution through an overridden then", async () => {
  expect((await run(`
    let settle;
    const result=new Promise(resolve=>{settle=resolve});
    const value=Promise.resolve(1);value.then=resolve=>resolve(result);
    settle(value);
    try{await result;return false}catch(error){return error instanceof TypeError}
  `)).returnValue).toBe(true);
});
