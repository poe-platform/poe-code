import { expect, it } from "vitest";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import { createSandboxTemporalPlainYearMonth, createHostTemporalPlainYearMonth, hostTemporalPlainYearMonthFields, isSandboxTemporalPlainYearMonth, temporalPlainYearMonthFields } from "./temporal-plain-year-month.js";

it.each([
  {isoYear:2000,isoMonth:2,isoDay:29,calendar:"buddhist"},
  {isoYear:-271821,isoMonth:4,isoDay:1,calendar:"iso8601"},
  {isoYear:275760,isoMonth:9,isoDay:30,calendar:"iso8601"},
  {isoYear:0,isoMonth:2,isoDay:29,calendar:"iso8601"}
])("preserves private reference-day fields including year-month boundaries: %j", fields => {
  const value=createSandboxTemporalPlainYearMonth(fields);
  expect(isSandboxTemporalPlainYearMonth(value)).toBe(true);
  expect(temporalPlainYearMonthFields(value)).toEqual(fields);
  expect(Object.isFrozen(temporalPlainYearMonthFields(value))).toBe(true);
  expect(Object.getPrototypeOf(temporalPlainYearMonthFields(value))).toBe(null);
  expect(hostTemporalPlainYearMonthFields(createHostTemporalPlainYearMonth(fields))).toEqual(fields);
});

it.each([
  {isoYear:-271821,isoMonth:3,isoDay:31},
  {isoYear:275760,isoMonth:10,isoDay:1},
  {isoYear:2001,isoMonth:2,isoDay:29},
  {isoYear:2000,isoMonth:0,isoDay:1},
  {isoYear:2000,isoMonth:1,isoDay:0},
  {isoYear:Infinity,isoMonth:1,isoDay:1},
  {isoYear:2000.5,isoMonth:1,isoDay:1}
])("rejects invalid private year-month fields: %j", fields => {
  expect(()=>createSandboxTemporalPlainYearMonth(fields)).toThrow(RangeError);
});

it("copies input records and ignores public shadows on owned and host values", () => {
  const fields={isoYear:2000,isoMonth:2,isoDay:29,calendar:"buddhist"};
  const value=createSandboxTemporalPlainYearMonth(fields);fields.isoDay=1;
  Object.defineProperty(value,"year",{get(){throw Error("shadow")}});
  const host=new Backend.PlainYearMonth(2000,2,"buddhist",29);
  for(const key of ["year","month","calendarId","toString"])Object.defineProperty(host,key,{get(){throw Error("shadow")}});
  expect(temporalPlainYearMonthFields(value).isoDay).toBe(29);
  expect(hostTemporalPlainYearMonthFields(host)).toEqual(temporalPlainYearMonthFields(value));
});

it("rejects hostile inputs and forged receivers without running hooks", () => {
  let reads=0;
  const input={get isoYear(){reads++;return 2000},isoMonth:1,isoDay:1};
  expect(()=>createSandboxTemporalPlainYearMonth(input)).toThrow(TypeError);
  const proxy=new Proxy(input,{getPrototypeOf(){reads++;throw Error("trap")},getOwnPropertyDescriptor(){reads++;throw Error("trap")}});
  expect(()=>createSandboxTemporalPlainYearMonth(proxy)).toThrow(TypeError);
  expect(hostTemporalPlainYearMonthFields(proxy)).toBeUndefined();
  expect(()=>temporalPlainYearMonthFields({})).toThrow(TypeError);
  expect(reads).toBe(0);
});

it("admits only tracked host exports after prototype removal", () => {
  const fields={isoYear:2000,isoMonth:2,isoDay:29,calendar:"iso8601"};
  const exported=createHostTemporalPlainYearMonth(fields);Object.setPrototypeOf(exported,null);
  expect(hostTemporalPlainYearMonthFields(exported)).toEqual(fields);
  Object.setPrototypeOf(exported,{});
  expect(()=>hostTemporalPlainYearMonthFields(exported)).toThrow(TypeError);
  const other=new Backend.PlainYearMonth(2000,2);Object.setPrototypeOf(other,null);
  expect(hostTemporalPlainYearMonthFields(other)).toBeUndefined();
});
