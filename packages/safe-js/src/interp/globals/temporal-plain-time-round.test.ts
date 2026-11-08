import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each([
  ["'hour'", "13:00:00"], ["'minutes'", "12:35:00"],
  ["{smallestUnit:'minute',roundingIncrement:15}", "12:30:00"],
  ["{smallestUnit:'second',roundingIncrement:10.9}", "12:35:00"],
  ["'millisecond'", "12:34:56.988"], ["'microsecond'", "12:34:56.987655"],
  ["'nanosecond'", "12:34:56.987654999"]
])("rounds with %s", async (options, expected) => {
  expect(await run(`return Temporal.PlainTime.from('12:34:56.987654999').round(${options}).toJSON()`))
    .toMatchObject({ok:true,returnValue:expected});
});

it.each([["ceil",3],["floor",2],["expand",3],["trunc",2],["halfCeil",3],["halfFloor",2],["halfExpand",3],["halfTrunc",2],["halfEven",2]])("rounds ties using %s", async (mode, hour) => {
  expect(await run(`return new Temporal.PlainTime(2,30).round({smallestUnit:'hour',roundingMode:'${mode}'}).hour`))
    .toMatchObject({ok:true,returnValue:hour});
});

it("wraps midnight and returns a fresh original-realm base instance", async () => {
  expect(await run(`class Derived extends Temporal.PlainTime{};const time=new Derived(23,59,59,999,999,999);
    const proto=Temporal.PlainTime.prototype;Object.defineProperty(time,'hour',{get(){throw 'read'}});Temporal.PlainTime=function(){};
    const result=time.round('hour');return [result.toJSON(),result!==time,result instanceof Derived,Object.getPrototypeOf(result)===proto]`))
    .toMatchObject({ok:true,returnValue:["00:00:00",true,false,true]});
});

it("reads and coerces options in order without enumeration", async () => {
  expect(await run(`const events=[];const options=new Proxy({},{ownKeys(){throw 'enumerated'},get(t,key){events.push(key);
    if(key==='roundingIncrement')return {valueOf(){events.push('number');return 15}};
    return {toString(){events.push('string '+key);return key==='roundingMode'?'floor':'minutes'}}}});
    const result=new Temporal.PlainTime(12,40).round(options);return [result.minute,events]`))
    .toMatchObject({ok:true,returnValue:[30,["roundingIncrement","number","roundingMode","string roundingMode","smallestUnit","string smallestUnit"]]});
});

it.each(["undefined","null","1","{}","'day'","'auto'","{smallestUnit:'hour',roundingIncrement:24}","{smallestUnit:'minute',roundingIncrement:7}","{smallestUnit:'second',roundingIncrement:60}","{smallestUnit:'nanosecond',roundingIncrement:1000}","{smallestUnit:'second',roundingIncrement:0}","{smallestUnit:'second',roundingIncrement:Infinity}","{smallestUnit:'second',roundingMode:'bad'}"])("rejects %s", async options => {
  const expected=["undefined","null","1"].includes(options)?"TypeError":"RangeError";
  expect(await run(`let error;try{new Temporal.PlainTime().round(${options})}catch(e){error=e.name}return error`))
    .toMatchObject({ok:true,returnValue:expected});
});

it("brands before options and rejects invalid increments before reading mode", async () => {
  expect(await run(`const events=[];const options=new Proxy({},{get(t,key){events.push(key);return 0}});
    try{Temporal.PlainTime.prototype.round.call({},options)}catch(e){events.push(e.name)}
    try{new Temporal.PlainTime().round(options)}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:["TypeError","roundingIncrement","RangeError"]});
});

it("preserves captured method and result through replay", async () => {
  const source=`const method=Temporal.PlainTime.prototype.round;const d=Object.getOwnPropertyDescriptor(Temporal.PlainTime.prototype,'round');
    const result=method.call(new Temporal.PlainTime(12,45),'hour');await 0;return [method.name,method.length,d.writable,d.enumerable,d.configurable,result.toJSON()]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["round",1,true,false,true,"13:00:00"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
