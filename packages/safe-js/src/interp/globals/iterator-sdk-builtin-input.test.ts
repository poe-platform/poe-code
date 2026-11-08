import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { getSandboxPropertyDescriptor } from "../object-model.js";
import { isSandboxClosure } from "../values.js";

it.each(['[3,5]','"ab"','new Uint8Array([3,5])', '""', '"😀z"', '"\\ud800x"'])("iterates SDK builtin input after run: %s", async input => {
  const native=new Function(`return Iterator.from(${input}).next()`)();
  const values=(await run(`return [Iterator.from,${input}]`)).returnValue;
  if(!Array.isArray(values)||!isSandboxClosure(values[0])) throw new Error("Expected SDK factory");
  const iterator=await values[0].call([values[1]],{stack:[],thisValue:undefined});
  const next=getSandboxPropertyDescriptor(iterator,"next")?.value;
  if(!isSandboxClosure(next)) throw new Error("Expected iterator next");
  expect(await next.call([],{stack:[],thisValue:iterator})).toEqual(native);
});

it.each(["undefined", "null", "7"])("rejects invalid guest string iterator %s", async method => {
  const source = `String.prototype[Symbol.iterator]=${method};return Iterator.from`;
  expect(() => runInNewContext(`const from=(function(){${source}})();from("ab")`)).toThrow();
  const from = (await run(source)).returnValue;
  if (!isSandboxClosure(from)) throw new Error("Expected SDK factory");
  await expect(from.call(["ab"], { stack: [], thisValue: undefined })).rejects.toBeInstanceOf(TypeError);
});

it("dispatches a string prototype Proxy ancestor with the primitive receiver", async () => {
  const source = `const trace=[];delete String.prototype[Symbol.iterator];
    Object.setPrototypeOf(String.prototype,new Proxy({[Symbol.iterator]:function*(){"use strict";yield this;}},{
      get(target,key,receiver){trace.push(key===Symbol.iterator,typeof receiver,receiver);return Reflect.get(target,key,receiver);}
    }));return [Iterator.from,trace]`;
  const expected = runInNewContext(`const values=(function(){${source}})();
    const step=values[0]("ab").next();({step,trace:values[1]})`);
  const values = (await run(source)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Expected SDK values");
  const iterator = await values[0].call(["ab"], { stack: [], thisValue: undefined });
  const next = getSandboxPropertyDescriptor(iterator, "next")?.value;
  if (!isSandboxClosure(next)) throw new Error("Expected iterator next");
  expect({ step: await next.call([], { stack: [], thisValue: iterator }), trace: values[1] }).toEqual(expected);
});

it("uses the originating string prototype and primitive getter receiver after cleanup", async () => {
  const source = `const trace=[];return [Iterator.from,trace,()=>{
    Object.defineProperty(String.prototype,Symbol.iterator,{get(){"use strict";
      trace.push(typeof this,this);return function*(){"use strict";yield this;}
    }});
  }]`;
  const expected = runInNewContext(`const values=(function(){${source}})();values[2]();
    const step=values[0]("ab").next();({step,trace:values[1]})`);
  const values = (await run(source)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0]) || !isSandboxClosure(values[2])) throw new Error("Expected SDK values");
  await values[2].call([], { stack: [], thisValue: undefined });
  await run('String.prototype[Symbol.iterator]=function*(){yield "wrong realm"}');
  const iterator = await values[0].call(["ab"], { stack: [], thisValue: undefined });
  const next = getSandboxPropertyDescriptor(iterator, "next")?.value;
  if (!isSandboxClosure(next)) throw new Error("Expected iterator next");
  expect({ step: await next.call([], { stack: [], thisValue: iterator }), trace: values[1] }).toEqual(expected);
});
