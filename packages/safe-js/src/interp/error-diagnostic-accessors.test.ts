import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../run.js";

it.each(["span", "stack"])("does not read a guest %s accessor while transferring a throw to catch", async key => {
  const source = `let reads=0;const error=new Error('original');Object.defineProperty(error,'${key}',{get(){reads++;throw 7}});let same=false;try{throw error}catch(caught){same=caught===error}return [same,reads]`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){${source}})()`)});
});

it.each([false,true])("does not execute a stack accessor while formatting a public failure (frozen=%s)", async frozen => {
  const source = `const error=new TypeError('original');Object.defineProperty(error,'stack',{get(){throw 7}});${frozen ? "Object.freeze(error);" : ""}throw error`;
  await expect(run(source)).rejects.toMatchObject({name:"TypeError",message:"original"});
});
