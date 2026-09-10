import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("creates a PlainTime from private slots without public getter reads", async () => {
  expect(await run(`const t=new Temporal.PlainDateTime(2000,2,29,12,34,56,987,654,321);
    for(const key of ['hour','minute','second','millisecond','microsecond','nanosecond'])
      Object.defineProperty(t,key,{get(){throw 'public getter'}});
    const result=t.toPlainTime();return [result.toString(),result instanceof Temporal.PlainTime]`))
    .toMatchObject({ok:true,returnValue:["12:34:56.987654321",true]});
});

it.each([
  ["undefined","2000-02-29T00:00:00[u-ca=buddhist]"],
  ["'23:59:59.123456789'","2000-02-29T23:59:59.123456789[u-ca=buddhist]"],
  ["{hour:7}","2000-02-29T07:00:00[u-ca=buddhist]"],
  ["new Temporal.PlainTime(8,9)","2000-02-29T08:09:00[u-ca=buddhist]"]
])("replaces only the time using %s", async (input,expected) => {
  expect(await run(`const t=new Temporal.PlainDateTime(2000,2,29,12,34,56,987,654,321,'buddhist');
    const result=t.withPlainTime(${input});return [result.toString(),result===t,t.hour,result instanceof Temporal.PlainDateTime]`))
    .toMatchObject({ok:true,returnValue:[expected,false,12,true]});
});

it("returns intrinsic prototypes rather than subclass or overwritten constructors", async () => {
  expect(await run(`class Derived extends Temporal.PlainDateTime{};const t=new Derived(2000,1,1,12);
    const datePrototype=Temporal.PlainDateTime.prototype;const timePrototype=Temporal.PlainTime.prototype;
    Temporal.PlainDateTime=function(){};Temporal.PlainTime=function(){};
    return [Object.getPrototypeOf(t.withPlainTime())===datePrototype,Object.getPrototypeOf(t.toPlainTime())===timePrototype]`))
    .toMatchObject({ok:true,returnValue:[true,true]});
});

it("checks the receiver before converting the replacement time", async () => {
  expect(await run(`let reads=0;try{Temporal.PlainDateTime.prototype.withPlainTime.call({},new Proxy({},{get(){reads++;throw 'get'}}))}
    catch(e){return [e.name,reads]}`)).toMatchObject({ok:true,returnValue:["TypeError",0]});
});

it("replays captured conversions with both private result brands intact", async () => {
  const source=`const t=new Temporal.PlainDateTime(2000,2,29,12,34,56,987,654,321);
    const date=t.withPlainTime('01:02:03.000000004');const time=t.toPlainTime();await 0;
    return [date.toString(),time.toString(),date.nanosecond,time.nanosecond]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["2000-02-29T01:02:03.000000004","12:34:56.987654321",4,321]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
