import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";
import { isSandboxClosure } from "./values.js";
import { Budget } from "./budget.js";
import { declareHostOperation } from "./host-bridge.js";
import { measureSandboxData } from "./values.js";

it.each([
  "const log=[];function C(){log.push('construct');return []}try{Float32Array.of.call(C,{valueOf(){log.push('convert');return 2}})}catch(error){return [error.name,log]}",
  "const log=[];function C(){log.push('construct');return new Float32Array(0)}try{Float32Array.of.call(C,{valueOf(){log.push('convert');return 2}})}catch(error){return [error.name,log]}",
  "const log=[];let result;function C(n){result=new Float32Array(n);return result}try{Float32Array.of.call(C,2,{valueOf(){log.push('throw');throw 7}},{valueOf(){log.push('later');return 4}})}catch(error){return [error,log,Array.from(result)]}",
  "const result=[];for(const value of [Symbol('x'),BigInt(2)]){try{Float32Array.of(value)}catch(error){result.push(error.name)}}return result",
  "const log=[];const value=Float32Array.of({[Symbol.toPrimitive](hint){log.push(hint);return '2.5'}});return [log,Array.from(value)]",
  "class Custom extends Float32Array{get length(){throw 7}}return Array.from(Custom.of(2,4))",
  "return Array.from(Float32Array.of(1,2.5,-0))",
  "return Array.from(Float32Array.of())",
  "class Custom extends Float32Array{}const value=Custom.of(2,4);return [value instanceof Custom,Array.from(value)]",
  "const parent=Object.getPrototypeOf(Float32Array);const d=Object.getOwnPropertyDescriptor(parent,'of');return [Object.hasOwn(Float32Array,'of'),Float32Array.of===parent.of,Float32Array.of.name,Float32Array.of.length,d.writable,d.enumerable,d.configurable]",
  "let length;function C(n){length=n;return new Float32Array(n+1)}const value=Float32Array.of.call(C,2,4);return [length,Array.from(value)]",
  "function C(){return []}try{Float32Array.of.call(C,2)}catch(error){return error.name}",
  "function C(){return new Float32Array(0)}try{Float32Array.of.call(C,2)}catch(error){return error.name}",
  "try{Float32Array.of.call(()=>{},2)}catch(error){return error.name}",
  "const log=[];function C(n){log.push('construct');return new Float32Array(n)}const a={valueOf(){log.push('a');return 2}};const b={valueOf(){log.push('b');return 4}};const value=Float32Array.of.call(C,a,b);return [log,Array.from(value)]"
])("matches native TypedArray.of: %s", async source => {
  const native = runInNewContext(`(function(){${source}})()`);
  const result = await run(source);
  expect(result.returnValue).toEqual(native);
});

it("preserves inherited factory identity and calls across repeated snapshots", async () => {
  const source = "const factory=Float32Array.of;class Custom extends Float32Array{}return ()=>[factory===Custom.of,Array.from(factory.call(Custom,2,4))]";
  let read = (await run(source)).returnValue;
  for (let round = 0; round < 2; round++) {
    const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "external", bindings: { read } }], callStack: [], pendingPromises: [], moduleBindings: {} });
    const result = restore(JSON.parse(JSON.stringify(saved)), { source }).currentScope.lookup("read");
    if (!result.found || !isSandboxClosure(result.value)) throw new Error("Missing restored reader");
    expect(await result.value.call([])).toEqual([true, [2,4]]);
    read = result.value;
  }
});

it.each([false, true])("retains factory storage during coercion and releases it (throw=%s)", async throws => {
  const budget = new Budget({ dataSize: 100000 });
  const retained: number[] = [];
  const inspect = declareHostOperation(() => { retained.push(measureSandboxData(budget.retainedValues())); }, "re-issue");
  const source = `function C(){return new Float32Array(3000)}try{Float32Array.of.call(C,{valueOf(){inspect();${throws ? "throw 7" : "return 2"}}})}catch(error){if(error!==7)throw error}inspect();return true`;
  expect(await run(source, { budget, bindings: { inspect } })).toMatchObject({ ok: true, returnValue: true });
  expect(retained[0]).toBeGreaterThan(12000);
  expect(retained[1]).toBeLessThan(1000);
});
