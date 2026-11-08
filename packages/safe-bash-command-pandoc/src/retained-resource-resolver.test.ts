import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import type {ResourceIdentifier} from "./types.js";
import {convert, convertToOutput} from "./engine.js";

const picture = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAADUlEQVR4AQECAP3/AIAAggCBw24l4AAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
const input = {bytes: new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [{t: "Image", c: [["",[],[]], [], ["remote:picture", ""]]}]}]}))};

it.each(["rtf", "odt"])("streams a custom image resolver into retained %s output", async to => {
  const options = {from: "json", to}, expected = await convert([input], options, {resources: {async resolve() {return picture;}}});
  const fs = new MemoryFileSystem(), parts: Uint8Array[] = []; let closed = 0;
  const resolve = vi.fn(async (): Promise<Uint8Array> => {throw new Error("Whole resource forbidden");});
  const resolveStream = vi.fn(async function* (id: string) {
    expect(id).toBe("remote:picture");
    try {const reused = new Uint8Array(7); for (let i = 0; i < picture.length; i += 7) {reused.fill(0); reused.set(picture.subarray(i, i + 7)); yield reused.subarray(0, Math.min(7, picture.length - i));}}
    finally {closed++;}
  });
  await convertToOutput([input], options, {resources: {resolve, resolveStream}, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {parts.push(bytes.slice()); await Promise.resolve();}, async close() {}, async abort() {}}});
  expect(resolve).not.toHaveBeenCalled(); expect(resolveStream).toHaveBeenCalledOnce(); expect(closed).toBe(1);
  expect(Uint8Array.from(parts.flatMap(bytes => [...bytes]))).toEqual(expected.kind === "text" ? new TextEncoder().encode(expected.text) : expected.bytes);
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["rtf", "odt"].flatMap(to => ["stream", "source"].map(capability => ({to, capability}))))("supports a $capability-only resolver with buffered and retained $to APIs", async ({to, capability}) => {
  const produce = async function* (id: string | ResourceIdentifier) {
    if (typeof id !== "string") {let value = ""; for await (const chunk of id.chunks()) value += chunk; expect(value).toBe("remote:picture");}
    yield picture.subarray(0, 20); yield picture.subarray(20);
  };
  const resources = capability === "source" ? {resolveSource: produce} : {resolveStream: produce};
  const options = {from: "json", to}, expected = await convert([input], options, {resources}), fs = new MemoryFileSystem(), parts: Uint8Array[] = [];
  await convertToOutput([input], options, {resources, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {parts.push(bytes.slice());}, async close() {}, async abort() {}}});
  expect(Uint8Array.from(parts.flatMap(bytes => [...bytes]))).toEqual(expected.kind === "text" ? new TextEncoder().encode(expected.text) : expected.bytes);
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["rtf", "odt"].flatMap(to => ["stream", "identifier"].flatMap(capability => ["source", "cancel", "invalid", "limit", "storage", "sink"].map(mode => ({to, mode, capability})))))("cleans up a $to custom $capability stream after $mode failure", async ({to, mode, capability}) => {
  const fs = new MemoryFileSystem(), controller = new AbortController(); let finalized = 0, failStorage = false;
  const produce = async function* (_id: string | ResourceIdentifier, _base: string | undefined, signal: AbortSignal | undefined) {
    expect(signal).toBe(controller.signal);
    try {
      yield picture.subarray(0, 7);
      if (mode === "source") throw new Error("Producer failed");
      if (mode === "cancel") controller.abort();
      if (mode === "invalid") yield "bad" as unknown as Uint8Array;
      if (mode === "storage") {failStorage = true; yield new Uint8Array(65536);}
      yield picture.subarray(7);
    } finally {finalized++;}
  };
  const resources = capability === "identifier" ? {resolveSource: produce} : {resolveStream: produce};
  const close = vi.fn(async () => {}), abort = vi.fn(async () => {}), write = vi.fn(async () => {if (mode === "sink") throw new Error("Sink failed");});
  if (mode === "storage") {
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args), write = handle.write.bind(handle);
      vi.spyOn(handle, "write").mockImplementation(async (...args) => {if (failStorage) throw new Error("Storage failed"); return write(...args);});
      return handle;
    });
  }
  await expect(convertToOutput([input], {from: "json", to}, {resources, signal: controller.signal, ...(mode === "limit" ? {limits: {resourceBytes: 6}} : {}), workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, close, abort}})).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : mode === "limit" ? "E_LIMIT" : "E_IO"});
  expect(finalized).toBe(1); expect(close).not.toHaveBeenCalled();
  if (mode !== "sink") expect(write).not.toHaveBeenCalled();
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["resources", "resourceBytes", "retainedBytes"] as const)("preserves %s accounting for single-chunk custom resolvers", async key => {
  for (const to of ["rtf", "odt"]) for (const limit of [0, 1, 2, 70, 140, 100000]) {
    const options = {from: "json", to}, limits = {[key]: limit};
    const run = async (streamed: boolean) => {
      const fs = new MemoryFileSystem(); let length = 0;
      const result = await convertToOutput([input], options, {limits, resources: streamed ? {async *resolveStream() {yield picture;}} : {async resolve() {return picture;}}, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {length += bytes.length;}, async close() {}, async abort() {}}}).then(() => ({length})).catch(error => ({code: error.code, message: error.message}));
      expect(await fs.readdir("/")).toEqual([]); return result;
    };
    expect(await run(true)).toEqual(await run(false));
  }
});

