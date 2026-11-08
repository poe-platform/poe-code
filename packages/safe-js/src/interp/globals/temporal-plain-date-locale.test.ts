import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each(['UTC','Pacific/Honolulu','+05:30'])("formats date fields independently of %s", async zone => {
  expect(await run(`return new Temporal.PlainDate(2000,2,29).toLocaleString('en-US',{
    year:'numeric',month:'2-digit',day:'2-digit',timeZone:${JSON.stringify(zone)}})`))
    .toMatchObject({ok:true,returnValue:'02/29/2000'});
});

it("validates the zone in read order even though date formatting ignores it", async () => {
  expect(await run(`if(!Object.hasOwn(Temporal.PlainDate.prototype,'toLocaleString'))throw 'missing';
    const reads=[];try{new Temporal.PlainDate(2000,1,1).toLocaleString('en',{
      get timeZone(){reads.push('zone');return 'Not/AZone'},get year(){reads.push('year')}})}catch(e){return [e.name,reads]}`))
    .toMatchObject({ok:true,returnValue:['RangeError',['zone']]});
});

it("rejects time-only formats and mixed style/component options", async () => {
  expect(await run(`if(!Object.hasOwn(Temporal.PlainDate.prototype,'toLocaleString'))throw 'missing';
    const date=new Temporal.PlainDate(2000,1,1);const errors=[];
    for(const options of [{hour:'numeric'},{timeStyle:'short'},{dateStyle:'short',year:'numeric'}])
      try{date.toLocaleString('en',options)}catch(e){errors.push(e.name)}return errors`))
    .toMatchObject({ok:true,returnValue:['TypeError','TypeError','TypeError']});
});

it("requires a matching non-ISO calendar and formats owned calendar fields", async () => {
  expect(await run(`if(!Object.hasOwn(Temporal.PlainDate.prototype,'toLocaleString'))throw 'missing';
    const date=new Temporal.PlainDate(2000,2,29,'buddhist');let error;
    try{date.toLocaleString('en-US',{calendar:'gregory'})}catch(e){error=e.name}
    return [date.toLocaleString('en-US',{calendar:'buddhist',year:'numeric'}),error]`))
    .toMatchObject({ok:true,returnValue:['2543 BE','RangeError']});
});

it("brands receivers before locale reads and preserves captured methods through replay", async () => {
  const source=`const date=new Temporal.PlainDate(2000,2,29);const method=date.toLocaleString;
    if(!Object.hasOwn(Temporal.PlainDate.prototype,'toLocaleString'))throw 'missing';
    Object.defineProperty(date,'year',{get(){throw 'public read'}});let error;
    try{method.call({},new Proxy([],{get(){throw 'locale read'}}))}catch(e){error=e.name}
    Temporal.PlainDate=undefined;await 0;
    return [method.name,method.length,error,method.call(date,'en-US',{year:'numeric',calendar:'buddhist'})]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:['toLocaleString',0,'TypeError','2543 BE']});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
