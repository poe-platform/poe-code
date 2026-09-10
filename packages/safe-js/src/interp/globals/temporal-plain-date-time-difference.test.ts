import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each([
  ["until", "2000-02-28T23:00", "2000-03-01T01:00", "undefined", "P1DT2H"],
  ["since", "2000-02-28T23:00", "2000-03-01T01:00", "undefined", "-P1DT2H"],
  ["until", "2000-01-31T12:00", "2000-02-29T12:00", "{largestUnit:'month'}", "P29D"],
  ["until", "2000-01-31T12:00[u-ca=buddhist]", "2000-02-29T12:00[u-ca=buddhist]", "{largestUnit:'month'}", "P29D"],
  ["until", "2000-01-28T12:00", "2000-02-29T12:00", "{largestUnit:'month'}", "P1M1D"],
  ["until", "2000-01-28T12:00[u-ca=buddhist]", "2000-02-29T12:00[u-ca=buddhist]", "{largestUnit:'month'}", "P1M1D"],
  ["until", "2000-01-01T00:00", "2000-01-01T01:30", "{smallestUnit:'hour',roundingMode:'ceil'}", "PT2H"],
  ["since", "2000-01-01T00:00", "2000-01-01T01:30", "{smallestUnit:'hour',roundingMode:'ceil'}", "-PT1H"],
  ["until", "2000-02-29T23:59:59.999999999", "2000-03-01T00:00", "undefined", "PT0.000000001S"]
])("%s computes %s to %s with %s", async (method, first, second, options, expected) => {
  expect(await run(`return Temporal.PlainDateTime.from(${JSON.stringify(first)}).${method}(${JSON.stringify(second)},${options}).toString()`))
    .toMatchObject({ok:true,returnValue:expected});
});

it.each(["until", "since"])("%s rejects calendar mismatch before options", async method => {
  expect(await run(`const value=new Temporal.PlainDateTime(2000,1,1);if(typeof value.${method}!=='function')throw 'missing';
    const reads=[];try{value.${method}('2000-01-01[u-ca=buddhist]',new Proxy({},{get(t,k){reads.push(k)}}))}
    catch(e){return [e.name,reads]}`)).toMatchObject({ok:true,returnValue:["RangeError",[]]});
});

it("converts the other operand before ordered options and reads options even for equal values", async () => {
  expect(await run(`const reads=[];const other=new Proxy({year:2000,month:1,day:1},{get(t,k){reads.push(k);return t[k]}});
    const options=new Proxy({},{get(t,k){reads.push(k);return t[k]}});
    return [new Temporal.PlainDateTime(2000,1,1).until(other,options).toString(),reads]`))
    .toMatchObject({ok:true,returnValue:["PT0S",["calendar","day","hour","microsecond","millisecond","minute","month","monthCode","nanosecond","second","year",
      "largestUnit","roundingIncrement","roundingMode","smallestUnit"]]});
});

it("uses private operands and intrinsic Duration prototypes through replay", async () => {
  const source=`const first=new Temporal.PlainDateTime(2000,1,1);const second=new Temporal.PlainDateTime(2000,1,2);
    for(const value of [first,second])Object.defineProperty(value,'year',{get(){throw 'public read'}});
    const until=first.until;const since=first.since;const proto=Temporal.Duration.prototype;Temporal.Duration=undefined;
    const result=until.call(first,second);await 0;
    return [until.length,since.length,Object.getPrototypeOf(result)===proto,result.toString(),since.call(first,second).toString()]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:[1,1,true,"P1D","-P1D"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
