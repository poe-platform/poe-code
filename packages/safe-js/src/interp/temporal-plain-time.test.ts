import { expect, it } from "vitest";
import { createSandboxTemporalPlainTime, isSandboxTemporalPlainTime, temporalPlainTimeFields } from "./temporal-plain-time.js";

it("creates an owned midnight value with no exposed internal slots", () => {
  const value=createSandboxTemporalPlainTime();
  expect(isSandboxTemporalPlainTime(value)).toBe(true);
  expect(Reflect.ownKeys(value)).toEqual([]);
  expect(Object.getPrototypeOf(value)).toBeNull();
  expect(Object.isExtensible(value)).toBe(true);
  expect(temporalPlainTimeFields(value)).toEqual({hour:0,minute:0,second:0,millisecond:0,microsecond:0,nanosecond:0});
});

it("copies and freezes validated private fields independently of public properties", () => {
  const fields={hour:23,minute:59,second:59,millisecond:999,microsecond:999,nanosecond:999};
  const value=createSandboxTemporalPlainTime(fields);
  fields.hour=0;
  Object.defineProperty(value,"hour",{get(){throw new Error("public getter")}});
  expect(temporalPlainTimeFields(value).hour).toBe(23);
  expect(Object.isFrozen(temporalPlainTimeFields(value))).toBe(true);
  expect(createSandboxTemporalPlainTime(fields)).not.toBe(value);
});

it.each([["hour",24],["minute",60],["second",60],["millisecond",1000],["microsecond",1000],["nanosecond",1000]] as const)("validates %s without truncating or constraining", (field,limit) => {
  for(const invalid of [-1,0.5,limit,NaN,Infinity,-Infinity])
    expect(()=>createSandboxTemporalPlainTime({[field]:invalid})).toThrow(RangeError);
  expect(temporalPlainTimeFields(createSandboxTemporalPlainTime({[field]:limit-1}))[field]).toBe(limit-1);
  expect(Object.is(temporalPlainTimeFields(createSandboxTemporalPlainTime({[field]:-0}))[field],0)).toBe(true);
});

it("rejects nonnumeric fields and accessors without executing conversion code", () => {
  let reads=0;
  const accessor=Object.defineProperty({},"hour",{get(){reads++;return 1}});
  expect(()=>createSandboxTemporalPlainTime(accessor)).toThrow(TypeError);
  expect(()=>createSandboxTemporalPlainTime({hour:"1"} as never)).toThrow(TypeError);
  expect(()=>createSandboxTemporalPlainTime({hour:undefined} as never)).toThrow(TypeError);
  expect(reads).toBe(0);
});

it("does not adopt inherited fields into private storage", () => {
  const input=Object.create({hour:23});
  expect(temporalPlainTimeFields(createSandboxTemporalPlainTime(input)).hour).toBe(0);
});

it("rejects forged and proxied receivers without invoking traps", () => {
  const value=createSandboxTemporalPlainTime({hour:1});
  const proxy=new Proxy(value,{get(){throw new Error("get trap")},getPrototypeOf(){throw new Error("prototype trap")}});
  for(const invalid of [undefined,null,1,{},Object.create(value),proxy]){
    expect(isSandboxTemporalPlainTime(invalid)).toBe(false);
    expect(()=>temporalPlainTimeFields(invalid)).toThrow(TypeError);
  }
});
