import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  "new Temporal.PlainDate(2000,1,2)",
  "new Temporal.PlainDateTime(2000,1,2)",
  "new Temporal.PlainTime(1)",
  "new Temporal.ZonedDateTime(0n,'UTC')"
])("rejects owned month-day partial input without observable reads: %s", async receiver => {
  expect(await run(`const input=new Temporal.PlainMonthDay(2,29);const events=[];
    for(const key of ['calendar','timeZone','day','hour'])Object.defineProperty(input,key,{get(){events.push(key);return undefined}});
    try{(${receiver}).with(input,{get overflow(){events.push('overflow');return 'constrain'}})}catch(e){events.push(e.name)}
    return events`)).toMatchObject({ok:true,returnValue:["TypeError"]});
});
