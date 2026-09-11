import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each(['add','subtract'])("%s constrains calendar overflow and supports explicit rejection", async method => {
  const source = method === 'add' ? '2000-01-31' : '2000-03-31';
  expect(await run(`const date=Temporal.PlainDate.from('${source}');let error;
    try{date.${method}({months:1},{overflow:'reject'})}catch(e){error=e.name}
    return [date.${method}('P1M').toString(),error,date.toString()]`))
    .toMatchObject({ok:true,returnValue:['2000-02-29','RangeError',source]});
});

it("uses whole 24-hour days and truncates sub-day remainders towards zero", async () => {
  expect(await run(`const date=new Temporal.PlainDate(2000,1,2);
    return [date.add('PT23H').toString(),date.subtract('PT23H').toString(),
      date.add('PT47H').toString(),date.subtract('PT47H').toString(),date.add('-PT47H').toString()]`))
    .toMatchObject({ok:true,returnValue:['2000-01-02','2000-01-02','2000-01-03','2000-01-01','2000-01-01']});
});

it("reads duration fields before overflow and rejects invalid durations first", async () => {
  expect(await run(`const events=[];const duration=new Proxy({days:1},{get(t,k){events.push(k);return t[k]}});
    const date=new Temporal.PlainDate(2000,1,1);
    date.add(duration,{get overflow(){events.push('overflow');return 'constrain'}});
    try{date.subtract({days:1,hours:-1},{get overflow(){events.push('unexpected');return 'constrain'}})}catch(e){events.push(e.name)}
    return events`)).toMatchObject({ok:true,returnValue:['days','hours','microseconds','milliseconds','minutes','months','nanoseconds','seconds','weeks','years','overflow','RangeError']});
});

it("uses private date and duration slots and preserves the calendar", async () => {
  expect(await run(`const date=new Temporal.PlainDate(2000,2,29,'buddhist');const duration=new Temporal.Duration(1);
    for(const key of ['year','calendarId','month','day'])Object.defineProperty(date,key,{get(){throw 'date read'}});
    Object.defineProperty(duration,'years',{get(){throw 'duration read'}});
    return [date.add(duration).toString(),date.subtract(duration).toString()]`))
    .toMatchObject({ok:true,returnValue:['2001-02-28[u-ca=buddhist]','1999-02-28[u-ca=buddhist]']});
});

it("brands receivers first and rejects results outside date limits", async () => {
  expect(await run(`const events=[];const method=Temporal.PlainDate.prototype.add;
    if(typeof method!=='function')throw 'missing method';
    try{method.call({},new Proxy({},{get(){events.push('read')}}))}catch(e){events.push(e.name)}
    try{new Temporal.PlainDate(275760,9,13).add({days:1})}catch(e){events.push(e.name)}
    try{new Temporal.PlainDate(-271821,4,19).subtract({days:1})}catch(e){events.push(e.name)}
    return events`)).toMatchObject({ok:true,returnValue:['TypeError','RangeError','RangeError']});
});

it("returns fresh intrinsic dates and replays captured arithmetic methods", async () => {
  const source=`class Derived extends Temporal.PlainDate{};const date=new Derived(2000,1,1);
    const proto=Temporal.PlainDate.prototype;const add=date.add;const subtract=date.subtract;
    Temporal.PlainDate=undefined;const next=add.call(date,{days:0});await 0;
    return [add.name,add.length,subtract.name,subtract.length,next!==date,Object.getPrototypeOf(next)===proto,
      next instanceof Derived,subtract.call(next,'P1D').toString()]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:['add',1,'subtract',1,true,true,false,'1999-12-31']});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
