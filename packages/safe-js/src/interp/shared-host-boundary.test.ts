import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { cloneSharedArrayBufferStorage, createSharedArrayBufferStorage } from "./shared-array-buffer.js";
import { digestHostCallArguments, HostCallJournal } from "./host-call.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { decodeReplayData, encodeReplayData } from "../snapshot/replay-data.js";
import { restoreDataView } from "./data-view.js";

it("includes shared bytes in host-call argument identity", () => {
  const a=createSharedArrayBufferStorage(4,undefined,new Budget());
  const before=digestHostCallArguments([a]);
  new Uint8Array(a)[0]=7;
  expect(digestHostCallArguments([a])).not.toBe(before);
});

it("distinguishes fixed, growable and ordinary backing in host-call identity", () => {
  const fixed=createSharedArrayBufferStorage(4,undefined,new Budget());
  const growing=createSharedArrayBufferStorage(4,8,new Budget());
  const larger=createSharedArrayBufferStorage(4,16,new Budget());
  const digests=[fixed,growing,larger,new ArrayBuffer(4),{}].map(value=>digestHostCallArguments([value]));
  expect(new Set(digests).size).toBe(digests.length);
});

it("distinguishes ordinary and shared typed-array storage in host-call identity", () => {
  const shared=new Int32Array(createSharedArrayBufferStorage(4,undefined,new Budget()));
  expect(digestHostCallArguments([shared])).not.toBe(digestHostCallArguments([new Int32Array(1)]));
});

it("returns guest-owned shared storage through a host identity function", async () => {
  const source=`const a=new SharedArrayBuffer(4);const b=identity(a);
    new Uint8Array(b)[0]=7;return [a!==b,new Uint8Array(a)[0],b.byteLength]`;
  expect(await run(source,{bindings:{identity:(value:unknown)=>value}}))
    .toMatchObject({ok:true,returnValue:[true,7,4]});
});

it("distinguishes aliased from independent shared blocks in argument identity", () => {
  const a=createSharedArrayBufferStorage(4,undefined,new Budget());
  const alias=cloneSharedArrayBufferStorage(a);
  const independent=createSharedArrayBufferStorage(4,undefined,new Budget());
  expect(digestHostCallArguments([a,alias])).not.toBe(digestHostCallArguments([a,independent]));
  expect(digestHostCallArguments([a,alias])).toBe(digestHostCallArguments([alias,a]));
});

it("does not implicitly admit unregistered host shared storage", async () => {
  await expect(run("return supply()",{bindings:{supply:()=>new SharedArrayBuffer(4)}}))
    .rejects.toThrow("Unsupported sandbox value");
});

it("preserves sharing through a returned host view", async () => {
  const source=`const b=new SharedArrayBuffer(4);const a=new Uint8Array(b);
    const c=identity(a);c[0]=9;return [a!==c,a.buffer!==c.buffer,a[0],c[0]]`;
  expect(await run(source,{bindings:{identity:(value:unknown)=>value}}))
    .toMatchObject({ok:true,returnValue:[true,true,9,9]});
});

it("preserves sharing with a host-returned wrapper during completed replay", async () => {
  const source=`const a=new SharedArrayBuffer(4);const b=identity(a);
    new Uint8Array(b)[0]=7;return [a!==b,new Uint8Array(a)[0],b.byteLength]`;
  const bindings={identity:(value:unknown)=>value};
  const result=await run(source,{bindings});
  expect(result).toMatchObject({ok:true,returnValue:[true,7,4]});
  expect(await run(source,{bindings,snapshot:JSON.parse(await dump(result))}))
    .toMatchObject({ok:true,returnValue:[true,7,4]});
});

it("freezes shared host outcome bytes at settlement", () => {
  const buffer=createSharedArrayBufferStorage(4,undefined,new Budget());
  const journal=new HostCallJournal("shared-outcome");
  const {record}=journal.issue({moduleId:"host",operation:"supply",
    argumentDigest:digestHostCallArguments([]),policy:"re-issue"});
  journal.start(record);
  journal.settle(record,{status:"fulfilled",value:buffer});
  const before=journal.snapshotReplay();
  new Uint8Array(buffer)[0]=7;
  expect(journal.snapshotReplay()).toEqual(before);
});

