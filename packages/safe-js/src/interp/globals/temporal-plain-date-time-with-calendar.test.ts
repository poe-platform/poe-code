import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each(["buddhist", "2000-01-01[u-ca=buddhist]"])("changes calendar without changing ISO fields: %s", async calendar => {
  expect(await run(`const value=new Temporal.PlainDateTime(2000,2,29,12,34,56,123,456,789);
    const result=value.withCalendar(${JSON.stringify(calendar)});
    return [result.toString(),result.year,value.calendarId,result!==value]`))
    .toMatchObject({ok:true,returnValue:["2000-02-29T12:34:56.123456789[u-ca=buddhist]",2543,"iso8601",true]});
});

it("reads private calendar and date-time slots, returning the intrinsic prototype", async () => {
  expect(await run(`class Derived extends Temporal.PlainDateTime {}
    const value=new Derived(2000,2,29);const calendar=new Temporal.PlainDateTime(1999,1,1,0,0,0,0,0,0,'buddhist');
    for(const object of [value,calendar])for(const key of ['calendarId','year','constructor','toString'])
      Object.defineProperty(object,key,{get(){throw 'public read'}});
    const result=value.withCalendar(calendar);
    return [result.year,result.day,Object.getPrototypeOf(result)===Temporal.PlainDateTime.prototype]`))
    .toMatchObject({ok:true,returnValue:[2543,29,true]});
});

it("rejects invalid receivers and calendars without coercing objects", async () => {
  expect(await run(`const method=Temporal.PlainDateTime.prototype.withCalendar;
    if(typeof method!=='function')throw 'missing method';
    const reads=[];const input=new Proxy({},{get(){reads.push('get');throw 'coercion'}});
    const errors=[];for(const receiver of [{},new Temporal.PlainDateTime(2000,1,1)]){
      try{method.call(receiver,input)}catch(error){errors.push(error.name)}
    }
    return [errors,reads]`)).toMatchObject({ok:true,returnValue:[["TypeError","TypeError"],[]]});
});

it("preserves captured method and result through replay", async () => {
  const source=`const value=new Temporal.PlainDateTime(2000,1,1);const method=value.withCalendar;
    const result=method.call(value,'iso8601');Temporal.PlainDateTime=undefined;await 0;
    return [method.name,method.length,result!==value,result.toString()]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["withCalendar",1,true,"2000-01-01T00:00:00"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
