import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  ["new Proxy({type:'json'},handler)", ["keys", "desc:type", "get:type"]],
  ["new Proxy({},handler)", ["keys"]],
  ["new Proxy(Object.defineProperty({},'hidden',{value:7}),handler)", ["keys", "desc:hidden"]],
  ["new Proxy({[Symbol()]:7},handler)", ["keys"]]
] as const)("reflects import attributes: %s", async (attributes, expected) => {
  const source = `const log=[];const handler={
    ownKeys(t){log.push('keys');return Reflect.ownKeys(t)},
    getOwnPropertyDescriptor(t,k){log.push('desc:'+String(k));return Reflect.getOwnPropertyDescriptor(t,k)},
    get(t,k){log.push('get:'+String(k));return t[k]}};
    try{await import('fixture',{with:${attributes}})}catch{}return log`;
  expect(await run(source, { modules: { fixture: { value: 7 } } })).toMatchObject({
    ok: true,
    returnValue: expected
  });
});

it("rechecks enumerability after an earlier attribute getter", async () => {
  const source = `const log=[];const attrs={get first(){log.push('first');
    Object.defineProperty(attrs,'second',{enumerable:true});return 'a'}};
    Object.defineProperty(attrs,'second',{configurable:true,get(){log.push('second');return 'b'}});
    try{await import('fixture',{with:attrs})}catch{}return log`;
  expect(await run(source, { modules: { fixture: {} } })).toMatchObject({
    ok: true,
    returnValue: ["first", "second"]
  });
});

it.each(["ownKeys", "getOwnPropertyDescriptor", "get"])(
  "rejects asynchronously when %s throws",
  async (operation) => {
    const source = `const marker={};const attrs=new Proxy({type:'json'},{${operation}(){throw marker}});
    let pending;try{pending=import('fixture',{with:attrs})}catch{return 'synchronous'}
    try{await pending}catch(error){return error===marker}return false`;
    expect(await run(source, { modules: { fixture: {} } })).toMatchObject({
      ok: true,
      returnValue: true
    });
  }
);
