import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each(["buddhist", "2000-01-01[u-ca=buddhist]"])("changes only the calendar: %s", async calendar => {
  expect(await run(`const a=new Temporal.ZonedDateTime(123n,'+05:30');
    const b=a.withCalendar(${JSON.stringify(calendar)});
    return [b.epochNanoseconds,b.timeZoneId,b.calendarId,b.year,b.hour,a.calendarId,b!==a];`))
    .toMatchObject({ok:true,returnValue:[123n,"+05:30","buddhist",2513,5,"iso8601",true]});
});

it("uses private slots for receiver and all available calendar-bearing types", async () => {
  expect(await run(`class Derived extends Temporal.ZonedDateTime {}
    const a=new Derived(0n,'UTC');const inputs=[new Temporal.PlainDate(2000,1,1,'buddhist'),
      new Temporal.PlainDateTime(2000,1,1,0,0,0,0,0,0,'buddhist'),new Temporal.ZonedDateTime(1n,'UTC','buddhist')];
    for(const value of [a,...inputs])for(const key of ['calendarId','epochNanoseconds','timeZoneId','constructor'])
      Object.defineProperty(value,key,{get(){throw 'shadow'}});
    return inputs.map(input=>{const b=a.withCalendar(input);return [b.calendarId,b.epochNanoseconds,
      Object.getPrototypeOf(b)===Temporal.ZonedDateTime.prototype]});`))
    .toMatchObject({ok:true,returnValue:Array.from({length:3},()=>["buddhist",0n,true])});
});

it("admits private ZonedDateTime calendars in existing date methods", async () => {
  expect(await run(`const calendar=new Temporal.ZonedDateTime(0n,'UTC','buddhist');
    Object.defineProperty(calendar,'calendarId',{get(){throw 'shadow'}});
    return [new Temporal.PlainDate(2000,1,1).withCalendar(calendar).year,
      new Temporal.PlainDateTime(2000,1,1).withCalendar(calendar).year];`))
    .toMatchObject({ok:true,returnValue:[2543,2543]});
});

it("brands receivers and rejects arbitrary calendar objects without coercion", async () => {
  expect(await run(`const method=Temporal.ZonedDateTime.prototype.withCalendar;
    if(typeof method!=='function')throw 'missing';const reads=[],errors=[];
    const input=new Proxy({},{get(){reads.push('get');throw 'coercion'}});
    for(const receiver of [{},new Temporal.ZonedDateTime(0n,'UTC')])
      try{method.call(receiver,input)}catch(e){errors.push(e.name)}
    return [errors,reads];`)).toMatchObject({ok:true,returnValue:[["TypeError","TypeError"],[]]});
});

it("retains intrinsic construction and method identity across replay", async () => {
  const source=`const a=new Temporal.ZonedDateTime(0n,'UTC');const method=a.withCalendar;
    Temporal.ZonedDateTime=undefined;const b=method.call(a,'buddhist');await 0;
    return [method.name,method.length,b.year,b.timeZoneId,b!==a];`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["withCalendar",1,2513,"UTC",true]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
