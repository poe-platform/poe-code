import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("formats private PlainDateTime fields and agrees with the locale method", async () => {
  expect(await run(`const value=new Temporal.PlainDateTime(2000,2,29,13,45,6);
    for(const key of ['year','valueOf','toString'])Object.defineProperty(value,key,{get(){throw 'public read'}});
    const options={year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Pacific/Honolulu'};
    const formatter=new Intl.DateTimeFormat('en-US',options);const parts=formatter.formatToParts(value);
    return [formatter.format(value),formatter.format(value)===value.toLocaleString('en-US',options),parts.find(p=>p.type==='hour').value]`))
    .toMatchObject({ok:true,returnValue:["02/29/2000, 13:45",true,"13"]});
});

it("preserves requested default components through cached formatter replay", async () => {
  const source=`const formatter=new Intl.DateTimeFormat('en-US');const format=formatter.format;
    const value=new Temporal.PlainDateTime(2000,2,29,13,45,6);await 0;
    return [format(value)===value.toLocaleString('en-US'),formatter.formatToParts(value).some(p=>p.type==='second'),format===formatter.format]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:[true,true,true]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});

it("formats matching date-time ranges with source-labelled parts", async () => {
  expect(await run(`const formatter=new Intl.DateTimeFormat('en-US',{hour:'numeric'});
    const a=new Temporal.PlainDateTime(2000,1,1,12);const b=new Temporal.PlainDateTime(2000,1,1,13);
    const parts=formatter.formatRangeToParts(a,b);return [parts.map(p=>p.value).join('')===formatter.formatRange(a,b),
      parts.filter(p=>p.type==='hour').map(p=>[p.value,p.source])]`))
    .toMatchObject({ok:true,returnValue:[true,[["12","startRange"],["1","endRange"]]]});
});

it("converts a numeric range operand before rejecting mixed kinds", async () => {
  expect(await run(`const events=[];const value={valueOf(){events.push('number');return 0}};
    try{new Intl.DateTimeFormat('en-US').formatRange(new Temporal.PlainDateTime(2000,1,1),value)}catch(e){events.push(e.name)}
    return events`)).toMatchObject({ok:true,returnValue:["number","TypeError"]});
});
