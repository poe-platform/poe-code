import { expect, it } from "vitest";
import { createSandboxTemporalPlainDateTime, temporalPlainDateTimeFields } from "../interp/temporal-plain-date-time.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { encodeReplayData, decodeReplayData } from "./replay-data.js";
import { validateGuestHeapNode } from "./guest-heap-validation.js";

const slots={isoYear:2000,isoMonth:2,isoDay:29,hour:12,minute:34,second:56,millisecond:987,microsecond:654,nanosecond:321,calendar:"buddhist"};

it("restores private calendar/ISO slots, aliases and frozen cycles from the guest heap", () => {
  const value=createSandboxTemporalPlainDateTime(slots);
  Object.defineProperty(value,"self",{value});
  Object.freeze(value);
  const source="return 0";
  const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{value,alias:value}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const scope=restore(JSON.parse(JSON.stringify(saved)),{source}).currentScope;
  const result=scope.lookup("value").value;
  expect(temporalPlainDateTimeFields(result)).toEqual(slots);
  expect(scope.lookup("alias").value).toBe(result);
  expect(Object.getOwnPropertyDescriptor(result,"self")?.value).toBe(result);
  expect(Object.isFrozen(result)).toBe(true);
});

it("round-trips private fields and symbol cycles through replay data", () => {
  const value=createSandboxTemporalPlainDateTime(slots);
  const key=Symbol("cycle");
  Object.defineProperty(value,key,{value});
  Object.freeze(value);
  const saved=encodeReplayData([value,value,key]);
  const result=decodeReplayData(JSON.parse(JSON.stringify(saved)));
  if(!Array.isArray(result) || typeof result[2]!=="symbol")throw new Error("Invalid graph");
  expect(result[0]).toBe(result[1]);
  expect(temporalPlainDateTimeFields(result[0])).toEqual(slots);
  expect(Object.getOwnPropertyDescriptor(result[0],result[2])?.value).toBe(result[0]);
  expect(Object.isFrozen(result[0])).toBe(true);
  expect(encodeReplayData(result)).toEqual(saved);
});

it.each([
  {}, {...slots,isoYear:-0}, {...slots,isoDay:30}, {...slots,hour:24},
  {...slots,calendar:"ISO8601"}, {...slots,calendar:"invalid"}, {...slots,extra:1},
  {...slots,nanosecond:0.5}, {...slots,isoMonth:"2"}
])("rejects malformed or noncanonical slots in both snapshot codecs: %j", invalid => {
  const node={kind:"guest-temporal-plain-date-time",slots,state:{properties:{properties:[],extensible:true}}};
  expect(validateGuestHeapNode(node,{"1":node})).toBe(true);
  expect(()=>validateGuestHeapNode({...node,slots:invalid},{"1":node})).toThrow();
  const graph={root:{tag:"ref",id:0},nodes:[{kind:"temporal-plain-date-time",slots}]};
  expect(temporalPlainDateTimeFields(decodeReplayData(graph))).toEqual(slots);
  expect(()=>decodeReplayData({...graph,nodes:[{kind:"temporal-plain-date-time",slots:invalid}]})).toThrow();
});
