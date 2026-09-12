import { expect, it } from "vitest";
import { recoverMissingIsoMonth } from "./intl-iso-month.js";

it("does not touch complete host output or resolve fallback epochs", () => {
  const parts = [{ type: "month", value: "host month" }];
  const epochs = () => { throw new Error("Must retain host result"); };
  expect(recoverMissingIsoMonth(parts, "en", { calendar: "iso8601", month: "long" }, "formatToParts", epochs)).toBe(parts);
  expect(recoverMissingIsoMonth("host month", "en", { calendar: "iso8601", month: "long" }, "format", epochs)).toBe("host month");
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
