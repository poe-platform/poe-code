import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { readDurationRecord } from "./intl-duration-record.js";
import { readDurationUnitOptions } from "./intl-duration-options.js";
import { formatDurationParts } from "./intl-duration-parts.js";

it.each([
  [{ style: "digital" }, { hours: 1, minutes: 2, seconds: 3 }, "1:02:03"],
  [{ style: "digital", fractionalDigits: 2 }, { seconds: 1, milliseconds: 999 }, "0:00:01.99"],
  [{ style: "digital", minutesDisplay: "auto" }, { hours: 1, seconds: 3 }, "1:00:03"],
  [{ style: "digital" }, { seconds: -3 }, "-0:00:03"],
  [{ style: "digital", fractionalDigits: 0 }, { milliseconds: -1 }, "-0:00:00"],
  [{ style: "digital" }, { hours: 1234 }, "1234:00:00"],
  [{ style: "long", hoursDisplay: "always" }, { minutes: -2 }, "-0 hours, 2 minutes"],
  [{ style: "long" }, { hours: -1, minutes: -2 }, "-1 hour, 2 minutes"],
  [{ style: "long" }, { milliseconds: 1, microseconds: 2, nanoseconds: 3 }, "1 millisecond, 2 microseconds, 3 nanoseconds"]
] as const)("partitions %j and %j", async (input, value, expected) => {
  const budget = new Budget();
  const record = await readDurationRecord(value, budget);
  const units: Record<string, { style: string; display: string }> = {};
  let previous = "";
  for (const unit of Object.keys(record)) {
    units[unit] = await readDurationUnitOptions(input, unit, input.style, previous, budget);
    if (["hours", "minutes", "seconds", "milliseconds", "microseconds"].includes(unit)) previous = units[unit]!.style;
  }
  const parts = formatDurationParts({ locale: "en", numberingSystem: "latn", style: input.style,
    fractionalDigits: "fractionalDigits" in input ? input.fractionalDigits : undefined, units }, record, ":");
  expect(parts.map(part => part.value).join("")).toBe(expected);
});
