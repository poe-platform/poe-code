import { expect, it } from "vitest";
import { createSandboxTemporalDuration, temporalDurationFields } from "../interp/temporal-duration.js";
import { setSandboxPrototype, getSandboxPrototype } from "../interp/object-model.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { validateGuestHeapNode } from "./guest-heap-validation.js";
import { run } from "../run.js";
import { dump } from "../dump.js";

it.each([0, 1, -1])("restores Duration slots, aliases, prototypes and frozen cycles with sign %s", sign => {
  const fields = {years:sign,days:sign*2,seconds:sign*3,nanoseconds:sign*4};
  const value = createSandboxTemporalDuration(fields);
  const prototype = {marker:"origin"};
  setSandboxPrototype(value,prototype);
  Object.defineProperty(value,"self",{value});
  Object.freeze(value);
  const source="return 0";
  const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{value,alias:value,prototype}}],
    callStack:[],pendingPromises:[],moduleBindings:{}});
  const scope=restore(JSON.parse(JSON.stringify(saved)),{source}).currentScope;
  const restored=scope.lookup("value").value;
  expect(temporalDurationFields(restored)).toEqual(temporalDurationFields(value));
  expect(scope.lookup("alias").value).toBe(restored);
  expect(getSandboxPrototype(restored as object)).toBe(scope.lookup("prototype").value);
  expect(Object.getOwnPropertyDescriptor(restored,"self")).toEqual({value:restored,writable:false,enumerable:false,configurable:false});
  expect(Object.isFrozen(restored)).toBe(true);
});

it("preserves a subclass Duration across public replay", async () => {
  const source=`class Derived extends Temporal.Duration{};const d=new Derived(0,0,0,0,0,0,2,0,0,1);
    await 0;return [d.seconds,d.nanoseconds,d instanceof Derived,new Temporal.Instant(0n).add(d).epochNanoseconds]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:[2,1,true,2000000001n]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});

const zeroFields={years:0,months:0,weeks:0,days:0,hours:0,minutes:0,seconds:0,milliseconds:0,microseconds:0,nanoseconds:0};

it("recaptures identical private fields at the maximum normalized time", () => {
  const source="return 0";
  const save=(value:ReturnType<typeof createSandboxTemporalDuration>)=>serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"module",bindings:{value}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const first=save(createSandboxTemporalDuration({seconds:9007199254740991,nanoseconds:999999999}));
  const value=restore(JSON.parse(JSON.stringify(first)),{source}).currentScope.lookup("value").value;
  expect(temporalDurationFields(value).nanoseconds).toBe(999999999);
  expect(save(value as ReturnType<typeof createSandboxTemporalDuration>)).toEqual(first);
});

it("rejects accessor slot encodings without invoking them", () => {
  let reads=0;
  const slots={...zeroFields};
  Object.defineProperty(slots,"seconds",{get(){reads++;return 1}});
  const node={kind:"guest-temporal-duration",slots,state:{properties:{properties:[],extensible:true}}};
  expect(()=>validateGuestHeapNode(node,{"1":node})).toThrow(TypeError);
  expect(reads).toBe(0);
});

it.each([{extra:0},{state:null}])("rejects invalid Duration node metadata %j", changes => {
  const valid={kind:"guest-temporal-duration",slots:zeroFields,state:{properties:{properties:[],extensible:true}}};
  expect(validateGuestHeapNode(valid,{"1":valid})).toBe(true);
  const node={...valid,...changes};
  expect(()=>validateGuestHeapNode(node,{"1":node})).toThrow();
});

it.each([
  null, [], {}, {...zeroFields,extra:0}, {...zeroFields,seconds:"1"}, {...zeroFields,seconds:0.5},
  {...zeroFields,seconds:Infinity}, {...zeroFields,seconds:NaN}, {...zeroFields,seconds:-0},
  {...zeroFields,seconds:1,nanoseconds:-1}, {...zeroFields,years:4294967296},
  {...zeroFields,seconds:9007199254740991,nanoseconds:1000000000}
])("rejects malformed Duration slots %j", slots => {
  const valid={kind:"guest-temporal-duration",slots:zeroFields,state:{properties:{properties:[],extensible:true}}};
  expect(validateGuestHeapNode(valid,{"1":valid})).toBe(true);
  const node={...valid,slots};
  expect(()=>validateGuestHeapNode(node,{"1":node})).toThrow();
});
