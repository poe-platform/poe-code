import { describe, expect, it } from "vitest";
import { createSandboxTemporalPlainDate, temporalPlainDateFields } from "../interp/temporal-plain-date.js";
import { createSandboxTemporalPlainDateTime, temporalPlainDateTimeFields } from "../interp/temporal-plain-date-time.js";
import { createSandboxTemporalPlainMonthDay, temporalPlainMonthDayFields } from "../interp/temporal-plain-month-day.js";
import { createSandboxTemporalPlainYearMonth, temporalPlainYearMonthFields } from "../interp/temporal-plain-year-month.js";
import { hasNullObjectPrototype, setSandboxPrototype } from "../interp/object-model.js";
import { decodeReplayData, encodeReplayData } from "./replay-data.js";

const date = { isoYear: 2000, isoMonth: 2, isoDay: 29, calendar: "buddhist" };
const dateTime = { ...date, hour: 23, minute: 59, second: 58, millisecond: 123, microsecond: 456, nanosecond: 789 };

describe.each([
  { kind: "temporal-plain-date", create: () => createSandboxTemporalPlainDate(date), read: temporalPlainDateFields, slots: date },
  { kind: "temporal-plain-date-time", create: () => createSandboxTemporalPlainDateTime(dateTime), read: temporalPlainDateTimeFields, slots: dateTime },
  { kind: "temporal-plain-month-day", create: () => createSandboxTemporalPlainMonthDay(date), read: temporalPlainMonthDayFields, slots: date },
  { kind: "temporal-plain-year-month", create: () => createSandboxTemporalPlainYearMonth(date), read: temporalPlainYearMonthFields, slots: date }
])("$kind replay codec", ({ kind, create, read, slots }) => {
  it("preserves private reference dates, aliases, descriptors and symbol cycles", () => {
    const value = create();
    const key = Symbol("self");
    Object.defineProperty(value, key, { value });
    Object.defineProperty(value, "calendarId", { value: "shadow" });
    setSandboxPrototype(value, null);
    Object.freeze(value);
    const saved = encodeReplayData([value, value, key]);
    const result = decodeReplayData(JSON.parse(JSON.stringify(saved)));
    if (!Array.isArray(result) || typeof result[2] !== "symbol") throw new Error("Invalid replay graph");
    expect(result[0]).toBe(result[1]);
    expect(read(result[0])).toEqual(slots);
    expect(Object.getOwnPropertyDescriptor(result[0], result[2])).toEqual({ value: result[0], writable: false, enumerable: false, configurable: false });
    expect(Object.getOwnPropertyDescriptor(result[0], "calendarId")?.value).toBe("shadow");
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(hasNullObjectPrototype(result[0] as object)).toBe(true);
    expect(encodeReplayData(result)).toEqual(saved);
  });

  it.each([
    { isoYear: -0 }, { isoMonth: 0 }, { isoDay: 30 }, { isoYear: 0.5 },
    { calendar: "ISO8601" }, { calendar: "invalid" }, { extra: true }
  ])("rejects invalid or noncanonical slot overrides %j", override => {
    const graph = { root: { tag: "ref", id: 0 }, nodes: [{ kind, slots }] };
    expect(read(decodeReplayData(graph))).toEqual(slots);
    expect(() => decodeReplayData({ ...graph, nodes: [{ kind, slots: { ...slots, ...override } }] })).toThrow();
  });

  it("rejects encoded calendar accessors without invoking them", () => {
    let reads = 0;
    const malicious = { ...slots };
    Object.defineProperty(malicious, "calendar", { get() { reads++; return "buddhist"; } });
    expect(() => decodeReplayData({ root: { tag: "ref", id: 0 }, nodes: [{ kind, slots: malicious }] }))
      .toThrow(expect.objectContaining({ name: "SnapshotValidationError", code: "invalidType", path: "$.nodes[0].slots.calendar" }));
    expect(reads).toBe(0);
  });
});
