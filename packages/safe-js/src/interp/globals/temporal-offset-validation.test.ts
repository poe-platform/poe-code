import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each(["+01:60", "+0160", "-00:99", "+00:00:60", "+000060"])("rejects invalid offset components %s in Temporal strings", async offset => {
  const instant = JSON.stringify(`1970-01-01T00:00${offset}`);
  const time = JSON.stringify(`12:34${offset}`);
  const relative = JSON.stringify(`2020-01-01T00:00${offset}[UTC]`);
  expect(await run(`return [()=>Temporal.Instant.from(${instant}),
    ()=>Temporal.PlainTime.from(${time}),
    ()=>new Temporal.Duration(0,0,0,1).total({unit:'hours',relativeTo:${relative}})]
    .map(f=>{try{f();return 'accepted'}catch(e){return e.name}})`))
    .toMatchObject({ok:true,returnValue:["RangeError","RangeError","RangeError"]});
});

it.each(["+01:60", "+0160", "-00:99"])("rejects malformed zone %s in options, bags and annotations", async offset => {
  const zone = JSON.stringify(offset);
  const annotation = JSON.stringify(`1970-01-01T00:00Z[${offset}]`);
  expect(await run(`return [()=>new Temporal.Instant(0n).toString({timeZone:${zone}}),
    ()=>new Temporal.Duration(0,0,0,1).total({unit:'hours',relativeTo:{year:2020,month:1,day:1,timeZone:${zone}}}),
    ()=>Temporal.Instant.from(${annotation})]
    .map(f=>{try{f();return 'accepted'}catch(e){return e.name}})`))
    .toMatchObject({ok:true,returnValue:["RangeError","RangeError","RangeError"]});
});

it("rejects offset bag components before reading later properties", async () => {
  expect(await run(`const events=[];try{new Temporal.Duration(0,0,0,1).total({unit:'hours',relativeTo:{
    year:2020,month:1,day:1,offset:'+00:00:60',get second(){events.push('second')},timeZone:'UTC'
  }})}catch(e){events.push(e.name)}return events`)).toMatchObject({ok:true,returnValue:["RangeError"]});
});

it("rejects time-zone bag components before reading year", async () => {
  expect(await run(`const events=[];try{new Temporal.Duration(0,0,0,1).total({unit:'hours',relativeTo:{
    get year(){events.push('year');return 2020},month:1,day:1,timeZone:'+01:60'
  }})}catch(e){events.push(e.name)}return events`)).toMatchObject({ok:true,returnValue:["RangeError"]});
});

it("preserves valid precise offsets, leap seconds and ignored annotation values", async () => {
  expect(await run(`return [
    Temporal.Instant.from('1970-01-01T00:00+00:00:00.000000001').epochNanoseconds.toString(),
    Temporal.Instant.from('19700101t0000-000059,5').epochNanoseconds.toString(),
    Temporal.PlainTime.from('12:34:60+00:00:59').toString(),
    Temporal.PlainTime.from('T1234+0159').toString(),
    Temporal.Instant.from('1970-01-01T00:00Z[foo=bad-9960]').epochNanoseconds.toString()
  ]`)).toMatchObject({ok:true,returnValue:["-1","59500000000","12:34:59","12:34:00","0"]});
});

it("preserves named zones, signed date years and date-only relative inputs", async () => {
  expect(await run(`const instant=new Temporal.Instant(0n);return [
    instant.toString({timeZone:'Etc/GMT+1'}),
    instant.toString({timeZone:'+202000-01-01T00:00+01:00'}),
    instant.toString({timeZone:'2020-01-01[UTC]'}),
    new Temporal.Duration(0,0,0,1).total({unit:'hours',relativeTo:'+002020-01-01'})
  ]`)).toMatchObject({ok:true,returnValue:["1969-12-31T23:00:00-01:00","1970-01-01T01:00:00+01:00","1970-01-01T00:00:00+00:00",24]});
});
