import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each(["+275760-09-13", "-271821-04-19"])(
  "totals a blank duration at the valid relative boundary %s", async relativeTo => {
    expect(await run(`return ['year','month','week','day','hour','nanosecond'].map(unit=>
      Object.is(new Temporal.Duration().total({relativeTo:${JSON.stringify(relativeTo)},unit}),0))`))
      .toMatchObject({ok:true,returnValue:[true,true,true,true,true,true]});
  }
);

it("does not let blank durations bypass option validation or required relative dates", async () => {
  expect(await run(`const errors=[];for(const options of [
    {unit:'year'},{unit:'auto',relativeTo:'+275760-09-13'},
    {unit:'hour',relativeTo:'invalid'}
  ])try{new Temporal.Duration().total(options)}catch(error){errors.push(error.name)}return errors`))
    .toMatchObject({ok:true,returnValue:["RangeError","RangeError","RangeError"]});
});
