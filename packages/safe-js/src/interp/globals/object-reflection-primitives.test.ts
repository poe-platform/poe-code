import { expect, it } from "vitest";
import { run } from "../../run.js";

it("lists own property names of primitive strings", async () => {
  expect((await run('return Object.getOwnPropertyNames("abc")')).returnValue).toEqual(["0","1","2","length"]);
});

it("returns every string descriptor including length", async () => {
  expect((await run('return Object.getOwnPropertyDescriptors("a")')).returnValue).toEqual({
    0:{value:"a",writable:false,enumerable:true,configurable:false},
    length:{value:1,writable:false,enumerable:false,configurable:false}
  });
});

it.each(["42","true",'Symbol("x")'])("reflects empty own properties of %s", async expression => {
  const source=`const value=${expression};return [Object.getOwnPropertyNames(value),Object.getOwnPropertySymbols(value),Object.getOwnPropertyDescriptors(value),Object.getOwnPropertyDescriptor(value,"x")]`;
  expect((await run(source)).returnValue).toEqual([[],[],{},undefined]);
});

for(const method of ["getOwnPropertyNames","getOwnPropertySymbols","getOwnPropertyDescriptors","getOwnPropertyDescriptor"]) {
  it.each(["null","undefined"])(`${method} rejects %s`, async value => {
    expect((await run(`try {Object.${method}(${value});return false}catch(error){return error instanceof TypeError}`)).returnValue).toBe(true);
  });
}

it("coerces descriptor keys after boxing and skips coercion for nullish targets", async () => {
  const source=`const calls=[];const key={[Symbol.toPrimitive](hint){calls.push(hint);return "0"}};
    const descriptor=Object.getOwnPropertyDescriptor("a",key);
    try{Object.getOwnPropertyDescriptor(null,key)}catch(error){}
    return [descriptor.value,calls]`;
  expect((await run(source)).returnValue).toEqual(["a",["string"]]);
});

it("reads own descriptors of primitive strings", async () => {
  expect((await run('return Object.getOwnPropertyDescriptor("abc","0")')).returnValue).toEqual({value:"a",writable:false,enumerable:true,configurable:false});
});
