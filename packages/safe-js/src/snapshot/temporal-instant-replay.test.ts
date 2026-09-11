import { expect, it } from "vitest";
import { createSandboxTemporalInstant, temporalInstantEpoch } from "../interp/temporal-instant.js";
import { hasNullObjectPrototype, setSandboxPrototype } from "../interp/object-model.js";
import { run } from "../run.js";
import { decodeReplayData, encodeReplayData } from "./replay-data.js";
import { serializeSafeJSSnapshot } from "./dump-format.js";
import { Temporal as TemporalBackend } from "temporal-polyfill/full/implementation";

it.each([0n,-1n,8640000000000000000000n,-8640000000000000000000n])("round-trips Instant epoch %s with aliases, symbols and descriptors", epoch => {
  const instant = createSandboxTemporalInstant(epoch);
  const key = Symbol("self");
  Object.defineProperty(instant, key, {value: instant});
  Object.freeze(instant);
  setSandboxPrototype(instant, null);
  const restored = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData([instant,instant,key]))));
  if (!Array.isArray(restored) || typeof restored[2] !== "symbol") throw new Error("Invalid graph");
  expect(restored[0]).toBe(restored[1]);
  expect(temporalInstantEpoch(restored[0])).toBe(epoch);
  expect(Object.getOwnPropertyDescriptor(restored[0],restored[2])).toEqual({value:restored[0],writable:false,enumerable:false,configurable:false});
  expect(Object.isFrozen(restored[0])).toBe(true);
  expect(hasNullObjectPrototype(restored[0] as object)).toBe(true);
});

it("preserves data descriptors created inside the guest", async () => {
  const result = await run("const value=new Temporal.Instant(1n);Object.defineProperty(value,'label',{value:7});return value");
  if (!result.ok) throw new Error("Guest Instant failed");
  const restored = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(result.returnValue))));
  expect(temporalInstantEpoch(restored)).toBe(1n);
  expect(Object.getOwnPropertyDescriptor(restored,"label")).toEqual({value:7,writable:false,enumerable:false,configurable:false});
});

it.each(["", "-0", "+1", "01", " 1", "0x1", "1.0", "1e1", "8640000000000000000001", "-8640000000000000000001", "1".repeat(24), 1, null])("rejects malformed epoch %s with a valid-node control", epochNanoseconds => {
  const node = {kind:"temporal-instant",epochNanoseconds:"1"};
  const graph = {root:{tag:"ref",id:0},nodes:[node]};
  expect(temporalInstantEpoch(decodeReplayData(graph))).toBe(1n);
  expect(() => decodeReplayData({...graph,nodes:[{...node,epochNanoseconds}]})).toThrow();
});

it.each([
  {extensible:"false"}, {nullPrototype:false}, {properties:[]},
  {properties:{label:{value:1,enumerable:true,writable:"yes",configurable:true}}},
  {symbolProperties:[[1,{value:2,enumerable:true,writable:true,configurable:true}]]},
  {unexpected:true}
])("rejects malformed Instant metadata %j", fields => {
  const node = {kind:"temporal-instant",epochNanoseconds:"1"};
  expect(temporalInstantEpoch(decodeReplayData({root:{tag:"ref",id:0},nodes:[node]}))).toBe(1n);
  expect(() => decodeReplayData({root:{tag:"ref",id:0},nodes:[{...node,...fields}]})).toThrow();
});

it("rejects guest accessors and modified prototypes without evaluating them", async () => {
  for (const source of [
    "const value=new Temporal.Instant(1n);Object.defineProperty(value,'label',{get(){throw 'invoked'}});return value",
    "const value=new Temporal.Instant(1n);Temporal.Instant.prototype.custom=true;return value"
  ]) {
    const result = await run(source);
    if (!result.ok) throw new Error("Guest Instant failed");
    expect(() => encodeReplayData(result.returnValue)).toThrow(TypeError);
  }
});

it("replays Instant inputs and a completed host result without repeating the host call", async () => {
  let calls = 0;
  const load = async () => { calls++; return new TemporalBackend.Instant(-1n); };
  const source = "const value=await load();return [input.epochNanoseconds,value.epochNanoseconds,value instanceof Temporal.Instant,value.toJSON()]";
  const first = await run(source,{bindings:{load,input:new TemporalBackend.Instant(1n)}});
  expect(first).toMatchObject({ok:true,returnValue:[1n,-1n,true,"1969-12-31T23:59:59.999999999Z"]});
  let snapshot = JSON.parse(serializeSafeJSSnapshot(first.snapshot));
  for (let index=0;index<2;index++) {
    const restored = await run(source,{snapshot,bindings:{load}});
    expect(restored).toMatchObject({ok:true,returnValue:[1n,-1n,true,"1969-12-31T23:59:59.999999999Z"]});
    expect(calls).toBe(1);
    snapshot = JSON.parse(serializeSafeJSSnapshot(restored.snapshot));
  }
});
