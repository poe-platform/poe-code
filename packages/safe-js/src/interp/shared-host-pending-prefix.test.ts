import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { declareHostOperation } from "./host-bridge.js";

it("restores an invocation prefix while reconciling a pending host side effect", async () => {
  let entered!:()=>void;
  const ready=new Promise<void>(resolve=>{entered=resolve;});
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const source=`const b=new SharedArrayBuffer(4);const a=new Uint8Array(b);
    const pending=mutate(b);const before=a[0];await pending;return [before,a[0]]`;
  const pending=run(source,{bindings:{mutate:declareHostOperation(async(buffer:SharedArrayBuffer)=>{
    new Uint8Array(buffer)[0]++;entered();await gate;return 17;
  },"read-side-effect")}});
  const outcome=pending.catch(error=>error);
  try {
    await ready;
    await new Promise<void>(resolve=>setImmediate(resolve));
    const snapshot=JSON.parse(await dump(pending,{mode:"replay"}));
    release();
    expect(await outcome).toMatchObject({ok:true,returnValue:[1,1]});
    let calls=0;
    expect(await run(source,{snapshot,bindings:{mutate:declareHostOperation(async()=>{
      calls++;throw new Error("Must not repeat side effect");
    },"read-side-effect")},hostCallResumeProvider:async request=>({
      ...request,outcome:{status:"fulfilled",value:17}
    })})).toMatchObject({ok:true,returnValue:[1,1]});
    expect(calls).toBe(0);
  } finally {release();await outcome;}
});
