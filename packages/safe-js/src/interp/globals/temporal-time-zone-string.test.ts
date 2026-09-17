import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  ["12:34+01:00", "1970-01-01T01:00:00+01:00"],
  ["T1234+01:00", "1970-01-01T01:00:00+01:00"],
  ["2020-01[UTC]", "1970-01-01T00:00:00+00:00"],
  ["202001[UTC]", "1970-01-01T00:00:00+00:00"],
  ["01-01[UTC]", "1970-01-01T00:00:00+00:00"],
  ["--01-01[UTC]", "1970-01-01T00:00:00+00:00"],
  ["12:34+00:00:01[+01:00]", "1970-01-01T01:00:00+01:00"],
  ["12:34[UTC][u-ca=unknown]", "1970-01-01T00:00:00+00:00"],
  ["+999999-01-01[UTC]", "1970-01-01T00:00:00+00:00"]
])("extracts a validated zone from %s", async (timeZone, expected) => {
  expect(await run(`return new Temporal.Instant(0n).toString({timeZone:${JSON.stringify(timeZone)}})`))
    .toMatchObject({ok:true,returnValue:expected});
});

it.each(["2020-02-30[UTC]", "12:34[UTC][!foo=bar]", "2020-01[UTC][u-ca=unknown]",
  "12:34+00:00:00", "12:34+01:60[UTC]", "-000000-01-01[UTC]", "12:34[UTC][UTC]"])(
  "rejects invalid zone-bearing string %s", async timeZone => {
    expect(await run(`try{new Temporal.Instant(0n).toString({timeZone:${JSON.stringify(timeZone)}})}catch(e){return e.name}`))
      .toMatchObject({ok:true,returnValue:"RangeError"});
  }
);

it("uses the same zone-string conversion in Duration relativeTo bags", async () => {
  expect(await run(`return new Temporal.Duration(0,0,0,1).total({unit:'hours',relativeTo:{
    year:2020,month:1,day:1,timeZone:'12:34+01:00'
  }})`)).toMatchObject({ok:true,returnValue:24});
});
