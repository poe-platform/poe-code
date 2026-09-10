import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("computes date differences in both directions and balances calendar units", async () => {
  expect(await run(`const start=new Temporal.PlainDate(2000,1,1);const end=new Temporal.PlainDate(2001,2,3);
    return [start.until(end).toString(),start.since(end).toString(),
      start.until(end,{largestUnit:'year'}).toString(),end.since(start,{largestUnit:'month'}).toString()]`))
    .toMatchObject({ok:true,returnValue:['P399D','-P399D','P1Y1M2D','P13M2D']});
});

it("rounds relative differences and preserves since direction", async () => {
  expect(await run(`const start=new Temporal.PlainDate(2000,1,1);const end=new Temporal.PlainDate(2000,1,12);
    return [start.until(end,{smallestUnit:'week',roundingMode:'halfExpand'}).toString(),
      start.since(end,{smallestUnit:'week',roundingMode:'floor'}).toString()]`))
    .toMatchObject({ok:true,returnValue:['P2W','-P2W']});
});

it("requires matching calendars before options and uses private date-time inputs", async () => {
  expect(await run(`const start=new Temporal.PlainDate(2000,1,1);const end=new Temporal.PlainDateTime(2000,1,2,23,59);
    for(const key of ['year','month','day','calendar','calendarId'])Object.defineProperty(end,key,{get(){throw 'public read'}});
    let error;try{start.until(start.withCalendar('buddhist'),{get largestUnit(){throw 'options read'}})}catch(e){error=e.name}
    return [start.until(end).toString(),error]`)).toMatchObject({ok:true,returnValue:['P1D','RangeError']});
});

it("reads options in order and validates them even when dates are equal", async () => {
  expect(await run(`const events=[];const date=new Temporal.PlainDate(2000,1,1);
    const options=new Proxy({smallestUnit:'hour'},{get(t,k){events.push(k);return t[k]}});
    try{date.until(date,options)}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:['largestUnit','roundingIncrement','roundingMode','smallestUnit','RangeError']});
});

it("rejects invalid receivers before argument reads and supports date endpoints", async () => {
  expect(await run(`const until=Temporal.PlainDate.prototype.until;if(typeof until!=='function')throw 'missing until';
    let error;try{until.call({},new Proxy({},{get(){throw 'argument read'}}))}catch(e){error=e.name}
    return [error,new Temporal.PlainDate(-271821,4,19).until(new Temporal.PlainDate(275760,9,13)).days]`))
    .toMatchObject({ok:true,returnValue:['TypeError',200000001]});
});

it("captures Duration prototypes and replays differences after public replacement", async () => {
  const source=`const date=new Temporal.PlainDate(2000,1,1);const until=date.until;const since=date.since;
    const proto=Temporal.Duration.prototype;Temporal.Duration=undefined;Temporal.PlainDate=undefined;
    const result=until.call(date,'2000-02-01',{largestUnit:'month'});await 0;
    return [until.name,until.length,since.name,since.length,result.toString(),Object.getPrototypeOf(result)===proto,
      since.call(date,'2000-01-02').toString()]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:['until',1,'since',1,'P1M',true,'-P1D']});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
