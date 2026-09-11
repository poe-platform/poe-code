import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData } from "./values.js";
import { Budget } from "./budget.js";
import { declareHostOperation } from "./host-bridge.js";

it.each([
  "const buffer=new ArrayBuffer(12);const values=new Float32Array(buffer);values.set([1,2,3]);const result=buffer.slice(4,12);new Float32Array(result)[0]=7;return [result.byteLength,Array.from(new Float32Array(result)),Array.from(values)]",
  "const trace=[];const result=new ArrayBuffer(12).slice({valueOf(){trace.push('start');return 4}},{valueOf(){trace.push('end');return 8}});return [result.byteLength,trace]",
  "const buffer=new ArrayBuffer(8);return [-Infinity,-3.9,NaN,Infinity,Symbol('x'),BigInt(1)].map(start=>{try{return buffer.slice(start).byteLength}catch(error){return error.name}})",
  "class Storage extends ArrayBuffer{};const source=new Storage(8,{maxByteLength:16});const result=source.slice(4);return [result instanceof Storage,result.byteLength,result.resizable,result!==source]",
  "const trace=[];const buffer=new ArrayBuffer(8);buffer.constructor={[Symbol.species]:function(length){trace.push(length);return new ArrayBuffer(length+4)}};const result=buffer.slice(4);return [trace,result.byteLength]",
  "const buffer=new ArrayBuffer(8);buffer.constructor={[Symbol.species]:function(){return buffer}};try{buffer.slice();return 'accepted'}catch(error){return error.name}"
])("matches native ArrayBuffer slice: %s", async source => {
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});

it.each([
  "return [7,null,{[Symbol.species]:7},{[Symbol.species]:()=>new ArrayBuffer(8)},{[Symbol.species]:function(){return new Float32Array(2)}},{[Symbol.species]:function(){return new ArrayBuffer(1)}}].map(constructor=>{const buffer=new ArrayBuffer(8);buffer.constructor=constructor;try{buffer.slice();return 'accepted'}catch(error){return error.name}})",
  "return [undefined,{}, {[Symbol.species]:null},{[Symbol.species]:undefined}].map(constructor=>{const buffer=new ArrayBuffer(8);buffer.constructor=constructor;return buffer.slice(4).byteLength})",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});new Float32Array(buffer).set([1,2]);const result=buffer.slice({valueOf(){buffer.resize(4);return 0}});return [result.byteLength,result.resizable,Array.from(new Float32Array(result))]",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});new Float32Array(buffer).set([1,2]);const result=buffer.slice({valueOf(){buffer.resize(16);return 0}});return [result.byteLength,Array.from(new Float32Array(result))]",
  "const buffer=new ArrayBuffer(8,{maxByteLength:16});new Float32Array(buffer).set([1,2]);buffer.constructor={[Symbol.species]:function(size){const result=new ArrayBuffer(size+4,{maxByteLength:16});new Float32Array(result).set([9,9,9]);buffer.resize(4);return result}};const result=buffer.slice();return [result.byteLength,result.resizable,Array.from(new Float32Array(result))]",
  "const trace=[];const buffer=new ArrayBuffer(8);Object.defineProperty(buffer,'constructor',{get(){trace.push('constructor');return {get [Symbol.species](){trace.push('species');return function(size){trace.push(size);new Float32Array(buffer)[1]=7;return new ArrayBuffer(size)}}}}});const result=buffer.slice({valueOf(){trace.push('start');return 4}},{valueOf(){trace.push('end');return 8}});return [trace,Array.from(new Float32Array(result))]"
])("matches slice callback and species edge behavior: %s", async source => {
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});

it("preserves ArrayBuffer slice species across snapshots", async () => {
  const source = "class Storage extends ArrayBuffer{};const buffer=new Storage(8);new Float32Array(buffer).set([1,2]);return ()=>{const result=buffer.slice(4);return [result instanceof Storage,Array.from(new Float32Array(result))]}";
  const expected = runInNewContext(`(function(){${source}})()()`);
  let read = (await run(source)).returnValue;
  for (let round = 0; round < 2; round++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "external", bindings: { read } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const result = restore(JSON.parse(JSON.stringify(saved)), { source }).currentScope.lookup("read");
    if (!result.found || !isSandboxClosure(result.value)) throw new Error("Missing restored reader");
    expect(await result.value.call([])).toEqual(expected);
    read = result.value;
  }
});

