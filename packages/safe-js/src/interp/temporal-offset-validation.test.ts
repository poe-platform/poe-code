import { expect, it } from "vitest";
import { validateTemporalOffset, validateTemporalStringOffsets } from "./temporal-offset-validation.js";

it.each(["+00", "-23", "+2359", "-23:59", "+235959", "-23:59:59", "+00:00:00.1", "-000000,123456789"])(
  "accepts UTCOffset %s", input => { expect(() => validateTemporalOffset(input)).not.toThrow(); }
);

it.each(["", "Z", "00:00", "−01:00", "+24", "+0060", "+00:60", "+000060", "+00:00:60",
  "+1", "+001", "+00001", "+00:0000", "+0000:00", "+00.1", "+0000.1", "+00:00.1",
  "+00:00:00.", "+00:00:00.1234567890", "+00:00:00,1x", "+00:00:00.1.2", "+00:00:00\n"])(
  "rejects invalid UTCOffset %j", input => { expect(() => validateTemporalOffset(input)).toThrow(RangeError); }
);

it.each(["1970-01-01T00:00+01:60", "19700101t0000+0160", "+002020-01-01 00:00-00:99",
  "1970-01-01T00:00Z[+01:60]", "1970-01-01T00:00Z[!+01:60]", "1970-01-01[+0160]",
  "1970-01-01T00:00Z[+00:00:00]", "+0160"])(
  "rejects invalid offsets embedded in %s", input => { expect(() => validateTemporalStringOffsets(input)).toThrow(RangeError); }
);

it.each(["Etc/GMT+1", "GMT0", "+202000-01-01T00:00+01:00", "+0020200101", "2020-01-01",
  "1970-01-01T00:00+00:00:00.000000001", "1970-01-01T00:00Z[foo=bad-9960]", "1970-01-01T00:00Z[Etc/GMT+1]"])(
  "does not mistake years, names or annotation values for offsets in %s", input => {
    expect(() => validateTemporalStringOffsets(input)).not.toThrow();
  }
);

it.each(["1234+0160", "T1234+0160", "t12:34:60+00:00:60"])("validates time-only offsets in %s", input => {
  expect(() => validateTemporalStringOffsets(input, true)).toThrow(RangeError);
});
