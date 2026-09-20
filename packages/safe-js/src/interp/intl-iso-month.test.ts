import { expect, it } from "vitest";
import { recoverMissingIsoMonth } from "./intl-iso-month.js";

it("does not touch complete host output or resolve fallback epochs", () => {
  const parts = [{ type: "month", value: "host month" }];
  const epochs = () => { throw new Error("Must retain host result"); };
  expect(recoverMissingIsoMonth(parts, "en", { calendar: "iso8601", month: "long" }, "formatToParts", epochs)).toBe(parts);
  expect(recoverMissingIsoMonth("host month", "en", { calendar: "iso8601", month: "long" }, "format", epochs)).toBe("host month");
  const range = [{ type: "month", value: "February", source: "startRange" },
    { type: "literal", value: "\u2009–\u2009", source: "shared" },
    { type: "month", value: "March", source: "endRange" }];
  expect(recoverMissingIsoMonth(range, "en", { calendar: "iso8601", month: "long" }, "formatRangeToParts", epochs)).toBe(range);
  expect(recoverMissingIsoMonth("February\u2009–\u2009March", "en", { calendar: "iso8601", month: "long" }, "formatRange", epochs))
    .toBe("February\u2009–\u2009March");
});

it.each(["en-US", "pl-PL", "ru-RU", "ar-EG-u-ca-iso8601-nu-arab"])("recovers all empty month methods in %s", locale => {
  const options = { calendar: "iso8601", month: "long", timeZone: "America/Los_Angeles" };
  const native = new Intl.DateTimeFormat(locale, { calendar: "gregory", month: "long", timeZone: options.timeZone });
  const start = Date.UTC(2000, 2, 1), end = Date.UTC(2000, 2, 2);
  let reads = 0;
  const epochs = () => { reads++; return [start, end]; };
  expect(recoverMissingIsoMonth("", locale, options, "format", epochs)).toBe(native.format(start));
  expect(recoverMissingIsoMonth([], locale, options, "formatToParts", epochs)).toEqual(native.formatToParts(start));
  expect(recoverMissingIsoMonth("", locale, options, "formatRange", epochs)).toBe(native.formatRange(start, end));
  expect(recoverMissingIsoMonth([], locale, options, "formatRangeToParts", epochs)).toEqual(native.formatRangeToParts(start, end));
  expect(reads).toBe(4);
});

it.each([
  { calendar: "gregory", month: "long" },
  { calendar: "iso8601", month: "short" },
  { calendar: "iso8601", month: "long", day: "numeric" },
  { calendar: "iso8601", month: "long", year: "numeric" },
  { calendar: "iso8601", month: "long", weekday: "long" },
  { calendar: "iso8601", month: "long", fractionalSecondDigits: 3 },
  { calendar: "iso8601", month: "long", hour: "numeric" }
])("leaves unqualified empty patterns visible: %j", options => {
  expect(recoverMissingIsoMonth("", "en", options, "format", () => { throw new Error("Outside recovery scope"); })).toBe("");
});
