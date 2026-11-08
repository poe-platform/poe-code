import { expect, it } from "vitest";
import { createSandboxTemporalInstant, temporalInstantEpoch } from "../interp/temporal-instant.js";
import { setSandboxPrototype, getSandboxPrototype } from "../interp/object-model.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { validateGuestHeapNode } from "./guest-heap-validation.js";

it.each([0n, -1n, 8640000000000000000000n, -8640000000000000000000n])("round trips Instant epoch %s with graph identity and descriptors", epoch => {
  const value=createSandboxTemporalInstant(epoch);
  const prototype={marker:"origin"};
  setSandboxPrototype(value,prototype);
  Object.defineProperty(value,"self",{value});
  Object.freeze(value);
  const source="return 0";
  const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{value,alias:value,prototype}}],
    callStack:[],pendingPromises:[],moduleBindings:{}});
  const scope=restore(JSON.parse(JSON.stringify(saved)),{source}).currentScope;
  const restored=scope.lookup("value").value;
  expect(temporalInstantEpoch(restored)).toBe(epoch);
  expect(scope.lookup("alias").value).toBe(restored);
  expect(getSandboxPrototype(restored as object)).toBe(scope.lookup("prototype").value);
  expect(Object.getOwnPropertyDescriptor(restored,"self")).toEqual({value:restored,writable:false,enumerable:false,configurable:false});
  expect(Object.isFrozen(restored)).toBe(true);
});

it.each(["", "01", "-0", "+1", " 1", "0x1", "1.5", "not-a-number", "8640000000000000000001", "-8640000000000000000001", "1".repeat(100), 1, null])("rejects malformed Instant epoch %j before restoration", epochNanoseconds => {
  const valid={kind:"guest-temporal-instant",epochNanoseconds:"1",state:{properties:{properties:[],extensible:true}}};
  expect(validateGuestHeapNode(valid,{"1":valid})).toBe(true);
  const node={kind:"guest-temporal-instant",epochNanoseconds,state:{properties:{properties:[],extensible:true}}};
  expect(()=>validateGuestHeapNode(node,{"1":node})).toThrow();
});

it("round trips an unmodified Instant and recaptures the same private epoch", () => {
  const source="return 0";
  const save=(value:ReturnType<typeof createSandboxTemporalInstant>)=>serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"module",bindings:{value}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const first=save(createSandboxTemporalInstant(1n));
  const value=restore(JSON.parse(JSON.stringify(first)),{source}).currentScope.lookup("value").value;
  expect(temporalInstantEpoch(value)).toBe(1n);
  expect(save(value as ReturnType<typeof createSandboxTemporalInstant>)).toEqual(first);
});
