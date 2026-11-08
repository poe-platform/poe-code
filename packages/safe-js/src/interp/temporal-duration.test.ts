import { expect, it } from "vitest";
import { createSandboxTemporalDuration, isSandboxTemporalDuration, temporalDurationFields } from "./temporal-duration.js";
import { measureSandboxData } from "./values.js";

it("rejects proxy field records without executing host traps", () => {
  let reads = 0;
  const fields = new Proxy({ seconds: 1 }, {
    getOwnPropertyDescriptor(target, key) {
      reads++;
      return Reflect.getOwnPropertyDescriptor(target, key);
    }
  });
  expect(() => createSandboxTemporalDuration(fields)).toThrow(TypeError);
  expect(reads).toBe(0);
});

it.each([null, 1, "", true, () => 1])("rejects a non-record field input %s", input => {
  expect(() => createSandboxTemporalDuration(input as never)).toThrow(TypeError);
});

it("owns immutable private fields without freezing guest properties", () => {
  const source={seconds:1,nanoseconds:2};
  const value=createSandboxTemporalDuration(source);
  source.seconds=9;
  expect(isSandboxTemporalDuration(value)).toBe(true);
  expect(Reflect.ownKeys(value)).toEqual([]);
  expect(temporalDurationFields(value)).toMatchObject({seconds:1,nanoseconds:2,years:0});
  expect(Object.isFrozen(temporalDurationFields(value))).toBe(true);
  value.label="duration";
  Object.freeze(value);
  expect(temporalDurationFields(value).seconds).toBe(1);
});

it.each([1,-1])("accepts exact maximum component and normalized time bounds with sign %s", sign => {
  const fields={years:sign*4294967295,months:sign*4294967295,weeks:sign*4294967295,
    seconds:sign*9007199254740991,nanoseconds:sign*999999999};
  expect(temporalDurationFields(createSandboxTemporalDuration(fields))).toMatchObject(fields);
});

it.each([
  {years:4294967296}, {months:-4294967296}, {weeks:4294967296},
  {seconds:9007199254740992}, {seconds:9007199254740991,nanoseconds:1000000000},
  {days:1,hours:-1}, {seconds:1,nanoseconds:-1}, {hours:Infinity}, {seconds:NaN}, {seconds:0.5}
])("rejects invalid fields %j", fields => {
  expect(() => createSandboxTemporalDuration(fields)).toThrow(RangeError);
});

it("does not coerce field values or invoke accessors, and rejects forged receivers", () => {
  let reads=0;
  const fields=Object.defineProperty({},"seconds",{get(){reads++;return 1}});
  expect(() => createSandboxTemporalDuration(fields)).toThrow(TypeError);
  expect(() => createSandboxTemporalDuration({seconds:{valueOf(){reads++;return 1}}} as never)).toThrow(TypeError);
  expect(() => temporalDurationFields({seconds:1})).toThrow(TypeError);
  expect(reads).toBe(0);
});

it("normalizes signed zero and accounts for all private numbers once", () => {
  const value=createSandboxTemporalDuration({seconds:-0});
  expect(Object.is(temporalDurationFields(value).seconds,-0)).toBe(false);
  expect(measureSandboxData([value])).toBe(81);
  expect(measureSandboxData([value,value])).toBe(81);
});

it.each([1, -1])("preserves representable unsafe subsecond integers with sign %s", sign => {
  for (const name of ["milliseconds", "microseconds", "nanoseconds"] as const) {
    const fields = { [name]: sign * 9007199254740992 };
    expect(temporalDurationFields(createSandboxTemporalDuration(fields))[name]).toBe(fields[name]);
  }
});

it.each([1, -1])("validates the combined subsecond carry exactly with sign %s", sign => {
  const fields = { seconds: sign * 9007199254740991, milliseconds: sign * 999,
    microseconds: sign * 999, nanoseconds: sign * 999 };
  expect(temporalDurationFields(createSandboxTemporalDuration(fields))).toMatchObject(fields);
  expect(() => createSandboxTemporalDuration({ ...fields, nanoseconds: sign * 1000 })).toThrow(RangeError);
});
