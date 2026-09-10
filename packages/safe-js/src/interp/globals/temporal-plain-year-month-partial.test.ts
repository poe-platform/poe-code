import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  "new Temporal.PlainDate(2000,2,29)",
  "new Temporal.PlainDateTime(2000,2,29)",
  "new Temporal.PlainTime(12)",
  "new Temporal.ZonedDateTime(0n,'UTC')",
  "new Temporal.PlainMonthDay(2,29)"
])("rejects year-month partials before public reads in %s.with", async receiver => {
  expect(await run(`const input=new Temporal.PlainYearMonth(2000,2),reads=[];
    for(const key of ['calendar','timeZone','day','hour'])Object.defineProperty(input,key,{get(){reads.push(key);return undefined}});
    try{(${receiver}).with(input,{get overflow(){reads.push('overflow');return 'constrain'}})}catch(e){return [e.name,reads]}`))
    .toMatchObject({ok:true,returnValue:["TypeError",[]]});
});
