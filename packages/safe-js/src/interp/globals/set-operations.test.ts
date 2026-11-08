import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { serialize, type RuntimeSnapshotValue } from "../../snapshot/serialize.js";
import { restore } from "../../snapshot/restore.js";
import { isSandboxClosure } from "../values.js";

it.each([
  "const r=new Set([1,2,3]).union(new Set([3,4]));return r instanceof Set?[...r]:r",
  "const trace=[];const other={get size(){trace.push('size');return 2},get has(){trace.push('has');return function(v){trace.push(['hasCall',v,this===other]);return v===2}},get keys(){trace.push('keys');return function(){trace.push(['keysCall',this===other]);return [2,4,4].values()}}};const r=new Set([1,2,3]).union(other);return [r instanceof Set?[...r]:r,trace]",
  "return [NaN,-1,undefined,1n,'bad'].map(size=>{try{new Set().union({size,has(){return false},keys(){return [].values()}})}catch(e){return e.name}})",
  "const trace=[];try{Set.prototype.union.call({}, {get size(){trace.push('size')}})}catch(e){return [e.name,trace]}",
  "const d=Object.getOwnPropertyDescriptor(Set.prototype,'union');return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable]",
  "const r=new Set([1,2,3]).intersection(new Set([3,4]));return r instanceof Set?[...r]:r",
  "const trace=[];const other={get size(){trace.push('size');return 2},get has(){trace.push('has');return function(v){trace.push(['hasCall',v,this===other]);return v===2}},get keys(){trace.push('keys');return function(){trace.push(['keysCall',this===other]);return [2,4,4].values()}}};const r=new Set([1,2,3]).intersection(other);return [r instanceof Set?[...r]:r,trace]",
  "return [NaN,-1,undefined,1n,'bad'].map(size=>{try{new Set().intersection({size,has(){return false},keys(){return [].values()}})}catch(e){return e.name}})",
  "const trace=[];try{Set.prototype.intersection.call({}, {get size(){trace.push('size')}})}catch(e){return [e.name,trace]}",
  "const d=Object.getOwnPropertyDescriptor(Set.prototype,'intersection');return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable]",
  "const r=new Set([1,2,3]).difference(new Set([3,4]));return r instanceof Set?[...r]:r",
  "const trace=[];const other={get size(){trace.push('size');return 2},get has(){trace.push('has');return function(v){trace.push(['hasCall',v,this===other]);return v===2}},get keys(){trace.push('keys');return function(){trace.push(['keysCall',this===other]);return [2,4,4].values()}}};const r=new Set([1,2,3]).difference(other);return [r instanceof Set?[...r]:r,trace]",
  "return [NaN,-1,undefined,1n,'bad'].map(size=>{try{new Set().difference({size,has(){return false},keys(){return [].values()}})}catch(e){return e.name}})",
  "const trace=[];try{Set.prototype.difference.call({}, {get size(){trace.push('size')}})}catch(e){return [e.name,trace]}",
  "const d=Object.getOwnPropertyDescriptor(Set.prototype,'difference');return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable]",
  "const r=new Set([1,2,3]).symmetricDifference(new Set([3,4]));return r instanceof Set?[...r]:r",
  "const trace=[];const other={get size(){trace.push('size');return 2},get has(){trace.push('has');return function(v){trace.push(['hasCall',v,this===other]);return v===2}},get keys(){trace.push('keys');return function(){trace.push(['keysCall',this===other]);return [2,4,4].values()}}};const r=new Set([1,2,3]).symmetricDifference(other);return [r instanceof Set?[...r]:r,trace]",
  "return [NaN,-1,undefined,1n,'bad'].map(size=>{try{new Set().symmetricDifference({size,has(){return false},keys(){return [].values()}})}catch(e){return e.name}})",
  "const trace=[];try{Set.prototype.symmetricDifference.call({}, {get size(){trace.push('size')}})}catch(e){return [e.name,trace]}",
  "const d=Object.getOwnPropertyDescriptor(Set.prototype,'symmetricDifference');return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable]",
  "const r=new Set([1,2,3]).isSubsetOf(new Set([3,4]));return r instanceof Set?[...r]:r",
  "const trace=[];const other={get size(){trace.push('size');return 2},get has(){trace.push('has');return function(v){trace.push(['hasCall',v,this===other]);return v===2}},get keys(){trace.push('keys');return function(){trace.push(['keysCall',this===other]);return [2,4,4].values()}}};const r=new Set([1,2,3]).isSubsetOf(other);return [r instanceof Set?[...r]:r,trace]",
  "return [NaN,-1,undefined,1n,'bad'].map(size=>{try{new Set().isSubsetOf({size,has(){return false},keys(){return [].values()}})}catch(e){return e.name}})",
  "const trace=[];try{Set.prototype.isSubsetOf.call({}, {get size(){trace.push('size')}})}catch(e){return [e.name,trace]}",
  "const d=Object.getOwnPropertyDescriptor(Set.prototype,'isSubsetOf');return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable]",
  "const r=new Set([1,2,3]).isSupersetOf(new Set([3,4]));return r instanceof Set?[...r]:r",
  "const trace=[];const other={get size(){trace.push('size');return 2},get has(){trace.push('has');return function(v){trace.push(['hasCall',v,this===other]);return v===2}},get keys(){trace.push('keys');return function(){trace.push(['keysCall',this===other]);return [2,4,4].values()}}};const r=new Set([1,2,3]).isSupersetOf(other);return [r instanceof Set?[...r]:r,trace]",
  "return [NaN,-1,undefined,1n,'bad'].map(size=>{try{new Set().isSupersetOf({size,has(){return false},keys(){return [].values()}})}catch(e){return e.name}})",
  "const trace=[];try{Set.prototype.isSupersetOf.call({}, {get size(){trace.push('size')}})}catch(e){return [e.name,trace]}",
  "const d=Object.getOwnPropertyDescriptor(Set.prototype,'isSupersetOf');return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable]",
  "const r=new Set([1,2,3]).isDisjointFrom(new Set([3,4]));return r instanceof Set?[...r]:r",
  "const trace=[];const other={get size(){trace.push('size');return 2},get has(){trace.push('has');return function(v){trace.push(['hasCall',v,this===other]);return v===2}},get keys(){trace.push('keys');return function(){trace.push(['keysCall',this===other]);return [2,4,4].values()}}};const r=new Set([1,2,3]).isDisjointFrom(other);return [r instanceof Set?[...r]:r,trace]",
  "return [NaN,-1,undefined,1n,'bad'].map(size=>{try{new Set().isDisjointFrom({size,has(){return false},keys(){return [].values()}})}catch(e){return e.name}})",
  "const trace=[];try{Set.prototype.isDisjointFrom.call({}, {get size(){trace.push('size')}})}catch(e){return [e.name,trace]}",
  "const d=Object.getOwnPropertyDescriptor(Set.prototype,'isDisjointFrom');return [d.value.name,d.value.length,d.writable,d.enumerable,d.configurable]",
  "class Child extends Set{static get [Symbol.species](){throw 7}}const r=new Child([1]).union(new Set([2]));return [r instanceof Child,Object.getPrototypeOf(r)===Set.prototype,[...r]]",
  "const a=new Set([1,2]);const b={size:10,has(v){if(v===1)a.add(3);return true},keys(){throw 7}};return [[...a.intersection(b)],[...a]]",
  "const a=new Set([1,2]);const b={size:10,has(v){if(v===1)a.add(3);return false},keys(){throw 7}};return [[...a.difference(b)],[...a]]",
  "const trace=[];const b={size:1,has(){return false},*keys(){try{yield 9;yield 1}finally{trace.push('close')}}};return [new Set([1,2]).isSupersetOf(b),trace]",
  "const trace=[];const b={size:1,has(){return false},*keys(){try{yield 1;yield 9}finally{trace.push('close')}}};return [new Set([1,2]).isDisjointFrom(b),trace]",
  "const trace=[];const b={size:1,has(){return false},keys(){return {next(){throw 7},return(){trace.push('close');return {}}}}};try{new Set([1]).union(b)}catch(e){return [e,trace]}",
  "return [...new Set([NaN,-0]).symmetricDifference({size:4,has(){throw 7},keys(){return [NaN,NaN,1,1].values()}})]",
  "return [...new Set([1,2,3]).intersection(new Set([3,1]))]",
  "return [...new Set([1,2]).intersection(new Set([2,1,3]))]"
])("matches native Set operations: %s", async source => {
  const expected = runInNewContext(`(function(){"use strict";${source}})()`);
  const result = await run(`if(typeof Set.prototype.union!=="function")throw new Error("Missing Set operations");${source}`);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  expect(result.returnValue).toEqual(expected);
});

