import { expect, it } from "vitest";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import {
  createSandboxTemporalZonedDateTime, temporalZonedDateTimeFields,
  isSandboxTemporalZonedDateTime, createHostTemporalZonedDateTime,
  hostTemporalZonedDateTimeFields
} from "./temporal-zoned-date-time.js";

it("stores copied, frozen private fields without exposing host values", () => {
  const input = { epochNanoseconds: 1n, timeZone: "america/new_york", calendar: "ISO8601" };
  const value = createSandboxTemporalZonedDateTime(input);
  input.epochNanoseconds = 2n;
  expect(Object.getPrototypeOf(value)).toBeNull();
  expect(Reflect.ownKeys(value)).toEqual([]);
  expect(Object.isExtensible(value)).toBe(true);
  for (const name of ["epochNanoseconds", "timeZoneId", "calendarId"])
    Object.defineProperty(value, name, { get() { throw Error("public getter"); } });
  const fields = temporalZonedDateTimeFields(value);
  expect(fields).toEqual({ epochNanoseconds: 1n, timeZone: "America/New_York", calendar: "iso8601" });
  expect(Object.isFrozen(fields)).toBe(true);
  expect(Object.getPrototypeOf(fields)).toBeNull();
});

it.each([0n, -1n, 1n, -8640000000000000000000n, 8640000000000000000000n])("retains exact epoch %s at extreme offsets", epochNanoseconds => {
  for (const timeZone of ["-23:59", "+23:59"])
    expect(temporalZonedDateTimeFields(createSandboxTemporalZonedDateTime({ epochNanoseconds, timeZone, calendar: "buddhist" })))
      .toEqual({ epochNanoseconds, timeZone, calendar: "buddhist" });
});

it.each([-8640000000000000000001n, 8640000000000000000001n])("rejects out-of-range epoch %s", epochNanoseconds => {
  expect(() => createSandboxTemporalZonedDateTime({ epochNanoseconds, timeZone: "UTC" })).toThrow(RangeError);
});

it.each([["+0530", "+05:30"], ["-00:00", "+00:00"], ["utc", "UTC"]])("canonicalizes identifier %s", (timeZone, expected) => {
  expect(temporalZonedDateTimeFields(createSandboxTemporalZonedDateTime({ epochNanoseconds: 0n, timeZone })))
    .toEqual({ epochNanoseconds: 0n, timeZone: expected, calendar: "iso8601" });
});

it.each(["+01:00:30", "2000-01-01T00:00[UTC]", "Not/A_Zone", ""]) ("rejects invalid constructor zone %s", timeZone => {
  expect(() => createSandboxTemporalZonedDateTime({ epochNanoseconds: 0n, timeZone })).toThrow(RangeError);
});

it("rejects accessors, proxies, inherited or wrongly typed fields without user code", () => {
  const input = { epochNanoseconds: 0n, timeZone: "UTC", calendar: "iso8601" };
  let reads = 0;
  const bad = [null, Object.create(input), new Proxy(input, { getOwnPropertyDescriptor() { reads++; throw Error("trap"); } })];
  for (const key of Object.keys(input)) {
    bad.push(Object.defineProperty({ ...input }, key, { get() { reads++; return input[key as keyof typeof input]; } }));
    bad.push({ ...input, [key]: { toString() { reads++; return "UTC"; }, valueOf() { reads++; return 0n; } } });
  }
  for (const value of bad) expect(() => createSandboxTemporalZonedDateTime(value as never)).toThrow(TypeError);
  expect(reads).toBe(0);
});

it("rejects forged receivers and proxy wrappers without traps", () => {
  const value = createSandboxTemporalZonedDateTime({ epochNanoseconds: 0n, timeZone: "UTC" });
  expect(isSandboxTemporalZonedDateTime(value)).toBe(true);
  for (const other of [null, undefined, {}, Object.create(value), new Proxy(value, { getPrototypeOf() { throw Error("trap"); } })]) {
    expect(isSandboxTemporalZonedDateTime(other)).toBe(false);
    expect(() => temporalZonedDateTimeFields(other)).toThrow(TypeError);
  }
});

it("reads captured backend getters and rejects proxies and forged host instances", () => {
  const value = new Backend.ZonedDateTime(123n, "Europe/Warsaw", "buddhist");
  for (const name of ["epochNanoseconds", "timeZoneId", "calendarId"])
    Object.defineProperty(value, name, { get() { throw Error("public getter"); } });
  expect(hostTemporalZonedDateTimeFields(value)).toEqual({ epochNanoseconds: 123n, timeZone: "Europe/Warsaw", calendar: "buddhist" });
  expect(hostTemporalZonedDateTimeFields(new Proxy(value, {}))).toBeUndefined();
  expect(() => hostTemporalZonedDateTimeFields(Object.create(Backend.ZonedDateTime.prototype))).toThrow(TypeError);
});

it("retains exported host slots after prototype removal but rejects custom prototypes", () => {
  const fields = { epochNanoseconds: -123n, timeZone: "+05:30", calendar: "iso8601" };
  const value = createHostTemporalZonedDateTime(fields);
  for (const name of ["epochNanoseconds", "timeZoneId", "calendarId"])
    Object.defineProperty(value, name, { get() { throw Error("public getter"); } });
  expect(hostTemporalZonedDateTimeFields(value)).toEqual(fields);
  Object.setPrototypeOf(value, null);
  expect(hostTemporalZonedDateTimeFields(value)).toEqual(fields);
  Object.setPrototypeOf(value, {});
  expect(() => hostTemporalZonedDateTimeFields(value)).toThrow(TypeError);
  const untracked = new Backend.ZonedDateTime(0n, "UTC");
  Object.setPrototypeOf(untracked, null);
  expect(hostTemporalZonedDateTimeFields(untracked)).toBeUndefined();
});
