import { expect, it, vi } from "vitest";
import { run } from "../run.js";
import { Budget, SandboxError } from "./budget.js";
import { digestHostCallArguments, HostCallJournal } from "./host-call.js";
import { createSharedArrayBufferStorage } from "./shared-array-buffer.js";
import { CompileScope } from "./regex/compile-guard.js";

it("does not change callback-visible storage if registering a newly exposed block exceeds budget", () => {
  const original = new HostCallJournal("callback-storage-budget");
  const source = createSharedArrayBufferStorage(4, undefined, new Budget());
  const extra = createSharedArrayBufferStorage(4, undefined, new Budget());
  const identity = { moduleId: "host", operation: "callback", argumentDigest: "buffer", policy: "re-issue" as const };
  const { record } = original.issue(identity);
  original.registerSharedArguments(record, [source]);
  original.registerSharedStorage(extra);
  new Uint8Array(source)[0] = 7;
  original.recordCallback(record, 1, [], 0);
  const replay = original.snapshotReplay();
  const budget = new Budget();
  const restored = new HostCallJournal("callback-storage-budget", [], undefined, replay, budget);
  const target = createSharedArrayBufferStorage(4, undefined, new Budget());
  restored.registerSharedArguments(restored.issue(identity).record, [target]);
  const failure = new SandboxError({ budget: "dataSize", current: 2, limit: 1 });
  const retain = budget.setRetainedDataUsage.bind(budget);
  const check = vi.spyOn(budget, "setRetainedDataUsage").mockImplementation((owner, usage) => {
    if (owner instanceof Map && usage > 1) throw failure;
    retain(owner, usage);
  });
  const compilation = new CompileScope();
  try {
    expect(() => restored.replayCallbackArguments(replay.calls[0].callbacks![0], compilation)).toThrow(failure);
    expect(new Uint8Array(target)[0]).toBe(0);
  } finally {
    check.mockRestore();
    compilation.dispose();
    restored.dispose();
  }
});

it("handles the native promise when invocation-prefix recording exhausts its budget", async () => {
  const budget=new Budget();
  const failure=new SandboxError({budget:"dataSize",current:2,limit:1});
  let rejectHost!:(reason:unknown)=>void;
  const hostPromise=new Promise<never>((_,reject)=>{rejectHost=reject;});
  const then=vi.spyOn(hostPromise,"then");
  const observed:Array<{promise:Promise<unknown>;calls:unknown[][]}>=[];
  const finish=hostPromise.finally.bind(hostPromise);
  const finallySpy=vi.spyOn(hostPromise,"finally").mockImplementation(onFinally=>{
    const result=finish(onFinally);
    const observer=vi.spyOn(result,"then");
    observed.push({promise:result,calls:observer.mock.calls});
    return result;
  });
  const retain=budget.setRetainedDataUsage.bind(budget);
  let failRecording=false;
  const check=vi.spyOn(budget,"setRetainedDataUsage").mockImplementation((owner,usage)=>{
    if (failRecording&&usage>0&&owner instanceof HostCallJournal) throw failure;
    retain(owner,usage);
  });
  try {
    await expect(run("return await mutate(new SharedArrayBuffer(4))",{budget,bindings:{mutate:()=>{
      failRecording=true;return hostPromise;
    }}})).rejects.toBe(failure);
    expect(then.mock.calls.some(([,reject])=>typeof reject==="function")).toBe(true);
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every(({calls})=>calls.some(([,reject])=>typeof reject==="function"))).toBe(true);
  } finally {
    check.mockRestore();
    then.mockRestore();
    finallySpy.mockRestore();
    const handled=[hostPromise,...observed.map(({promise})=>promise)].map(promise=>promise.catch(()=>undefined));
    rejectHost(new Error("host failed after the recording failure"));
    await Promise.all(handled);
  }
});

it.each([false,true])("does not apply replayed writes or growth when retaining the outcome exceeds its budget (async: %s)", asynchronous => {
  const source=createSharedArrayBufferStorage(4,8,new Budget());
  const original=new HostCallJournal("shared-retention-budget");
  const identity={moduleId:"host",operation:"mutate",argumentDigest:digestHostCallArguments([source]),policy:"re-issue" as const};
  const {record}=original.issue(identity);
  original.registerSharedArguments(record,[source]);
  original.start(record);
  source.grow(8);
  new Uint8Array(source)[0]=7;
  if (asynchronous) {
    record.asynchronous=true;
    original.captureSharedPrefix(record);
  }
  original.settle(record,{status:"fulfilled",value:17});
  const budget=new Budget();
  const restored=new HostCallJournal("shared-retention-budget",[],undefined,original.snapshotReplay(),budget);
  const target=createSharedArrayBufferStorage(4,8,new Budget());
  const replayed=restored.issue(identity).record;
  restored.registerSharedArguments(replayed,[target]);
  const failure=new SandboxError({budget:"dataSize",current:2,limit:1});
  const retain=vi.spyOn(budget,"reconcileCompileData").mockImplementation(()=>{throw failure;});
  try {
    expect(()=>restored.replayOutcome(replayed)).toThrow(failure);
    expect(new Uint8Array(target)[0]).toBe(0);
    expect(target.byteLength).toBe(4);
  } finally {retain.mockRestore();restored.dispose();}
});
