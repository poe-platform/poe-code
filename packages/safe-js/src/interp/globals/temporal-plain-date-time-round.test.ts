import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each([
  ["'day'", "2000-03-01T00:00:00"], ["'hours'", "2000-03-01T00:00:00"],
  ["'minute'", "2000-03-01T00:00:00"], ["'second'", "2000-03-01T00:00:00"],
  ["'millisecond'", "2000-02-29T23:59:59.988"],
  ["'microsecond'", "2000-02-29T23:59:59.987655"],
  ["'nanosecond'", "2000-02-29T23:59:59.987654999"],
  ["{smallestUnit:'minute',roundingIncrement:15,roundingMode:'floor'}", "2000-02-29T23:45:00"]
])("rounds date-time with %s", async (options,expected) => {
  expect(await run(`return Temporal.PlainDateTime.from('2000-02-29T23:59:59.987654999').round(${options}).toString()`))
    .toMatchObject({ok:true,returnValue:expected});
});

it("preserves calendar and private fields while returning the intrinsic prototype", async () => {
  expect(await run(`class Derived extends Temporal.PlainDateTime{};const value=new Derived(2000,2,29,23,59,0,0,0,0,'buddhist');
    const proto=Temporal.PlainDateTime.prototype;Object.defineProperty(value,'year',{get(){throw 'read'}});
    Temporal.PlainDateTime=undefined;const result=value.round('day');
    return [result.toString(),result.year,result!==value,Object.getPrototypeOf(result)===proto]`))
    .toMatchObject({ok:true,returnValue:["2000-03-01T00:00:00[u-ca=buddhist]",2543,true,true]});
});

it.each(["undefined","null","{}","'month'","{smallestUnit:'day',roundingIncrement:2}","{smallestUnit:'hour',roundingIncrement:24}","{smallestUnit:'minute',roundingIncrement:7}"])("rejects invalid rounding options %s", async options => {
  const error=["undefined","null"].includes(options)?"TypeError":"RangeError";
  expect(await run(`const value=new Temporal.PlainDateTime(2000,1,1);if(typeof value.round!=='function')throw 'missing';
    try{value.round(${options})}catch(e){return e.name}`)).toMatchObject({ok:true,returnValue:error});
});

it("reads and coerces options in order", async () => {
  expect(await run(`const events=[];const options=new Proxy({},{ownKeys(){throw 'enumerated'},get(t,key){events.push(key);
    if(key==='roundingIncrement')return {valueOf(){events.push('number');return 15.9}};
    return {toString(){events.push('string '+key);return key==='roundingMode'?'floor':'minutes'}}}});
    const result=new Temporal.PlainDateTime(2000,1,1,12,40).round(options);return [result.minute,events]`))
    .toMatchObject({ok:true,returnValue:[30,["roundingIncrement","number","roundingMode","string roundingMode","smallestUnit","string smallestUnit"]]});
});

it("rejects range overflow after option reads", async () => {
  expect(await run(`const events=[];const value=Temporal.PlainDateTime.from('+275760-09-13T23:59:59.999999999');
    try{value.round(new Proxy({smallestUnit:'day'},{get(t,k){events.push(k);return t[k]}}))}
    catch(e){return [e.name,events]}`)).toMatchObject({ok:true,returnValue:["RangeError",["roundingIncrement","roundingMode","smallestUnit"]]});
});

it("retains captured rounding and result through replay", async () => {
  const source=`const value=new Temporal.PlainDateTime(2000,1,1);const method=value.round;
    const result=method.call(value,'nanosecond');await 0;return [method.name,method.length,result!==value,result.toString()]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["round",1,true,"2000-01-01T00:00:00"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});

it.each([["ceil",2],["floor",1],["expand",2],["trunc",1],["halfCeil",2],["halfFloor",1],["halfExpand",2],["halfTrunc",1],["halfEven",1]])("rounds noon to a day using %s", async (mode,day) => {
  expect(await run(`return new Temporal.PlainDateTime(2000,1,1,12).round({smallestUnit:'day',roundingMode:'${mode}'}).day`))
    .toMatchObject({ok:true,returnValue:day});
});

it("brands before options and validates increments before reading the mode", async () => {
  expect(await run(`const events=[];const options=new Proxy({},{get(t,key){events.push(key);return 0}});
    try{Temporal.PlainDateTime.prototype.round.call({},options)}catch(e){events.push(e.name)}
    try{new Temporal.PlainDateTime(2000,1,1).round(options)}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:["TypeError","roundingIncrement","RangeError"]});
});
