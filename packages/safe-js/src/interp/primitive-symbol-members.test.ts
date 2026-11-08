import { assert, expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  ["String", "'text'"],
  ["Number", "7"],
  ["Boolean", "true"]
])("reads inherited symbol data and accessors on %s primitives", async (constructor, primitive) => {
  const source=`const key=Symbol('property');const getter=Symbol('getter');
    ${constructor}.prototype[key]=9;
    Object.defineProperty(${constructor}.prototype,getter,{get(){return [typeof this,this===${primitive}]}});
    return [(${primitive})[key],(${primitive})[getter]];`;
  const result=await run(source);
  assert(result.ok);
  expect(result.returnValue).toEqual([9,[typeof Function('return '+primitive)(),true]]);
});
