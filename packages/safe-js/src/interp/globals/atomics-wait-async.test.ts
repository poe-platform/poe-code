import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";

it("settles a finite atomic timeout and removes its waiter", async () => {
  const source=`const a=new Int32Array(new SharedArrayBuffer(4));
    const waiter=Atomics.waitAsync(a,0,0,1);
    return [waiter.async,await waiter.value,Atomics.notify(a,0)]`;
  const expected=[true,"timed-out",0];
  expect(await runInNewContext(`(async()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});

it("notifies queued atomic waiters in registration order", async () => {
  const source=`const a=new Int32Array(new SharedArrayBuffer(4));
    const events=[];
    const first=Atomics.waitAsync(a,0,0).value.then(v=>events.push("first:"+v));
    const second=Atomics.waitAsync(a,0,0).value.then(v=>events.push("second:"+v));
    const counts=[Atomics.notify(a,0,1)];
    await first;counts.push(Atomics.notify(a,0,1));await second;
    counts.push(Atomics.notify(a,0));return [events,counts]`;
  const expected=[["first:ok","second:ok"],[1,1,0]];
  expect(await runInNewContext(`(async()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});

it("keeps wait queues separate by byte location", async () => {
  const source=`const b=new SharedArrayBuffer(8);const a=new Int32Array(b);
    const alias=new Int32Array(b,4);const first=Atomics.waitAsync(a,0,0);
    const second=Atomics.waitAsync(a,1,0);const counts=[Atomics.notify(alias,0)];
    const values=[await second.value];counts.push(Atomics.notify(a,0));
    values.push(await first.value);return [counts,values]`;
  const expected=[[1,1],["ok","ok"]];
  expect(await runInNewContext(`(async()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});

it("replays a completed notified atomic wait", async () => {
  const source=`const a=new Int32Array(new SharedArrayBuffer(4));
    const waiter=Atomics.waitAsync(a,0,0);const count=Atomics.notify(a,0);
    return [count,await waiter.value]`;
  const result=await run(source);
  expect(result).toMatchObject({ok:true,returnValue:[1,"ok"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(result))}))
    .toMatchObject({ok:true,returnValue:[1,"ok"]});
});

it("cancels a run awaiting an atomic timeout", async () => {
  const controller=new AbortController();
  let entered!:()=>void;
  const ready=new Promise<void>(resolve=>{entered=resolve;});
  const pending=run(`const a=new Int32Array(new SharedArrayBuffer(4));
    const waiter=Atomics.waitAsync(a,0,0,20);entered();return await waiter.value`,
    {signal:controller.signal,bindings:{entered}});
  const outcome=pending.catch(error=>error);
  await ready;
  controller.abort(new Error("stop atomic await"));
  expect(await outcome).toMatchObject({message:"stop atomic await"});
});
