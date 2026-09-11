import { expect, it } from "vitest";
import { run } from "../../run.js";

it("accepts zoned strings and calendar property bags", async () => {
  expect(await run(`const a=Temporal.ZonedDateTime.from('1970-01-01T05:30:00.123456789+05:30[+05:30]');
    const b=Temporal.ZonedDateTime.from({year:2513,month:1,day:1,timeZone:'UTC',calendar:'buddhist'});
    return [a.epochNanoseconds,a.timeZoneId,b.epochNanoseconds,b.calendarId,Temporal.ZonedDateTime.from.length];`))
    .toMatchObject({ok:true,returnValue:[123456789n,'+05:30',0n,'buddhist',1]});
});

it("clones owned slots without reading shadows and validates options in order", async () => {
  expect(await run(`const z=new Temporal.ZonedDateTime(123n,'UTC');const reads=[];
    for(const k of ['calendar','timeZone','epochNanoseconds'])Object.defineProperty(z,k,{get(){throw 'shadow'}});
    const copy=Temporal.ZonedDateTime.from(z,new Proxy({},{get(t,k){reads.push(k);return undefined}}));
    return [copy!==z,copy.epochNanoseconds,reads];`))
    .toMatchObject({ok:true,returnValue:[true,123n,['disambiguation','offset','overflow']]});
});

it("reads property fields before options and stops at a missing timeZone", async () => {
  expect(await run(`if(typeof Temporal.ZonedDateTime.from!=='function')throw 'missing';const reads=[];
    const opts=new Proxy({},{get(t,k){reads.push('option.'+k)}});
    try{Temporal.ZonedDateTime.from(new Proxy({year:2000,month:1,day:1},{get(t,k){reads.push(k);return t[k]}}),opts)}catch(e){reads.push(e.name)}
    return reads;`)).toMatchObject({ok:true,returnValue:['calendar','day','hour','microsecond','millisecond','minute','month','monthCode','nanosecond','offset','second','timeZone','TypeError']});
});

it("validates string grammar before options but epoch range after options", async () => {
  expect(await run(`if(typeof Temporal.ZonedDateTime.from!=='function')throw 'missing';const reads=[];
    const options=new Proxy({},{get(t,k){reads.push(k)}});const errors=[];
    for(const input of ['bad','+999999-01-01T00:00[UTC]']){
      try{Temporal.ZonedDateTime.from(input,options)}catch(e){errors.push(e.name)}
    }return [errors,reads];`)).toMatchObject({ok:true,returnValue:[['RangeError','RangeError'],['disambiguation','offset','overflow']]});
});

it("handles DST overlap disambiguation and mismatched offset policies", async () => {
  expect(await run(`const source='2021-11-07T01:30[America/New_York]';
    const earlier=Temporal.ZonedDateTime.from(source,{disambiguation:'earlier'});
    const later=Temporal.ZonedDateTime.from(source,{disambiguation:'later'});
    const use=Temporal.ZonedDateTime.from('1970-01-01T00:00+01:00[UTC]',{offset:'use'});
    const ignore=Temporal.ZonedDateTime.from('1970-01-01T00:00+01:00[UTC]',{offset:'ignore'});
    return [later.epochNanoseconds-earlier.epochNanoseconds,use.epochNanoseconds,ignore.epochNanoseconds];`))
    .toMatchObject({ok:true,returnValue:[3600000000000n,-3600000000000n,0n]});
});