it("awaits each destination write before advancing a reused resolver chunk", async () => {
  const {ExecutionContext} = await import("./execution.js");
  let produced = 0, accepted = 0, pending = 0, finalized = 0;
  const context = new ExecutionContext("convert", {resources: {async *resolveStream() {
    const reused = new Uint8Array(131072);
    try {for (let i = 0; i < 8; i++) {expect(accepted).toBe(i * reused.length); reused.fill(i); produced++; yield reused;}}
    finally {finalized++;}
  }}});
  try {
    const length = await context.consumeResource("asset", undefined, async bytes => {
      expect(++pending).toBe(1); expect(bytes.length).toBeLessThanOrEqual(65536);
      expect(bytes.every(byte => byte === produced - 1)).toBe(true);
      await Promise.resolve(); accepted += bytes.length; pending--;
    });
    expect(length).toBe(1048576); expect(accepted).toBe(length); expect(finalized).toBe(1);
  } finally {await context.close();}
});

it.each(["pending", "factory"])("closes a resolver directly when cancellation interrupts its %s", async mode => {
  const {ExecutionContext} = await import("./execution.js");
  const controller = new AbortController();
  let started!: () => void, finishPull!: (value: IteratorResult<Uint8Array>) => void;
  const ready = new Promise<void>(resolve => {started = resolve;});
  const pull = new Promise<IteratorResult<Uint8Array>>(resolve => {finishPull = resolve;});
  const returned = vi.fn(async () => ({done: true as const, value: undefined}));
  const next = vi.fn(() => {started(); return pull;});
  const accept = vi.fn(async () => {});
  const context = new ExecutionContext("convert", {signal: controller.signal, resources: {
    resolveStream() {
      if (mode === "factory") {controller.abort(); started();}
      return {[Symbol.asyncIterator]: () => ({next, return: returned})};
    }
  }});
  let closing: Promise<void> | undefined;
  try {
    const operation = context.consumeResource("picture", undefined, accept);
    const rejected = expect(operation).rejects.toMatchObject({code: "E_CANCELLED"});
    await ready; controller.abort(); await rejected;
    closing = context.close();
    // close() dispatches owned cleanup callbacks in its first microtask.
    await Promise.resolve(); await Promise.resolve();
    expect(returned).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledTimes(mode === "factory" ? 0 : 1);
    expect(accept).not.toHaveBeenCalled();
  } finally {
    finishPull({done: true, value: undefined});
    await closing; await context.close();
  }
  expect(returned).toHaveBeenCalledOnce();
});

it("normalizes synchronous resolver factory failure", async () => {
  const {ExecutionContext} = await import("./execution.js");
  const context = new ExecutionContext("convert", {resources: {resolveStream() {throw new Error("Factory failed");}}});
  try {await expect(context.consumeResource("picture", undefined, async () => {})).rejects.toMatchObject({code: "E_IO", operation: "convert"});}
  finally {await context.close();}
});


it.each(["rtf", "odt"])("passes replayable identifier chunks to a retained %s resolver", async to => {
  const id = "opaque:" + "a😀%20".repeat(10000);
  const source = {bytes: new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [{t: "Image", c: [["", [], []], [], [id, ""]]}]}]}))};
  const expected = await convert([source], {from: "json", to}, {resources: {async resolve() {return picture;}}});
  const fs = new MemoryFileSystem(), output: Uint8Array[] = [];
  const resolve = vi.fn(async () => {throw new Error("Whole identifier resolver forbidden");});
  const resolveStream = vi.fn((): AsyncIterable<Uint8Array> => {throw new Error("Whole identifier stream resolver forbidden");});
  const resolveSource = vi.fn(async function* (source: {length: number; chunks(): AsyncIterable<string>}) {
    expect(source.length).toBe(id.length);
    for (let pass = 0; pass < 2; pass++) {
      let offset = 0;
      for await (const chunk of source.chunks()) {
        expect(chunk.length).toBeLessThanOrEqual(4096);
        expect(chunk).toBe(id.slice(offset, offset + chunk.length));
        offset += chunk.length;
      }
      expect(offset).toBe(id.length);
    }
    yield picture;
  });
  await convertToOutput([source], {from: "json", to}, {resources: {resolve, resolveStream, resolveSource}, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
    async write(bytes) {expect(bytes.length).toBeLessThanOrEqual(16384); await Promise.resolve(); output.push(bytes.slice());}, async close() {}, async abort() {}
  }});
  expect(resolveSource).toHaveBeenCalledOnce(); expect(resolve).not.toHaveBeenCalled(); expect(resolveStream).not.toHaveBeenCalled();
  expect(Uint8Array.from(output.flatMap(bytes => [...bytes]))).toEqual(expected.kind === "text" ? new TextEncoder().encode(expected.text) : expected.bytes);
  expect(await fs.readdir("/")).toEqual([]);
});
