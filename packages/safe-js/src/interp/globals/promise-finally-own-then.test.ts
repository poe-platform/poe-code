import { expect, it } from "vitest";
import { run } from "../../run.js";

it("Promise.finally invokes the receiver's own then", async () => {
  const result = await run(`
    const value=Promise.resolve(1);
    value.then=function(onFulfilled,onRejected){
      return this===value && onFulfilled===42 && onRejected===42;
    };
    return value.finally(42);
  `);
  expect(result.returnValue === true).toBe(true);
});

it("reads the getter once before returning and preserves receiver identity", async () => {
  const result = await run(`
    const value=Promise.resolve(1), events=[];
    Object.defineProperty(value,"then",{get(){
      if(this!==value)throw new Error("getter receiver");
      events.push("get");
      return function(a,b){events.push("call");return this===value && a===42 && b===42};
    }});
    const result=value.finally(42);events.push("after");
    return result===true && events.join(",")==="get,call,after";
  `);
  expect(result.returnValue === true).toBe(true);
});

it.each(["undefined", "null", "42"])("throws synchronously for non-callable own then %s", async then => {
  const result = await run(`
    const value=Promise.resolve(1);value.then=${then};
    try{value.finally(()=>0);return false}catch(error){return error instanceof TypeError}
  `);
  expect(result.returnValue === true).toBe(true);
});

it("propagates a getter error synchronously without calling cleanup", async () => {
  const result = await run(`
    const value=Promise.resolve(1), marker={};let calls=0;
    Object.defineProperty(value,"then",{get(){throw marker}});
    try{value.finally(()=>{calls++});return false}catch(error){return error===marker && calls===0}
  `);
  expect(result.returnValue === true).toBe(true);
});

it.each(["fulfilled", "rejected"])("provides cleanup wrappers preserving the %s result", async state => {
  const result = await run(`
    const value=Promise.resolve(1);let calls=0;
    value.then=function(fulfilled,rejected){
      if(this!==value || typeof fulfilled!=="function" || typeof rejected!=="function")throw new Error("handlers");
      return ${state}(42);
    };
    const pending=value.finally(function(){if(this!==undefined)throw new Error("cleanup receiver");calls++;return 99});
    try{const answer=await pending;return "${state}"==="fulfilled" && answer===42 && calls===1}
    catch(error){return "${state}"==="rejected" && error===42 && calls===1}
  `);
  expect(result.returnValue === true).toBe(true);
});
