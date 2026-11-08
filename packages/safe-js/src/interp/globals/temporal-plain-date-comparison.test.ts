import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("orders ISO dates independently of calendars while equality includes calendars", async () => {
  expect(await run(`const date=new Temporal.PlainDate(2000,2,29);const other=date.withCalendar('buddhist');
    return [Temporal.PlainDate.compare(date,other),date.equals(other),date.equals('2000-02-29'),
      Temporal.PlainDate.compare('1999-12-31',date),Temporal.PlainDate.compare('2000-03-01',date),
      Temporal.PlainDate.compare('-271821-04-19','+275760-09-13')]`))
    .toMatchObject({ok:true,returnValue:[0,false,true,-1,1,-1]});
});

it("converts compare arguments from left to right and stops on the first failure", async () => {
  expect(await run(`const events=[];const one={get calendar(){events.push('one');throw 'stop'}};
    const two={get calendar(){events.push('two');throw 'unexpected'}};
    try{Temporal.PlainDate.compare(one,two)}catch(e){events.push(e)}
    return events`)).toMatchObject({ok:true,returnValue:['one','stop']});
});

it("uses private slots and discards the time of date-time arguments", async () => {
  expect(await run(`const date=new Temporal.PlainDate(2000,2,29);const other=new Temporal.PlainDateTime(2000,2,29,23,59);
    for(const value of [date,other])for(const key of ['calendar','calendarId','year','month','day'])
      Object.defineProperty(value,key,{get(){throw 'public read'}});
    return [date.equals(other),Temporal.PlainDate.compare(date,other)]`))
    .toMatchObject({ok:true,returnValue:[true,0]});
});

it("brands equals receivers before reading the argument and rejects invalid dates", async () => {
  expect(await run(`const method=Temporal.PlainDate.prototype.equals;
    if(typeof method!=='function')throw 'missing equals';
    const events=[];const input=new Proxy({},{get(){events.push('read');throw 'read'}});
    try{method.call({},input)}catch(e){events.push(e.name)}
    try{new Temporal.PlainDate(2000,1,1).equals('2000-02-30')}catch(e){events.push(e.name)}
    return events`)).toMatchObject({ok:true,returnValue:['TypeError','RangeError']});
});

it("preserves captured comparison functions across replay and public replacement", async () => {
  const source=`const compare=Temporal.PlainDate.compare;const date=new Temporal.PlainDate(2000,1,1);const equals=date.equals;
    Temporal.PlainDate=undefined;await 0;
    return [compare.name,compare.length,equals.name,equals.length,compare.call(null,date,'2000-01-02'),equals.call(date,{year:2000,month:1,day:1})]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:['compare',2,'equals',1,-1,true]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
