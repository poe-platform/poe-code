import { expect, it } from "vitest";
import { createSandboxTemporalPlainDate, temporalPlainDateFields } from "../interp/temporal-plain-date.js";
import { setSandboxPrototype, hasNullObjectPrototype } from "../interp/object-model.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { encodeReplayData, decodeReplayData } from "./replay-data.js";
import { validateGuestHeapNode } from "./guest-heap-validation.js";

const slots={isoYear:2000,isoMonth:2,isoDay:29,calendar:"buddhist"};

it("restores private date slots, aliases and frozen cycles from the heap", () => {
  const value=createSandboxTemporalPlainDate(slots);Object.defineProperty(value,"self",{value});Object.freeze(value);
  const source="return 0";
  const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{value,alias:value}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const scope=restore(JSON.parse(JSON.stringify(saved)),{source}).currentScope;const result=scope.lookup("value").value;
  expect(temporalPlainDateFields(result)).toEqual(slots);expect(scope.lookup("alias").value).toBe(result);
  expect(Object.getOwnPropertyDescriptor(result,"self")?.value).toBe(result);expect(Object.isFrozen(result)).toBe(true);
});

it("round-trips replay symbols, cycles and explicit null prototypes", () => {
  const value=createSandboxTemporalPlainDate(slots);const key=Symbol("cycle");setSandboxPrototype(value,null);
  Object.defineProperty(value,key,{value});Object.freeze(value);
  const saved=encodeReplayData([value,value,key]);const result=decodeReplayData(JSON.parse(JSON.stringify(saved)));
  if(!Array.isArray(result)||typeof result[2]!=="symbol")throw Error("Invalid graph");
  expect(result[0]).toBe(result[1]);expect(temporalPlainDateFields(result[0])).toEqual(slots);
  expect(Object.getOwnPropertyDescriptor(result[0],result[2])?.value).toBe(result[0]);
  expect(Object.isFrozen(result[0])).toBe(true);expect(hasNullObjectPrototype(result[0] as object)).toBe(true);
  expect(encodeReplayData(result)).toEqual(saved);
});

it.each([
  {},{...slots,isoYear:-0},{...slots,isoDay:30},{...slots,isoMonth:0},
  {...slots,calendar:"ISO8601"},{...slots,calendar:"invalid"},{...slots,extra:1},
  {...slots,isoYear:0.5},{...slots,isoMonth:"2"},
  {...slots,isoYear:-271821,isoMonth:4,isoDay:18},
  {...slots,isoYear:275760,isoMonth:9,isoDay:14}
])("rejects malformed or noncanonical slots in both codecs: %j", invalid => {
  const node={kind:"guest-temporal-plain-date",slots,state:{properties:{properties:[],extensible:true}}};
  expect(validateGuestHeapNode(node,{"1":node})).toBe(true);
  expect(()=>validateGuestHeapNode({...node,slots:invalid},{"1":node})).toThrow();
  const graph={root:{tag:"ref",id:0},nodes:[{kind:"temporal-plain-date",slots}]};
  expect(temporalPlainDateFields(decodeReplayData(graph))).toEqual(slots);
  expect(()=>decodeReplayData({...graph,nodes:[{kind:"temporal-plain-date",slots:invalid}]})).toThrow();
});