it("freezes shared outcome aliases and growth while preserving wrapper identity", () => {
  const buffer=createSharedArrayBufferStorage(4,8,new Budget());
  const alias=cloneSharedArrayBufferStorage(buffer);
  const independent=createSharedArrayBufferStorage(4,8,new Budget());
  const view=restoreDataView(alias,0);
  const journal=new HostCallJournal("shared-alias-outcome");
  const {record}=journal.issue({moduleId:"host",operation:"supply",
    argumentDigest:digestHostCallArguments([]),policy:"re-issue"});
  journal.start(record);
  journal.settle(record,{status:"fulfilled",value:[view,buffer,alias,independent]});
  buffer.grow(8);
  new Uint8Array(buffer)[0]=7;
  const checkpoint=journal.snapshotReplay();
  const saved=checkpoint.calls[0].outcome!;
  const decoded=decodeReplayData(saved.data);
  if (!Array.isArray(decoded)) throw new Error("Missing outcome array");
  const [d,a,b,c]=decoded as [DataView,SharedArrayBuffer,SharedArrayBuffer,SharedArrayBuffer];
  expect(a).not.toBe(b);
  expect(d.buffer).toBe(b);
  expect([a.byteLength,b.byteLength,d.byteLength]).toEqual([4,4,4]);
  expect(d.getUint8(0)).toBe(0);
  d.setUint8(0,9);
  expect(new Uint8Array(a)[0]).toBe(9);
  expect(new Uint8Array(c)[0]).toBe(0);
  expect(new Uint8Array(buffer)[0]).toBe(7);
  expect(journal.snapshotReplay()).toEqual(checkpoint);
});

it.each([true,false])("replays host growth and writes (returns shared storage: %s)", async returnsBuffer => {
  const source=`const b=new SharedArrayBuffer(4,{maxByteLength:8});const a=new Uint8Array(b);
    const result=mutate(b);return [b.byteLength,Array.from(a),${returnsBuffer?"result!==b":"result"}]`;
  let calls=0;
  const bindings={mutate:(buffer:SharedArrayBuffer)=>{
    calls++;buffer.grow(8);new Uint8Array(buffer)[7]=9;return returnsBuffer?buffer:17;
  }};
  const expected=[8,[0,0,0,0,0,0,0,9],returnsBuffer?true:17];
  const result=await run(source,{bindings});
  expect(result).toMatchObject({ok:true,returnValue:expected});
  expect(await run(source,{bindings,snapshot:JSON.parse(await dump(result))}))
    .toMatchObject({ok:true,returnValue:expected});
  expect(calls).toBe(1);
});

it("replays a host-returned view without rerunning the host", async () => {
  const source=`const b=new SharedArrayBuffer(4);const a=new Uint8Array(b);
    const c=identity(a);c[0]=9;return [a!==c,a.buffer!==c.buffer,a[0],c[0]]`;
  let calls=0;
  const bindings={identity:(value:unknown)=>{calls++;return value;}};
  const result=await run(source,{bindings});
  expect(await run(source,{bindings,snapshot:JSON.parse(await dump(result))}))
    .toMatchObject({ok:true,returnValue:[true,true,9,9]});
  expect(calls).toBe(1);
});

it.each([null,{},[[0,"0"]],[[0,-1]],[[0,0.5]],[[9999,0]],[[0,0],[0,1]]])(
  "rejects malformed shared argument associations %j", associations => {
    const buffer=createSharedArrayBufferStorage(4,undefined,new Budget());
    const journal=new HostCallJournal("shared-association-validation");
    const {record}=journal.issue({moduleId:"host",operation:"identity",
      argumentDigest:digestHostCallArguments([buffer]),policy:"re-issue"});
    journal.registerSharedArguments(record,[buffer]);
    journal.start(record);
    journal.settle(record,{status:"fulfilled",value:buffer});
    const saved=JSON.parse(JSON.stringify(journal.snapshotReplay()));
    saved.calls[0].outcome.sharedArguments=associations;
    expect(()=>new HostCallJournal("shared-association-validation",[],undefined,saved)).toThrow(TypeError);
  }
);

it.each(["empty","ordinary","duplicate","synchronous"])("rejects malformed invocation prefix: %s", corruption => {
  const buffer=createSharedArrayBufferStorage(4,undefined,new Budget());
  const journal=new HostCallJournal("prefix-validation");
  const {record}=journal.issue({moduleId:"host",operation:"identity",
    argumentDigest:digestHostCallArguments([buffer]),policy:"re-issue"});
  journal.registerSharedArguments(record,[buffer]);
  journal.start(record);
  record.asynchronous=true;
  journal.captureSharedPrefix(record);
  journal.settle(record,{status:"fulfilled",value:17});
  const saved=JSON.parse(JSON.stringify(journal.snapshotReplay()));
  if (corruption==="synchronous") saved.calls[0].asynchronous=false;
  else saved.calls[0].sharedPrefix=encodeReplayData(corruption==="empty"?[]:
    corruption==="ordinary"?[new ArrayBuffer(4)]:[buffer,cloneSharedArrayBufferStorage(buffer)]);
  expect(()=>new HostCallJournal("prefix-validation",[],undefined,saved)).toThrow(TypeError);
});
