import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {ExecutionContext} from "./execution.js";
import {LuaStorage} from "./lua-storage.js";

async function usingHeap(run: (heap: LuaStorage, fs: MemoryFileSystem, context: ExecutionContext) => Promise<void>) {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {});
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  const heap = new LuaStorage(storage, units => context.cooperate(units));
  try {await run(heap, fs, context);}
  finally {await storage.close(); await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
}

it("retains binary Lua strings from reused chunks without a full-payload read", async () => {
  await usingHeap(async (heap, fs) => {
    const open = vi.spyOn(fs, "open");
    vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole payload forbidden"));
    const value = await heap.string((async function* () {
      const bytes = new Uint8Array(10000);
      for (let index = 0; index < 16; index++) {bytes.fill(index); yield bytes;}
    })());
    expect(await heap.byteLength(value)).toBe(160000);
    let offset = 0;
    for await (const chunk of heap.bytes(value)) {
      expect(chunk.length).toBeLessThanOrEqual(8192);
      for (const byte of chunk) if (byte !== Math.floor(offset++ / 10000)) throw new Error("Borrowed string bytes changed");
    }
    expect(offset).toBe(160000);
    expect(open).toHaveBeenCalled();
  });
});

it("uses Lua value equality for keys, including independently stored strings and negative zero", async () => {
  await usingHeap(async heap => {
    const table = await heap.table(), other = await heap.table();
    const a = await heap.string([Uint8Array.of(0, 255, 1)]);
    const b = await heap.string([Uint8Array.of(0), Uint8Array.of(255, 1)]);
    await heap.set(table, a, 12);
    await heap.set(table, -0, false);
    await heap.set(table, false, 13);
    await heap.set(table, other, table);
    expect(await heap.get(table, b)).toBe(12);
    expect(await heap.get(table, 0)).toBe(false);
    expect(await heap.get(table, false)).toBe(13);
    expect(await heap.get(table, other)).toEqual(table);
    expect(await heap.get(other, a)).toBeUndefined();
    await heap.set(table, b, 14);
    expect(await heap.get(table, a)).toBe(14);
    await heap.set(table, b, undefined);
    expect(await heap.get(table, a)).toBeUndefined();
  });
});

it("compares complete string keys after hash collisions", async () => {
  await usingHeap(async heap => {
    const table = await heap.table(), encoder = new TextEncoder();
    const a = await heap.string([encoder.encode("costarring")]);
    const b = await heap.string([encoder.encode("liquid")]);
    await heap.set(table, a, 1); await heap.set(table, b, 2);
    expect(await heap.get(table, a)).toBe(1);
    expect(await heap.get(table, b)).toBe(2);
    await heap.set(table, a, undefined);
    expect(await heap.get(table, b)).toBe(2);
  });
});

it("spills table indexes and traverses updates/deletions without a resident key list", async () => {
  await usingHeap(async (heap, fs) => {
    const open = vi.spyOn(fs, "open"), table = await heap.table();
    for (let index = 1; index <= 500; index++) await heap.set(table, index, index * 2);
    expect(await heap.length(table)).toBe(500);
    let entry = await heap.next(table), visited = 0;
    while (entry) {
      expect(entry.value).toBe(Number(entry.key) * 2);
      await heap.set(table, entry.key, undefined);
      entry = await heap.next(table, entry.key);
      visited++;
    }
    expect(visited).toBe(500);
    expect(await heap.next(table)).toBeUndefined();
    expect(await heap.length(table)).toBe(0);
    expect(open).toHaveBeenCalled();
    await heap.set(table, 1, true);
    expect(await heap.next(table)).toEqual({key: 1, value: true});
    await expect(heap.next(table, 501)).rejects.toThrow("Invalid key to next");
  });
});

