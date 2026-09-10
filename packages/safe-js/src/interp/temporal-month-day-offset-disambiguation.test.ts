import { expect, it } from "vitest";
import { validateTemporalStringOffsets } from "./temporal-offset-validation.js";
import { run } from "../run.js";

it.each(["--1001", "--1001[u-ca=iso8601]"])("does not mistake a month-day prefix for a UTC offset: %s", async input => {
  expect(() => validateTemporalStringOffsets(input)).not.toThrow();
  expect(await run(`return Temporal.PlainMonthDay.from(${JSON.stringify(input)}).toString()`))
    .toMatchObject({ok:true,returnValue:"10-01"});
});

it.each(["+24:00", "-2360", "−10:01", "--1001[+24:00]"])("still rejects invalid actual offsets: %s", input => {
  expect(() => validateTemporalStringOffsets(input)).toThrow(RangeError);
});
