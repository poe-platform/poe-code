import { expect, it } from "vitest";
import { canonicalizeIntlOffsetZone } from "./intl-offset-zone.js";

it("canonicalizes every minute offset in basic and extended syntax", () => {
  for (const sign of ["+", "-"]) {
    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute++) {
        const hh = String(hour).padStart(2, "0");
        const mm = String(minute).padStart(2, "0");
        const expected = `${hour === 0 && minute === 0 ? "+" : sign}${hh}:${mm}`;
        expect(canonicalizeIntlOffsetZone(`${sign}${hh}${mm}`)).toBe(expected);
        expect(canonicalizeIntlOffsetZone(`${sign}${hh}:${mm}`)).toBe(expected);
        if (minute === 0) expect(canonicalizeIntlOffsetZone(`${sign}${hh}`)).toBe(expected);
      }
    }
  }
});

it.each(["+24", "-24:00", "+01:60", "+0160", "+00:99", "+01:00:00", "+010000",
  "+01:00:00.0", "−01:00", "+1", "+01:", "+01:0", "+001", "+00.5", "+0a:00",
  "+00:0a", "+００:００", "+00 00", "+00:00\n", "+00:00 ", "+-01", "+"])(
  "rejects invalid offset %j", input => {
    expect(() => canonicalizeIntlOffsetZone(input)).toThrow(RangeError);
  }
);

it.each(["UTC", "America/New_York", "Etc/GMT+1", "invalid/zone", "", "Z"])(
  "leaves named-zone validation to the caller for %j", input => {
    expect(canonicalizeIntlOffsetZone(input)).toBeUndefined();
  }
);
