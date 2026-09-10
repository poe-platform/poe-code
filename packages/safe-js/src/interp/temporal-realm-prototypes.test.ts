import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { registerRealmPrototype } from "./function-realm.js";
import { getSandboxPrototype, hasGuestObjectState, setSandboxPrototype } from "./object-model.js";
import { createSandboxTemporalInstant } from "./temporal-instant.js";
import { createSandboxTemporalDuration } from "./temporal-duration.js";
import { createSandboxTemporalPlainTime } from "./temporal-plain-time.js";
import { createSandboxTemporalPlainDateTime } from "./temporal-plain-date-time.js";
import { createSandboxTemporalPlainDate } from "./temporal-plain-date.js";
import { createSandboxTemporalPlainMonthDay } from "./temporal-plain-month-day.js";
import { createSandboxTemporalPlainYearMonth } from "./temporal-plain-year-month.js";
import { createSandboxTemporalZonedDateTime } from "./temporal-zoned-date-time.js";

const date = { isoYear: 2000, isoMonth: 2, isoDay: 29, calendar: "iso8601" };
it.each([
  { name: "Instant", create: () => createSandboxTemporalInstant(1n) },
  { name: "Duration", create: () => createSandboxTemporalDuration({ seconds: 1 }) },
  { name: "PlainTime", create: () => createSandboxTemporalPlainTime({ hour: 1 }) },
  { name: "PlainDateTime", create: () => createSandboxTemporalPlainDateTime({ ...date, hour: 1, minute: 0, second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 }) },
  { name: "PlainDate", create: () => createSandboxTemporalPlainDate(date) },
  { name: "PlainMonthDay", create: () => createSandboxTemporalPlainMonthDay(date) },
  { name: "PlainYearMonth", create: () => createSandboxTemporalPlainYearMonth(date) },
  { name: "ZonedDateTime", create: () => createSandboxTemporalZonedDateTime({ epochNanoseconds: 1n, timeZone: "UTC", calendar: "iso8601" }) }
])("selects the receiving realm for an unmaterialized Temporal.$name", ({ name, create }) => {
  const first = new Budget();
  const second = new Budget();
  const firstPrototype = { realm: "first" };
  const secondPrototype = { realm: "second" };
  registerRealmPrototype(first, `Temporal.${name}`, firstPrototype);
  registerRealmPrototype(second, `Temporal.${name}`, secondPrototype);
  const value = create();
  expect(hasGuestObjectState(value)).toBe(false);
  expect(getSandboxPrototype(value)).toBeNull();
  expect(getSandboxPrototype(value, new Budget())).toBeNull();
  expect(getSandboxPrototype(value, first)).toBe(firstPrototype);
  expect(getSandboxPrototype(value, second)).toBe(secondPrototype);
  const explicit = { realm: "explicit" };
  setSandboxPrototype(value, explicit);
  expect(hasGuestObjectState(value)).toBe(true);
  expect(getSandboxPrototype(value, first)).toBe(explicit);
  expect(getSandboxPrototype(value, second)).toBe(explicit);
  setSandboxPrototype(value, null);
  expect(getSandboxPrototype(value, first)).toBeNull();
  expect(getSandboxPrototype(value, second)).toBeNull();
});
