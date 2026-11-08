import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { deepCopyFromSandbox } from "./values.js";

it.each(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError"])
  ("preserves %s messages and normalizes message descriptors", async name => {
    const source = `const copy=structuredClone(new ${name}("message"));return [copy.name,copy.message,copy instanceof ${name},Object.getOwnPropertyDescriptor(copy,"message")];`;
    expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
  });

it("preserves error causes and their identity in the surrounding clone graph", async () => {
  const source = 'const cause={code:7};const error=new Error("outer",{cause});const copy=structuredClone({error,cause});return [copy.error.message,copy.error.cause===copy.cause,copy.error.cause.code]';
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});

it("ignores ordinary enumerable error properties", async () => {
  const source = 'const error=new Error("message");error.callback=()=>1;error.extra=7;try{const copy=structuredClone(error);return [copy.message,Object.keys(copy)]}catch(e){return e.name}';
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});

it.each([
  'const e=new Error();const c=structuredClone(e);return [c.message,Object.hasOwn(c,"message")]',
  'const e=new TypeError("x");e.name="RangeError";const c=structuredClone(e);return [c.name,c.message,c instanceof RangeError]',
  'const e=new Error("x");e.name="CustomError";const c=structuredClone(e);return [c.name,c.message]',
  'const e=new Error("x");e.stack="";let reads=0;Object.defineProperty(e,"message",{get(){reads++;return "wrong"}});const c=structuredClone(e);return [reads,c.message,Object.hasOwn(c,"message")]',
  'const e=new Error();e.stack="";const trace=[];e.message={toString(){trace.push("message");return "coerced"}};const c=structuredClone(e);return [trace,c.message]',
  'const e=new Error("x");Object.defineProperty(e,"cause",{get(){throw "unused"}});const c=structuredClone(e);return [c.message,Object.hasOwn(c,"cause")]',
  'const e=new Error("x",{cause:()=>1});const b=new ArrayBuffer(1);try{structuredClone(e,{transfer:[b]});return "accepted"}catch(e){return [e.name,b.detached]}',
  'const e=new Error("x");e.stack="";const trace=[];Object.defineProperty(e,"name",{get(){trace.push("name");return "TypeError"}});e.message={toString(){trace.push("message");return "y"}};const c=structuredClone(e);return [trace,c.name,c.message]',
  'const e=new Error("x");e.stack="";e.cause=e;const c=structuredClone(e);return [c.cause===c,c.message]',
  'const e=new Error();e.stack="";e.message=undefined;const c=structuredClone(e);return [c.message,Object.hasOwn(c,"message")]',
  'const e=new Error();e.stack="";e.message=Symbol("x");const b=new ArrayBuffer(1);try{structuredClone(e,{transfer:[b]})}catch(e){return [e.name,b.detached]}',
  'const b=new ArrayBuffer(1);const e=new Error();e.stack="";e.message={toString(){new Uint8Array(b)[0]=7;return "x"}};e.cause=b;const c=structuredClone(e,{transfer:[b]});return [c.message,b.detached,new Uint8Array(c.cause)[0]]'
])("matches native error property handling: %s", async body => {
  const source = `try { ${body} } catch (e) {return {error:e.name}}`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});

it("reads the error name before selecting its message descriptor, per HTML", async () => {
  // Node 22 captures the message descriptor before reading name; HTML does not.
  const source = 'const e=new Error("x");e.stack="";Object.defineProperty(e,"name",{get(){delete e.message;return "RangeError"}});const c=structuredClone(e);return [c.name,c.message,Object.hasOwn(c,"message")]';
  expect(await run(source)).toMatchObject({ok:true,returnValue:["RangeError","",false]});
});

it("does not coerce a non-string error name, per HTML", async () => {
  // HTML selects Error for a name outside the seven literal strings. Node 22
  // instead coerces this object and invokes its throwing toString.
  const source = 'const e=new Error("x");e.stack="";e.name={toString(){throw 1}};return structuredClone(e).name';
  expect(await run(source)).toMatchObject({ok:true,returnValue:"Error"});
});

it("preserves cyclic error causes and descriptors across public snapshots", async () => {
  const source = 'const error=new TypeError("message");error.cause=error;const copy=structuredClone(error);await 0;return [copy.name,copy.message,copy.cause===copy,Object.keys(copy),copy instanceof TypeError]';
  const result = await run(source);
  expect(result).toMatchObject({ok:true,returnValue:["TypeError","message",true,[],true]});
  const snapshot = restore(JSON.parse(await dump(result)), {source});
  expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:["TypeError","message",true,[],true]});
});

it("exports cloned errors through the public SDK without dropping non-enumerable fields", async () => {
  const result = await run('const error=new TypeError("message");error.cause=error;return structuredClone(error)');
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const error = deepCopyFromSandbox(result.returnValue) as Error;
  expect(error).toBeInstanceOf(TypeError);
  expect(error.message).toBe("message");
  expect(error.cause).toBe(error);
  expect(Object.getOwnPropertyDescriptor(error,"message")).toMatchObject({enumerable:false,writable:true,configurable:true});
});