it("copies union receiver data after obtaining the other keys iterator", async () => {
  // ECMA-262 union steps 4–5; independently verified on Node 24.14.
  // Node 22.23 copies too early, so it is not an oracle for this case.
  const result = await run("const a=new Set([1]);const b={size:2,has(){return false},keys(){a.add(2);return [3].values()}};return [...a.union(b)]");
  expect(result).toMatchObject({ ok: true, returnValue: [1,2,3] });
});

it.each(["union", "intersection", "difference", "symmetricDifference"])("restores %s output with identity and insertion order", async method => {
  const source = `const a={n:1},b={n:2},c={n:3};const result=new Set([a,b]).${method}(new Set([b,c]));return ()=>[[...result].map(v=>v.n),result.has(a),result.has(b),result.has(c)]`;
  const expected = runInNewContext(`(function(){${source}})()()`);
  const first = await run(source);
  if (!first.ok) throw first.error;
  const reader = first.returnValue as RuntimeSnapshotValue;
  const saved = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { reader } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(saved)), { source });
  const binding = restored.currentScope.lookup("reader");
  if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("Missing reader");
  expect(await binding.value.call([])).toEqual(expected);
});

it("bounds an endless set-like keys producer", async () => {
  await expect(run("return new Set().union({size:Infinity,has(){return false},*keys(){while(true)yield 1}})", { budget: new Budget({ maxSteps: 1000 }) }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
});

it("accounts for values retained by a union while keys produces another value", async () => {
  const source = "return new Set().union({size:2,has(){return false},*keys(){yield 'x'.repeat(2000);const temporary='y'.repeat(2000);yield 'z'.repeat(2000)}})";
  await expect(run(source, { budget: new Budget({ dataSize: 5000 }) }))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
  expect(await run(source, { budget: new Budget({ dataSize: 10000 }) })).toMatchObject({ ok: true });
});

it.each(["union", "symmetricDifference", "isSupersetOf"])("uses keys rather than Symbol.iterator for %s", async method => {
  const source = `const b=new Set([2]);b[Symbol.iterator]=function(){throw 7};const r=new Set([1,2]).${method}(b);return r instanceof Set?[...r]:r`;
  const expected = runInNewContext(`(function(){${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});
