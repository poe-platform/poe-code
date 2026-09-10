import { expect, it } from "vitest";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("constructs ISO and Buddhist dates with calendar-derived getters", async () => {
  expect(await run(`const iso=new Temporal.PlainDate(2000,2,29);const b=new Temporal.PlainDate(2000,2,29,'buddhist');
    return [iso.year,iso.monthCode,iso.dayOfWeek,iso.dayOfYear,iso.daysInMonth,iso.inLeapYear,b.year,b.calendarId,b.toString(),Reflect.ownKeys(iso)]`))
    .toMatchObject({ok:true,returnValue:[2000,"M02",2,60,29,true,2543,"buddhist","2000-02-29[u-ca=buddhist]",[]]});
});

it("coerces fields in order and truncates finite numbers", async () => {
  expect(await run(`const reads=[];const field=(name,value)=>({valueOf(){reads.push(name);return value}});
    const value=new Temporal.PlainDate(field('year',2000.9),field('month',2.9),field('day',29.9));
    return [value.toString(),reads,Temporal.PlainDate.length]`))
    .toMatchObject({ok:true,returnValue:["2000-02-29",["year","month","day"],3]});
});

it("rejects invalid dates and calendar coercion without reading newTarget prototype", async () => {
  expect(await run(`if(typeof Temporal.PlainDate!=='function')throw 'missing';const reads=[];
    const target=new Proxy(function(){},{get(t,k){reads.push(k);return t[k]}});const errors=[];
    for(const args of [[2001,2,29],[2000,1,1,{toString(){throw 'coerced'}}],[Infinity,1,1]]){
      try{Reflect.construct(Temporal.PlainDate,args,target)}catch(e){errors.push(e.name)}
    }return [errors,reads]`)).toMatchObject({ok:true,returnValue:[["RangeError","TypeError","RangeError"],[]]});
});

it("preserves subclasses and rejects ordinary calls and forged getters", async () => {
  expect(await run(`class DateSubclass extends Temporal.PlainDate{};const value=new DateSubclass(2000,1,1);const errors=[];
    try{Temporal.PlainDate(2000,1,1)}catch(e){errors.push(e.name)}
    const getter=Object.getOwnPropertyDescriptor(Temporal.PlainDate.prototype,'year').get;
    try{getter.call({})}catch(e){errors.push(e.name)}
    try{value.valueOf()}catch(e){errors.push(e.name)}
    return [value instanceof DateSubclass,Object.getPrototypeOf(value)===DateSubclass.prototype,errors]`))
    .toMatchObject({ok:true,returnValue:[true,true,["TypeError","TypeError","TypeError"]]});
});

it("reads only calendarName for toString and ignores JSON arguments", async () => {
  expect(await run(`const value=new Temporal.PlainDate(2000,2,29,'buddhist');const reads=[];
    const options=new Proxy({calendarName:'never'},{get(t,k){reads.push(k);return t[k]}});
    return [value.toString(options),value.toJSON(options),reads]`))
    .toMatchObject({ok:true,returnValue:["2000-02-29","2000-02-29[u-ca=buddhist]",["calendarName"]]});
});

it("retains private dates and captured methods through replay", async () => {
  const source=`const value=new Temporal.PlainDate(2000,2,29);const format=value.toString;Temporal.PlainDate=undefined;
    await 0;return [format.call(value),value.daysInYear,Object.prototype.toString.call(value)]`;
  const first=await run(source);expect(first).toMatchObject({ok:true,returnValue:["2000-02-29",366,"[object Temporal.PlainDate]"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});

it("imports bindings and replays a host date result without repeating the call", async () => {
  let calls=0;const load=()=>{calls++;return new Backend.PlainDate(2000,2,29,'buddhist')};
  const input=new Backend.PlainDate(2000,1,1);const source=`const value=await load();return [input.year,value.year,value.toString(),value instanceof Temporal.PlainDate]`;
  const first=await run(source,{bindings:{input,load}});
  expect(first).toMatchObject({ok:true,returnValue:[2000,2543,"2000-02-29[u-ca=buddhist]",true]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first)),bindings:{load}})).toMatchObject({ok:true,returnValue:first.returnValue});
  expect(calls).toBe(1);
});
