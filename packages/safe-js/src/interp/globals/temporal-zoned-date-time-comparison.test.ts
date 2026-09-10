import { expect, it } from "vitest";
import { run } from "../../run.js";

it("compares instants but equality also considers zone and calendar", async () => {
  expect(await run(`const a=new Temporal.ZonedDateTime(0n,'UTC');
    const zone=new Temporal.ZonedDateTime(0n,'+00:00'),calendar=new Temporal.ZonedDateTime(0n,'UTC','buddhist');
    return [Temporal.ZonedDateTime.compare(a,zone),Temporal.ZonedDateTime.compare(a,calendar),
      a.equals(zone),a.equals(calendar),a.equals(new Temporal.ZonedDateTime(0n,'UTC')),
      Temporal.ZonedDateTime.compare(a,new Temporal.ZonedDateTime(1n,'UTC'))];`))
    .toMatchObject({ok:true,returnValue:[0,0,false,false,true,-1]});
});

it("accepts strings and bags without consulting overridden receiver fields", async () => {
  expect(await run(`const a=new Temporal.ZonedDateTime(0n,'UTC');
    for(const key of ['epochNanoseconds','timeZoneId','calendarId'])Object.defineProperty(a,key,{get(){throw 'shadow'}});
    return [a.equals('1970-01-01T00:00Z[UTC]'),a.equals({year:1970,month:1,day:1,timeZone:'UTC'}),
      Temporal.ZonedDateTime.compare('1970-01-01T00:00Z[UTC]',a),a.equals.length,Temporal.ZonedDateTime.compare.length];`))
    .toMatchObject({ok:true,returnValue:[true,true,0,1,2]});
});

it("brands equals receiver before converting its argument", async () => {
  expect(await run(`const method=Temporal.ZonedDateTime.prototype.equals;if(typeof method!=='function')throw 'missing';
    const reads=[];const input=new Proxy({},{get(t,k){reads.push(k);throw 'argument'}});
    let error;try{method.call({},input)}catch(e){error=e.name}return [error,reads];`))
    .toMatchObject({ok:true,returnValue:['TypeError',[]]});
});

it("finishes first comparison input before observing the second", async () => {
  expect(await run(`if(typeof Temporal.ZonedDateTime.compare!=='function')throw 'missing';const reads=[];
    const first=new Proxy({},{get(t,k){reads.push('first.'+k);if(k==='day')throw 'first-error'}});
    const second=new Proxy({},{get(t,k){reads.push('second.'+k)}});let error;
    try{Temporal.ZonedDateTime.compare(first,second)}catch(e){error=e}return [error,reads];`))
    .toMatchObject({ok:true,returnValue:['first-error',['first.calendar','first.day']]});
});
