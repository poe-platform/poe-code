import { describe, expect, it } from "vitest";
import { run } from "../core.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { createSandboxClosure, createSandboxPromise } from "./values.js";
import { getSandboxDataProperty } from "./object-model.js";

describe("Symbol values and property keys", () => {
  it("preserves symbol identity in context-free data property reads", () => {
    const key = Symbol("key");
    const properties = { [key]: 7, "Symbol(key)": 9 };
    expect(getSandboxDataProperty(properties, key)).toBe(7);
    expect(getSandboxDataProperty(createSandboxClosure({ call: () => undefined, properties }), key)).toBe(7);
  });
  it.each([
    ["global", "return typeof Symbol;"],
    ["identity", "const first=Symbol('key');return [typeof first,first===first,first===Symbol('key')];"],
    ["descriptions", "return [Symbol().description,Symbol('').description,Symbol('key').description];"],
    ["explicit string conversion", "return String(Symbol('key'));"],
    ["implicit string conversion", "try{return ''+Symbol('key')}catch(error){return error.name}"],
    ["numeric conversion", "try{return Number(Symbol('key'))}catch(error){return error.name}"],
    ["arithmetic conversion", "try{return Symbol('key')+1}catch(error){return error.name}"],
    ["unary conversion", "try{return -Symbol('key')}catch(error){return error.name}"],
    ["relational conversion", "try{return Symbol('key')<1}catch(error){return error.name}"],
    ["loose equality", "const key=Symbol('key');return [key==key,key==Symbol('key'),key=='Symbol(key)'];"],
    ["nonconstructible", "try{return new Symbol('key')}catch(error){return error.name}"],
    ["registry", "const key=Symbol.for('key');return [key===Symbol.for('key'),Symbol.keyFor(key),Symbol.keyFor(Symbol('key'))];"],
    ["registry argument validation", "try{return Symbol.keyFor('key')}catch(error){return error.name}"],
    ["well-known symbols", "return [typeof Symbol.iterator,typeof Symbol.asyncIterator,Symbol.iterator===Symbol.iterator];"],
    ["computed property", "const key=Symbol('key');const object={[key]:7,key:9};return [object[key],object.key,key in object];"],
    ["method name", "const key=Symbol('key');const object={[key](){return 7}};return [object[key](),object[key].name];"],
    ["anonymous symbol method name", "const key=Symbol();const object={[key](){}};return object[key].name;"],
    ["class fields", "const key=Symbol('key');class Box{[key]=7}return new Box()[key];"],
    ["class method name", "const key=Symbol('key');class Box{[key](){return 7}}const object=new Box();return [object[key](),object[key].name];"],
    ["enumeration", "const key=Symbol('key');const object={[key]:7,plain:9};return [Object.keys(object),Object.getOwnPropertyNames(object),Object.getOwnPropertySymbols(object)[0]===key];"],
    ["string-only enumeration", "const key=Symbol('key');const object={[key]:7,plain:9};return [Object.keys(object),Object.values(object),Object.entries(object)];"],
    ["descriptor enumeration", "const key=Symbol('key');const object={[key]:7};return Object.getOwnPropertyDescriptors(object)[key].value;"],
    ["multiple descriptors", "const key=Symbol('key');const object={};Object.defineProperties(object,{[key]:{value:7}});return object[key];"],
    ["rest", "const first=Symbol('first');const second=Symbol('second');const {[first]:value,...rest}={[first]:7,[second]:9};return [value,first in rest,rest[second]];"],
    ["private arguments metadata", "function read(){return Object.getOwnPropertySymbols(arguments).map(String)}return read(1);"],
    ["private error metadata", "try{throw new Error('test')}catch(error){return Object.getOwnPropertySymbols(error).length}"],
    ["spread", "const key=Symbol('key');const copy={...{[key]:7}};return copy[key];"],
    ["assignment", "const key=Symbol('key');const object={};object[key]=7;object[key]+=2;return object[key];"],
    ["deletion", "const key=Symbol('key');const object={[key]:7};return [delete object[key],key in object];"],
    ["descriptor", "const key=Symbol('key');const object={};Object.defineProperty(object,key,{value:7,enumerable:true});return [Object.getOwnPropertyDescriptor(object,key).value,object[key]];"],
    ["primitive conversion hook", "const object={[Symbol.toPrimitive](hint){return hint==='string'?'key':7}};return [String(object),Number(object)];"],
    ["symbol-returning property key", "const key=Symbol('key');const log=[];const wrapper={[Symbol.toPrimitive](hint){log.push(hint);return key}};const object={[wrapper]:7};return [object[wrapper],log];"],
    ["noncallable primitive hook", "try{return String({[Symbol.toPrimitive]:7})}catch(error){return error.name}"],
    ["object-returning primitive hook", "try{return Number({[Symbol.toPrimitive](){return {}}})}catch(error){return error.name}"],
    ["null primitive hook fallback", "return String({[Symbol.toPrimitive]:null,toString(){return 'fallback'}});"],
    ["inherited primitive hook", "const prototype={[Symbol.toPrimitive](hint){return this.value+hint}};const object=Object.create(prototype);object.value='own:';return String(object);"],
    ["sync iteration", "const iterable={[Symbol.iterator](){let index=0;return {next(){return {done:index>=2,value:++index}}}}};const values=[];for(const value of iterable)values.push(value);return values;"],
    ["async iteration", "const iterable={[Symbol.asyncIterator](){let index=0;return {async next(){return {done:index>=2,value:++index}}}}};const values=[];for await(const value of iterable)values.push(value);return values;"]
  ])("matches native %s", async (_name, source) => {
    const expected = await new Function("return async function(){'use strict';" + source + "}")()();
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("does not expose private runtime metadata", async () => {
    // A clean native process returns zero; Vitest's async instrumentation adds host-only symbols.
    const source = "return [Object.getOwnPropertySymbols(Promise.resolve(1)).length,Object.getOwnPropertySymbols(new Map()).length,Object.getOwnPropertySymbols(Symbol).length];";
    expect(await run(source)).toMatchObject({ ok: true, returnValue: [0, 0, 0] });
  });

  it("preserves symbol identity and symbol-keyed properties through a checkpoint", async () => {
    const source = "const key=Symbol('key');const registered=Symbol.for('registered');const object={[key]:7};const map=new Map([[key,object]]);await wait();return [map.get(key)[key],Object.getOwnPropertySymbols(object)[0]===key,registered===Symbol.for('registered')];";
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const original = run(source, { bindings: {
      wait: createSandboxClosure({ async: true, call: () => { entered(); return createSandboxPromise(pending); } })
    } });
    let snapshot: ReturnType<typeof JSON.parse>;
    try { await waiting; snapshot = JSON.parse(await dump(original)); }
    finally { release(); await original; }
    expect(await original).toMatchObject({ ok: true, returnValue: [7, true, true] });
    expect(await run(source, { snapshot: restore(snapshot, { source }), bindings: {
      wait: createSandboxClosure({ async: true, call: () => createSandboxPromise(Promise.resolve()) })
    } })).toMatchObject({ ok: true, returnValue: [7, true, true] });
  });
});
