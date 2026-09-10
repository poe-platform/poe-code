import { expect, it } from "vitest";
import { createSandboxDateTimeFormat, dateTimeFormatState, formatDateTimeValue } from "../interp/intl-datetimeformat.js";
import { createSandboxTemporalPlainTime } from "../interp/temporal-plain-time.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { validateGuestHeapNode } from "./guest-heap-validation.js";

it("retains requested defaults separately from resolved date fields", () => {
  const source="return 0";
  const value=createSandboxDateTimeFormat('en-US',{timeZone:'UTC'});
  const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:'module',bindings:{value}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const restored=restore(JSON.parse(JSON.stringify(saved)),{source}).currentScope.lookup('value').value;
  expect(dateTimeFormatState(restored).requestedOptions).toEqual({timeZone:'UTC'});
  expect(dateTimeFormatState(restored).options).toEqual(dateTimeFormatState(value).options);
});

it.each([{timeZone:'invalid/zone'},{timeZone:'America/New_York'},{year:123},{hour12:'false'},{fractionalSecondDigits:1.5},{unexpected:true}])("rejects malformed requested options %j", requestedOptions => {
  const options=new Intl.DateTimeFormat('en-US',{timeZone:'UTC'}).resolvedOptions();
  const node={kind:'guest-datetimeformat',options,requestedOptions,state:{properties:{properties:[],extensible:true}}};
  expect(()=>validateGuestHeapNode(node,{'1':node})).toThrow();
});

it("does not invoke requested-option accessors during validation", () => {
  let reads=0;const requestedOptions={};Object.defineProperty(requestedOptions,'hour',{get(){reads++;return 'numeric'},enumerable:true});
  const node={kind:'guest-datetimeformat',options:new Intl.DateTimeFormat('en-US',{timeZone:'UTC'}).resolvedOptions(),requestedOptions,state:{properties:{properties:[],extensible:true}}};
  expect(()=>validateGuestHeapNode(node,{'1':node})).toThrow();expect(reads).toBe(0);
});

it("keeps implicit Temporal time defaults after a formatter round trip", () => {
  const source="return 0";
  const value=createSandboxDateTimeFormat('en-US',{timeZone:'UTC'});
  const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:'module',bindings:{value}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const restored=restore(JSON.parse(JSON.stringify(saved)),{source}).currentScope.lookup('value').value;
  const time=createSandboxTemporalPlainTime({hour:12,minute:0,second:0,millisecond:0,microsecond:0,nanosecond:0});
  expect(formatDateTimeValue(restored,'format',[time])).toBe('12:00:00 PM');
});

it("restores legacy formatters without inventing requested options", () => {
  const source="return 0";
  const native=new Intl.DateTimeFormat('en-US',{timeZone:'UTC'});
  const value=createSandboxDateTimeFormat('en-US',{...native.resolvedOptions()},true);
  const saved=serialize({source,currentAstNodeId:1,scopeChain:[{id:'module',bindings:{value}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const restored=restore(JSON.parse(JSON.stringify(saved)),{source}).currentScope.lookup('value').value;
  expect(dateTimeFormatState(restored).requestedOptions).toBeUndefined();
  expect(formatDateTimeValue(restored,'format',[0])).toBe(native.format(0));
});
