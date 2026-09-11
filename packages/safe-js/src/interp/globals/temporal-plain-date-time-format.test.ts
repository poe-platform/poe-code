import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each([
  ["{}","2000-02-29T12:34:56.987654321[u-ca=buddhist]"],
  ["{calendarName:'never'}","2000-02-29T12:34:56.987654321"],
  ["{calendarName:'critical',fractionalSecondDigits:3}","2000-02-29T12:34:56.987[!u-ca=buddhist]"],
  ["{smallestUnit:'minutes'}","2000-02-29T12:34[u-ca=buddhist]"]
])("formats ISO fields and calendar annotation with %s", async (options,expected) => {
  expect(await run(`return new Temporal.PlainDateTime(2000,2,29,12,34,56,987,654,321,'buddhist').toString(${options})`))
    .toMatchObject({ok:true,returnValue:expected});
});

it("balances date rollover during string rounding", async () => {
  expect(await run(`return new Temporal.PlainDateTime(2000,2,29,23,59,59,999,999,999).toString({smallestUnit:'second',roundingMode:'ceil'})`))
    .toMatchObject({ok:true,returnValue:"2000-03-01T00:00:00"});
});

it("uses private fields and ignores JSON method arguments", async () => {
  expect(await run(`const t=new Temporal.PlainDateTime(2000,2,29,12);
    Object.defineProperty(t,'year',{get(){throw 'read'}});
    return [t.toJSON(new Proxy({},{get(){throw 'options'}})),JSON.stringify(t),String(t)]`))
    .toMatchObject({ok:true,returnValue:["2000-02-29T12:00:00",'"2000-02-29T12:00:00"',"2000-02-29T12:00:00"]});
});

it("reads formatting options in alphabetical order without enumeration", async () => {
  expect(await run(`const reads=[];const options=new Proxy({calendarName:'always',fractionalSecondDigits:0,roundingMode:'trunc',smallestUnit:'second'},
    {get(t,k){reads.push(k);return t[k]},ownKeys(){throw 'enumeration'}});
    const text=new Temporal.PlainDateTime(2000,1,1).toString(options);return [text,reads]`))
    .toMatchObject({ok:true,returnValue:["2000-01-01T00:00:00[u-ca=iso8601]",["calendarName","fractionalSecondDigits","roundingMode","smallestUnit"]]});
});

it("rejects invalid calendar display before reading later options", async () => {
  expect(await run(`const reads=[];try{new Temporal.PlainDateTime(2000,1,1).toString(new Proxy({},{get(t,k){reads.push(k);return 'invalid'}}))}
    catch(e){return [e.name,reads]}`)).toMatchObject({ok:true,returnValue:["RangeError",["calendarName"]]});
});

it("brands before reading options and rejects rounding beyond the supported range", async () => {
  expect(await run(`const reads=[];const options=new Proxy({},{get(t,k){reads.push(k);return undefined}});
    try{Temporal.PlainDateTime.prototype.toString.call({},options)}catch(e){reads.push(e.name)}
    try{new Temporal.PlainDateTime(275760,9,13,23,59,59,999,999,999).toString({smallestUnit:'second',roundingMode:'ceil'})}
    catch(e){reads.push(e.name)}return reads`)).toMatchObject({ok:true,returnValue:["TypeError","RangeError"]});
});

it("preserves captured formatting method identity and metadata through replay", async () => {
  const source=`const t=new Temporal.PlainDateTime(2000,2,29,12);const f=t.toString;
    const d=Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype,'toString');
    Temporal.PlainDateTime=undefined;await 0;
    return [f.name,f.length,d.writable,d.enumerable,d.configurable,f.call(t)]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["toString",0,true,false,true,"2000-02-29T12:00:00"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
