import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("formats private date fields and agrees with the locale method", async () => {
  expect(await run(`const value=new Temporal.PlainDate(2000,2,29);
    for(const key of ['year','valueOf','toString'])Object.defineProperty(value,key,{get(){throw 'public read'}});
    const options={year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Pacific/Honolulu'};
    const formatter=new Intl.DateTimeFormat('en-US',options);const parts=formatter.formatToParts(value);
    return [formatter.format(value),formatter.format(value)===value.toLocaleString('en-US',options),parts.find(p=>p.type==='day').value]`))
    .toMatchObject({ok:true,returnValue:['02/29/2000',true,'29']});
});

it("preserves requested default components and bound format through replay", async () => {
  const source=`const formatter=new Intl.DateTimeFormat('en-US');const format=formatter.format;
    const value=new Temporal.PlainDate(2000,2,29);await 0;
    return [format(value)===value.toLocaleString('en-US'),formatter.formatToParts(value).some(p=>p.type==='day'),format===formatter.format]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:[true,true,true]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});

it("formats date ranges with source-labelled parts", async () => {
  expect(await run(`const formatter=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric'});
    const a=new Temporal.PlainDate(2000,1,1);const b=new Temporal.PlainDate(2000,1,3);
    const parts=formatter.formatRangeToParts(a,b);return [parts.map(p=>p.value).join('')===formatter.formatRange(a,b),
      parts.filter(p=>p.type==='day').map(p=>[p.value,p.source])]`))
    .toMatchObject({ok:true,returnValue:[true,[['1','startRange'],['3','endRange']]]});
});

it("rejects mixed Temporal kinds and still converts numeric range operands", async () => {
  expect(await run(`const events=[];const date=new Temporal.PlainDate(2000,1,1);const formatter=new Intl.DateTimeFormat('en-US');
    try{formatter.formatRange(date,{valueOf(){events.push('number');return 0}})}catch(e){events.push(e.name)}
    try{formatter.formatRange(date,new Temporal.PlainDateTime(2000,1,1))}catch(e){events.push(e.name)}
    return events`)).toMatchObject({ok:true,returnValue:['number','TypeError','TypeError']});
});

it("enforces calendar compatibility and rejects time-only formats", async () => {
  expect(await run(`const date=new Temporal.PlainDate(2000,2,29,'buddhist');const errors=[];
    for(const options of [{calendar:'gregory'},{calendar:'buddhist',hour:'numeric'}])
      try{new Intl.DateTimeFormat('en-US',options).format(date)}catch(e){errors.push(e.name)}
    return [new Intl.DateTimeFormat('en-US',{calendar:'buddhist',year:'numeric'}).format(date),errors]`))
    .toMatchObject({ok:true,returnValue:['2543 BE',['RangeError','TypeError']]});
});
