import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("formats the private zone with explicit locale components", async () => {
  expect(await run(`return new Temporal.ZonedDateTime(0n,'America/New_York').toLocaleString('en-US',
    {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});`))
    .toMatchObject({ok:true,returnValue:"12/31/1969, 19:00"});
});

it("rejects every explicit timeZone before coercion or later option reads", async () => {
  expect(await run(`const a=new Temporal.ZonedDateTime(0n,'UTC'),log=[],errors=[];
    if(!Object.hasOwn(Temporal.ZonedDateTime.prototype,'toLocaleString'))throw 'missing';
    for(const timeZone of ['UTC',null,{toString(){log.push('coerce');return 'UTC'}}]){
      try{a.toLocaleString('en',{timeZone,get weekday(){log.push('weekday')}})}catch(e){errors.push(e.name)}}
    return [errors,log];`)).toMatchObject({ok:true,returnValue:[["TypeError","TypeError","TypeError"],[]]});
});

it("requires the resolved calendar to match non-ISO receivers", async () => {
  expect(await run(`const a=new Temporal.ZonedDateTime(0n,'UTC','buddhist');let error;
    try{a.toLocaleString('en-US')}catch(e){error=e.name}
    return [error,a.toLocaleString('en-US',{calendar:'buddhist',year:'numeric'})];`))
    .toMatchObject({ok:true,returnValue:["RangeError","2513 BE"]});
});

it("brands before locale reads and retains method identity across replay", async () => {
  const source=`const a=new Temporal.ZonedDateTime(0n,'UTC'),method=a.toLocaleString,log=[];let error;
    try{method.call({},new Proxy([],{get(){log.push('locale');throw 'read'}}))}catch(e){error=e.name}
    for(const key of ['epochNanoseconds','timeZoneId','calendarId'])Object.defineProperty(a,key,{get(){throw 'shadow'}});
    Temporal.ZonedDateTime=undefined;await 0;
    return [method.name,method.length,error,log,method.call(a,'en-US',{year:'numeric'})];`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["toLocaleString",0,"TypeError",[],"1970"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
