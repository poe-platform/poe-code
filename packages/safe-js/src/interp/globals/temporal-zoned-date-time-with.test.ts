import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("merges date/time fields with calendar overflow rules", async () => {
  expect(await run(`const a=Temporal.ZonedDateTime.from('2020-01-31T12:34:56Z[UTC][u-ca=buddhist]');let error;
    try{a.with({month:2},{overflow:'reject'})}catch(e){error=e.name}
    return [a.with({monthCode:'M02',hour:9}).toString(),error];`))
    .toMatchObject({ok:true,returnValue:["2020-02-29T09:34:56+00:00[UTC][u-ca=buddhist]","RangeError"]});
});

it("prefers the existing offset but honors explicit offset policy", async () => {
  expect(await run(`const a=Temporal.ZonedDateTime.from('2021-11-07T01:30-05:00[America/New_York]');
    return [a.with({minute:45}).offset,a.with({minute:45},{offset:'ignore'}).offset,
      a.with({offset:'-04:00'}).offset];`)).toMatchObject({ok:true,returnValue:["-05:00","-04:00","-04:00"]});
});

it("rejects Temporal partial inputs before properties and empty bags before options", async () => {
  expect(await run(`const a=new Temporal.ZonedDateTime(0n,'UTC');if(typeof a.with!=='function')throw 'missing';
    const reads=[],errors=[];for(const input of [new Temporal.PlainDate(2000,1,1),new Temporal.PlainTime(),
      new Temporal.PlainDateTime(2000,1,1),new Temporal.PlainMonthDay(1,1),new Temporal.PlainYearMonth(2000,1),a]){Object.defineProperty(input,'calendar',{get(){reads.push('calendar');throw 'read'}});
      try{a.with(input)}catch(e){errors.push(e.name)}}
    try{a.with({},new Proxy({},{get(){reads.push('option');throw 'read'}}))}catch(e){errors.push(e.name)}return [errors,reads];`))
    .toMatchObject({ok:true,returnValue:[Array(7).fill("TypeError"),[]]});
});

it("reads partial fields before options in the required order", async () => {
  expect(await run(`const a=new Temporal.ZonedDateTime(0n,'UTC'),log=[];
    a.with(new Proxy({minute:15},{get(t,k){log.push(k);return t[k]}}),new Proxy({},{get(t,k){log.push('option.'+k)}}));return log;`))
    .toMatchObject({ok:true,returnValue:["calendar","timeZone","day","hour","microsecond","millisecond","minute","month","monthCode","nanosecond","offset","second","year","option.disambiguation","option.offset","option.overflow"]});
});

it("keeps private slots and captured method/prototype identity through replay", async () => {
  const source=`const a=new Temporal.ZonedDateTime(0n,'UTC'),method=a.with,proto=Temporal.ZonedDateTime.prototype;
    for(const key of ['epochNanoseconds','calendarId','timeZoneId','constructor'])Object.defineProperty(a,key,{get(){throw 'shadow'}});
    Temporal.ZonedDateTime=undefined;const b=method.call(a,{minute:15});await 0;
    return [method.name,method.length,b.toString(),Object.getPrototypeOf(b)===proto,b!==a];`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["with",1,"1970-01-01T00:15:00+00:00[UTC]",true,true]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
