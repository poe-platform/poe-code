import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each(["en-US","de-DE","fr-FR"])("formats private time fields in %s", async locale => {
  const options={hour:'numeric',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,timeZone:'UTC'} as const;
  const expected=new Intl.DateTimeFormat(locale,options).format(Date.UTC(1970,0,1,12,34,56,123));
  expect(await run(`const time=Temporal.PlainTime.from('12:34:56.123456789');Object.defineProperty(time,'hour',{get(){throw 'read'}});
    time.toString=()=>{throw 'conversion'};return time.toLocaleString('${locale}',${JSON.stringify(options)})`))
    .toMatchObject({ok:true,returnValue:expected});
});

it("defaults to clock fields and ignores validated zones and zone names", async () => {
  expect(await run(`const time=new Temporal.PlainTime(12,34,56);return [time.toLocaleString('en-US'),
    time.toLocaleString('en-US',{timeZone:'America/New_York',timeZoneName:'long'}),time.toLocaleString('en-US',{era:'long'})]`))
    .toMatchObject({ok:true,returnValue:["12:34:56 PM","12:34:56 PM","12:34:56 PM"]});
});

it.each(["+01", "+0130", "+01:30", "-00:00", "+23:59", "-23:59"])("validates and ignores fixed-offset zone %s", async timeZone => {
  expect(await run(`return new Temporal.PlainTime(12,34,56).toLocaleString('en-US',{
    timeZone:${JSON.stringify(timeZone)},timeZoneName:'long',hour:'numeric',minute:'2-digit'
  })`)).toMatchObject({ok:true,returnValue:"12:34 PM"});
});

it.each(["+24:00", "+01:60", "+01:00:00", "+010000", "+01:00:00.0", "−01:00", "+1", "+01:"])("rejects malformed offset %s before later option reads", async timeZone => {
  expect(await run(`const events=[];try{new Temporal.PlainTime().toLocaleString('en-US',{
    timeZone:${JSON.stringify(timeZone)},get hour(){events.push('hour');return 'numeric'}
  })}catch(e){events.push(e.name)}return events`)).toMatchObject({ok:true,returnValue:["RangeError"]});
});

it("coerces an offset once and still validates style conflicts after reading later options", async () => {
  expect(await run(`const events=[];try{new Temporal.PlainTime().toLocaleString('en-US',{
    get timeZone(){events.push('zone');return {toString(){events.push('string');return '+05:30'}}},
    get hour(){events.push('hour');return 'numeric'},get timeStyle(){events.push('style');return 'short'}
  })}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:["zone","string","hour","style","TypeError"]});
});

it("preserves fixed-offset time-style formatting through replay", async () => {
  const source=`const time=new Temporal.PlainTime(23,59,58);await 0;
    return time.toLocaleString('de-DE',{timeZone:'-23:59',timeStyle:'full'})`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:"23:59:58"});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});

it.each(["short","medium","long","full"])("supports %s time style without zone names", async style => {
  expect(await run(`return new Temporal.PlainTime(12,34,56).toLocaleString('en-US',{timeStyle:'${style}',timeZone:'America/New_York'})`))
    .toMatchObject({ok:true,returnValue:style==='short'?"12:34 PM":"12:34:56 PM"});
});

it("selects relevant clock fields from mixed date/time options", async () => {
  expect(await run(`return new Temporal.PlainTime(12,34).toLocaleString('en-US',{year:'numeric',month:'long',day:'numeric',hour:'numeric'})`))
    .toMatchObject({ok:true,returnValue:"12 PM"});
});

it.each(["{year:'numeric'}","{dateStyle:'short'}","{timeStyle:'short',year:'numeric'}","{timeStyle:'short',hour:'numeric'}"])("rejects incompatible formats %s", async options => {
  expect(await run(`let error;try{new Temporal.PlainTime().toLocaleString('en-US',${options})}catch(e){error=e.name}return error`))
    .toMatchObject({ok:true,returnValue:"TypeError"});
});

it("brands before locale reads and validates locales before options", async () => {
  expect(await run(`const events=[];const input=new Proxy({},{get(){events.push('read');throw 'read'}});
    try{Temporal.PlainTime.prototype.toLocaleString.call({},input,input)}catch(e){events.push(e.name)}
    try{new Temporal.PlainTime().toLocaleString('bad_locale',input)}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:["TypeError","RangeError"]});
});

it("reads each locale option once in order without enumeration", async () => {
  const keys=["localeMatcher","calendar","numberingSystem","hour12","hourCycle","timeZone","weekday","era","year","month","day","dayPeriod","hour","minute","second","fractionalSecondDigits","timeZoneName","formatMatcher","dateStyle","timeStyle"];
  expect(await run(`const events=[];new Temporal.PlainTime().toLocaleString('en-US',new Proxy({},{ownKeys(){throw 'enumerated'},get(t,k){events.push(k);return undefined}}));return events`))
    .toMatchObject({ok:true,returnValue:keys});
});

it("validates a discarded time zone before reading later properties", async () => {
  expect(await run(`const events=[];try{new Temporal.PlainTime().toLocaleString('en-US',{timeZone:'invalid/zone',get year(){events.push('year')}})}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:["RangeError"]});
});

it("preserves own method metadata and captured locale formatting through replay", async () => {
  const source=`const time=new Temporal.PlainTime(12,34);const method=Temporal.PlainTime.prototype.toLocaleString;
    const d=Object.getOwnPropertyDescriptor(Temporal.PlainTime.prototype,'toLocaleString');await 0;
    return [method.name,method.length,d.writable,d.enumerable,d.configurable,method.call(time,'en-US',{hour12:false})]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["toLocaleString",0,true,false,true,"12:34:00"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
