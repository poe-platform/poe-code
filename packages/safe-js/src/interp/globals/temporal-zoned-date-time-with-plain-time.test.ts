import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("changes wall time while preserving local date, zone and calendar", async () => {
  expect(await run(`const a=new Temporal.ZonedDateTime(0n,'+05:30','buddhist');
    return [a.withPlainTime('12:34:56.123456789').toString(),a.withPlainTime({hour:99}).hour,a.withPlainTime.length];`))
    .toMatchObject({ok:true,returnValue:["1970-01-01T12:34:56.123456789+05:30[+05:30][u-ca=buddhist]",23,0]});
});

it("uses compatible disambiguation for gaps and overlaps and start-of-day for omitted time", async () => {
  expect(await run(`const gap=Temporal.ZonedDateTime.from('2021-03-14T12:00-04:00[America/New_York]');
    const overlap=Temporal.ZonedDateTime.from('2021-11-07T12:00-05:00[America/New_York]');
    const midnight=Temporal.ZonedDateTime.from('2015-10-18T12:00-02:00[America/Sao_Paulo]');
    return [gap.withPlainTime('02:30').toString(),overlap.withPlainTime('01:30').toString(),
      midnight.withPlainTime().equals(midnight.startOfDay())];`))
    .toMatchObject({ok:true,returnValue:["2021-03-14T03:30:00-04:00[America/New_York]","2021-11-07T01:30:00-04:00[America/New_York]",true]});
});

it("reads ZonedDateTime time inputs through private slots in all time conversions", async () => {
  expect(await run(`const time=new Temporal.ZonedDateTime(123456789n,'+05:30');
    for(const key of ['hour','minute','second','millisecond','microsecond','nanosecond'])
      Object.defineProperty(time,key,{get(){throw 'shadow'}});
    const a=new Temporal.ZonedDateTime(0n,'UTC');
    return [a.withPlainTime(time).toPlainTime().toString(),Temporal.PlainTime.from(time).toString(),
      new Temporal.PlainDateTime(2000,1,1).withPlainTime(time).toPlainTime().toString()];`))
    .toMatchObject({ok:true,returnValue:Array(3).fill("05:30:00.123456789")});
});

it("rejects ZonedDateTime as a partial PlainTime object without reading fields", async () => {
  expect(await run(`const input=new Temporal.ZonedDateTime(0n,'UTC');
    Object.defineProperty(input,'calendar',{get(){throw 'read'}});let error;
    try{new Temporal.PlainTime().with(input)}catch(e){error=e.name}return error;`))
    .toMatchObject({ok:true,returnValue:"TypeError"});
});

it("brands the receiver before input coercion and returns an intrinsic object", async () => {
  expect(await run(`const method=Temporal.ZonedDateTime.prototype.withPlainTime;if(typeof method!=='function')throw 'missing';
    let error;try{method.call({},new Proxy({},{get(){throw 'input'}}))}catch(e){error=e.name}
    class Derived extends Temporal.ZonedDateTime {}const a=new Derived(0n,'UTC');
    const b=method.call(a,'12:00');return [error,Object.getPrototypeOf(b)===Temporal.ZonedDateTime.prototype,b!==a];`))
    .toMatchObject({ok:true,returnValue:["TypeError",true,true]});
});

it("preserves captured methods and changed values across replay", async () => {
  const source=`const a=new Temporal.ZonedDateTime(0n,'UTC');const method=a.withPlainTime;
    Temporal.ZonedDateTime=undefined;const b=method.call(a,'12:34');await 0;
    return [method.name,b.toString()];`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["withPlainTime","1970-01-01T12:34:00+00:00[UTC]"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
