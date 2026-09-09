import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { declareHostOperation } from "./host-bridge.js";

it.each([
  {rejects:false,beforeAwait:false},{rejects:true,beforeAwait:false},
  {rejects:false,beforeAwait:true},{rejects:true,beforeAwait:true}
])("preserves shared write visibility around an async host outcome %j", async ({rejects,beforeAwait}) => {
  const source=`const b=new SharedArrayBuffer(4);const a=new Uint8Array(b);
    const pending=mutate(b);const before=a[0];let result;
    try{result=await pending}catch(error){result=error.message}
    return [before,a[0],result]`;
  let calls=0;
  const bindings={mutate:async(buffer:SharedArrayBuffer)=>{
    calls++;
    if (beforeAwait) new Uint8Array(buffer)[0]=7;
    await new Promise<void>(resolve=>setImmediate(resolve));
    if (!beforeAwait) new Uint8Array(buffer)[0]=7;
    if (rejects) throw new Error("changed");
    return 17;
  }};
  const expected=[beforeAwait?7:0,7,rejects?"changed":17];
  const result=await run(source,{bindings});
  expect(result).toMatchObject({ok:true,returnValue:expected});
  expect(await run(source,{bindings,snapshot:JSON.parse(await dump(result))}))
    .toMatchObject({ok:true,returnValue:expected});
  expect(calls).toBe(1);
});

it("replays separate invocation and settlement growth", async () => {
  const source=`const b=new SharedArrayBuffer(4,{maxByteLength:16});const a=new Uint8Array(b);
    const pending=mutate(b);const before=[b.byteLength,a[7]];
    await pending;return [before,b.byteLength,a[15]]`;
  const bindings={mutate:async(buffer:SharedArrayBuffer)=>{
    buffer.grow(8);new Uint8Array(buffer)[7]=7;
    await new Promise<void>(resolve=>setImmediate(resolve));
    buffer.grow(16);new Uint8Array(buffer)[15]=9;
  }};
  const result=await run(source,{bindings});
  expect(result).toMatchObject({ok:true,returnValue:[[8,7],16,9]});
  expect(await run(source,{bindings,snapshot:JSON.parse(await dump(result))}))
    .toMatchObject({ok:true,returnValue:[[8,7],16,9]});
});

it("does not apply a pending invocation prefix twice when reissuing a call", async () => {
  let entered!:()=>void;
  const ready=new Promise<void>(resolve=>{entered=resolve;});
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const source=`const b=new SharedArrayBuffer(4);const a=new Uint8Array(b);
    const pending=mutate(b);const before=a[0];await pending;return [before,a[0]]`;
  const pending=run(source,{bindings:{mutate:declareHostOperation(async(buffer:SharedArrayBuffer)=>{
    new Uint8Array(buffer)[0]++;entered();await gate;
  },"re-issue")}});
  const outcome=pending.catch(error=>error);
  try {
    await ready;
    await new Promise<void>(resolve=>setImmediate(resolve));
    const snapshot=JSON.parse(await dump(pending,{mode:"replay"}));
    release();
    expect(await outcome).toMatchObject({ok:true,returnValue:[1,1]});
    expect(await run(source,{snapshot,bindings:{mutate:declareHostOperation(async(buffer:SharedArrayBuffer)=>{
      new Uint8Array(buffer)[0]++;
    },"re-issue")}})).toMatchObject({ok:true,returnValue:[1,1]});
  } finally {release();await outcome;}
});
