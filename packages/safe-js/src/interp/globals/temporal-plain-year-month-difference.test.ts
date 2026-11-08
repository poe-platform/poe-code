import { expect, it } from "vitest";
import { run } from "../../run.js";

it("returns signed calendar differences with year or month units", async () => {
  expect(await run(`const a=new Temporal.PlainYearMonth(2000,2),b=new Temporal.PlainYearMonth(2001,5);
    const d=a.until(b);return [d.toString(),a.since(b).toString(),a.until(b,{largestUnit:'month'}).toString(),d instanceof Temporal.Duration]`))
    .toMatchObject({ok:true,returnValue:["P1Y3M","-P1Y3M","P15M",true]});
});

it("rounds years with directional rounding for until and since", async () => {
  expect(await run(`const a=new Temporal.PlainYearMonth(2000,1);return [a.until('2001-08',{smallestUnit:'year',roundingMode:'ceil'}).toString(),a.since('2001-08',{smallestUnit:'year',roundingMode:'ceil'}).toString()]`))
    .toMatchObject({ok:true,returnValue:["P2Y","-P1Y"]});
});

it("uses private fields and ignores ISO reference-day differences within a calendar month", async () => {
  expect(await run(`const a=new Temporal.PlainYearMonth(2000,2,'buddhist',29),b=new Temporal.PlainYearMonth(2000,2,'buddhist',1);
    for(const t of [a,b])for(const k of ['calendar','year','month','day'])Object.defineProperty(t,k,{get(){throw Error('shadow')}});
    return a.until(b).toString()`)).toMatchObject({ok:true,returnValue:"PT0S"});
});

it("rejects mismatched calendars before options", async () => {
  expect(await run(`const events=[];try{new Temporal.PlainYearMonth(2000,2).until(new Temporal.PlainYearMonth(2000,2,'buddhist'),{get largestUnit(){events.push('option');return 'year'}})}catch(e){return [e.name,events]}`))
    .toMatchObject({ok:true,returnValue:["RangeError",[]]});
});

it("reads options in order and validates them even for equal values", async () => {
  expect(await run(`const events=[],t=new Temporal.PlainYearMonth(2000,2),options=new Proxy({largestUnit:'month',smallestUnit:'day'},{get(t,k){events.push(k);return t[k]}});
    try{t.until(t,options)}catch(e){return [e.name,events]}`))
    .toMatchObject({ok:true,returnValue:["RangeError",["largestUnit","roundingIncrement","roundingMode","smallestUnit"]]});
});

it.each(["{smallestUnit:'auto'}","{largestUnit:'week'}","{roundingIncrement:0}","null"])("rejects invalid difference options: %s", async options => {
  expect(await run(`try{new Temporal.PlainYearMonth(2000,2).since('2001-02',${options})}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:options==="null"?"TypeError":"RangeError"});
});
