import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each(["buddhist", "2000-01-01[u-ca=buddhist]"])("changes calendar while preserving the ISO date: %s", async calendar => {
  expect(await run(`const value=new Temporal.PlainDate(2000,2,29);
    const result=value.withCalendar(${JSON.stringify(calendar)});
    return [result.toString(),result.year,value.calendarId,result!==value]`))
    .toMatchObject({ok:true,returnValue:["2000-02-29[u-ca=buddhist]",2543,"iso8601",true]});
});

it("uses private receiver and calendar slots and returns the intrinsic prototype", async () => {
  expect(await run(`class Derived extends Temporal.PlainDate {}
    const value=new Derived(2000,2,29);
    const calendars=[new Temporal.PlainDate(1999,1,1,'buddhist'),new Temporal.PlainDateTime(1999,1,1,0,0,0,0,0,0,'buddhist')];
    for(const object of [value,...calendars])for(const key of ['calendarId','year','constructor','toString'])
      Object.defineProperty(object,key,{get(){throw 'public read'}});
    return calendars.map(calendar=>{const result=value.withCalendar(calendar);
      return [result.year,result.day,Object.getPrototypeOf(result)===Temporal.PlainDate.prototype,result instanceof Derived]})`))
    .toMatchObject({ok:true,returnValue:[[2543,29,true,false],[2543,29,true,false]]});
});

it("rejects invalid receivers and object calendars without coercion", async () => {
  expect(await run(`const method=Temporal.PlainDate.prototype.withCalendar;
    if(typeof method!=='function')throw 'missing method';
    const reads=[];const input=new Proxy({},{get(){reads.push('get');throw 'coercion'}});
    const errors=[];for(const receiver of [{},new Temporal.PlainDate(2000,1,1)]){
      try{method.call(receiver,input)}catch(error){errors.push(error.name)}
    }
    return [errors,reads]`)).toMatchObject({ok:true,returnValue:[["TypeError","TypeError"],[]]});
});

it("preserves captured methods and fresh results through replay", async () => {
  const source=`const value=new Temporal.PlainDate(2000,1,1);const method=value.withCalendar;
    const result=method.call(value,'iso8601');Temporal.PlainDate=undefined;await 0;
    return [method.name,method.length,result!==value,result.toString()]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["withCalendar",1,true,"2000-01-01"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