it("rejects nil and NaN writes while allowing nil and NaN lookups", async () => {
  await usingHeap(async heap => {
    const table = await heap.table();
    await expect(heap.set(table, undefined, 1)).rejects.toThrow("Table index is nil");
    await expect(heap.set(table, NaN, 1)).rejects.toThrow("Table index is NaN");
    expect(await heap.get(table, undefined)).toBeUndefined();
    expect(await heap.get(table, NaN)).toBeUndefined();
    expect(await heap.next(table)).toBeUndefined();
  });
});

it("closes a source iterator when cooperative string storage fails", async () => {
  const fs = new MemoryFileSystem(), signal = new AbortController().signal;
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal}, 1);
  const failure = new Error("cancelled"), closed = vi.fn();
  const heap = new LuaStorage(storage, async () => {throw failure;});
  try {
    await expect(heap.string((async function* () {
      try {yield new Uint8Array(50000);} finally {closed();}
    })())).rejects.toBe(failure);
    expect(closed).toHaveBeenCalledOnce();
  } finally {await storage.close();}
  expect(await fs.readdir("/")).toEqual([]);
});


it("compares long binary string keys across different source chunk boundaries", async () => {
  await usingHeap(async heap => {
    const table = await heap.table(), payload = new Uint8Array(25000).fill(255);
    payload[12000] = 0;
    const first = await heap.string([payload]);
    const second = await heap.string((async function* () {
      for (let offset = 0; offset < payload.length; offset += 997) yield payload.subarray(offset, offset + 997);
    })());
    await heap.set(table, first, false);
    expect(await heap.get(table, second)).toBe(false);
    payload[24000] = 1;
    const different = await heap.string([payload]);
    expect(await heap.get(table, different)).toBeUndefined();
    expect(await heap.get(table, first)).toBe(false);
  });
});

it("cooperates on empty source chunks and closes on cancellation", async () => {
  const fs = new MemoryFileSystem(), signal = new AbortController().signal;
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal}, 1);
  const failure = new Error("cancelled"), closed = vi.fn();
  const cooperate = vi.fn(async () => {throw failure;}), tail = vi.fn();
  const heap = new LuaStorage(storage, cooperate);
  try {
    await expect(heap.string((async function* () {
      try {yield new Uint8Array(); tail(); yield Uint8Array.of(1);} finally {closed();}
    })())).rejects.toBe(failure);
    expect(cooperate).toHaveBeenCalledWith(1);
    expect(tail).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledOnce();
  } finally {await storage.close();}
});

it("closes a failed source and preserves its primary error when cleanup also fails", async () => {
  await usingHeap(async heap => {
    const failure = new Error("source failed"), closed = vi.fn(async (): Promise<IteratorResult<Uint8Array>> => {throw new Error("cleanup failed");});
    const source = {
      [Symbol.asyncIterator]() {return this;},
      async next(): Promise<IteratorResult<Uint8Array>> {throw failure;},
      return: closed
    };
    await expect(heap.string(source)).rejects.toBe(failure);
    expect(closed).toHaveBeenCalledOnce();
  });
});

it("retains closure identity and shared mutable captures after their creating scope exits", async () => {
  await usingHeap(async heap => {
    const capture = await heap.cell(1), table = await heap.table();
    const first = await heap.closure(123, [capture]);
    const second = await heap.closure(123, [capture]);
    await heap.set(table, first, second);
    expect(await heap.get(table, first)).toEqual(second);
    expect(await heap.get(table, second)).toBeUndefined();
    expect(await heap.prototype(first)).toBe(123);
    expect(await heap.capture(first, 0)).toBe(capture);
    await heap.assign((await heap.capture(second, 0))!, 9);
    expect(await heap.value((await heap.capture(first, 0))!)).toBe(9);
    expect(await heap.capture(first, 1)).toBeUndefined();
    await heap.assign(capture, first);
    expect(await heap.value(capture)).toEqual(first);
  });
});