it("coerces getter-valued bounds in direct slice calls", async () => {
  const values = (await run("const buffer=new ArrayBuffer(8);new Float32Array(buffer).set([1,2]);return [ArrayBuffer.prototype.slice,buffer,{get valueOf(){return ()=>4}}]")).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Missing method");
  const result = await values[0].call([values[2]], { stack: [], thisValue: values[1] });
  expect(Array.from(new Float32Array(result as ArrayBuffer))).toEqual([2]);
});

it("rejects a detached receiver in a direct slice call", async () => {
  const values = (await run("return [ArrayBuffer.prototype.slice,new ArrayBuffer(8)]")).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Missing method");
  structuredClone(values[1], { transfer: [values[1] as ArrayBuffer] });
  expect(() => ArrayBuffer.prototype.slice.call(values[1], 0)).toThrow(TypeError);
  await expect(values[0].call([0], { stack: [], thisValue: values[1] })).rejects.toThrow(TypeError);
});

it("rejects a source detached during constructor lookup", async () => {
  const native = new ArrayBuffer(8);
  Object.defineProperty(native, "constructor", { get() {
    structuredClone(native, { transfer: [native] });
    return undefined;
  } });
  expect(() => native.slice()).toThrow(TypeError);
  const values = (await run("return [ArrayBuffer.prototype.slice,new ArrayBuffer(8)]")).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Missing method");
  await expect(values[0].call([], { stack: [], thisValue: values[1], getProperty: () => {
    structuredClone(values[1], { transfer: [values[1] as ArrayBuffer] });
    return undefined;
  } })).rejects.toThrow(TypeError);
});

it("rejects a detached species result even for an empty slice", async () => {
  const detached = new ArrayBuffer(0);
  structuredClone(detached, { transfer: [detached] });
  const native = new ArrayBuffer(0);
  Object.defineProperty(native, "constructor", { value: { [Symbol.species]: function () { return detached; } } });
  expect(() => native.slice()).toThrow(TypeError);
  const values = (await run("return [ArrayBuffer.prototype.slice,new ArrayBuffer(0)]")).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Missing method");
  const species = createSandboxClosure({ call: () => detached, construct: () => detached });
  const outcome = await Promise.resolve(values[0].call([], { stack: [], thisValue: values[1],
    getProperty: (_value, key) => key === "constructor" ? {} : species
  })).then(() => "accepted", error => error.name);
  expect(outcome).toBe("TypeError");
});

it.each([false, true])("retains slice storage across a species call (throws: %s)", async throws => {
  const budget = new Budget({ dataSize: 100000 });
  const retained: number[] = [];
  const inspect = declareHostOperation(() => { retained.push(measureSandboxData(budget.retainedValues())); }, "re-issue");
  const source = `function make(){const buffer=new ArrayBuffer(12000);buffer.constructor={[Symbol.species]:function(){inspect();${throws ? "throw 7" : "return new ArrayBuffer(1)"}}};return buffer}try{make().slice(0,1)}catch(error){if(error!==7)throw error}inspect();return true`;
  expect(await run(source, { budget, bindings: { inspect } })).toMatchObject({ ok: true, returnValue: true });
  expect(retained[0]).toBeGreaterThan(12000);
  expect(retained[1]).toBeLessThan(1000);
});

it("budgets destination bytes together with the retained source", async () => {
  const options = { budget: new Budget({ dataSize: 20000 }) };
  expect(await run("return new ArrayBuffer(12000).byteLength", options)).toMatchObject({ ok: true, returnValue: 12000 });
  await expect(run("return new ArrayBuffer(12000).slice().byteLength", {
    budget: new Budget({ dataSize: 20000 })
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
});
