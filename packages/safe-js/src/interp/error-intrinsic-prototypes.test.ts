import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../run.js";
import { serialize, type RuntimeSnapshotValue } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { sandboxErrorTypes } from "../error/shape.js";
import { getSandboxDataProperty } from "./object-model.js";
import { createBuiltinBindings } from "./globals.js";
import { Budget } from "./budget.js";
import { deepCopyFromSandbox, measureSandboxData } from "./values.js";

it("exports native Error data descriptors, cycles and type without guest prototypes", async () => {
  const result = await run("const e=new TypeError('message');e.cause=e;Object.freeze(e);return e");
  const exported = deepCopyFromSandbox(result.returnValue) as TypeError;
  expect(exported).toBeInstanceOf(TypeError);
  expect(exported.message).toBe("message");
  expect(exported.cause).toBe(exported);
  expect(Object.hasOwn(exported,"name")).toBe(false);
  expect(Object.getOwnPropertyDescriptor(exported,"message")).toMatchObject({enumerable:false,writable:false,configurable:false});
  expect(Object.isFrozen(exported)).toBe(true);
});

it.each([
  "class Custom extends Error{};return new Custom('message')",
  "Error.prototype.extra=7;return new TypeError('message')",
  "Object.prototype.extra=7;return new TypeError('message')",
  "const e=new Error('message');Object.defineProperty(e,'extra',{get(){throw 7}});return e"
])("keeps executable or custom Error state out of data exports: %s", async source => {
  const result = await run(source);
  expect(()=>deepCopyFromSandbox(result.returnValue)).toThrow(TypeError);
});
import { dump } from "../dump.js";
import { restore as restoreSnapshot } from "../restore.js";

it.each([false, true])("preserves a host Error's guest prototype across replay (async=%s)", async asynchronous => {
  let calls = 0;
  const fail = () => { calls++; throw new TypeError("host message"); };
  const bindings = { fail: asynchronous ? async () => fail() : fail };
  const source = "try{await fail()}catch(error){return [error.name,error.message,error instanceof TypeError,Object.getPrototypeOf(error)===TypeError.prototype]}";
  const execution = run(source, {bindings});
  const expected = {ok:true,returnValue:["TypeError","host message",true,true]};
  expect(await execution).toMatchObject(expected);
  const saved = restoreSnapshot(JSON.parse(await dump(execution)),{source});
  expect(await run(source,{bindings,snapshot:saved})).toMatchObject(expected);
  expect(calls).toBe(1);
});

it("accounts for nonenumerable Error messages and stacks", async () => {
  const result = await run("return new Error('x'.repeat(10000))");
  expect(measureSandboxData([result.returnValue])).toBeGreaterThan(20000);
});

it("surfaces frozen source errors without replacing their message with a host mutation failure", async () => {
  await expect(run("throw Object.freeze(new TypeError('original'))"))
    .rejects.toMatchObject({name:"TypeError",message:"original"});
});

it("restores an older error constructor without adding a prototype", () => {
  const source = "return 1";
  const bindings = createBuiltinBindings({budget:new Budget(),errorPrototypes:false});
  const saved = serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{error:bindings.Error}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const result = restore(JSON.parse(JSON.stringify(saved)),{source}).currentScope.lookup("error");
  if (!result.found) throw new Error("Missing legacy constructor");
  expect(getSandboxDataProperty(result.value,"prototype")).toBeUndefined();
});

