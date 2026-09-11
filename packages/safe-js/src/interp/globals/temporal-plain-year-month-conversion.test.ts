import { expect, it } from "vitest";
import { run } from "../../run.js";

it("converts date private fields into canonical year-months", async () => {
  expect(await run(`const date=new Temporal.PlainDate(2000,2,29,'buddhist');
    for(const key of ['year','month','day','calendarId'])Object.defineProperty(date,key,{get(){throw Error('shadow')}});
    const result=date.toPlainYearMonth();return [result.toString(),result instanceof Temporal.PlainYearMonth]`))
    .toMatchObject({ok:true,returnValue:["2000-02-01[u-ca=buddhist]",true]});
});

it("selects a calendar day and constrains overflow without reading unrelated properties", async () => {
  expect(await run(`const events=[];const bag=new Proxy({day:30},{get(t,k){events.push(k);return t[k]}});
    const result=new Temporal.PlainYearMonth(2000,2).toPlainDate(bag);
    return [result.toString(),result instanceof Temporal.PlainDate,events]`))
    .toMatchObject({ok:true,returnValue:["2000-02-29",true,["day"]]});
});

it("uses private non-ISO receiver fields and coerces day once", async () => {
  expect(await run(`const t=new Temporal.PlainYearMonth(2000,2,'buddhist',29),events=[];
    for(const key of ['calendar','year','month','day'])Object.defineProperty(t,key,{get(){throw Error('shadow')}});
    const result=t.toPlainDate({day:{valueOf(){events.push('day');return 28.8}}});return [result.toString(),events]`))
    .toMatchObject({ok:true,returnValue:["2000-02-28[u-ca=buddhist]",["day"]]});
});

it.each(["{}", "{day:undefined}", "{day:0}", "{day:Infinity}", "null", "1"])("rejects missing or invalid day input: %s", async input => {
  const error = input.includes("day:0") || input.includes("Infinity") ? "RangeError" : "TypeError";
  expect(await run(`try{new Temporal.PlainYearMonth(2000,2).toPlainDate(${input})}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:error});
});

it("brands both conversion methods before observing input", async () => {
  expect(await run(`const events=[];try{Temporal.PlainYearMonth.prototype.toPlainDate.call({}, {get day(){events.push('day');return 1}})}catch(e){events.push(e.name)}
    try{Temporal.PlainDate.prototype.toPlainYearMonth.call({})}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:["TypeError","TypeError"]});
});

it("allows boundary months but checks the resulting PlainDate limits", async () => {
  expect(await run(`const t=new Temporal.PlainYearMonth(-271821,4);let error;try{t.toPlainDate({day:1})}catch(e){error=e.name}
    return [error,t.toPlainDate({day:20}).toString()]`)).toMatchObject({ok:true,returnValue:["RangeError","-271821-04-20"]});
});
