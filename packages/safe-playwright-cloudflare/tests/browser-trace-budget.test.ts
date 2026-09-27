import { beforeEach, expect, test, vi } from "vitest";
import { EventEmitter } from "node:events";
import * as fsPromises from "node:fs/promises";
import { vol } from "memfs";
import { createPlaywrightAdapter } from "@poe-platform/safe-bash/playwright";
import { createCloudflarePlaywrightAdapter } from "../src/index.js";
import { NativeRecorder, progress, providerFixture } from "./browser-trace-budget.fixture.js";
import { createZipCodec } from "@poe-code/office-package/zip";
import { captureBrowserTrace } from "../src/browser-trace.js";
import { RealFileSystem } from "@poe-code/safe-fs/fs/real";

vi.mock("node:fs", async () => (await import("memfs")).fs);
vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
vi.mock("@poe-platform/safe-bash/playwright", async importOriginal => ({
  ...await importOriginal<typeof import("@poe-platform/safe-bash/playwright")>(),
  createPlaywrightAdapter: vi.fn(() => ({ acquire: vi.fn() })),
}));
const state = vi.hoisted(() => ({ resource: undefined as unknown }));
vi.mock("../src/shell-browser-resource.js", () => ({ acquireCloudflareBrowser: async () => state.resource }));
vi.mock("../src/browser-code-executor.js", () => ({ createBrowserCodeExecutor: () => async () => "" }));
vi.mock("../src/browser-codegen.js", () => ({ generateBrowserActionCode() {} }));
beforeEach(() => { vol.reset(); vol.mkdirSync("/tmp", { recursive: true }); });

async function acquire(limits = { maxBytes: 1024, maxFiles: 32, maxArchiveBytes: 1024 }) {
  const fixture = providerFixture();
  state.resource = fixture.resource;
  createCloudflarePlaywrightAdapter({} as Parameters<typeof createCloudflarePlaywrightAdapter>[0], undefined, undefined,
    { traceCapture: "archive", traceLimits: limits } as Parameters<typeof createCloudflarePlaywrightAdapter>[3]);
  const options = vi.mocked(createPlaywrightAdapter).mock.calls.at(-1)![0];
  const resource = await options.chromium!.acquireBrowser!({ signal: new AbortController().signal });
  await resource.browser.newContext();
  const check = () => (resource as typeof resource & { checkTrace(context: object, options: { signal: AbortSignal }): Promise<void> }).checkTrace(fixture.context, { signal: new AbortController().signal });
  return { ...fixture, resource, check };
}

test("rejects aggregate raw resources before the provider can retain a queue larger than the recording budget", async () => {
  const f = await acquire();
  try {
    await f.context.tracing.start();
    const recorder = f.recorders.at(-1)!;
    for (let i = 0; i < 20; i++) recorder._appendResource(`body-${i}`, new Uint8Array(128));
    const retained = recorder._fs.retained.reduce((total, value) => total + Buffer.byteLength(value), 0);
    expect(retained).toBeLessThanOrEqual(1024);
    expect(typeof (f.resource as { checkTrace?: unknown }).checkTrace).toBe("function");
    await expect(f.check()).rejects.toThrow("Browser trace byte limit exceeded");
    await expect(f.check()).rejects.toThrow("Browser trace byte limit exceeded");
    expect(recorder.stopped).toBe(true);
    await expect(f.context.tracing.stop({ path: "/tmp/overflow.zip" })).rejects.toThrow("Browser trace byte limit exceeded");
    expect(vol.existsSync("/tmp/overflow.zip")).toBe(false);
  } finally { await f.resource.release(); }
});

