import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each(["42", "true", '"text"', 'Symbol("x")'])("returns primitive target %s unchanged", async expression => {
  const source=`const value=${expression};return [Object.setPrototypeOf(value,{})===value,Object.setPrototypeOf(value,null)===value]`;
  expect((await run(source)).returnValue).toEqual([true,true]);
});

it.each(["42", "true", '"text"', 'Symbol("x")'])("validates the prototype before returning %s", async expression => {
  const source=`const value=${expression};const results=[];
    for(const prototype of [undefined,1,true,"text",Symbol("bad")]) {
      try {Object.setPrototypeOf(value,prototype);results.push(false)}catch(error){results.push(error instanceof TypeError)}
    }return results`;
  expect((await run(source)).returnValue).toEqual([true,true,true,true,true]);
});

it.each(["null", "undefined"])("rejects nullish target %s", async expression => {
  const source=`try {Object.setPrototypeOf(${expression},{});return false}catch(error){return error instanceof TypeError}`;
  expect((await run(source)).returnValue).toBe(true);
});

it("accepts object prototypes without accessing or changing primitive targets", async () => {
  const source=`const value=42;const results=[];
    for(const prototype of [Promise.resolve(1),new Map(),new Set(),/x/,()=>0]) {
      results.push(Object.setPrototypeOf(value,prototype)===value);
    }return results`;
  expect((await run(source)).returnValue).toEqual([true,true,true,true,true]);
});
