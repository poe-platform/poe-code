import { expect, it } from "vitest";
import { run } from "../../run.js";

it("converts PlainDate private slots to midnight without public property reads", async () => {
  expect(await run(`const date=new Temporal.PlainDate(2000,2,29,'buddhist');
    for(const name of ['year','month','day','calendar','hour','monthCode'])Object.defineProperty(date,name,{get(){throw name}});
    return Temporal.PlainDateTime.from(date).toString()`))
    .toMatchObject({ok:true,returnValue:"2000-02-29T00:00:00[u-ca=buddhist]"});
});

it("uses the date fast path for differences", async () => {
  expect(await run(`const date=new Temporal.PlainDate(2000,5,2);Object.defineProperty(date,'year',{get(){throw 'public'}});
    const value=new Temporal.PlainDateTime(2000,5,2,0,0,0,987,654,321);
    return [value.until(date).toString(),value.since(date).toString()]`))
    .toMatchObject({ok:true,returnValue:["-PT0.987654321S","PT0.987654321S"]});
});

it("rejects PlainDate as a partial replacement before public reads", async () => {
  expect(await run(`const date=new Temporal.PlainDate(2000,1,1);const reads=[];
    Object.defineProperty(date,'calendar',{get(){reads.push('calendar')}});
    try{new Temporal.PlainDateTime(2000,1,1).with(date)}catch(e){return [e.name,reads]}`))
    .toMatchObject({ok:true,returnValue:["TypeError",[]]});
});
