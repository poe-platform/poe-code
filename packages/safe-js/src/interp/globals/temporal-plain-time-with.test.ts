import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("merges defined fields, preserving omitted and undefined fields", async () => {
  expect(await run(`return Temporal.PlainTime.from('01:02:03.004005006').with({hour:12.9,second:undefined,nanosecond:9}).toJSON()`))
    .toMatchObject({ok:true,returnValue:"12:02:03.004005009"});
});

it("constrains by default and rejects overflow on request", async () => {
  expect(await run(`const time=new Temporal.PlainTime(1,2);let error;try{time.with({minute:60},{overflow:'reject'})}catch(e){error=e.name}
    return [time.with({hour:24,minute:-1}).toJSON(),error,time.toJSON()]`))
    .toMatchObject({ok:true,returnValue:["23:00:00","RangeError","01:02:00"]});
});

it("reads calendar/timeZone, then fields with immediate coercion, then overflow", async () => {
  expect(await run(`const events=[];const input=new Proxy({},{ownKeys(){throw 'enumerated'},get(t,key){events.push(key);
    if(key==='minute')return {valueOf(){events.push('number');return 5}}}});
    const result=new Temporal.PlainTime(1).with(input,{get overflow(){events.push('overflow');return {toString(){events.push('string');return 'reject'}}}});
    return [result.minute,events]`)).toMatchObject({ok:true,returnValue:[5,["calendar","timeZone","hour","microsecond","millisecond","minute","number","nanosecond","second","overflow","string"]]});
});

it.each(["undefined","null","1","'12:00'","{}","{hour:undefined}","{calendar:null,hour:1}","{timeZone:'UTC',hour:1}","new Temporal.PlainTime()"])("rejects invalid partial input %s before options", async input => {
  expect(await run(`let reads=0;let error;try{new Temporal.PlainTime().with(${input},{get overflow(){reads++;return 'reject'}})}catch(e){error=e.name}return [error,reads]`))
    .toMatchObject({ok:true,returnValue:["TypeError",0]});
});

it("brands the receiver and rejects branded partial inputs before property reads", async () => {
  expect(await run(`const events=[];const input=new Temporal.PlainTime();Object.defineProperty(input,'calendar',{get(){events.push('calendar')}});
    const bag=new Proxy({},{get(){events.push('bag');return 1}});
    try{Temporal.PlainTime.prototype.with.call({},bag)}catch(e){events.push(e.name)}
    try{input.with(input)}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:["TypeError","TypeError"]});
});

it("stops after defined calendar and rejects non-finite fields before overflow", async () => {
  expect(await run(`const events=[];const time=new Temporal.PlainTime();
    try{time.with({get calendar(){events.push('calendar');return null},get timeZone(){throw 'read'}})}catch(e){events.push(e.name)}
    try{time.with({hour:Infinity},{get overflow(){throw 'read'}})}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:["calendar","TypeError","RangeError"]});
});

it("does not reject Instant or Duration brands when they carry valid partial time fields", async () => {
  expect(await run(`const instant=new Temporal.Instant(0n);instant.hour=3;const duration=new Temporal.Duration();duration.minute=4;
    const time=new Temporal.PlainTime(1,2);return [time.with(instant).toJSON(),time.with(duration).toJSON()]`))
    .toMatchObject({ok:true,returnValue:["03:02:00","01:04:00"]});
});

it("rejects owned dates before reading partial fields or options", async () => {
  expect(await run(`const events=[];const date=new Temporal.PlainDate(2000,2,29);
    for(const key of ['calendar','timeZone','hour'])Object.defineProperty(date,key,{get(){events.push(key);return key==='hour'?3:undefined}});
    try{new Temporal.PlainTime(1).with(date,{get overflow(){events.push('overflow');return 'reject'}})}catch(e){events.push(e.name)}
    return events`)).toMatchObject({ok:true,returnValue:["TypeError"]});
});

it("still converts a date carrying time fields through PlainTime.from", async () => {
  expect(await run(`const date=new Temporal.PlainDate(2000,2,29);date.hour=3;
    return Temporal.PlainTime.from(date).toJSON()`)).toMatchObject({ok:true,returnValue:"03:00:00"});
});

it("returns fresh base values from private receiver fields and replays captured methods", async () => {
  const source=`class Derived extends Temporal.PlainTime{};const time=new Derived(1,2);const proto=Temporal.PlainTime.prototype;
    Object.defineProperty(time,'hour',{get(){throw 'read'}});const method=proto.with;Temporal.PlainTime=function(){};
    const result=method.call(time,{minute:3});await 0;return [method.name,method.length,result.toJSON(),result!==time,result instanceof Derived,Object.getPrototypeOf(result)===proto]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["with",1,"01:03:00",true,false,true]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