test("admits the exact UTF-8 boundary and refuses the next byte before a buffered append", async () => {
  const f = await acquire({ maxBytes: 64, maxFiles: 32, maxArchiveBytes: 1024 });
  try {
    await f.context.tracing.start();
    const recorder = f.recorders.at(-1)!;
    const path = recorder._state!.traceFile;
    recorder._fs.appendFile(path, "é".repeat(17), false);
    await f.check();
    expect(vol.readFileSync(path, "utf8")).toBe("trace\n" + "é".repeat(17));
    recorder._fs.appendFile(path, "x", false);
    expect(recorder._fs._buffers.has(path)).toBe(false);
    await expect(f.check()).rejects.toThrow("byte limit");
  } finally { await f.resource.release(); }
});

test("bounds zero-byte file entries, deduplicates hashes, and leaves sibling data and stacks intact", async () => {
  const f = await acquire({ maxBytes: 1024, maxFiles: 5, maxArchiveBytes: 1024 });
  vol.mkdirSync("/tmp/playwright-artifacts-shared/resources", { recursive: true });
  vol.writeFileSync("/tmp/playwright-artifacts-shared/resources/sibling", "private");
  const sibling = { callStacks: [] as unknown[], file: "/tmp/sibling.stacks", live: false, writer: Promise.resolve() };
  f.localUtils._stackSessions.set(sibling.file, sibling);
  await f.context.tracing.start();
  const recorder = f.recorders.at(-1)!;
  const directory = recorder._state!.tracesDir;
  recorder._appendResource("first", new Uint8Array());
  recorder._appendResource("first", new Uint8Array(2000));
  recorder._appendResource("second", new Uint8Array());
  await f.check();
  recorder._appendResource("third", new Uint8Array());
  await f.localUtils.addStackToTracingNoReply({ callData: { id: 42 } });
  await expect(f.check()).rejects.toThrow("file limit");
  await f.resource.release();
  expect(vol.existsSync(directory)).toBe(false);
  expect(vol.readFileSync("/tmp/playwright-artifacts-shared/resources/sibling", "utf8")).toBe("private");
  expect(sibling.callStacks).toEqual([{ id: 42 }]);
  expect(f.localUtils._stackSessions.get(sibling.file)).toBe(sibling);
});

test.each([false, true])("admits stack records before the provider retains them (live=%s)", async live => {
  const f = await acquire({ maxBytes: 600, maxFiles: 32, maxArchiveBytes: 1024 });
  try {
    await f.context.tracing.start({ _live: live });
    const stack = f.localUtils._stackSessions.get(f.context.tracing._stacksId!)!;
    for (let id = 0; id < 12; id++) await f.localUtils.addStackToTracingNoReply({ callData: { id, stack: [{ file: "é\\\"".repeat(24), function: "test", line: 1, column: 1 }] } });
    expect(stack.callStacks.length).toBeLessThan(12);
    await expect(f.check()).rejects.toThrow("byte limit");
  } finally { await f.resource.release(); }
});

test("charges overwritten queued versions until the admitted queue drains", async () => {
  const f = await acquire({ maxBytes: 64, maxFiles: 32, maxArchiveBytes: 1024 });
  try {
    await f.context.tracing.start();
    await f.check();
    const recorder = f.recorders.at(-1)!;
    const path = `${recorder._state!.resourcesDir}/replace`;
    let resume!: () => void;
    recorder._fs.pause = new Promise(resolve => { resume = resolve; });
    recorder._fs.writeFile(path, new Uint8Array(20));
    recorder._fs.writeFile(path, new Uint8Array(20));
    expect(recorder._fs.retained).toHaveLength(1);
    resume();
    await expect(f.check()).rejects.toThrow("byte limit");
  } finally { await f.resource.release(); }
});

test("releases superseded versions after flush rather than imposing a cumulative write quota", async () => {
  const f = await acquire({ maxBytes: 80, maxFiles: 32, maxArchiveBytes: 1024 });
  try {
    await f.context.tracing.start();
    const recorder = f.recorders.at(-1)!;
    const path = `${recorder._state!.resourcesDir}/replace`;
    for (let index = 0; index < 20; index++) { recorder._fs.writeFile(path, new Uint8Array(20)); await f.check(); }
    expect(vol.statSync(path).size).toBe(20);
  } finally { await f.resource.release(); }
});

