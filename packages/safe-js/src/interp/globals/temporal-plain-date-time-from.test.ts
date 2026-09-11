import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  ["'2000-02-29T12:34:56.123456789'","2000-02-29T12:34:56.123456789"],
  ["'2000-02-29'","2000-02-29T00:00:00"],
  ["{year:2000,monthCode:'M02',day:29,hour:12}","2000-02-29T12:00:00"],
  ["{calendar:'buddhist',year:2543,month:2,day:29}","2000-02-29T00:00:00[u-ca=buddhist]"],
  ["{year:2001,month:2,day:31,hour:25}","2001-02-28T23:00:00"]
])("constructs from %s", async (input,expected) => {
  expect(await run(`return Temporal.PlainDateTime.from(${input}).toString()`))
    .toMatchObject({ok:true,returnValue:expected});
});

it("clones private slots without public reads and validates overflow", async () => {
  expect(await run(`const input=new Temporal.PlainDateTime(2000,2,29,12);
    Object.defineProperty(input,'year',{get(){throw 'public getter'}});
    const reads=[];const result=Temporal.PlainDateTime.from(input,{get overflow(){reads.push('overflow');return 'reject'}});
    return [result!==input,result.toString(),reads]`))
    .toMatchObject({ok:true,returnValue:[true,"2000-02-29T12:00:00",["overflow"]]});
});

it("reads calendar then ordered fields then overflow without enumeration", async () => {
  expect(await run(`const reads=[];const input=new Proxy({year:2000,month:2,day:29},
    {get(t,k){reads.push(k);return t[k]},ownKeys(){throw 'enumeration'}});
    Temporal.PlainDateTime.from(input,{get overflow(){reads.push('overflow');return 'constrain'}});return reads`))
    .toMatchObject({ok:true,returnValue:["calendar","day","hour","microsecond","millisecond","minute","month","monthCode","nanosecond","second","year","overflow"]});
});

it("reads options before rejecting an otherwise valid out-of-range string", async () => {
  expect(await run(`const reads=[];try{Temporal.PlainDateTime.from('+999999-01-01T00:00',
    {get overflow(){reads.push('overflow');throw 'option failure'}})}catch(error){return [error,reads]}`))
    .toMatchObject({ok:true,returnValue:["option failure",["overflow"]]});
});

it.each(["invalid","2000-02-30","-000000-01-01","2000-01-01T00:00Z"])("rejects invalid string %s before options", async input => {
  expect(await run(`const reads=[];try{Temporal.PlainDateTime.from(${JSON.stringify(input)},
    {get overflow(){reads.push('overflow');return 'constrain'}})}catch(error){return [error.name,reads]}`))
    .toMatchObject({ok:true,returnValue:["RangeError",[]]});
});

it.each([
  ["+999996-02-29T00:00",["overflow","RangeError"]],
  ["+999999-02-29T00:00",["RangeError"]],
  ["-999996-02-29T00:00",["overflow","RangeError"]],
  ["-271821-04-19T00:00",["overflow","RangeError"]],
  ["+275760-09-14T00:00",["overflow","RangeError"]],
  ["+999996-02-29T00:00[u-ca=invalid]",["RangeError"]]
])("separates grammar, calendar and range validation for %s", async (input,expected) => {
  expect(await run(`const reads=[];try{Temporal.PlainDateTime.from(${JSON.stringify(input)},
    {get overflow(){reads.push('overflow');return 'constrain'}})}catch(error){reads.push(error.name)}return reads`))
    .toMatchObject({ok:true,returnValue:expected});
});

it.each(["-000004-02-29T12:00:00","+000000-02-29T00:00:00","-271821-04-19T00:00:00.000000001","+275760-09-13T23:59:59.999999999"])("preserves original expanded-year input %s", async input => {
  expect(await run(`const value=Temporal.PlainDateTime.from(${JSON.stringify(input)});return value.toString()`))
    .toMatchObject({ok:true,returnValue:input==="+000000-02-29T00:00:00" ? "0000-02-29T00:00:00" : input});
});
