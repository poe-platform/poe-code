import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("converts ISO strings and calendar fields without confusing their years", async () => {
  expect(await run(`return [Temporal.PlainDate.from('2000-02-29T23:59:59[u-ca=buddhist]').toString(),
    Temporal.PlainDate.from({calendar:'buddhist',year:2543,monthCode:'M02',day:29}).toString(),
    Temporal.PlainDate.from({year:2001,month:2,day:31}).toString()]`))
    .toMatchObject({ok:true,returnValue:['2000-02-29[u-ca=buddhist]','2000-02-29[u-ca=buddhist]','2001-02-28']});
});

it("reads only date fields in order, immediately coerces them, then reads overflow", async () => {
  expect(await run(`const events=[];const values={day:29,month:2,year:2000};
    const input=new Proxy(values,{get(t,k){events.push(k);if(k in t)return {valueOf(){events.push('number '+k);return t[k]}}},ownKeys(){throw 'enumerated'}});
    const result=Temporal.PlainDate.from(input,{get overflow(){events.push('overflow');return 'reject'}});
    return [result.toString(),events]`)).toMatchObject({ok:true,returnValue:['2000-02-29',
      ['calendar','day','number day','month','number month','monthCode','year','number year','overflow']]});
});

it("copies owned dates and date-times through private slots but still validates options", async () => {
  expect(await run(`const values=[new Temporal.PlainDate(2000,2,29,'buddhist'),new Temporal.PlainDateTime(2000,2,29,23,0,0,0,0,0,'buddhist')];
    const events=[];return values.map(value=>{
      for(const key of ['calendar','calendarId','year','month','monthCode','day','hour'])Object.defineProperty(value,key,{get(){throw 'public read'}});
      const copy=Temporal.PlainDate.from(value,{get overflow(){events.push('overflow');return 'reject'}});
      return [copy.toString(),copy!==value,events.length]})`))
    .toMatchObject({ok:true,returnValue:[['2000-02-29[u-ca=buddhist]',true,1],['2000-02-29[u-ca=buddhist]',true,2]]});
});

it("validates string grammar before options and representable range after options", async () => {
  expect(await run(`const events=[];for(const input of ['2000-02-30','-000000-01-01','+999999-01-01','-999999-01-01']){
    try{Temporal.PlainDate.from(input,{get overflow(){events.push('overflow');return 'constrain'}})}catch(e){events.push(e.name)}}
    return events`)).toMatchObject({ok:true,returnValue:['RangeError','RangeError','overflow','RangeError','overflow','RangeError']});
});

it("accepts both date endpoints independently of date-time range", async () => {
  expect(await run(`return ['-271821-04-19','+275760-09-13'].map(value=>Temporal.PlainDate.from(value).toString())`))
    .toMatchObject({ok:true,returnValue:['-271821-04-19','+275760-09-13']});
});

it("rejects invalid numeric fields before options and validates month codes", async () => {
  expect(await run(`const events=[];for(const input of [{year:2000,month:0,day:1},{year:2000,monthCode:2,day:1},{year:2000,monthCode:'M00',day:1},{year:Infinity,month:1,day:1}]){
    try{Temporal.PlainDate.from(input,{get overflow(){events.push('overflow');return 'reject'}})}catch(e){events.push(e.name)}}
    return events`)).toMatchObject({ok:true,returnValue:['RangeError','TypeError','RangeError','RangeError']});
});

it("ignores constructor receivers and preserves captured factories through replay", async () => {
  const source=`class Derived extends Temporal.PlainDate{};const from=Derived.from;
    const proto=Temporal.PlainDate.prototype;Temporal.PlainDate=undefined;
    const result=from.call(null,'2000-01-01');await 0;
    return [from.name,from.length,result.toString(),Object.getPrototypeOf(result)===proto,result instanceof Derived]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:['from',1,'2000-01-01',true,false]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
