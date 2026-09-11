import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import { declareHostOperation } from "./host-bridge.js";
import { isSandboxClosure, measureSandboxData } from "./values.js";
import { serialize } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it.each(["slice", "subarray"])("preserves %s clamping and invalid numeric bounds", async method => {
  const source = `const value=new Float32Array([1,2,3]);return [undefined,null,NaN,Infinity,-Infinity,-1.5,9,Symbol('x'),BigInt(1)].map(bound=>{try{return Array.from(value.${method}(bound))}catch(error){return error.name}})`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});

it.each(["slice", "subarray"])("coerces %s bounds in native order", async method => {
  const source = `const trace=[];const value=new Float32Array([1,2,3]);const result=value.${method}({valueOf(){trace.push('start');return 1}},{valueOf(){trace.push('end');return 3}});return [Array.from(result),trace]`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});

it.each(["slice", "subarray"])("retains %s source mutations during coercion", async method => {
  const source = `const value=new Float32Array([1,2,3]);const result=value.${method}({valueOf(){value[1]=7;return 1}});return Array.from(result)`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});

it.each(["slice", "subarray"])("stops %s before end coercion when start throws", async method => {
  const source = `const trace=[];try{new Float32Array(2).${method}({valueOf(){trace.push('start');throw 7}},{valueOf(){trace.push('end');return 1}})}catch(error){return [error,trace]}`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext(`(function(){${source}})()`) });
});

it.each(["slice", "subarray"])("coerces %s getter-valued hooks in direct calls", async method => {
  const values = (await run(`return [Float32Array.prototype.${method},new Float32Array([1,2,3]),{get valueOf(){return ()=>1}}]`)).returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0])) throw new Error("Missing method");
  expect(await values[0].call([values[2]], { stack: [], thisValue: values[1] })).toEqual(new Float32Array([2, 3]));
});

it.each(["slice", "subarray"])("retains %s storage through coercion and releases after success or throw", async method => {
  for (const throws of [false, true]) {
    const budget = new Budget({ dataSize: 100000 });
    const retained: number[] = [];
    const inspect = declareHostOperation(() => { retained.push(measureSandboxData(budget.retainedValues())); }, "re-issue");
    const source = `try{Float32Array.prototype.${method}.call(new Float32Array(3000),{valueOf(){inspect();${throws ? "throw 7" : "return 0"}}},1)}catch(error){if(error!==7)throw error}inspect();return true`;
    expect(await run(source, { budget, bindings: { inspect } })).toMatchObject({ ok: true, returnValue: true });
    expect(retained[0]).toBeGreaterThan(12000);
    expect(retained[1]).toBeLessThan(1000);
  }
});

it.each(["slice", "subarray"])("preserves %s coercion and aliasing across snapshots", async method => {
  const source = `const value=new Float32Array([1,2,3]);const bound={valueOf(){return 1}};return ()=>{const result=value.${method}(bound);result[0]=7;return [Array.from(result),Array.from(value)]}`;
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
