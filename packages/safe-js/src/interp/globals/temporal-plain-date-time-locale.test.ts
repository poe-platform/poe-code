import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each(["UTC", "Pacific/Honolulu", "+05:30"])("formats wall-clock fields independently of %s", async zone => {
  expect(await run(`return new Temporal.PlainDateTime(2000,2,29,13,45,6).toLocaleString('en-US',{
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:${JSON.stringify(zone)}})`))
    .toMatchObject({ok:true,returnValue:"02/29/2000, 13:45"});
});

it("validates a zone before reading later options", async () => {
  expect(await run(`const value=new Temporal.PlainDateTime(2000,1,1);if(!Object.hasOwn(Temporal.PlainDateTime.prototype,'toLocaleString'))throw 'missing';
    const reads=[];try{value.toLocaleString('en',{get timeZone(){reads.push('zone');return 'Not/AZone'},get year(){reads.push('year')}})}
    catch(e){return [e.name,reads]}`)).toMatchObject({ok:true,returnValue:["RangeError",["zone"]]});
});

it("rejects mixed styles and components", async () => {
  expect(await run(`if(!Object.hasOwn(Temporal.PlainDateTime.prototype,'toLocaleString'))throw 'missing';
    try{new Temporal.PlainDateTime(2000,1,1).toLocaleString('en',{dateStyle:'short',hour:'numeric'})}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:"TypeError"});
});

it("uses private fields and preserves the captured locale method across replay", async () => {
  const source=`const value=new Temporal.PlainDateTime(2000,2,29,13,45);Object.defineProperty(value,'year',{get(){throw 'public'}});
    const method=value.toLocaleString;Temporal.PlainDateTime=undefined;await 0;
    return [method.length,method.call(value,'en-US',{year:'numeric',calendar:'buddhist'})]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:[0,"2543 BE"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
