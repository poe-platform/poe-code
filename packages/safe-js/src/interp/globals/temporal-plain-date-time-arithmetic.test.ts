import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each([
  ["add","2000-01-31T12:00","{months:1}","2000-02-29T12:00:00"],
  ["subtract","2000-03-31T12:00","'P1M'","2000-02-29T12:00:00"],
  ["add","2000-02-29T23:59:59.999999999","{nanoseconds:1}","2000-03-01T00:00:00"],
  ["subtract","2000-03-01T00:00","{nanoseconds:1}","2000-02-29T23:59:59.999999999"],
  ["add","2000-01-31T23:00","{months:1,hours:2}","2000-03-01T01:00:00"],
  ["add","2000-01-31T12:00[u-ca=buddhist]","{months:1}","2000-02-29T12:00:00[u-ca=buddhist]"],
  ["subtract","2000-01-01T12:00","{days:-1}","2000-01-02T12:00:00"]
])("%s balances %s with %s", async (method,input,duration,expected) => {
  expect(await run(`return Temporal.PlainDateTime.from(${JSON.stringify(input)}).${method}(${duration}).toString()`))
    .toMatchObject({ok:true,returnValue:expected});
});

it("reads duration fields before overflow, without enumerating", async () => {
  expect(await run(`const events=[];const duration=new Proxy({months:1},{ownKeys(){throw 'enumerated'},get(t,k){events.push(k);return t[k]}});
    const result=new Temporal.PlainDateTime(2000,1,31).add(duration,{get overflow(){events.push('overflow');return 'constrain'}});
    return [result.day,events]`)).toMatchObject({ok:true,returnValue:[29,
      ["days","hours","microseconds","milliseconds","minutes","months","nanoseconds","seconds","weeks","years","overflow"]]});
});

it.each(["add","subtract"])("%s rejects invalid duration before options", async method => {
  expect(await run(`const value=new Temporal.PlainDateTime(2000,1,1);if(typeof value.${method}!=='function')throw 'missing';
    const reads=[];try{value.${method}({days:1,hours:-1},{get overflow(){reads.push('overflow')}})}
    catch(e){return [e.name,reads]}`)).toMatchObject({ok:true,returnValue:["RangeError",[]]});
});

it("respects overflow rejection and rejects results outside the representable range", async () => {
  expect(await run(`const errors=[];for(const [value,duration] of [
    [new Temporal.PlainDateTime(2001,1,31),{months:1}],
    [Temporal.PlainDateTime.from('+275760-09-13T23:59:59.999999999'),{nanoseconds:1}]]){
      try{value.add(duration,{overflow:'reject'})}catch(e){errors.push(e.name)}
    }return errors`)).toMatchObject({ok:true,returnValue:["RangeError","RangeError"]});
});

it("uses private receiver and duration fields and preserves intrinsic prototypes through replay", async () => {
  const source=`class Derived extends Temporal.PlainDateTime{};const value=new Derived(2000,1,31);const duration=Temporal.Duration.from({months:1});
    Object.defineProperty(value,'year',{get(){throw 'receiver read'}});Object.defineProperty(duration,'months',{get(){throw 'duration read'}});
    const proto=Temporal.PlainDateTime.prototype;const add=value.add;const subtract=value.subtract;
    Temporal.PlainDateTime=undefined;const result=add.call(value,duration);await 0;
    return [add.length,subtract.length,Object.getPrototypeOf(result)===proto,result.toString(),subtract.call(result,{days:1}).day]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:[1,1,true,"2000-02-29T00:00:00",28]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
