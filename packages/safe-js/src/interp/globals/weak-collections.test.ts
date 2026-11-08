import { expect, it } from "vitest";
import { run } from "../../run.js";
import { measureSandboxData } from "../values.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each([
  ["const key={};const map=new WeakMap([[key,7]]);return [map.get(key),map.has(key),map.delete(key),map.has(key)]", [7,true,true,false]],
  ["const key={};const set=new WeakSet([key]);return [set.has(key),set.delete(key),set.has(key)]", [true,true,false]],
  ["const key=Symbol();const map=new WeakMap([[key,7]]);const set=new WeakSet([key]);return [map.get(key),set.has(key)]", [7,true]],
  ["const key=Symbol.for('registered');let rejected=0;try{new WeakMap().set(key,1)}catch(e){if(e instanceof TypeError)rejected++}try{new WeakSet().add(key)}catch(e){if(e instanceof TypeError)rejected++}return rejected", 2]
] as const)("supports weak collection keys: %s", async (source, expected) => {
  expect(await run(source)).toMatchObject({ok: true, returnValue: expected});
});

it.each([
  ["try{WeakMap()}catch(e){return e.name}", "TypeError"],
  ["try{WeakSet()}catch(e){return e.name}", "TypeError"],
  ["const m=new WeakMap();return [m.get(1),m.has(1),m.delete(1)]", [undefined,false,false]],
  ["const s=new WeakSet();return [s.has(1),s.delete(1)]", [false,false]],
  ["const k=()=>{};return new WeakMap([[k,4]]).get(k)", 4],
  ["class M extends WeakMap{};const m=new M();return [m instanceof M,m instanceof WeakMap,m.set({},1)===m]", [true,true,true]],
  ["class S extends WeakSet{};const s=new S();return [s instanceof S,s instanceof WeakSet,s.add({})===s]", [true,true,true]],
  ["const m=new WeakMap();return [m.size,m.keys,m.values,m.entries,m[Symbol.iterator],Object.prototype.toString.call(m)]", [undefined,undefined,undefined,undefined,undefined,"[object WeakMap]"]],
  ["let closed=0;const source={[Symbol.iterator](){return {next(){return {value:[1,2],done:false}},return(){closed++;return {}}}}};try{new WeakMap(source)}catch(e){return [e.name,closed]}", ["TypeError",1]],
  ["const k={};const seen=[];class M extends WeakMap{set(a,b){seen.push([a===k,b]);return this}};new M([[k,7]]);return seen", [[true,7]]]
] as const)("preserves weak collection object semantics: %s", async (source, expected) => {
  expect(await run(source)).toMatchObject({ok: true, returnValue: expected});
});

it("does not make a weak map key live for accounting", async () => {
  const result = await run("const key=Object.create(null);const map=Object.setPrototypeOf(new WeakMap(),null);WeakMap.prototype.set.call(map,key,'x'.repeat(200));return [map,key]");
  if (!result.ok) throw result.error;
  const [map,key] = result.returnValue as unknown[];
  expect(measureSandboxData([map])).toBe(1);
  expect(measureSandboxData([map,key])).toBe(203);
  expect(measureSandboxData([key,map])).toBe(203);
});

it("reaches a fixed point across weak entries without retaining unrooted chains", async () => {
  const result = await run("const a=Object.create(null),b=Object.create(null);const first=new WeakMap([[a,b]]),second=new WeakMap([[b,'x'.repeat(200)]]);Object.setPrototypeOf(first,null);Object.setPrototypeOf(second,null);return [first,second,a]");
  if (!result.ok) throw result.error;
  const [first,second,key] = result.returnValue as unknown[];
  expect(measureSandboxData([first,second])).toBe(2);
  expect(measureSandboxData([second,first,key])).toBe(206);
});

it.each(["WeakMap", "WeakSet"])("rejects cloning %s before invoking custom getters", async name => {
  expect(await run(`let reads=0;const value=new ${name}();Object.defineProperty(value,'x',{enumerable:true,get(){reads++;return 1}});try{structuredClone(value)}catch(e){return [e.name,reads]}`))
    .toMatchObject({ok: true, returnValue: ["DataCloneError",0]});
});

it.each(["WeakMap", "WeakSet"])("preserves %s metadata and receiver branding", async name => {
  const method = name === "WeakMap" ? "set" : "add";
  expect(await run(`let badReceiver=false,badNew=false;try{${name}.prototype.${method}.call({}, {})}catch(e){badReceiver=e instanceof TypeError}try{new ${name}.prototype.${method}({})}catch(e){badNew=e instanceof TypeError}return [${name}.name,${name}.length,${name}.prototype.${method}.length,badReceiver,badNew,Object.keys(${name}.prototype)]`))
    .toMatchObject({ok: true, returnValue: [name,0,name === "WeakMap" ? 2 : 1,true,true,[]]});
});

it("replays a weak map with a strongly retained key through a checkpoint", async () => {
  const source = "const key={};const map=new WeakMap([[key,7]]);map.self=map;await 0;return [map.get(key),map.self===map]";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ok: true, returnValue: [7,true]});
    expect(await run(source, { snapshot })).toMatchObject({ok: true, returnValue: [7,true]});
  } finally { await completed; }
});

it("accepts well-known symbols while registered symbols remain misses", async () => {
  expect(await run("const m=new WeakMap([[Symbol.iterator,9]]),s=new WeakSet([Symbol.toStringTag]);const k=Symbol.for('registered');return [m.get(Symbol.iterator),s.has(Symbol.toStringTag),m.get(k),m.has(k),m.delete(k),s.has(k),s.delete(k)]"))
    .toMatchObject({ok: true, returnValue: [9,true,undefined,false,false,false,false]});
});

it("restores fresh symbol keys without making registered symbols valid", async () => {
  const source = "const key=Symbol('key');const map=new WeakMap([[key,7]]);const registered=Symbol.for('registered');await 0;let rejected=false;try{map.set(registered,8)}catch(e){rejected=e instanceof TypeError}return [map.get(key),rejected,map.has(registered)]";
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await completed).toMatchObject({ok: true, returnValue: [7,true,false]});
    expect(await run(source, { snapshot })).toMatchObject({ok: true, returnValue: [7,true,false]});
  } finally { await completed; }
});
