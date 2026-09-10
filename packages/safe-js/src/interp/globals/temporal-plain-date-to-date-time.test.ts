import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("combines a private date with midnight or an explicit time", async () => {
  expect(await run(`const date=new Temporal.PlainDate(2000,2,29,'buddhist');
    Object.defineProperty(date,'year',{get(){throw 'public read'}});
    return [date.toPlainDateTime().toString(),date.toPlainDateTime('12:34:56.123456789').toString(),
      date.toPlainDateTime({hour:25,minute:61}).toString()]`))
    .toMatchObject({ok:true,returnValue:['2000-02-29T00:00:00[u-ca=buddhist]','2000-02-29T12:34:56.123456789[u-ca=buddhist]','2000-02-29T23:59:00[u-ca=buddhist]']});
});

it("takes owned time and date-time inputs through private slots", async () => {
  expect(await run(`const date=new Temporal.PlainDate(2000,2,29);const values=[new Temporal.PlainTime(1,2,3),new Temporal.PlainDateTime(1999,1,1,4,5,6)];
    for(const value of values)Object.defineProperty(value,'hour',{get(){throw 'public read'}});
    return values.map(value=>date.toPlainDateTime(value).toString())`))
    .toMatchObject({ok:true,returnValue:['2000-02-29T01:02:03','2000-02-29T04:05:06']});
});

it("brands the date receiver before time conversion and rejects invalid inputs", async () => {
  expect(await run(`const method=Temporal.PlainDate.prototype.toPlainDateTime;if(typeof method!=='function')throw 'missing conversion';
    const events=[];try{method.call({},new Proxy({},{get(){events.push('read')}}))}catch(e){events.push(e.name)}
    for(const value of [null,{},'25:00'])try{new Temporal.PlainDate(2000,1,1).toPlainDateTime(value)}catch(e){events.push(e.name)}
    return events`)).toMatchObject({ok:true,returnValue:['TypeError','TypeError','TypeError','RangeError']});
});

it("checks date-time limits after reading the time, including the earliest date", async () => {
  expect(await run(`const date=new Temporal.PlainDate(-271821,4,19);let error;
    try{date.toPlainDateTime()}catch(e){error=e.name}
    return [error,date.toPlainDateTime({nanosecond:1}).toString(),new Temporal.PlainDate(275760,9,13).toPlainDateTime('23:59:59.999999999').toString()]`))
    .toMatchObject({ok:true,returnValue:['RangeError','-271821-04-19T00:00:00.000000001','+275760-09-13T23:59:59.999999999']});
});

it("captures the date-time prototype for subclasses, namespace changes and replay", async () => {
  const source=`class Derived extends Temporal.PlainDate{};const date=new Derived(2000,1,1);const method=date.toPlainDateTime;
    const proto=Temporal.PlainDateTime.prototype;Temporal.PlainDateTime=undefined;Temporal.PlainDate=undefined;
    const first=method.call(date);const second=method.call(date);await 0;
    return [method.name,method.length,first.toString(),first!==second,Object.getPrototypeOf(first)===proto,first instanceof Derived,first.toPlainDate().toString()]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:['toPlainDateTime',0,'2000-01-01T00:00:00',true,true,false,'2000-01-01']});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
