import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each(["Promise.resolve(1)","new Map()","new Set()","/x/"])("assigns own properties to %s", async expression => {
  const source=`const value=${expression};const result=Object.assign(value,{label:42});return [result===value,value.label]`;
  expect((await run(source)).returnValue).toEqual([true,42]);
});

for(const expression of ["Promise.resolve(1)","new Map()","new Set()","/x/"]) {
  it(`invokes setters on ${expression}`, async () => {
    const source=`const value=${expression};const calls=[];
      Object.defineProperty(value,"label",{set(label){calls.push([this===value,label])}});
      Object.assign(value,{label:42});return calls`;
    expect((await run(source)).returnValue).toEqual([[true,42]]);
  });

  it(`rejects new properties on non-extensible ${expression}`, async () => {
    const source=`const value=${expression};Object.preventExtensions(value);
      const same=Object.assign(value,null,undefined)===value;
      try{Object.assign(value,{label:42});return false}catch(error){return same&&error instanceof TypeError}`;
    expect((await run(source)).returnValue).toBe(true);
  });

  it(`preserves partial assignment before failure on ${expression}`, async () => {
    const source=`const value=${expression};Object.defineProperty(value,"blocked",{value:0,writable:false});
      try{Object.assign(value,{first:1,blocked:2,last:3})}catch(error){}
      return [value.first,value.blocked,value.last]`;
    expect((await run(source)).returnValue).toEqual([1,0,undefined]);
  });
}
