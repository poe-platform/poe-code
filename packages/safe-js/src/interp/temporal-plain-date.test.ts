import { expect, it } from "vitest";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import { createSandboxTemporalPlainDate, temporalPlainDateFields, isSandboxTemporalPlainDate, createHostTemporalPlainDate, hostTemporalPlainDateFields } from "./temporal-plain-date.js";

it("stores immutable ISO fields independently of calendar years and public fields", () => {
  const input={isoYear:2000,isoMonth:2,isoDay:29,calendar:"buddhist"};
  const value=createSandboxTemporalPlainDate(input);input.isoYear=2001;
  expect(Reflect.ownKeys(value)).toEqual([]);
  expect(Object.getPrototypeOf(value)).toBeNull();
  expect(Object.isExtensible(value)).toBe(true);
  Object.defineProperty(value,"year",{get(){throw Error("public read");}});
  expect(temporalPlainDateFields(value)).toEqual({isoYear:2000,isoMonth:2,isoDay:29,calendar:"buddhist"});
  expect(Object.isFrozen(temporalPlainDateFields(value))).toBe(true);
});

it.each([
  {isoYear:2001,isoMonth:2,isoDay:29},
  {isoYear:2000,isoMonth:13,isoDay:1},
  {isoYear:2000,isoMonth:1,isoDay:0},
  {isoYear:2000.5,isoMonth:1,isoDay:1},
  {isoYear:NaN,isoMonth:1,isoDay:1},
  {isoYear:Infinity,isoMonth:1,isoDay:1},
  {isoYear:-271821,isoMonth:4,isoDay:18},
  {isoYear:275760,isoMonth:9,isoDay:14}
])("rejects invalid internal ISO fields: %j", fields => {
  expect(()=>createSandboxTemporalPlainDate(fields)).toThrow(RangeError);
});

it("accepts both date endpoints and normalizes negative zero", () => {
  for(const fields of [{isoYear:-271821,isoMonth:4,isoDay:19},{isoYear:275760,isoMonth:9,isoDay:13}])
    expect(temporalPlainDateFields(createSandboxTemporalPlainDate(fields))).toEqual({...fields,calendar:"iso8601"});
  expect(Object.is(temporalPlainDateFields(createSandboxTemporalPlainDate({isoYear:-0,isoMonth:1,isoDay:1})).isoYear,0)).toBe(true);
});

it("rejects accessors, inherited fields, strings and proxies without coercion", () => {
  const fields={isoYear:2000,isoMonth:1,isoDay:1};let reads=0;
  const accessor=Object.defineProperty({...fields},"calendar",{get(){reads++;return "iso8601";}});
  const proxy=new Proxy(fields,{getOwnPropertyDescriptor(){reads++;throw Error("trap");}});
  for(const input of [accessor,proxy,Object.create(fields),{...fields,isoYear:"2000"}])
    expect(()=>createSandboxTemporalPlainDate(input as never)).toThrow(TypeError);
  expect(reads).toBe(0);
});

it("rejects forged receivers and proxy wrappers without traps", () => {
  const value=createSandboxTemporalPlainDate({isoYear:2000,isoMonth:1,isoDay:1});
  const proxy=new Proxy(value,{getPrototypeOf(){throw Error("trap");}});
  for(const input of [null,undefined,1,{},Object.create(value),proxy]){
    expect(isSandboxTemporalPlainDate(input)).toBe(false);
    expect(()=>temporalPlainDateFields(input)).toThrow(TypeError);
  }
});

it("reads captured host slots rather than overridden calendar-derived getters", () => {
  const value=new Backend.PlainDate(2000,2,29,"buddhist");
  for(const name of ["year","month","day","calendarId","withCalendar"])
    Object.defineProperty(value,name,{get(){throw Error("public read");}});
  expect(hostTemporalPlainDateFields(value)).toEqual({isoYear:2000,isoMonth:2,isoDay:29,calendar:"buddhist"});
  expect(hostTemporalPlainDateFields(new Proxy(value,{}))).toBeUndefined();
});

it("tracks exported host dates after prototype removal but rejects custom prototypes", () => {
  const fields={isoYear:2000,isoMonth:2,isoDay:29,calendar:"buddhist"};
  const value=createHostTemporalPlainDate(fields);Object.setPrototypeOf(value,null);
  expect(hostTemporalPlainDateFields(value)).toEqual(fields);
  Object.setPrototypeOf(value,{});
  expect(()=>hostTemporalPlainDateFields(value)).toThrow(TypeError);
  const untracked=new Backend.PlainDate(2000,1,1);Object.setPrototypeOf(untracked,null);
  expect(hostTemporalPlainDateFields(untracked)).toBeUndefined();
});
