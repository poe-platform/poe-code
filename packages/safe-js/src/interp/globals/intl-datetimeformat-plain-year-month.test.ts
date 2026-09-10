import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("formats private year-month fields without primitive or public field reads", async () => {
  expect(await run(`const t=new Temporal.PlainYearMonth(2000,2,'gregory',29);
    for(const key of ['year','monthCode','calendarId','valueOf','toString'])Object.defineProperty(t,key,{get(){throw Error('shadow')}});
    const f=new Intl.DateTimeFormat('en-US',{calendar:'gregory',month:'long',year:'numeric'});
    return [f.format(t),f.formatToParts(t).filter(p=>p.type==='month'||p.type==='year').map(p=>[p.type,p.value])]`))
    .toMatchObject({ok:true,returnValue:["February 2000",[["month","February"],["year","2000"]]]});
});

it("supports year-month ranges and source-labelled parts", async () => {
  expect(await run(`const f=new Intl.DateTimeFormat('en-US',{calendar:'gregory',month:'long',year:'numeric'});
    const a=new Temporal.PlainYearMonth(2000,2,'gregory'),b=new Temporal.PlainYearMonth(2001,2,'gregory');
    const parts=f.formatRangeToParts(a,b);return [parts.map(p=>p.value).join('')===f.formatRange(a,b),parts.filter(p=>p.type==='year').map(p=>[p.value,p.source])]`))
    .toMatchObject({ok:true,returnValue:[true,[["2000","startRange"],["2001","endRange"]]]});
});

it("converts the other range operand before rejecting mixed input kinds", async () => {
  expect(await run(`const events=[];const f=new Intl.DateTimeFormat('en-US');const t=new Temporal.PlainYearMonth(2000,2,'gregory');
    try{f.formatRange(t,{valueOf(){events.push('number');return 0}})}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:["number","TypeError"]});
});

it("rejects mismatched calendars and incompatible components", async () => {
  expect(await run(`const t=new Temporal.PlainYearMonth(2000,2,'gregory');const errors=[];
    for(const options of [{calendar:'buddhist'},{calendar:'gregory',day:'numeric'}])try{new Intl.DateTimeFormat('en-US',options).format(t)}catch(e){errors.push(e.name)}
    return errors`)).toMatchObject({ok:true,returnValue:["RangeError","TypeError"]});
});

it("preserves the captured formatter and year-month data through snapshot replay", async () => {
  const source=`const f=new Intl.DateTimeFormat('en-US',{calendar:'gregory',month:'long',year:'numeric'});
    const format=f.format;const t=new Temporal.PlainYearMonth(2000,2,'gregory');await 0;return [format(t),format===f.format]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["February 2000",true]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
