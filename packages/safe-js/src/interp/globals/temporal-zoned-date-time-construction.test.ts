import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each([
  ["-8640000000000000000000", "UTC", "-271821-04-20T00:00:00+00:00[UTC]"],
  ["-8640000000000000000000", "+23:59", "-271821-04-20T23:59:00+23:59[+23:59]"],
  ["-8640000000000000000000", "-23:59", "-271821-04-19T00:01:00-23:59[-23:59]"],
  ["8640000000000000000000", "UTC", "+275760-09-13T00:00:00+00:00[UTC]"],
  ["8640000000000000000000", "+23:59", "+275760-09-13T23:59:00+23:59[+23:59]"],
  ["8640000000000000000000", "-23:59", "+275760-09-12T00:01:00-23:59[-23:59]"]
])("preserves epoch boundary %s in zone %s", async (epoch, zone, expected) => {
  expect(await run(`const value=new Temporal.ZonedDateTime(${epoch}n,${JSON.stringify(zone)});
    return [value.epochNanoseconds,value.toString()];`))
    .toMatchObject({ok:true,returnValue:[BigInt(epoch),expected]});
});

it("constructs zoned values with exact epochs and calendar-derived fields", async () => {
  expect(await run(`const value=new Temporal.ZonedDateTime(123456789n,'+0530','buddhist');
    return [value.epochNanoseconds,value.epochMilliseconds,value.timeZoneId,value.calendarId,
      value.year,value.month,value.day,value.hour,value.minute,value.second,value.millisecond,value.microsecond,value.nanosecond,
      value.offset,value.offsetNanoseconds,value.hoursInDay,Reflect.ownKeys(value),Temporal.ZonedDateTime.length];`))
    .toMatchObject({ok:true,returnValue:[123456789n,123,'+05:30','buddhist',2513,1,1,5,30,0,123,456,789,'+05:30',19800000000000,24,[],2]});
});

it("validates epoch, zone and calendar before looking up newTarget prototype", async () => {
  expect(await run(`if(typeof Temporal.ZonedDateTime!=='function')throw 'missing';
    const reads=[];const target=new Proxy(function(){},{get(t,k){reads.push(k);return t[k]}});const errors=[];
    for(const args of [[8640000000000000000001n,{}],[0n,'Invalid/Zone',{}],[0n,'UTC',{}],[0n,'2000-01-01T00:00[UTC]']]){
      try{Reflect.construct(Temporal.ZonedDateTime,args,target)}catch(e){errors.push(e.name)}
    }return [errors,reads];`)).toMatchObject({ok:true,returnValue:[['RangeError','RangeError','TypeError','RangeError'],[]]});
});

it("coerces only epoch with number hint and preserves subclasses", async () => {
  expect(await run(`const reads=[];class Zoned extends Temporal.ZonedDateTime{};
    const value=new Zoned({[Symbol.toPrimitive](hint){reads.push(hint);return '123'}},'utc');
    return [value.epochNanoseconds,reads,value instanceof Zoned,Object.getPrototypeOf(value)===Zoned.prototype,
      Object.prototype.toString.call(value)];`))
    .toMatchObject({ok:true,returnValue:[123n,['number'],true,true,'[object Temporal.ZonedDateTime]']});
});

it("rejects ordinary calls, forged getters and implicit conversion", async () => {
  expect(await run(`if(typeof Temporal.ZonedDateTime!=='function')throw 'missing';const errors=[];
    const getter=Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype,'epochNanoseconds').get;
    for(const action of [()=>Temporal.ZonedDateTime(0n,'UTC'),()=>getter.call({}),()=>new Temporal.ZonedDateTime(0n,'UTC').valueOf()]){
      try{action()}catch(e){errors.push(e.name)}
    }return errors;`)).toMatchObject({ok:true,returnValue:['TypeError','TypeError','TypeError']});
});

it("retains captured zoned getters through completed replay", async () => {
  const source=`const value=new Temporal.ZonedDateTime(-1n,'UTC');
    const getter=Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype,'epochMilliseconds').get;
    Temporal.ZonedDateTime=undefined;await 0;return [getter.call(value),value.year,value.nanosecond];`;
  const first=await run(source);expect(first).toMatchObject({ok:true,returnValue:[-1,1969,999]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
