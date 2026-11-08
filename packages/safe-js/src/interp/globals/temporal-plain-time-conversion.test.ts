import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each(["23:59:58.997998999", "2026-09-09T23:59:58.997998999", "T23:59:58.997998999"])("parses %s exactly", async input => {
  expect(await run(`const t=Temporal.PlainTime.from(${JSON.stringify(input)});return [t.hour,t.minute,t.second,t.millisecond,t.microsecond,t.nanosecond]`))
    .toMatchObject({ok:true,returnValue:[23,59,58,997,998,999]});
});

it("defaults missing bag fields and constrains finite truncated values", async () => {
  expect(await run(`const t=Temporal.PlainTime.from({hour:24.9,minute:-1,millisecond:1000});return [t.hour,t.minute,t.second,t.millisecond,t.microsecond,t.nanosecond]`))
    .toMatchObject({ok:true,returnValue:[23,0,0,999,0,0]});
});

it("reads bag fields alphabetically, converts immediately and reads overflow last", async () => {
  expect(await run(`const events=[];const bag=new Proxy({hour:1},{ownKeys(){throw 'enumerated'},get(t,k){events.push(k);return k==='hour'?{valueOf(){events.push('convert');return 1}}:undefined}});
    Temporal.PlainTime.from(bag,{get overflow(){events.push('overflow');return {toString(){events.push('string');return 'reject'}}}});return events`))
    .toMatchObject({ok:true,returnValue:["hour","convert","microsecond","millisecond","minute","nanosecond","second","overflow","string"]});
});

it("copies branded values without reading overridden fields or preserving subclasses", async () => {
  expect(await run(`class Derived extends Temporal.PlainTime{};const input=new Derived(23);Object.defineProperty(input,'hour',{get(){throw 'read'}});
    const copy=Derived.from(input);return [copy!==input,copy.hour,copy instanceof Derived,Object.getPrototypeOf(copy)===Temporal.PlainTime.prototype]`))
    .toMatchObject({ok:true,returnValue:[true,23,false,true]});
});

it("extracts a ZonedDateTime's private local time before reading overflow", async () => {
  expect(await run(`const input=Temporal.ZonedDateTime.from('2024-03-10T03:30:00.123456789-04:00[America/New_York]');
    const events=[];for(const key of ['hour','minute','second','timeZoneId','epochNanoseconds','calendarId'])
      Object.defineProperty(input,key,{get(){throw Error('public field read')}});
    const result=Temporal.PlainTime.from(input,{get overflow(){events.push('overflow');return 'reject'}});
    return [result.toString(),events]`))
    .toMatchObject({ok:true,returnValue:["03:30:00.123456789",["overflow"]]});
});

it.each(["new Temporal.PlainMonthDay(1,2)", "new Temporal.PlainYearMonth(2024,1)", "new Temporal.ZonedDateTime(0n,'UTC')"])(
  "rejects owned partial-time input %s before public property reads", async input => {
    expect(await run(`const input=${input};let reads=0;
      for(const key of ['calendar','timeZone','hour'])Object.defineProperty(input,key,{
        get(){reads++;throw Error('public property read')}
      });try{new Temporal.PlainTime().with(input)}catch(error){return [error.name,reads]}`))
      .toMatchObject({ok:true,returnValue:["TypeError",0]});
  }
);

it.each(["{}", "{hour:undefined}", "{hour:Infinity}", "{hour:1n}", "'not-a-time'", "'24:00'", "'12:00Z'", "null", "1"])(
  "rejects invalid input before consulting options: %s", async expression => {
    expect(await run(`let reads=0;let rejected=false;try{Temporal.PlainTime.from(${expression},{get overflow(){reads++;return 'reject'}})}catch(e){rejected=true}return [rejected,reads]`))
      .toMatchObject({ok:true,returnValue:[true,0]});
  }
);

it("validates overflow even on branded inputs and strings", async () => {
  expect(await run(`const results=[];for(const input of [new Temporal.PlainTime(),'12:00']){
    try{Temporal.PlainTime.from(input,{overflow:'invalid'})}catch(e){results.push(e.name)}}
    try{Temporal.PlainTime.from({hour:24},{overflow:'reject'})}catch(e){results.push(e.name)}return results`))
    .toMatchObject({ok:true,returnValue:["RangeError","RangeError","RangeError"]});
});

it("compares exact subsecond fields and constrains bags", async () => {
  expect(await run(`return [Temporal.PlainTime.compare('23:59:59.999999998','23:59:59.999999999'),
    Temporal.PlainTime.compare({hour:24},{hour:23}),Temporal.PlainTime.compare('12:00','11:59'),new Temporal.PlainTime(12).equals('12:00')]`))
    .toMatchObject({ok:true,returnValue:[-1,0,1,true]});
});

it("converts compare operands in order and brands equals before reading its argument", async () => {
  expect(await run(`const events=[];const second={get hour(){events.push('second');return 2}};
    try{Temporal.PlainTime.compare('invalid',second)}catch(e){events.push(e.name)}
    try{Temporal.PlainTime.prototype.equals.call({},second)}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:["RangeError","TypeError"]});
});

it("preserves the originating result prototype after the public constructor is replaced", async () => {
  expect(await run(`const from=Temporal.PlainTime.from;const prototype=Temporal.PlainTime.prototype;Temporal.PlainTime=function(){};
    const result=from('12:00');return [result.hour,Object.getPrototypeOf(result)===prototype]`))
    .toMatchObject({ok:true,returnValue:[12,true]});
});

it("registers method metadata and captured methods for completed replay", async () => {
  const source=`const from=Temporal.PlainTime.from;const compare=Temporal.PlainTime.compare;const equals=Temporal.PlainTime.prototype.equals;
    const value=from('12:00');await 0;return [from.length,compare.length,equals.length,compare(value,'13:00'),equals.call(value,{hour:12})]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:[1,2,1,-1,true]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