test("exports the real entries-to-LocalUtils path as a bounded standard ZIP including Unicode stacks", async () => {
  const f = await acquire({ maxBytes: 16384, maxFiles: 64, maxArchiveBytes: 4096 });
  try {
    await f.context.tracing.start();
    const recorder = f.recorders.at(-1)!;
    recorder._appendResource("compressible", new Uint8Array(8192));
    await f.localUtils.addStackToTracingNoReply({ callData: { id: 123, stack: [{ file: "文\\\".ts", function: "é", line: 4, column: 9 }] } });
    await f.context.tracing.stop({ path: "/tmp/result.zip" });
    const bytes = vol.readFileSync("/tmp/result.zip") as Buffer;
    expect(bytes.byteLength).toBeLessThanOrEqual(4096);
    const codec = createZipCodec();
    const limits = { maxArchiveBytes: 4096, maxEntryBytes: 16384, maxTotalBytes: 16384, maxMembers: 64, maxPathBytes: 1024, maxDepth: 8, maxPaxBytes: 65535, maxTextBytes: 1024, chunkSize: 512 };
    const archive = await codec.readZipArchive(bytes, limits, new AbortController().signal);
    expect(archive.entries.map(entry => entry.name)).toEqual(["trace.trace", "trace.network", "resources/compressible", "trace.stacks"]);
    const chunks: Uint8Array[] = [];
    for await (const chunk of codec.decodeZipEntry(archive.entries.at(-1)!, limits, new AbortController().signal)) chunks.push(chunk);
    expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual({ files: ["文\\\".ts"], stacks: [[123, [[0, 4, 9, "é"]]]] });
    expect(f.localUtils._stackSessions.size).toBe(0);
  } finally { await f.resource.release(); }
});

test("refuses ZIP framing overflow before publishing a file", async () => {
  const f = await acquire({ maxBytes: 1024, maxFiles: 32, maxArchiveBytes: 32 });
  try {
    await f.context.tracing.start();
    await expect(f.context.tracing.stop({ path: "/tmp/oversize.zip" })).rejects.toThrow("archive byte or file limit");
    expect(vol.existsSync("/tmp/oversize.zip")).toBe(false);
    await expect(f.check()).rejects.toThrow("archive byte or file limit");
  } finally { await f.resource.release(); }
});

test("preserves native live capture lookup and gives restart a new root and dedup set", async () => {
  const f = await acquire();
  const fs = new RealFileSystem({ root: "/" });
  try {
    await f.context.tracing.start();
    const first = f.recorders.at(-1)!;
    const oldDirectory = first._state!.tracesDir;
    first._appendResource("reused", Uint8Array.of(7));
    const capture = () => captureBrowserTrace(f.context as never, { maxBytes: 1024, signal: new AbortController().signal }, fs);
    expect((await capture()).files.some(file => file.path === "resources/reused")).toBe(true);
    await f.context.tracing.stop();
    expect((await capture()).files.some(file => file.path === "resources/reused")).toBe(true);
    await f.context.tracing.start();
    const second = f.recorders.at(-1)!;
    second._appendResource("reused", Uint8Array.of(9));
    first._appendResource("late", new Uint8Array(2000));
    await f.check();
    expect(vol.existsSync(oldDirectory)).toBe(false);
    expect(vol.readFileSync(`${second._state!.resourcesDir}/reused`)).toEqual(Buffer.from([9]));
    expect(vol.existsSync(`${second._state!.resourcesDir}/late`)).toBe(false);
  } finally { await f.resource.release(); }
});

test("release during start drains startup and leaves no private recording directory", async () => {
  const f = await acquire();
  const start = f.context.tracing.start();
  await f.resource.release();
  await expect(start).rejects.toThrow("closed");
  expect(vol.readdirSync("/tmp")).toEqual([]);
  await f.resource.release();
});

