import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each(["PlainDate", "PlainDateTime"])("%s.from uses zoned private local fields and calendar", async type => {
  expect(await run(`const input=new Temporal.ZonedDateTime(123456789n,'-08:00','buddhist');
    for(const key of ['calendar','calendarId','year','month','monthCode','day','hour','minute','second','millisecond','microsecond','nanosecond'])
      Object.defineProperty(input,key,{get(){throw 'public read'}});
    const result=Temporal.${type}.from(input);return [result.toString(),result.year];`))
    .toMatchObject({ok:true,returnValue:[type === "PlainDate" ? "1969-12-31[u-ca=buddhist]" : "1969-12-31T16:00:00.123456789[u-ca=buddhist]",2512]});
});

it.each(["PlainDate", "PlainDateTime"])("%s validates overflow for zoned input and returns a fresh intrinsic", async type => {
  expect(await run(`const input=new Temporal.ZonedDateTime(0n,'UTC');const log=[];
    const options={get overflow(){log.push('get');return {toString(){log.push('coerce');return 'reject'}}}};
    const result=Temporal.${type}.from(input,options);let error;
    try{Temporal.${type}.from(input,{overflow:'invalid'})}catch(e){error=e.name}
    return [log,error,Object.getPrototypeOf(result)===Temporal.${type}.prototype,result!==input];`))
    .toMatchObject({ok:true,returnValue:[["get","coerce"],"RangeError",true,true]});
});

it.each(["PlainDate", "PlainDateTime"])("%s.with rejects zoned partial inputs before public reads", async type => {
  expect(await run(`const input=new Temporal.ZonedDateTime(0n,'UTC'),reads=[];
    Object.defineProperty(input,'calendar',{get(){reads.push('calendar');throw 'read'}});let error;
    try{new Temporal.${type}(2000,1,1).with(input)}catch(e){error=e.name}return [error,reads];`))
    .toMatchObject({ok:true,returnValue:["TypeError",[]]});
});
