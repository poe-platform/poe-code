import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { isSandboxClosure } from "../values.js";

it.each(["has", "get", "none"])(
  "preserves caller cause identity in a borrowed constructor: %s",
  async (stop) => {
    const owner = (await run("return Error")).returnValue;
    const caller = (
      await run(`return C=>{
    const marker=new TypeError('caller');const log=[];
    const options=new Proxy({}, {
      has(){log.push('has');if('${stop}'==='has')throw marker;return true},
      get(){log.push('get');if('${stop}'==='get')throw marker;return marker}});
    try{const error=new C('',options);return [error.cause===marker,log]}
    catch(error){return [error===marker,log]}
  }`)
    ).returnValue;
    if (!isSandboxClosure(owner) || !isSandboxClosure(caller))
      throw new Error("Expected realm exports");
    expect(await caller.call([owner], { stack: [], thisValue: undefined })).toEqual([
      true,
      stop === "has" ? ["has"] : ["has", "get"]
    ]);
  }
);

it("preserves cause traps after public replay and realm cleanup", async () => {
  const source = `const log=[];const marker={};const options=new Proxy({}, {
    has(){log.push('has');return true},get(){log.push('get');return marker}});
    await 0;return ()=>{const error=new Error('',options);return [error.cause===marker,log.slice()]}`;
  const original = await run(source);
  expect(original.ok).toBe(true);
  const replayed = await run(source, {
    snapshot: JSON.parse(await dump(original))
  });
  expect(replayed.ok).toBe(true);
  for (const result of [original, replayed]) {
    const factory = result.returnValue;
    if (!isSandboxClosure(factory)) throw new Error("Expected factory");
    expect(await factory.call([], { stack: [], thisValue: undefined })).toEqual([
      true,
      ["has", "get"]
    ]);
  }
});

const constructors = [
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError"
];

it.each(["prototype", "message", "has", "get", "iterator", "none"])(
  "matches native constructor ordering when %s interrupts construction",
  async (stop) => {
    const source = `const log=[];const marker={};
      function step(name){log.push(name);if(name==='${stop}')throw marker}
      const target=new Proxy(function(){},{get(t,k){if(k==='prototype')step('prototype');return Reflect.get(t,k)}});
      const message={toString(){step('message');return 'text'}};
      const options=new Proxy({}, {has(){step('has');return true},get(){step('get');return 7}});
      const errors={[Symbol.iterator](){step('iterator');return [][Symbol.iterator]()}};
      let caught=false;try{Reflect.construct(AggregateError,[errors,message,options],target)}catch(error){caught=error===marker}
      return [caught,log]`;
    const expected = Function(source)();
    expect(await run(source)).toMatchObject({
      ok: true,
      returnValue: expected
    });
  }
);

it("does not read a cause hidden by the has trap", async () => {
  expect(
    await run(`const log=[];const options=new Proxy({cause:7},{
    has(){log.push('has');return false},get(){throw 'unexpected get'}});
    return [Object.hasOwn(new Error('',options),'cause'),log]`)
  ).toMatchObject({ ok: true, returnValue: [false, ["has"]] });
});

it("enforces the has trap invariant for a nonconfigurable cause", async () => {
  expect(
    await run(`const options=new Proxy(Object.defineProperty({},'cause',{value:7}),{has(){return false}});
    try{new Error('',options)}catch(error){return error instanceof TypeError}return false`)
  ).toMatchObject({ ok: true, returnValue: true });
});

it("rejects revoked cause options", async () => {
  expect(
    await run(`const pair=Proxy.revocable({},{});pair.revoke();
    try{new Error('',pair.proxy)}catch(error){return error instanceof TypeError}return false`)
  ).toMatchObject({ ok: true, returnValue: true });
});

it("supports function options and ignores SuppressedError's fourth argument", async () => {
  expect(
    await run(`function options(){}options.cause=7;
    const ignored=new Proxy({}, {has(){throw 'unexpected has'},get(){throw 'unexpected get'}});
    return [new Error('',options).cause,Object.hasOwn(new SuppressedError(1,2,'',ignored),'cause')]`)
  ).toMatchObject({ ok: true, returnValue: [7, false] });
});

it.each(constructors)("%s checks cause through has before get", async (name) => {
  for (const present of [true, false]) {
    const source = `const log=[];const options=new Proxy({}, {
      has(t,k){log.push('has:'+k);return ${present}},
      get(t,k){log.push('get:'+k);return 7},
      getOwnPropertyDescriptor(){throw 'unexpected descriptor lookup'}
    });const error=new ${name}(${name === "AggregateError" ? "[]," : ""}'message',options);
    const d=Object.getOwnPropertyDescriptor(error,'cause');
    return [log,d ? [d.value,d.writable,d.enumerable,d.configurable] : null]`;
    expect(await run(source)).toMatchObject({
      ok: true,
      returnValue: [
        present ? ["has:cause", "get:cause"] : ["has:cause"],
        present ? [7, true, false, true] : null
      ]
    });
  }
});

it.each(["has", "get"])("preserves a thrown cause %s value", async (trap) => {
  const source = `const marker={};const options=new Proxy({}, {has(){${trap === "has" ? "throw marker" : "return true"}},get(){throw marker}});
    try{new Error('message',options)}catch(error){return error===marker}return false`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: true });
});

it("checks inherited Proxy causes in message/cause/iteration order", async () => {
  const source = `const log=[];const options=Object.create(new Proxy({}, {
    has(t,k){log.push('has:'+k);return true},get(t,k){log.push('get:'+k);return 7}}));
    const errors={[Symbol.iterator](){log.push('iterator');return [][Symbol.iterator]()}};
    const error=new AggregateError(errors,{toString(){log.push('message');return 'text'}},options);
    return [error.cause,log]`;
  expect(await run(source)).toMatchObject({
    ok: true,
    returnValue: [7, ["message", "has:cause", "get:cause", "iterator"]]
  });
});
