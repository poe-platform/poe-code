import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("formats private PlainTime fields without primitive coercion", async () => {
  expect(await run(`const t=new Temporal.PlainTime(12);for(const key of ['hour','valueOf','toString'])Object.defineProperty(t,key,{get(){throw 'read'}});
    const f=new Intl.DateTimeFormat('en-US',{hour:'numeric'});return [f.format(t),f.formatToParts(t).find(p=>p.type==='hour').value]`))
    .toMatchObject({ok:true,returnValue:["12 PM","12"]});
});

it("formats Instant values with the requested time zone", async () => {
  expect(await run(`const f=new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/New_York'});
    return f.format(new Temporal.Instant(0n))`)).toMatchObject({ok:true,returnValue:"7:00 PM"});
});

it("distinguishes implicit defaults from explicit date-only options", async () => {
  expect(await run(`const t=new Temporal.PlainTime(12);let error;
    try{new Intl.DateTimeFormat('en-US',{year:'numeric',month:'numeric',day:'numeric'}).format(t)}catch(e){error=e.name}
    return [new Intl.DateTimeFormat('en-US').format(t),error]`))
    .toMatchObject({ok:true,returnValue:["12:00:00 PM","TypeError"]});
});

it("filters mixed date/time fields for PlainTime but preserves numeric-date formatting", async () => {
  expect(await run(`const f=new Intl.DateTimeFormat('en-US',{year:'numeric',hour:'numeric',timeZone:'UTC'});
    return [f.format(new Temporal.PlainTime(12)),f.formatToParts(0).find(p=>p.type==='year').value]`))
    .toMatchObject({ok:true,returnValue:["12 PM","1970"]});
});

it("supports PlainTime ranges and source-labelled parts", async () => {
  expect(await run(`const f=new Intl.DateTimeFormat('en-US',{hour:'numeric'});const a=new Temporal.PlainTime(12);const b=new Temporal.PlainTime(13);
    const parts=f.formatRangeToParts(a,b);return [parts.map(p=>p.value).join('')===f.formatRange(a,b),
      parts.filter(p=>p.type==='hour').map(p=>[p.value,p.source])]`))
    .toMatchObject({ok:true,returnValue:[true,[["12","startRange"],["1","endRange"]]]});
});

it("preserves operand order for reversed Temporal ranges", async () => {
  expect(await run(`return new Intl.DateTimeFormat('en-US',{hour:'numeric'}).formatRangeToParts(new Temporal.PlainTime(13),new Temporal.PlainTime(12))
    .filter(p=>p.type==='hour').map(p=>[p.value,p.source])`))
    .toMatchObject({ok:true,returnValue:[["1","startRange"],["12","endRange"]]});
});

it("converts both range operands before rejecting mixed kinds", async () => {
  expect(await run(`const events=[];const value={valueOf(){events.push('number');return 0}};const f=new Intl.DateTimeFormat('en-US');
    try{f.formatRange(new Temporal.PlainTime(),value)}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:["number","TypeError"]});
});

it("does not admit proxy-wrapped Temporal private brands", async () => {
  expect(await run(`let error;try{new Intl.DateTimeFormat('en-US').format(new Proxy(new Temporal.PlainTime(),{}))}catch(e){error=e.name}return error`))
    .toMatchObject({ok:true,returnValue:"TypeError"});
});

it("preserves requested defaults and cached format functions through replay", async () => {
  const source=`const implicit=new Intl.DateTimeFormat('en-US');const explicit=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'numeric',day:'numeric'});
    const format=implicit.format;const time=new Temporal.PlainTime(12);await 0;let error;try{explicit.format(time)}catch(e){error=e.name}
    return [format(time),error,format===implicit.format]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["12:00:00 PM","TypeError",true]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
