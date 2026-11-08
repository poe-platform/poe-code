import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each(["en","de","fr","ar"])("matches the maintained Intl formatter in %s", async locale => {
  expect(await run(`const fields={hours:1,minutes:2,seconds:3,milliseconds:4,microseconds:5,nanoseconds:6};const d=Temporal.Duration.from(fields);
    return ['long','short','narrow','digital'].map(style=>d.toLocaleString('${locale}',{style})===new Intl.DurationFormat('${locale}',{style}).format(fields))`))
    .toMatchObject({ok:true,returnValue:[true,true,true,true]});
});

it("formats digital time from private slots even when public methods and fields are replaced", async () => {
  expect(await run(`const d=Temporal.Duration.from('PT1H2M3.004005006S');Object.defineProperty(d,'hours',{get(){throw 'shadow'}});
    d.toString=()=>{throw 'string'};Intl.DurationFormat=function(){throw 'constructor'};
    return d.toLocaleString('en',{style:'digital',fractionalDigits:9})`))
    .toMatchObject({ok:true,returnValue:"1:02:03.004005006"});
});

it("lets Intl.DurationFormat format branded private slots without reading shadowing getters", async () => {
  expect(await run(`const d=Temporal.Duration.from('PT1H');Object.defineProperty(d,'hours',{get(){throw 'shadow'}});
    const format=new Intl.DurationFormat('en',{style:'digital'});return [format.format(d),format.formatToParts(d).map(p=>p.value).join('')]`))
    .toMatchObject({ok:true,returnValue:["1:00:00","1:00:00"]});
});

it("checks branding before locale or option access", async () => {
  expect(await run(`const events=[];const input=new Proxy({},{get(){events.push('read');throw 'access'}});
    try{Temporal.Duration.prototype.toLocaleString.call({},input,input)}catch(e){return [e.name,events]}`))
    .toMatchObject({ok:true,returnValue:["TypeError",[]]});
});

it("canonicalizes locales before reading options", async () => {
  expect(await run(`const events=[];const locales={length:1,get 0(){events.push('locale');return 'en'}};
    const options={get style(){events.push('style');return 'digital'}};
    return [Temporal.Duration.from('PT1S').toLocaleString(locales,options),events]`))
    .toMatchObject({ok:true,returnValue:["0:00:01",["locale","style"]]});
});

it.each([["'invalid_tag'","{}","RangeError"],["'en'","null","TypeError"],["'en'","{style:'invalid'}","RangeError"],
  ["'en'","{fractionalDigits:10}","RangeError"]])("validates locale %s and options %s", async (locale,options,error) => {
  expect(await run(`try{new Temporal.Duration().toLocaleString(${locale},${options});return 'accepted'}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:error});
});

it("preserves metadata and completed locale results through replay", async () => {
  const source=`const desc=Object.getOwnPropertyDescriptor(Temporal.Duration.prototype,'toLocaleString');let error;
    try{new desc.value()}catch(e){error=e.name}const d=Temporal.Duration.from('-PT1H');await 0;
    return [d.toLocaleString('en',{style:'digital'}),desc.value.name,desc.value.length,desc.enumerable,desc.writable,desc.configurable,error]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["-1:00:00","toLocaleString",0,false,true,true,"TypeError"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
