import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("constructs year-months with calendar getters and standard metadata", async () => {
  expect(await run(`const t=new Temporal.PlainYearMonth(2000,2,'buddhist',29);
    return [t.year,t.month,t.monthCode,t.calendarId,t.era,t.eraYear,t.daysInMonth,t.daysInYear,t.monthsInYear,t.inLeapYear,
      t instanceof Temporal.PlainYearMonth,Object.prototype.toString.call(t),Temporal.PlainYearMonth.length,
      Object.getOwnPropertyDescriptor(Temporal.PlainYearMonth,'prototype').writable]`))
    .toMatchObject({ok:true,returnValue:[2543,2,"M02","buddhist","be",2543,29,366,12,true,true,"[object Temporal.PlainYearMonth]",2,false]});
});

it("coerces year and month before calendar validation, then reference day", async () => {
  expect(await run(`const events=[];const v=(s,n)=>({valueOf(){events.push(s);return n}});
    try{new Temporal.PlainYearMonth(v('year',2000),v('month',2),'invalid',v('day',29))}catch(e){events.push(e.name)}
    const t=new Temporal.PlainYearMonth(v('year',2000.9),v('month',2.9),'ISO8601',v('day',29.8));
    return [events,t.year,t.month,t.calendarId]`))
    .toMatchObject({ok:true,returnValue:[["year","month","RangeError","year","month","day"],2000,2,"iso8601"]});
});

it("rejects calls without new and calendars without string coercion", async () => {
  expect(await run(`const events=[];try{Temporal.PlainYearMonth(2000,2)}catch(e){events.push(e.name)}
    try{new Temporal.PlainYearMonth(2000,2,{toString(){events.push('coerced');return 'iso8601'}})}catch(e){events.push(e.name)}
    return events`)).toMatchObject({ok:true,returnValue:["TypeError","TypeError"]});
});

it("brands getters and reads private fields despite public shadows", async () => {
  expect(await run(`const t=new Temporal.PlainYearMonth(2000,2);const p=Temporal.PlainYearMonth.prototype;
    const year=Object.getOwnPropertyDescriptor(p,'year').get;
    Object.defineProperty(t,'year',{get(){throw Error('shadow')}});
    const errors=[];for(const v of [{},p,new Proxy(t,{})])try{year.call(v)}catch(e){errors.push(e.name)}
    return [year.call(t),errors]`)).toMatchObject({ok:true,returnValue:[2000,["TypeError","TypeError","TypeError"]]});
});

it("preserves public subclass identity through snapshot replay", async () => {
  const source=`class Derived extends Temporal.PlainYearMonth{};const t=new Derived(2000,2);await 0;
    return [t instanceof Derived,t.year,t.month,t.daysInMonth]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:[true,2000,2,29]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:[true,2000,2,29]});
});

it.each(["", "2000", "NaN,1", "Infinity,1", "2000,Infinity", "2000,0", "2000,13", "2001,2,'iso8601',29", "2000,1,'iso8601',Infinity", "-271821,3", "275760,10"])("rejects invalid constructor arguments: %s", async args => {
  expect(await run(`try{new Temporal.PlainYearMonth(${args})}catch(e){return e.name}`)).toMatchObject({ok:true,returnValue:"RangeError"});
});

it("accepts boundary reference dates outside PlainDate limits", async () => {
  expect(await run(`const a=new Temporal.PlainYearMonth(-271821,4,'iso8601',1),b=new Temporal.PlainYearMonth(275760,9,'iso8601',30);
    return [a.year,a.month,b.year,b.month]`)).toMatchObject({ok:true,returnValue:[-271821,4,275760,9]});
});

it("reads newTarget prototype only after date validation", async () => {
  expect(await run(`const events=[];const target=new Proxy(function(){},{get(t,k,r){if(k==='prototype')events.push(k);return Reflect.get(t,k,r)}});
    try{Reflect.construct(Temporal.PlainYearMonth,[2000,13],target)}catch(e){events.push(e.name)}
    const t=Reflect.construct(Temporal.PlainYearMonth,[2000,2],target);
    return [events,Object.getPrototypeOf(t)===target.prototype]`)).toMatchObject({ok:true,returnValue:[["RangeError","prototype","prototype"],true]});
});
