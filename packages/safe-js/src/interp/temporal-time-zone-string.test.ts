import { expect, it } from "vitest";
import { parseTemporalTimeZoneString } from "./temporal-time-zone-string.js";

it.each([
  ["UTC", "UTC"], ["Etc/GMT+1", "Etc/GMT+1"], ["America/New_York", "America/New_York"],
  ["+01", "+01:00"], ["-00:00", "+00:00"], ["-2359", "-23:59"],
  ["12:34+01:00", "+01:00"], ["T1234+01:00", "+01:00"], ["t1234[UTC]", "UTC"],
  ["1234+0100", "+01:00"], ["12[UTC]", "UTC"], ["12:34:60[UTC]", "UTC"],
  ["2020-01[UTC]", "UTC"], ["202001[UTC]", "UTC"], ["+00202001[UTC]", "UTC"],
  ["--02-29[UTC]", "UTC"], ["--0229[UTC]", "UTC"], ["0229[UTC]", "UTC"],
  ["2020-02-29[UTC]", "UTC"], ["20200229t1234+0100", "+01:00"],
  ["0000-02-29T00:00Z", "UTC"], ["-000004-02-29[UTC]", "UTC"],
  ["+999999-01-01[UTC]", "UTC"], ["2020-01-01 12:34z", "UTC"],
  ["12:34+00:00:01.123456789[+01:00]", "+01:00"],
  ["12:34[UTC][u-ca=unknown]", "UTC"], ["12:34[UTC][!u-ca=unknown]", "UTC"],
  ["2020-01[UTC][u-ca=ISO8601]", "UTC"],
  ["2020-01-01[UTC][u-ca=unknown][u-ca=other]", "UTC"],
  ["0230[UTC][u-ca=unknown]", "UTC"], ["202013[UTC][u-ca=unknown]", "UTC"],
  ["2020-00", "+00:00"], ["2020-0101[UTC]", "UTC"], ["202001-01[UTC]", "UTC"]
])("parses %s as %s", (input, expected) => { expect(parseTemporalTimeZoneString(input)).toBe(expected); });

it.each(["", "+24", "−01:00", "+01:00:00", "12:34", "12:34Z", "12:34+00:00:00",
  "12:34+00:00:60[UTC]", "12:34+01:60[UTC]", "24:00[UTC]", "12:60[UTC]", "12:34:61[UTC]",
  "12:3456[UTC]", "1234:56[UTC]", "12:34.5[UTC]", "12:34:56.[UTC]", "12:34:56.1234567890[UTC]",
  "2020-02-30[UTC]", "1900-02-29[UTC]", "-000000-01-01[UTC]", "2020-0101T00:00[UTC]", "202001-01T00:00[UTC]",
  "2020-01[UTC][u-ca=unknown]", "0229[UTC][u-ca=unknown]", "202001[UTC][u-ca=unknown]",
  "12:34[UTC][UTC]", "12:34[foo=bar][UTC]", "12:34[UTC][!foo=bar]", "12:34[UTC][Foo=bar]",
  "12:34[UTC][foo=]", "12:34[UTC][foo=bar--baz]", "12:34[UTC][foo=bar_baz]", "12:34[UTC]junk",
  "12:34[UTC", "12:34[]", "12:34[!u-ca=iso8601][u-ca=iso8601]",
  "12:34[UTC][u-ca=iso8601][!u-ca=iso8601]"])("rejects %j", input => {
  expect(() => parseTemporalTimeZoneString(input)).toThrow(RangeError);
});

it("validates every annotation without an arbitrary annotation-count limit", () => {
  const annotations = "[foo=bar]".repeat(20);
  expect(parseTemporalTimeZoneString(`12:34[UTC]${annotations}`)).toBe("UTC");
  expect(() => parseTemporalTimeZoneString(`12:34[UTC]${annotations}[!foo=bar]`)).toThrow(RangeError);
});

it("preserves syntactic names before ISO fallback, leaving availability to the caller", () => {
  // ParseTemporalTimeZoneString first parses TimeZoneIdentifier. These strings
  // fit its named-zone grammar; they are not available IANA identifiers.
  expect(parseTemporalTimeZoneString("T1234+0100")).toBe("T1234+0100");
  expect(parseTemporalTimeZoneString("T12Z")).toBe("T12Z");
});