test.each(["_onRequest", "_onAPIRequest"] as const)("bounds response headers while %s entries remain pending", async method => {
  const f = await acquire({ maxBytes: 256, maxFiles: 32, maxArchiveBytes: 1024 });
  try {
    await f.context.tracing.start();
    const recorder = f.recorders.at(-1)!;
    const request = { entry: { response: { headers: [] as { name: string; value: string }[], cookies: [] } } };
    recorder._harTracer[method](request);
    const entry = (request as unknown as Record<symbol, typeof request.entry>)[recorder._harTracer._entrySymbol]!;
    expect(recorder._pendingHarEntries.has(entry)).toBe(true);
    entry.response.headers.push({ name: "set-cookie", value: "x".repeat(512) });
    expect(entry.response.headers).toEqual([]);
    expect(request.entry.response.headers).toEqual([]);
    await expect(f.check()).rejects.toThrow("byte limit");
  } finally { await f.resource.release(); }
});

test("bounds retained HAR page titles changed after page entry creation", async () => {
  const f = await acquire({ maxBytes: 256, maxFiles: 32, maxArchiveBytes: 1024 });
  try {
    await f.context.tracing.start();
    const recorder = f.recorders.at(-1)!;
    const frame = new EventEmitter();
    const page = { title: "x".repeat(512), mainFrame: () => frame };
    const entry = recorder._harTracer._createPageEntryIfNeeded(page) as { title: string };
    recorder._harTracer._onDOMContentLoaded(page, entry);
    expect(entry.title).toBe("");
    await expect(f.check()).rejects.toThrow("byte limit");
  } finally { await f.resource.release(); }
});

test("retiring HAR metadata removes its exact native lifecycle listener and preserves other listeners", async () => {
  const f = await acquire();
  await f.context.tracing.start();
  const frame = new EventEmitter();
  const otherListener = () => {};
  frame.on("addlifecycle", otherListener);
  const recorder = f.recorders.at(-1)!;
  recorder._harTracer._createPageEntryIfNeeded({ title: "page", mainFrame: () => frame });
  expect(frame.listenerCount("addlifecycle")).toBe(2);
  await f.resource.release();
  expect(frame.listeners("addlifecycle")).toEqual([otherListener]);
});

test("replaces the active chunk's stack reservation without a cumulative record quota", async () => {
  const f = await acquire({ maxBytes: 256, maxFiles: 8, maxArchiveBytes: 1024 });
  try {
    await f.context.tracing.start();
    for (let index = 0; index < 20; index++) {
      await f.localUtils.addStackToTracingNoReply({ callData: { id: index } });
      await f.localUtils.tracingStarted({ tracesDir: f.context.tracing._tracesDir, traceName: "recording", live: false });
      await f.check();
    }
    expect(f.localUtils._stackSessions.size).toBe(1);
  } finally { await f.resource.release(); }
});

test("release removes only owned request symbols and clears metadata still held by a pending callback", async () => {
  const f = await acquire();
  await f.context.tracing.start();
  const recorder = f.recorders.at(-1)!;
  const request = { entry: { response: { headers: [{ name: "large", value: "x".repeat(128) }] } } };
  recorder._harTracer._onRequest(request);
  const stored = request as unknown as Record<symbol, typeof request.entry>;
  const proxy = stored[recorder._harTracer._entrySymbol]!;
  await f.resource.release();
  expect(stored[recorder._harTracer._entrySymbol]).toBeUndefined();
  expect(proxy.response.headers).toEqual([]);
  expect(request.entry.response.headers[0]!.value).toHaveLength(128);
});

