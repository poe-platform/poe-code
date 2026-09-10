import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each([
  ["23:59:59.999999999", "add", "{nanoseconds:1}", [0,0,0,0,0,0]],
  ["00:00", "subtract", "{nanoseconds:1}", [23,59,59,999,999,999]],
  ["12:00", "add", "'-PT25H'", [11,0,0,0,0,0]],
  ["12:00", "subtract", "'-PT25H'", [13,0,0,0,0,0]],
  ["12:00", "add", "'P1Y2M3W4DT1H'", [13,0,0,0,0,0]],
  ["12:00", "subtract", "'P1Y2M3W4DT1H'", [11,0,0,0,0,0]]
] as const)("%s %s %s wraps exactly", async (start, method, duration, expected) => {
  expect(await run(`const result=Temporal.PlainTime.from(${JSON.stringify(start)}).${method}(${duration});
    return [result.hour,result.minute,result.second,result.millisecond,result.microsecond,result.nanosecond]`))
    .toMatchObject({ok:true,returnValue:expected});
});

it.each(["add", "subtract"] as const)("%s preserves exact nanoseconds for maximum durations", async method => {
  const day = 86400000000000n;
  const delta = 9007199254740991n * 1000000000n + 999999999n;
  const total = ((43200000000000n + (method === "add" ? delta : -delta)) % day + day) % day;
  const expected = [Number(total / 3600000000000n), Number(total / 60000000000n % 60n),
    Number(total / 1000000000n % 60n), Number(total / 1000000n % 1000n),
    Number(total / 1000n % 1000n), Number(total % 1000n)];
  expect(await run(`const result=new Temporal.PlainTime(12).${method}({seconds:9007199254740991,nanoseconds:999999999});
    return [result.hour,result.minute,result.second,result.millisecond,result.microsecond,result.nanosecond]`))
    .toMatchObject({ok:true,returnValue:expected});
});

it("brands the receiver before converting a duration", async () => {
  expect(await run(`let reads=0;const input={get hours(){reads++;return 1}};const errors=[];
    for(const name of ['add','subtract']){try{Temporal.PlainTime.prototype[name].call({},input)}catch(e){errors.push(e.name)}}return [errors,reads]`))
    .toMatchObject({ok:true,returnValue:[["TypeError","TypeError"],0]});
});

it("uses private receiver and Duration slots rather than overridden public properties", async () => {
  expect(await run(`const time=new Temporal.PlainTime(12);const duration=new Temporal.Duration(0,0,0,0,1);
    Object.defineProperty(time,'hour',{get(){throw 'read hour'}});Object.defineProperty(duration,'hours',{get(){throw 'read hours'}});
    return [time.add(duration).hour,time.subtract(duration).hour]`))
    .toMatchObject({ok:true,returnValue:[13,11]});
});

it("returns fresh base-realm values and ignores a second argument", async () => {
  expect(await run(`class Derived extends Temporal.PlainTime{};const time=new Derived(12);const prototype=Temporal.PlainTime.prototype;
    const options=new Proxy({},{get(){throw 'options'}});Temporal.PlainTime=function(){};
    const result=time.add({hours:0},options);return [result!==time,result.hour,result instanceof Derived,Object.getPrototypeOf(result)===prototype]`))
    .toMatchObject({ok:true,returnValue:[true,12,false,true]});
});

it.each(["{years:1,hours:-1}", "{days:0.5}", "{seconds:9007199254740992}"])("validates the complete duration before discarding date fields: %s", async input => {
  expect(await run(`try{new Temporal.PlainTime().add(${input})}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:"RangeError"});
});

it("registers arithmetic metadata and captured methods for replay", async () => {
  const source=`const add=Temporal.PlainTime.prototype.add;const subtract=Temporal.PlainTime.prototype.subtract;
    const time=new Temporal.PlainTime(12);await 0;return [add.length,subtract.length,add.call(time,'PT1H').hour,subtract.call(time,'PT1H').hour]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:[1,1,13,11]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
