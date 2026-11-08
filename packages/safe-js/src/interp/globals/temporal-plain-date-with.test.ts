import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("merges date fields, resolving month/monthCode and calendar years", async () => {
  expect(await run(`const date=new Temporal.PlainDate(2000,2,29);const buddhist=date.withCalendar('buddhist');
    return [date.with({year:2001}).toString(),date.with({monthCode:'M03'}).toString(),
      date.with({month:4,year:undefined}).toString(),buddhist.with({year:2544}).toString()]`))
    .toMatchObject({ok:true,returnValue:['2001-02-28','2000-03-29','2000-04-29','2001-02-28[u-ca=buddhist]']});
});

it("reads partial fields in order before options and enforces reject overflow", async () => {
  expect(await run(`const events=[];const partial=new Proxy({year:2001},{get(t,k){events.push(k);return t[k]}});
    try{new Temporal.PlainDate(2000,2,29).with(partial,{get overflow(){events.push('overflow');return 'reject'}})}catch(e){events.push(e.name)}
    return events`)).toMatchObject({ok:true,returnValue:['calendar','timeZone','day','month','monthCode','year','overflow','RangeError']});
});

it.each(['undefined','null',"'2000-01-01'",'{}','{year:undefined}','{calendar:null,year:2000}',"{timeZone:'UTC',year:2000}",
  'new Temporal.PlainDate(2000,1,1)','new Temporal.PlainDateTime(2000,1,1)','new Temporal.PlainTime()'])("rejects invalid partial input %s before options", async input => {
  expect(await run(`let reads=0;let error;try{new Temporal.PlainDate(2000,1,1).with(${input},{get overflow(){reads++;return 'reject'}})}catch(e){error=e.name}
    return [error,reads]`)).toMatchObject({ok:true,returnValue:['TypeError',0]});
});

it("uses private receiver fields and allows Instant/Duration objects with partial fields", async () => {
  expect(await run(`const date=new Temporal.PlainDate(2000,2,29);
    for(const key of ['year','month','day','calendarId'])Object.defineProperty(date,key,{get(){throw 'public read'}});
    const instant=new Temporal.Instant(0n);instant.year=2001;const duration=new Temporal.Duration();duration.month=3;
    return [date.with(instant).toString(),date.with(duration).toString()]`))
    .toMatchObject({ok:true,returnValue:['2001-02-28','2000-03-29']});
});

it("rejects branded partials and invalid receivers without property reads", async () => {
  expect(await run(`const method=Temporal.PlainDate.prototype.with;if(typeof method!=='function')throw 'missing with';
    const date=new Temporal.PlainDate(2000,1,1);const events=[];
    Object.defineProperty(date,'calendar',{get(){events.push('calendar')}});
    try{method.call(date,date)}catch(e){events.push(e.name)}
    try{method.call({},new Proxy({},{get(){events.push('read')}}))}catch(e){events.push(e.name)}
    return events`)).toMatchObject({ok:true,returnValue:['TypeError','TypeError']});
});

it("returns fresh intrinsic results and replays captured replacement", async () => {
  const source=`class Derived extends Temporal.PlainDate{};const date=new Derived(2000,1,1);const method=date.with;
    const proto=Temporal.PlainDate.prototype;Temporal.PlainDate=undefined;const result=method.call(date,{day:1});await 0;
    return [method.name,method.length,result.toString(),result!==date,Object.getPrototypeOf(result)===proto,result instanceof Derived]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:['with',1,'2000-01-01',true,true,false]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
