import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each(["until","since"])("returns an exact signed Duration with %s", async method => {
  const sign=method==='until'?1:-1;
  expect(await run(`const d=Temporal.PlainTime.from('01:02:03.004005006').${method}('03:04:05.006007008');
    return [d instanceof Temporal.Duration,d.hours,d.minutes,d.seconds,d.milliseconds,d.microseconds,d.nanoseconds]`))
    .toMatchObject({ok:true,returnValue:[true,...[2,2,2,2,2,2].map(n=>n*sign)]});
});

it("does not interpret earlier clock times as the next day", async () => {
  expect(await run(`return new Temporal.PlainTime(23).until('01:00').toJSON()`))
    .toMatchObject({ok:true,returnValue:"-PT22H"});
});

it("balances requested units and preserves one-nanosecond differences", async () => {
  expect(await run(`const time=new Temporal.PlainTime();return [time.until('01:02',{largestUnit:'minutes'}).minutes,
    time.until('23:59:59.999999999',{largestUnit:'nanosecond'}).nanoseconds,
    Temporal.PlainTime.from('23:59:59.999999998').until('23:59:59.999999999').nanoseconds]`))
    .toMatchObject({ok:true,returnValue:[62,86399999999999,1]});
});

it.each([["ceil",2,-1],["floor",1,-2],["expand",2,-2],["trunc",1,-1],["halfCeil",2,-1],["halfFloor",1,-2],["halfExpand",2,-2],["halfTrunc",1,-1],["halfEven",2,-2]])("rounds signed differences using %s", async (mode, until, since) => {
  expect(await run(`const time=new Temporal.PlainTime();const options={smallestUnit:'hour',roundingMode:'${mode}'};
    return [time.until('01:30',options).hours,time.since('01:30',options).hours]`))
    .toMatchObject({ok:true,returnValue:[until,since]});
});

it("converts other before reading options, with ordered immediate coercion", async () => {
  expect(await run(`const events=[];const other={get hour(){events.push('other');return 2}};
    const values={largestUnit:'hours',roundingIncrement:1,roundingMode:'trunc',smallestUnit:'seconds'};
    const options=new Proxy({},{ownKeys(){throw 'enumerated'},get(t,k){events.push(k);return k==='roundingIncrement'?{valueOf(){events.push('number');return 1}}:{toString(){events.push('string '+k);return values[k]}}}});
    new Temporal.PlainTime().until(other,options);return events`))
    .toMatchObject({ok:true,returnValue:["other","largestUnit","string largestUnit","roundingIncrement","number","roundingMode","string roundingMode","smallestUnit","string smallestUnit"]});
});

it.each(["{largestUnit:'day'}","{smallestUnit:'auto'}","{smallestUnit:'minute',largestUnit:'second'}","{smallestUnit:'minute',roundingIncrement:7}","{smallestUnit:'second',roundingIncrement:60}","{roundingMode:'bad'}"])("rejects invalid difference settings %s", async options => {
  expect(await run(`let error;try{new Temporal.PlainTime().until('01:00',${options})}catch(e){error=e.name}return error`))
    .toMatchObject({ok:true,returnValue:"RangeError"});
});

it("brands before other and rejects invalid other before options", async () => {
  expect(await run(`const events=[];const input=new Proxy({},{get(){events.push('read');return 1}});
    try{Temporal.PlainTime.prototype.until.call({},input,input)}catch(e){events.push(e.name)}
    try{new Temporal.PlainTime().since('bad',input)}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:["TypeError","RangeError"]});
});

it("retains Duration's original prototype and captured methods through replay", async () => {
  const source=`const time=new Temporal.PlainTime(1);const other=new Temporal.PlainTime(2);const proto=Temporal.Duration.prototype;
    Object.defineProperty(time,'hour',{get(){throw 'read'}});Object.defineProperty(other,'hour',{get(){throw 'read'}});
    const method=Temporal.PlainTime.prototype.until;Temporal.Duration=function(){};const result=method.call(time,other);await 0;
    return [method.name,method.length,result.hours,Object.getPrototypeOf(result)===proto]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["until",1,1,true]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
