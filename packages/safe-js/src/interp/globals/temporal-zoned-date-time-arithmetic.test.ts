import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("distinguishes calendar days from elapsed hours across DST", async () => {
  expect(await run(`const a=Temporal.ZonedDateTime.from('2021-03-13T12:00-05:00[America/New_York]');
    const day=a.add({days:1}),hours=a.add('PT24H');
    return [day.toString(),hours.toString(),day.subtract({days:1}).equals(a),hours.subtract('PT24H').equals(a)];`))
    .toMatchObject({ok:true,returnValue:["2021-03-14T12:00:00-04:00[America/New_York]","2021-03-14T13:00:00-04:00[America/New_York]",true,true]});
});

it("constrains or rejects calendar overflow and preserves calendar", async () => {
  expect(await run(`const a=Temporal.ZonedDateTime.from('2020-01-31T12:00Z[UTC][u-ca=buddhist]');let error;
    try{a.add({months:1},{overflow:'reject'})}catch(e){error=e.name}
    return [a.add({months:1}).toString(),a.subtract({months:1}).calendarId,error];`))
    .toMatchObject({ok:true,returnValue:["2020-02-29T12:00:00+00:00[UTC][u-ca=buddhist]","buddhist","RangeError"]});
});

it("finishes duration conversion before options and brands before either", async () => {
  expect(await run(`const method=Temporal.ZonedDateTime.prototype.add;if(typeof method!=='function')throw 'missing';
    const log=[];const duration=new Proxy({},{get(t,k){log.push(k);return k==='days'?1:undefined}});
    const options={get overflow(){log.push('overflow');return 'constrain'}};
    method.call(new Temporal.ZonedDateTime(0n,'UTC'),duration,options);let error;
    try{method.call({},new Proxy({},{get(){throw 'input'}}),options)}catch(e){error=e.name}
    return [log,error];`)).toMatchObject({ok:true,returnValue:[[
      "days","hours","microseconds","milliseconds","minutes","months","nanoseconds","seconds","weeks","years","overflow"],"TypeError"]});
});

it("uses private receiver/duration slots and creates intrinsic results", async () => {
  expect(await run(`class Derived extends Temporal.ZonedDateTime {}const a=new Derived(0n,'UTC'),d=new Temporal.Duration(0,0,0,0,1);
    for(const key of ['epochNanoseconds','timeZoneId','calendarId','constructor'])Object.defineProperty(a,key,{get(){throw 'receiver'}});
    Object.defineProperty(d,'hours',{get(){throw 'duration'}});const b=a.add(d);
    return [b.epochNanoseconds,Object.getPrototypeOf(b)===Temporal.ZonedDateTime.prototype,a.add.length,a.subtract.length];`))
    .toMatchObject({ok:true,returnValue:[3600000000000n,true,1,1]});
});

it("replays captured arithmetic after namespace replacement", async () => {
  const source=`const a=new Temporal.ZonedDateTime(0n,'UTC');const method=a.subtract;
    Temporal.ZonedDateTime=undefined;const b=method.call(a,'PT1H');await 0;return [method.name,b.toString()];`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["subtract","1969-12-31T23:00:00+00:00[UTC]"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
