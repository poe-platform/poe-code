import { expect, it } from "vitest";
import { createSandboxTemporalPlainDateTime, isSandboxTemporalPlainDateTime, temporalPlainDateTimeFields } from "./temporal-plain-date-time.js";

it("stores private ISO fields separately from calendar interpretation", () => {
  const value=createSandboxTemporalPlainDateTime({isoYear:2000,isoMonth:2,isoDay:29,calendar:"buddhist"});
  expect(temporalPlainDateTimeFields(value)).toEqual({isoYear:2000,isoMonth:2,isoDay:29,
    hour:0,minute:0,second:0,millisecond:0,microsecond:0,nanosecond:0,calendar:"buddhist"});
  expect(Reflect.ownKeys(value)).toEqual([]);
  expect(Object.getPrototypeOf(value)).toBeNull();
  expect(Object.isExtensible(value)).toBe(true);
});

it("copies immutable slots without consulting public properties", () => {
  const input={isoYear:2000,isoMonth:2,isoDay:29,hour:12,nanosecond:321};
  const value=createSandboxTemporalPlainDateTime(input);
  input.isoYear=2001;
  Object.defineProperty(value,"isoYear",{get(){throw new Error("public getter");}});
  expect(temporalPlainDateTimeFields(value).isoYear).toBe(2000);
  expect(temporalPlainDateTimeFields(value).nanosecond).toBe(321);
  expect(Object.isFrozen(temporalPlainDateTimeFields(value))).toBe(true);
});

it.each([
  {isoYear:2001,isoMonth:2,isoDay:29},
  {isoYear:2000,isoMonth:13,isoDay:1},
  {isoYear:2000,isoMonth:1,isoDay:0},
  {isoYear:2000.5,isoMonth:1,isoDay:1},
  {isoYear:2000,isoMonth:1,isoDay:1,hour:24},
  {isoYear:2000,isoMonth:1,isoDay:1,nanosecond:1000},
  {isoYear:2000,isoMonth:1,isoDay:1,second:60},
  {isoYear:NaN,isoMonth:1,isoDay:1},
  {isoYear:275760,isoMonth:9,isoDay:14},
  {isoYear:-271821,isoMonth:4,isoDay:19}
])("rejects invalid internal fields without truncation or constraint: %j", fields => {
  expect(()=>createSandboxTemporalPlainDateTime(fields)).toThrow(RangeError);
});

it("preserves nanosecond endpoints and normalizes negative zero", () => {
  const first=createSandboxTemporalPlainDateTime({isoYear:-271821,isoMonth:4,isoDay:19,nanosecond:1});
  const last=createSandboxTemporalPlainDateTime({isoYear:275760,isoMonth:9,isoDay:13,hour:23,minute:59,second:59,millisecond:999,microsecond:999,nanosecond:999});
  expect(temporalPlainDateTimeFields(first).nanosecond).toBe(1);
  expect(temporalPlainDateTimeFields(last).nanosecond).toBe(999);
  const zero=createSandboxTemporalPlainDateTime({isoYear:-0,isoMonth:1,isoDay:1,hour:-0});
  expect(Object.is(temporalPlainDateTimeFields(zero).isoYear,0)).toBe(true);
  expect(Object.is(temporalPlainDateTimeFields(zero).hour,0)).toBe(true);
});

it("rejects accessors, missing dates and nonnumeric data without coercion", () => {
  const input={isoYear:2000,isoMonth:1,isoDay:1};
  let reads=0;
  const accessor=Object.defineProperty({...input},"hour",{get(){reads++;return 12;}});
  expect(()=>createSandboxTemporalPlainDateTime(accessor)).toThrow(TypeError);
  expect(()=>createSandboxTemporalPlainDateTime({...input,hour:"12"} as never)).toThrow(TypeError);
  expect(()=>createSandboxTemporalPlainDateTime(Object.create(input))).toThrow(TypeError);
  const calendar=Object.defineProperty({...input},"calendar",{get(){reads++;return "iso8601";}});
  expect(()=>createSandboxTemporalPlainDateTime(calendar)).toThrow(TypeError);
  expect(reads).toBe(0);
});

it("rejects forged receivers and proxies without invoking their traps", () => {
  const value=createSandboxTemporalPlainDateTime({isoYear:2000,isoMonth:1,isoDay:1});
  const proxy=new Proxy(value,{get(){throw new Error("get trap");},getPrototypeOf(){throw new Error("prototype trap");}});
  for(const input of [null,undefined,1,{},Object.create(value),proxy]){
    expect(isSandboxTemporalPlainDateTime(input)).toBe(false);
    expect(()=>temporalPlainDateTimeFields(input)).toThrow(TypeError);
  }
});
