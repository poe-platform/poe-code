import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {ExecutionContext} from "./execution.js";
import {LuaStorage} from "./lua-storage.js";
import {LuaFrames} from "./lua-frames.js";

async function usingFrames(run: (frames: LuaFrames, heap: LuaStorage, fs: MemoryFileSystem) => Promise<void>, signal?: AbortSignal) {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", signal ? {signal} : {});
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: signal ?? new AbortController().signal}, 1);
  const heap = new LuaStorage(storage, units => context.cooperate(units));
  const frames = new LuaFrames(storage, heap, units => context.cooperate(units));
  try {await run(frames, heap, fs);}
  finally {await storage.close(); await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
}

it("retains calls, program counters and return continuations without a resident frame stack", async () => {
  await usingFrames(async (frames, heap, fs) => {
    vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole payload forbidden"));
    const open = vi.spyOn(fs, "open"), closure = await heap.closure(1, []);
    let frame = 0;
    for (let i = 0; i < 400; i++) {
      frame = await frames.push(frame, closure, i, i % 3);
      await frames.set(frame, 0, i);
      await frames.pc(frame, i * 2);
    }
    for (let i = 399; i >= 0; i--) {
      const current = await frames.read(frame);
      expect(current.closure).toEqual(closure);
      expect(current.pc).toBe(i * 2);
      expect(current.returnBase).toBe(i);
      expect(current.results).toBe(i % 3);
      expect(await frames.get(frame, 0)).toBe(i);
      frame = current.parent;
    }
    expect(frame).toBe(0);
    expect(open).toHaveBeenCalled();
  });
});

it("closes only out-of-scope registers while sibling closures keep sharing their old cells", async () => {
  await usingFrames(async (frames, heap) => {
    const frame = await frames.push(0, await heap.closure(1, []), 0, -1);
    await frames.set(frame, 0, 5);
    await frames.set(frame, 1, 10);
    const outer = await frames.capture(frame, 0), inner = await frames.capture(frame, 1);
    const first = await heap.closure(2, [inner]), second = await heap.closure(2, [inner]);
    expect(await frames.capture(frame, 1)).toBe(inner);
    await frames.close(frame, 1);
    await frames.set(frame, 1, 20);
    await frames.set(frame, 0, 6);
    expect(await heap.value(outer)).toBe(6);
    expect(await heap.value((await heap.capture(first, 0))!)).toBe(10);
    await heap.assign((await heap.capture(second, 0))!, 30);
    expect(await heap.value((await heap.capture(first, 0))!)).toBe(30);
    expect(await frames.get(frame, 1)).toBe(20);
    expect(await frames.capture(frame, 1)).not.toBe(inner);
    await frames.close(frame, 0);
    await frames.set(frame, 0, 7);
    expect(await heap.value(outer)).toBe(6);
  });
});

it("retains varargs and nil slots with an explicit count for multiple-result calls", async () => {
  await usingFrames(async (frames, heap) => {
    const frame = await frames.push(0, await heap.closure(1, []), 0, -1);
    await frames.arguments(frame, (async function* () {yield 1; yield undefined; yield false; yield undefined;})());
    expect((await frames.read(frame)).argumentCount).toBe(4);
    expect(await frames.argument(frame, 0)).toBe(1);
    expect(await frames.argument(frame, 1)).toBeUndefined();
    expect(await frames.argument(frame, 2)).toBe(false);
    expect(await frames.argument(frame, 3)).toBeUndefined();
    expect(await frames.get(frame, 2)).toBeUndefined();
    await frames.set(frame, 4, undefined);
    expect((await frames.read(frame)).top).toBe(5);
    await frames.top(frame, 2);
    expect((await frames.read(frame)).top).toBe(2);
  });
});

it("tail calls replace a frame's registers without changing captured values or its continuation", async () => {
  await usingFrames(async (frames, heap) => {
    const first = await heap.closure(1, []), second = await heap.closure(2, []);
    const parent = await frames.push(0, first, 0, -1);
    const frame = await frames.push(parent, first, 3, 2);
    await frames.set(frame, 0, 42);
    const captured = await frames.capture(frame, 0);
    await frames.pc(frame, 123);
    await frames.replace(frame, second);
    expect(await frames.read(frame)).toMatchObject({parent, closure: second, returnBase: 3, results: 2, pc: 0, top: 0, argumentCount: 0});
    expect(await frames.get(frame, 0)).toBeUndefined();
    await frames.set(frame, 0, 12);
    expect(await heap.value(captured)).toBe(42);
  });
});


it("cancels a long argument transfer, closes its producer and discards scratch files", async () => {
  const controller = new AbortController(), closed = vi.fn();
  await usingFrames(async (frames, heap) => {
    const frame = await frames.push(0, await heap.closure(1, []), 0, -1);
    const timer = setTimeout(() => controller.abort(), 0);
    try {
      await expect(frames.arguments(frame, (async function* () {
        try {for (;;) yield undefined;} finally {closed();}
      })())).rejects.toMatchObject({code: "E_CANCELLED"});
      expect(closed).toHaveBeenCalledOnce();
    } finally {clearTimeout(timer);}
  }, controller.signal);
});
