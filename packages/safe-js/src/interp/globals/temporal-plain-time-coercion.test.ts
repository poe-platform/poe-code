import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("rejects implicit arithmetic without falling through to string conversion", async () => {
  expect(await run(`const time=new Temporal.PlainTime(12);let reads=0;
    time.toString=()=>{reads++;return '12:00'};const errors=[];
    for(const operation of [()=>+time,()=>time+1,()=>time<new Temporal.PlainTime(13),()=>time==12]){
      try{operation();errors.push('accepted')}catch(e){errors.push(e.name)}
    }return [errors,reads]`)).toMatchObject({ok:true,returnValue:[["TypeError","TypeError","TypeError","TypeError"],0]});
});

it("always throws without inspecting even an unbranded or revoked receiver", async () => {
  expect(await run(`const method=Temporal.PlainTime.prototype.valueOf;
    const revoked=Proxy.revocable({},{});revoked.revoke();const errors=[];
    for(const value of [undefined,null,1,{},new Temporal.PlainTime(),revoked.proxy]){
      try{method.call(value);errors.push('accepted')}catch(e){errors.push(e.name)}
    }return errors`)).toMatchObject({ok:true,returnValue:Array(6).fill("TypeError")});
});

it("preserves the own method descriptor and captured identity through replay", async () => {
  const source=`const proto=Temporal.PlainTime.prototype;const method=proto.valueOf;
    const descriptor=Object.getOwnPropertyDescriptor(proto,'valueOf');await 0;
    let error;try{method.call({})}catch(e){error=e.name}
    return [method.name,method.length,descriptor.writable,descriptor.enumerable,descriptor.configurable,error]`;
  const first=await run(source);
  expect(first).toMatchObject({ok:true,returnValue:["valueOf",0,true,false,true,"TypeError"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:first.returnValue});
});
