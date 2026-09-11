import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("distinguishes elapsed hours from calendar days across DST", async () => {
  expect(await run(`const a=Temporal.ZonedDateTime.from('2021-03-13T12:00-05:00[America/New_York]'),b=a.add({days:1});
    return [a.until(b).toString(),a.until(b,{largestUnit:'day'}).toString(),b.since(a).toString(),
      a.since(b,{largestUnit:'day'}).toString()];`))
    .toMatchObject({ok:true,returnValue:["PT23H","P1D","PT23H","-P1D"]});
});

it("allows different zones only for time-unit differences", async () => {
  expect(await run(`const a=new Temporal.ZonedDateTime(0n,'UTC'),b=new Temporal.ZonedDateTime(3600000000000n,'+05:30');
    let error;try{a.until(b,{largestUnit:'day'})}catch(e){error=e.name}
    return [a.until(b).toString(),error];`)).toMatchObject({ok:true,returnValue:["PT1H","RangeError"]});
});

it("rejects calendar mismatch before options and zone mismatch after options", async () => {
  expect(await run(`const a=new Temporal.ZonedDateTime(0n,'UTC');if(typeof a.until!=='function')throw 'missing';
    const log=[],errors=[];const options=new Proxy({largestUnit:'day'},{get(t,k){log.push(k);return t[k]}});
    for(const b of [new Temporal.ZonedDateTime(0n,'UTC','buddhist'),new Temporal.ZonedDateTime(0n,'+01:00')])
      try{a.until(b,options)}catch(e){errors.push(e.name)}return [errors,log];`))
    .toMatchObject({ok:true,returnValue:[["RangeError","RangeError"],["largestUnit","roundingIncrement","roundingMode","smallestUnit"]]});
});

it("supports directed rounding and private inputs", async () => {
  expect(await run(`const a=new Temporal.ZonedDateTime(0n,'UTC'),b=new Temporal.ZonedDateTime(90000000000n,'UTC');
    for(const value of [a,b])for(const key of ['epochNanoseconds','calendarId','timeZoneId'])Object.defineProperty(value,key,{get(){throw 'shadow'}});
    return [a.until(b,{smallestUnit:'minute',roundingMode:'ceil'}).toString(),
      a.since(b,{smallestUnit:'minute',roundingMode:'ceil'}).toString()];`))
    .toMatchObject({ok:true,returnValue:["PT2M","-PT1M"]});
});

it("retains captured Duration prototypes and difference methods through replay", async () => {
  const source=`const a=new Temporal.ZonedDateTime(0n,'UTC'),b=new Temporal.ZonedDateTime(1n,'UTC');
    const method=a.until,proto=Temporal.Duration.prototype;Temporal.Duration=undefined;
    const result=method.call(a,b);await 0;return [method.name,method.length,result.nanoseconds,Object.getPrototypeOf(result)===proto];`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["until",1,1,true]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
