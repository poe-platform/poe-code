import { expect, it } from "vitest";
import { run } from "../../run.js";

it("reads an own constructor getter once before returning the same promise", async () => {
  const source=`const value=Promise.resolve(1);let reads=0;
    Object.defineProperty(value,"constructor",{get(){reads++;return Promise}});
    return [Promise.resolve(value)===value,reads]`;
  expect((await run(source)).returnValue).toEqual([true,1]);
});

it("creates a new promise when the input constructor differs", async () => {
  const source=`const value=Promise.resolve(1);value.constructor={};const result=Promise.resolve(value);
    return [result===value,await result]`;
  expect((await run(source)).returnValue).toEqual([false,1]);
});

it("propagates constructor getter errors synchronously", async () => {
  const source=`const value=Promise.resolve(1);const error={};Object.defineProperty(value,"constructor",{get(){throw error}});
    try{Promise.resolve(value);return false}catch(caught){return caught===error}`;
  expect((await run(source)).returnValue).toBe(true);
});

it("returns a same-constructor promise without creating a new capability", async () => {
  const source=`const receiver={};const value=Promise.resolve(1);value.constructor=receiver;
    return Promise.resolve.call(receiver,value)===value`;
  expect((await run(source)).returnValue).toBe(true);
});
