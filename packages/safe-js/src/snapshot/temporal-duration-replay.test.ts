import { expect, it } from "vitest";
import { createSandboxTemporalDuration, temporalDurationFields } from "../interp/temporal-duration.js";
import { hasNullObjectPrototype, setSandboxPrototype } from "../interp/object-model.js";
import { run } from "../run.js";
import { decodeReplayData, encodeReplayData } from "./replay-data.js";

it.each([0,1,-1])("preserves Duration slots and a frozen symbol cycle with sign %s", sign => {
  const value=createSandboxTemporalDuration({seconds:sign*9007199254740991,nanoseconds:sign*999999999});
  const key=Symbol("self");
  Object.defineProperty(value,key,{value});
  Object.freeze(value);
  setSandboxPrototype(value,null);
  const restored=decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData([value,value,key]))));
  if (!Array.isArray(restored) || typeof restored[2]!=="symbol") throw new Error("Invalid graph");
  expect(restored[0]).toBe(restored[1]);
  expect(temporalDurationFields(restored[0])).toEqual(temporalDurationFields(value));
  expect(Object.getOwnPropertyDescriptor(restored[0],restored[2])).toEqual({value:restored[0],writable:false,enumerable:false,configurable:false});
  expect(Object.isFrozen(restored[0])).toBe(true);
  expect(hasNullObjectPrototype(restored[0] as object)).toBe(true);
});

it("preserves guest-defined data properties", async () => {
  const result=await run("const d=new Temporal.Duration(1);Object.defineProperty(d,'label',{value:7});return d");
  const restored=decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(result.returnValue))));
  expect(temporalDurationFields(restored).years).toBe(1);
  expect(Object.getOwnPropertyDescriptor(restored,"label")).toEqual({value:7,writable:false,enumerable:false,configurable:false});
});

const zeroFields={years:0,months:0,weeks:0,days:0,hours:0,minutes:0,seconds:0,milliseconds:0,microseconds:0,nanoseconds:0};
it.each([null,[],{}, {...zeroFields,extra:0}, {...zeroFields,seconds:"1"}, {...zeroFields,seconds:0.5},
  {...zeroFields,seconds:-0}, {...zeroFields,seconds:Infinity}, {...zeroFields,seconds:NaN},
  {...zeroFields,seconds:1,nanoseconds:-1}, {...zeroFields,years:4294967296},
  {...zeroFields,seconds:9007199254740991,nanoseconds:1000000000}])("rejects malformed Duration slots %j", slots => {
  const node={kind:"temporal-duration",slots:zeroFields};
  const graph={root:{tag:"ref",id:0},nodes:[node]};
  expect(temporalDurationFields(decodeReplayData(graph))).toEqual(zeroFields);
  expect(()=>decodeReplayData({...graph,nodes:[{...node,slots}]})).toThrow();
});

it.each([{extensible:"false"},{nullPrototype:false},{properties:[]},{unexpected:true},
  {properties:{label:{value:1,enumerable:true,writable:"yes",configurable:true}}},
  {symbolProperties:[[1,{value:2,enumerable:true,writable:true,configurable:true}]]}
])("rejects malformed metadata %j", fields => {
  const node={kind:"temporal-duration",slots:zeroFields};
  expect(temporalDurationFields(decodeReplayData({root:{tag:"ref",id:0},nodes:[node]}))).toEqual(zeroFields);
  expect(()=>decodeReplayData({root:{tag:"ref",id:0},nodes:[{...node,...fields}]})).toThrow();
});

it("rejects encoded slot accessors without invoking them", () => {
  let reads=0;
  const slots={...zeroFields};
  Object.defineProperty(slots,"seconds",{get(){reads++;return 1}});
  expect(()=>decodeReplayData({root:{tag:"ref",id:0},nodes:[{kind:"temporal-duration",slots}]}))
    .toThrow(expect.objectContaining({name:"SnapshotValidationError",code:"invalidType",path:"$.nodes[0].slots.seconds"}));
  expect(reads).toBe(0);
});

it("rejects guest accessors and modified prototypes without invoking them", async () => {
  for(const source of [
    "const d=new Temporal.Duration();Object.defineProperty(d,'label',{get(){throw 'invoked'}});return d",
    "const d=new Temporal.Duration();Temporal.Duration.prototype.custom=true;return d"
  ]) {
    const result=await run(source);
    expect(()=>encodeReplayData(result.returnValue)).toThrow(TypeError);
  }
});
