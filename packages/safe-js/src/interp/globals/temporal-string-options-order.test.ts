import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each(["auto", "year", "month", "week", "day", "hour"])(
  "reads and coerces timeZoneName before rejecting the recognized %s formatting unit",
  async (unit) => {
    expect(await run(`const log=[];let error;
      try { new Temporal.ZonedDateTime(0n,'UTC').toString({
        smallestUnit:${JSON.stringify(unit)},
        get timeZoneName(){log.push('get');return {toString(){log.push('coerce');return 'auto'}}}
      }); } catch(e) { error=e.name; }
      return [error,log];`))
      .toMatchObject({ok:true,returnValue:["RangeError",["get","coerce"]]});
  }
);

it("propagates a timeZoneName getter's exception before rejecting smallestUnit auto", async () => {
  expect(await run(`const sentinel={};let caught;
    try {new Temporal.ZonedDateTime(0n,'UTC').toString({smallestUnit:'auto',
      get timeZoneName(){throw sentinel}})}catch(e){caught=e}
    return caught===sentinel;`)).toMatchObject({ok:true,returnValue:true});
});

it.each(["autos", "unknown"])("rejects unknown unit %s before reading timeZoneName", async (unit) => {
  expect(await run(`let reads=0;let error;
    try {new Temporal.ZonedDateTime(0n,'UTC').toString({smallestUnit:${JSON.stringify(unit)},
      get timeZoneName(){reads++;throw 'unexpected'}})}catch(e){error=e.name}
    return [error,reads];`)).toMatchObject({ok:true,returnValue:["RangeError",0]});
});
