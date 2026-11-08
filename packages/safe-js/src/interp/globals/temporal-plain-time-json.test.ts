import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it.each(["00:00:00", "01:02:03", "01:02:03.1", "01:02:03.000001", "23:59:59.999999999"])("serializes %s with automatic precision", async text => {
  expect(await run(`const time=Temporal.PlainTime.from(${JSON.stringify(text)});return [time.toJSON(),JSON.stringify({time})]`))
    .toMatchObject({ok:true,returnValue:[text,JSON.stringify({time:text})]});
});

it("uses private fields and ignores arguments and overridden formatting", async () => {
  expect(await run(`class Derived extends Temporal.PlainTime{};const time=new Derived(1,2,3,100);
    for(const key of ['hour','toString','valueOf'])Object.defineProperty(time,key,{get(){throw 'read'}});
    const options=new Proxy({},{get(){throw 'options'}});return time.toJSON(options)`))
    .toMatchObject({ok:true,returnValue:"01:02:03.1"});
});

it("rejects receivers without private time slots without invoking proxy traps", async () => {
  expect(await run(`const method=Temporal.PlainTime.prototype.toJSON;const errors=[];
    const proxy=new Proxy(new Temporal.PlainTime(),{get(){throw 'trap'}});
    for(const receiver of [undefined,null,{},Temporal.PlainTime.prototype,proxy]){
      try{method.call(receiver);errors.push('accepted')}catch(e){errors.push(e.name)}
    }return errors`)).toMatchObject({ok:true,returnValue:Array(5).fill("TypeError")});
});

it("preserves method metadata and captured serialization through replay", async () => {
  const source=`const method=Temporal.PlainTime.prototype.toJSON;
    const descriptor=Object.getOwnPropertyDescriptor(Temporal.PlainTime.prototype,'toJSON');
    const time=new Temporal.PlainTime(12);Temporal.PlainTime=function(){};await 0;
    return [method.name,method.length,descriptor.writable,descriptor.enumerable,descriptor.configurable,method.call(time)]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["toJSON",0,true,false,true,"12:00:00"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