it("retains metatable identity independently of table entries and iteration", async () => {
  await usingHeap(async heap => {
    const table = await heap.table(), metatable = await heap.table();
    expect(await heap.metatable(table)).toBeUndefined();
    await heap.setMetatable(table, metatable);
    await heap.set(table, 1, 42);
    expect(await heap.metatable(table)).toEqual(metatable);
    expect(await heap.next(table)).toEqual({key: 1, value: 42});
    expect(await heap.next(table, 1)).toBeUndefined();
    await heap.setMetatable(table, undefined);
    expect(await heap.metatable(table)).toBeUndefined();
    expect(await heap.get(table, 1)).toBe(42);
  });
});

it("preserves Lua integer/float tags while matching equivalent numeric table keys", async () => {
  await usingHeap(async heap => {
    const table = await heap.table();
    const integer = {kind: "integer" as const, value: 7};
    const cell = await heap.cell(integer);
    expect(await heap.value(cell)).toEqual(integer);
    await heap.assign(cell, 7);
    expect(await heap.value(cell)).toBe(7);
    await heap.set(table, integer, integer);
    expect(await heap.get(table, 7)).toEqual(integer);
    await heap.set(table, 7, false);
    expect(await heap.get(table, integer)).toBe(false);
    expect(await heap.next(table)).toEqual({key: integer, value: false});
    expect(await heap.next(table, 7)).toBeUndefined();
    await heap.set(table, {kind: "integer", value: 0}, true);
    expect(await heap.get(table, -0)).toBe(true);
    await heap.set(table, {kind: "integer", value: -2147483648}, 1);
    expect(await heap.get(table, -2147483648)).toBe(1);
    await heap.set(table, -2147483648, undefined);
    expect(await heap.get(table, {kind: "integer", value: -2147483648})).toBeUndefined();
  });
});


it.each([NaN, Infinity, 1.5, 2147483648, -2147483649])("rejects invalid tagged Lua integers: %s", async value => {
  await usingHeap(async heap => {
    await expect(heap.cell({kind: "integer", value})).rejects.toThrow("Lua integer must fit signed 32 bits");
  });
});

it("seeks retained string bytes across arbitrary source chunks without whole-string reads",async()=>{
  await usingHeap(async(heap,fs)=>{
    vi.spyOn(fs,"readFile").mockRejectedValue(new Error("Whole payload forbidden"));
    const value=await heap.string((async function*(){
      const chunk=new Uint8Array(137);
      for(let offset=0;offset<25000;offset+=chunk.length) {
        const count=Math.min(chunk.length,25000-offset);
        for(let i=0;i<count;i++) chunk[i]=(offset+i)%251;
        yield chunk.subarray(0,count);
      }
    })());
    for(const offset of [24999,0,8191,8192,16383,16384,123,24900]) {
      const bytes=await heap.readBytes(value,offset,Math.min(200,25000-offset));
      expect([...bytes]).toEqual(Array.from({length:bytes.length},(_,i)=>(offset+i)%251));
    }
    expect(await heap.readBytes(value,25000,0)).toEqual(new Uint8Array());
    await expect(heap.readBytes(value,-1,1)).rejects.toThrow();
    await expect(heap.readBytes(value,0,8193)).rejects.toThrow();
    await expect(heap.readBytes(value,25000,1)).rejects.toThrow();
  });
});

it.each(["end","chunk"])("normalizes cancellation after a string source returns %s",async mode=>{
  const fs=new MemoryFileSystem(),controller=new AbortController(),context=new ExecutionContext("convert",{signal:controller.signal});
  const storage=new PagedStorage({fs,cwd:"/",env:{},signal:controller.signal},1),heap=new LuaStorage(storage,units=>context.cooperate(units));
  try {
    await expect(heap.string((async function*(){
      yield Uint8Array.of(1);
      controller.abort();
      if(mode==="chunk") yield new Uint8Array(8192);
    })())).rejects.toMatchObject({code:"E_CANCELLED"});
  } finally {await storage.close();await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
});
