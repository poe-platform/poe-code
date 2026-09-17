import { expect, it, vi } from "vitest";
import { createTest262Realm } from "./realm.js";

it("disposes scheduled conformance callbacks before releasing their realm", async () => {
  vi.useFakeTimers();
  const print = vi.fn();
  const realm = createTest262Realm({}, print, undefined, undefined, { agent: {}, canBlock: false });
  try {
    expect(await realm.evaluate('setTimeout(() => print("late"), 1000)'))
      .toMatchObject({ status: "normal" });
    expect(vi.getTimerCount()).toBe(1);
    await realm.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await vi.runAllTimersAsync();
    expect(print).not.toHaveBeenCalled();
  } finally { await realm.dispose(); vi.useRealTimers(); }
});

it("queues timer callbacks behind the running guest job during host suspension", async () => {
  let entered!: () => void;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const print = vi.fn();
  const realm = createTest262Realm({}, print, undefined, undefined, {
    agent: { start: async () => { entered(); await gate; } }, canBlock: false
  });
  const evaluation = realm.evaluate('let phase=0;setTimeout(()=>print(phase),0);$262.agent.start("");phase=1;');
  try {
    await ready;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(print).not.toHaveBeenCalled();
    release();
    expect(await evaluation).toMatchObject({ status: "normal" });
    await realm.settle();
    expect(print.mock.calls).toEqual([["1"]]);
  } finally { release(); await evaluation; await realm.dispose(); }
});

it("cancels a timer already queued behind a suspended guest job", async () => {
  let entered!: () => void;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const print = vi.fn();
  const realm = createTest262Realm({}, print, undefined, undefined, {
    agent: { start: async () => { entered(); await gate; } }, canBlock: false
  });
  const evaluation = realm.evaluate('setTimeout(()=>print("late"),0);$262.agent.start("");');
  try {
    await ready;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const disposal = realm.dispose();
    release();
    await evaluation;
    await disposal;
    expect(print).not.toHaveBeenCalled();
  } finally { release(); await evaluation; await realm.dispose(); }
});