it.each(["Error", "TypeError", "AggregateError"])("preserves the private %s brand through portable snapshots", async name => {
  const source = `return Object.freeze(new ${name}(${name === "AggregateError" ? "[1]," : ""}'message',{cause:7}))`;
  const original = await run(source);
  const saved = serialize({source,currentAstNodeId:1,scopeChain:[{id:"external",bindings:{error:original.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const restored = restore(JSON.parse(JSON.stringify(saved)),{source}).currentScope.lookup("error");
  if (!restored.found || typeof restored.value !== "object" || restored.value === null) throw new Error("Missing restored error");
  expect(sandboxErrorTypes.get(restored.value)).toBe(name);
  expect(getSandboxDataProperty(restored.value,"name")).toBe(name);
  expect(getSandboxDataProperty(restored.value,"message")).toBe("message");
  expect(getSandboxDataProperty(restored.value,"cause")).toBe(7);
  expect(Object.isFrozen(restored.value)).toBe(true);
});

it.each([
  "return [Object.getPrototypeOf(Error)===Object.getPrototypeOf(()=>{}),Object.getPrototypeOf(TypeError)===Error]",
  "return [typeof Error.prototype,Object.getPrototypeOf(TypeError.prototype)===Error.prototype,Error.prototype.constructor===Error]",
  "return [Object.getPrototypeOf(new Error())===Error.prototype,Object.getPrototypeOf(Error())===Error.prototype]",
  "return [Object.hasOwn(new Error(),'name'),Object.hasOwn(new Error(),'message'),Object.keys(new Error('x'))]",
  "const value=new Error('x');Object.setPrototypeOf(value,null);return value instanceof Error",
  "return Object.create(Error.prototype) instanceof Error",
  "return String(new TypeError('x'))",
  "return [Error,TypeError,RangeError,ReferenceError,SyntaxError,URIError,EvalError,AggregateError].map(C=>[C.name,C.length,C.prototype.name,C.prototype.message,C.prototype.constructor===C,Object.getOwnPropertyDescriptor(C,'prototype').writable])",
  "const d=Object.getOwnPropertyDescriptor(new Error('x'),'message');return [d.value,d.writable,d.enumerable,d.configurable]",
  "const trace=[];const error=new Error({toString(){trace.push('message');return 'text'}},Object.create({get cause(){trace.push('cause');return 7}}));const d=Object.getOwnPropertyDescriptor(error,'cause');return [error.message,error.cause,trace,d.writable,d.enumerable,d.configurable]",
  "return [Object.hasOwn(new Error(undefined,{cause:undefined}),'cause'),Object.hasOwn(new Error('x',7),'cause')]",
  "const e=new AggregateError(new Set([1,2]),'x',{cause:7});const d=Object.getOwnPropertyDescriptor(e,'errors');return [e.errors,e.message,e.cause,d.enumerable,e instanceof AggregateError,e instanceof Error]",
  "try{new AggregateError(7)}catch(e){return e.name}",
  "const trace=[];const values={[Symbol.iterator](){trace.push('iterate');return [1][Symbol.iterator]()}};const error=new AggregateError(values,{toString(){trace.push('message');return 'x'}},{get cause(){trace.push('cause');return 7}});return [error.errors,trace]",
  "class Custom extends Error{field=7}const e=new Custom('x');return [e.message,e.name,e.field,e instanceof Custom,e instanceof Error,Object.getPrototypeOf(e)===Custom.prototype]",
  "try{Math.abs(Symbol('x'))}catch(e){return [e.name,Object.getPrototypeOf(e)===TypeError.prototype,e instanceof TypeError,e instanceof Error]}",
  "return [{},{name:'',message:'x'},{name:'X',message:''}].map(value=>Error.prototype.toString.call(value))",
  "const trace=[];const value={get name(){trace.push('name');return {toString(){trace.push('name-string');return 'X'}}},get message(){trace.push('message');return 'text'}};return [Error.prototype.toString.call(value),trace]",
  "try{new Error(Symbol('x'))}catch(e){return e.name}",
  "const error=Object.freeze(new TypeError('x'));try{throw error}catch(e){return [e===error,e.name,e.message,Object.getPrototypeOf(e)===TypeError.prototype]}",
  "const e=new Error('x');Error.prototype.name='Changed';Error.prototype.message='default';return [e.name,e.message,new Error().message,String(e)]"
])("provides native error prototype behavior: %s", async source => {
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext(`(function(){'use strict';${source}})()`)});
});
