import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each([
  ["{}", "01:02:03.123456789"],
  ["{fractionalSecondDigits:0}", "01:02:03"],
  ["{fractionalSecondDigits:3.9}", "01:02:03.123"],
  ["{smallestUnit:'minutes'}", "01:02"],
  ["{smallestUnit:'microsecond',fractionalSecondDigits:0}", "01:02:03.123456"]
])("formats with %s", async (options, expected) => {
  expect(await run(`return Temporal.PlainTime.from('01:02:03.123456789').toString(${options})`))
    .toMatchObject({ok:true,returnValue:expected});
});

it.each([
  ["ceil",3],["floor",2],["expand",3],["trunc",2],["halfCeil",3],
  ["halfFloor",2],["halfExpand",3],["halfTrunc",2],["halfEven",2]
])("rounds exact ties with %s", async (mode, second) => {
  expect(await run(`return Temporal.PlainTime.from('00:00:02.5').toString({smallestUnit:'second',roundingMode:'${mode}'})`))
    .toMatchObject({ok:true,returnValue:`00:00:0${second}`});
});

it("wraps rounded midnight and pads fractional precision", async () => {
  expect(await run(`return [Temporal.PlainTime.from('23:59:59.999999999').toString({fractionalSecondDigits:0,roundingMode:'ceil'}),
    new Temporal.PlainTime(1).toString({fractionalSecondDigits:9})]`))
    .toMatchObject({ok:true,returnValue:["00:00:00","01:00:00.000000000"]});
});

it("reads and converts options in order without enumeration", async () => {
  expect(await run(`const events=[];const values={fractionalSecondDigits:'auto',roundingMode:'trunc',smallestUnit:'seconds'};
    const options=new Proxy({},{ownKeys(){throw 'enumeration'},get(t,key){events.push(key);return {toString(){events.push('convert '+key);return values[key]}}}});
    const text=new Temporal.PlainTime(1).toString(options);return [text,events]`))
    .toMatchObject({ok:true,returnValue:["01:00:00",["fractionalSecondDigits","convert fractionalSecondDigits","roundingMode","convert roundingMode","smallestUnit","convert smallestUnit"]]});
});

it.each(["null", "1", "{fractionalSecondDigits:NaN}", "{fractionalSecondDigits:10}", "{fractionalSecondDigits:'3'}", "{roundingMode:'invalid'}", "{smallestUnit:'hour'}", "{smallestUnit:'day'}", "{smallestUnit:'auto'}", "{smallestUnit:Symbol()}"])("rejects invalid options %s", async options => {
  expect(await run(`let error;try{new Temporal.PlainTime().toString(${options})}catch(e){error=e.name}return error`))
    .toMatchObject({ok:true,returnValue:options==='null'||options==='1'||options.includes('Symbol')?"TypeError":"RangeError"});
});

it("brands before options and stops reads after invalid digits", async () => {
  expect(await run(`const events=[];const options=new Proxy({},{get(t,key){events.push(key);return 10}});
    try{Temporal.PlainTime.prototype.toString.call({},options)}catch(e){events.push(e.name)}
    try{new Temporal.PlainTime().toString(options)}catch(e){events.push(e.name)}return events`))
    .toMatchObject({ok:true,returnValue:["TypeError","fractionalSecondDigits","RangeError"]});
});

it("uses private fields and preserves captured method metadata through replay", async () => {
  const source=`const time=new Temporal.PlainTime(1,2,3);Object.defineProperty(time,'hour',{get(){throw 'read'}});
    const method=Temporal.PlainTime.prototype.toString;const d=Object.getOwnPropertyDescriptor(Temporal.PlainTime.prototype,'toString');
    Temporal.PlainTime=function(){};await 0;return [method.name,method.length,d.writable,d.enumerable,d.configurable,method.call(time),String(time)]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["toString",0,true,false,true,"01:02:03","01:02:03"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