test("a producer-stop failure cannot interrupt synchronous provider close notifications", async () => {
  const f = await acquire();
  await f.context.tracing.start();
  const recorder = f.recorders.at(-1)!;
  const directory = recorder._state!.tracesDir;
  const failure = new Error("native HAR stop failed");
  recorder._harTracer.stop = () => { throw failure; };
  expect(() => f.native.abort()).not.toThrow();
  const error = await f.resource.release().catch(error => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.errors.flatMap((error: unknown) => error instanceof AggregateError ? error.errors : [error])).toContain(failure);
  expect(vol.existsSync(directory)).toBe(false);
});

test("release during source stat preserves cancellation and drains export without a late artifact", async () => {
  const f = await acquire({ maxBytes: 4096, maxFiles: 32, maxArchiveBytes: 4096 });
  const source = "/tmp/source-stat.ts";
  const output = "/tmp/canceled-source.zip";
  vol.writeFileSync(source, "export const answer = 42;");
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const open = fsPromises.open;
  const openSpy = vi.spyOn(fsPromises, "open").mockImplementation(async (...args) => {
    const file = await open(...args);
    if (args[0] === source) {
      const stat = file.stat.bind(file);
      vi.spyOn(file, "stat").mockImplementationOnce(async () => {
        entered.resolve();
        await resume.promise;
        return stat();
      });
    }
    return file;
  });
  let exporting: Promise<void> | undefined;
  let releasing: Promise<void> | undefined;
  try {
    await f.context.tracing.start();
    const recorder = f.recorders.at(-1)!;
    const directory = recorder._state!.tracesDir;
    await f.localUtils.addStackToTracingNoReply({ callData: { id: 1, stack: [{ file: source, line: 1, column: 1 }] } });
    const { entries } = await f.native.stopChunk(undefined, { mode: "entries" });
    exporting = f.localUtils.zip({ entries: entries!, zipFile: output, stacksId: f.context.tracing._stacksId, mode: "write", includeSources: true }, progress);
    const outcome = exporting.catch(error => error);
    await Promise.race([entered.promise, exporting]);
    releasing = f.resource.release();
    resume.resolve();
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toBe("Browser trace recording closed");
    await releasing;
    expect(vol.existsSync(output)).toBe(false);
    expect(vol.existsSync(directory)).toBe(false);
    expect(vol.readFileSync(source, "utf8")).toBe("export const answer = 42;");
  } finally {
    resume.resolve();
    await exporting?.catch(() => {});
    try { await (releasing ?? f.resource.release()); }
    finally { openSpy.mockRestore(); }
  }
});

test("a native start failure after allocation cleans its recording and permits a fresh restart", async () => {
  const f = await acquire();
  const failure = new Error("Native tracing start failed after allocation");
  const originalStart = NativeRecorder.prototype.start;
  let failedDirectory: string | undefined;
  const start = vi.spyOn(NativeRecorder.prototype, "start").mockImplementationOnce(function (this: NativeRecorder, options) {
    originalStart.call(this, options);
    failedDirectory = this._state!.tracesDir;
    this._appendResource("body", Uint8Array.of(7));
    throw failure;
  });
  try {
    await expect(f.context.tracing.start()).rejects.toBe(failure);
    expect(failedDirectory).toBeDefined();
    expect(vol.existsSync(failedDirectory!)).toBe(false);
    expect(f.recorders.at(-1)!._state).toBeUndefined();
    expect(f.localUtils._stackSessions.size).toBe(0);
    await f.context.tracing.start();
    const restarted = f.recorders.at(-1)!;
    expect(restarted._state!.tracesDir).not.toBe(failedDirectory);
    restarted._appendResource("body", Uint8Array.of(9));
    await f.check();
    expect(vol.readFileSync(`${restarted._state!.resourcesDir}/body`)).toEqual(Buffer.from([9]));
    await f.context.tracing.stop({ path: "/tmp/restarted-after-start-failure.zip" });
    expect(vol.existsSync("/tmp/restarted-after-start-failure.zip")).toBe(true);
  } finally {
    start.mockRestore();
    await f.resource.release();
  }
});
