import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import type {FileSystem} from "@poe-code/safe-fs/core";
import {createPandocCommand} from "./command.js";
import {createStandalonePandocCommand} from "./safe-bash.js";
import {createFileOutput} from "./file-output.js";
import {ExecutionContext} from "./execution.js";

const encoder = new TextEncoder();
function streamingFiles(fs: MemoryFileSystem, publish: NonNullable<FileSystem["publishFileConditional"]>): FileSystem {
  return new Proxy(fs, {get(target, key) {
    if (key === "capabilities") return {...target.capabilities, atomicFilePublication: true, atomicFileMutation: false, trustedOwnedStaging: false};
    if (key === "capabilitiesFor") return undefined;
    if (key === "publishFileConditional") return publish;
    if (key === "writeFileConditional") return undefined;
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  }});
}
async function run(fs: FileSystem, text: string) {
  let stderr = "";
  const result = await createPandocCommand().execute({
    command: "pandoc", args: ["-f", "csv", "-t", "html", "-o", "/result.html"],
    fs, cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: (async function* () {yield encoder.encode(text);})(),
    stdout: {async write() {throw new Error("unexpected stdout");}},
    stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
  });
  return {...result, stderr};
}

it("streams command file output through atomic publication without collecting input", async () => {
  const memory = new MemoryFileSystem();
  let total = 0;
  let largest = 0;
  const publish = vi.fn<NonNullable<FileSystem["publishFileConditional"]>>(async (_path, source, options) => {
    expect(options.expected).toBeNull();
    for await (const bytes of source) {total += bytes.length; largest = Math.max(largest, bytes.length);}
    return {...await memory.stat("/"), type: "file", size: total};
  });
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("input collector forbidden"));
  try {
    expect(await run(streamingFiles(memory, publish), "header\n" + "x".repeat(50000))).toEqual({exitCode: 0, stderr: ""});
    expect(publish).toHaveBeenCalledOnce();
    expect(total).toBeGreaterThan(50000);
    expect(largest).toBeLessThanOrEqual(16384);
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
});

it("preserves the destination when conversion fails before publication", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/result.html", encoder.encode("original"));
  const publish = vi.fn<NonNullable<FileSystem["publishFileConditional"]>>(async () => {throw new Error("must not publish");});
  expect(await run(streamingFiles(memory, publish), '"unterminated')).toMatchObject({exitCode: 4});
  expect(publish).not.toHaveBeenCalled();
  expect(new TextDecoder().decode(await memory.readFile("/result.html"))).toBe("original");
});

it("reports a failed atomic publication and closes its conversion", async () => {
  const memory = new MemoryFileSystem();
  const publish = vi.fn<NonNullable<FileSystem["publishFileConditional"]>>(async (_path, source) => {
    for await (const ignoredBytes of source) {throw new Error("publication unavailable");}
    throw new Error("empty publication");
  });
  expect(await run(streamingFiles(memory, publish), "header\n" + "x".repeat(50000))).toMatchObject({exitCode: 9});
  expect(publish).toHaveBeenCalledOnce();
  expect(await memory.readdir("/")).toEqual([]);
});

it("supports SDK conversion and awaits the atomic commit", async () => {
  const {createFileOutput} = await import("./file-output.js");
  const {convertToOutput} = await import("./engine.js");
  const memory = new MemoryFileSystem();
  let committed = false;
  const fs = streamingFiles(memory, async (path, source, options) => {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for await (const bytes of source) {chunks.push(bytes.slice()); length += bytes.length;}
    const data = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {data.set(chunk, offset); offset += chunk.length;}
    const result = await memory.writeFileConditional!(path, data, options);
    committed = true;
    return result;
  });
  const sink = createFileOutput(fs, "/result.html", {expected: null, parent: await fs.stat("/"), maxBytes: Infinity});
  await convertToOutput([{bytes: encoder.encode("a\nb")}], {from: "csv", to: "html"}, {
    workingFiles: {fs, directory: "/"}, output: sink
  });
  expect(committed).toBe(true);
  expect(new TextDecoder().decode(await fs.readFile("/result.html"))).toContain("<td>b</td>");
});

it("does not replace a destination changed during streamed publication", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/result.html", encoder.encode("original"));
  const fs = streamingFiles(memory, async (path, source, options) => {
    for await (const ignoredBytes of source) { /* Consume privately before committing. */ }
    await memory.writeFile(path, encoder.encode("concurrent writer"));
    return memory.writeFileConditional!(path, encoder.encode("converted"), options);
  });
  expect(await run(fs, "a\nb")).toMatchObject({exitCode: 9});
  expect(new TextDecoder().decode(await memory.readFile("/result.html"))).toBe("concurrent writer");
});

it("cancels and drains a live SDK file publisher", async () => {
  const {createFileOutput} = await import("./file-output.js");
  const {convertToOutput} = await import("./engine.js");
  const memory = new MemoryFileSystem();
  const controller = new AbortController();
  let retired = false;
  const fs = streamingFiles(memory, async (_path, source) => {
    try {
      for await (const ignoredBytes of source) controller.abort("cancel conversion");
      throw new Error("unexpected EOF");
    } finally {retired = true;}
  });
  const sink = createFileOutput(fs, "/result.html", {expected: null, parent: await fs.stat("/"), maxBytes: Infinity, signal: controller.signal});
  await expect(convertToOutput([{bytes: encoder.encode("a\n" + "x".repeat(50000))}], {from: "csv", to: "html"}, {
    workingFiles: {fs, directory: "/"}, output: sink, signal: controller.signal
  })).rejects.toMatchObject({code: "E_CANCELLED"});
  expect(retired).toBe(true);
  expect(await memory.readdir("/")).toEqual([]);
});

it("publishes an empty conversion only when its sink closes", async () => {
  const memory = new MemoryFileSystem();
  const publish = vi.fn<NonNullable<FileSystem["publishFileConditional"]>>(async (_path, source) => {
    for await (const bytes of source) expect(bytes.length).toBe(0);
    return {...await memory.stat("/"), type: "file", size: 0};
  });
  expect(await run(streamingFiles(memory, publish), "")).toEqual({exitCode: 0, stderr: ""});
  expect(publish).toHaveBeenCalledOnce();
});

it.each([false, true])("streams standalone file destinations with explicit sink authority (fs=%s)", async withFs => {
  const memory = new MemoryFileSystem();
  let total = 0;
  let largest = 0;
  let committed = false;
  const fs = streamingFiles(memory, async (_path, source) => {
    for await (const bytes of source) {total += bytes.length; largest = Math.max(largest, bytes.length);}
    committed = true;
    return {...await memory.stat("/"), type: "file", size: total};
  });
  const parent = await fs.stat("/");
  const createOutput = vi.fn((path: string, signal: AbortSignal) => {
    expect(path).toBe("/result.html");
    return createFileOutput(fs, path, {expected: null, parent, maxBytes: Infinity, signal});
  });
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("input collector forbidden"));
  const writeFile = vi.fn(async () => {throw new Error("buffered output forbidden");});
  const stderr = vi.fn(async () => {});
  try {
    expect(await createStandalonePandocCommand({workingFiles: {fs, directory: "/", cacheBytes: 16384}}).execute({
      args: ["-f", "csv", "-t", "html", "-o", "/result.html"],
      ...(withFs ? {fs} : {}), cwd: "/", createOutput, writeFile,
      signal: new AbortController().signal,
      stdin: (async function* () {yield encoder.encode("header\n" + "x".repeat(50000));})(),
      stdout: {async write() {throw new Error("unexpected stdout");}}, stderr: {write: stderr}
    })).toEqual({exitCode: 0});
    expect(stderr).not.toHaveBeenCalled();
    expect(createOutput).toHaveBeenCalledOnce();
    expect(committed).toBe(true);
    expect(total).toBeGreaterThan(50000);
    expect(largest).toBeLessThanOrEqual(16384);
    expect(writeFile).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
    expect(await memory.readdir("/")).toEqual([]);
  } finally {acquire.mockRestore();}
});

it.each(['"unterminated', "a\nb"])("does not acquire standalone output before parse and budget preflight (%s)", async text => {
  const createOutput = vi.fn(() => {throw new Error("destination must stay unopened");});
  let error = "";
  const result = await createStandalonePandocCommand({
    workingFiles: {fs: new MemoryFileSystem(), directory: "/"}, limits: {outputBytes: 1}
  }).execute({
    args: ["-f", "csv", "-t", "html", "-o", "/result.html"], createOutput,
    signal: new AbortController().signal,
    stdin: (async function* () {yield encoder.encode(text);})(),
    stdout: {async write() {throw new Error("unexpected stdout");}},
    stderr: {async write(bytes) {error += new TextDecoder().decode(bytes);}}
  });
  expect(result.exitCode).toBe(text.startsWith('"') ? 4 : 7);
  expect(error).toContain(text.startsWith('"') ? "E_PARSE" : "E_LIMIT");
  expect(createOutput).not.toHaveBeenCalled();
});

it.each(["empty", "write failure", "close failure", "cancel", "factory cancel", "factory failure"])("owns standalone destination lifecycle: %s", async mode => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  const reason = new Error(mode);
  let retired = false;
  const write = vi.fn(async () => {
    if (mode === "write failure") throw reason;
    if (mode === "cancel") controller.abort(reason);
  });
  const close = vi.fn(async () => {if (mode === "close failure") throw reason;});
  const abort = vi.fn(async () => {await Promise.resolve(); retired = true;});
  const createOutput = vi.fn(() => {
    if (mode === "factory failure") throw reason;
    if (mode === "factory cancel") controller.abort(reason);
    return {write, close, abort};
  });
  let error = "";
  const run = createStandalonePandocCommand({workingFiles: {fs, directory: "/"}}).execute({
    args: ["-f", "csv", "-t", "html", "-o", "/result.html"], createOutput,
    signal: controller.signal,
    stdin: (async function* () {yield encoder.encode(mode === "empty" ? "" : "a\nb");})(),
    stdout: {async write() {throw new Error("unexpected stdout");}},
    stderr: {async write(bytes) {error += new TextDecoder().decode(bytes);}}
  });
  if (mode === "cancel" || mode === "factory cancel") await expect(run).rejects.toBe(reason);
  else await expect(run).resolves.toEqual({exitCode: mode === "empty" ? 0 : 9});
  expect(createOutput).toHaveBeenCalledOnce();
  if (mode === "factory cancel") {expect(write).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();}
  if (mode === "empty") {
    expect(close).toHaveBeenCalledOnce();
    expect(abort).not.toHaveBeenCalled();
    expect(error).toBe("");
  } else if (mode !== "factory failure") {
    expect(abort).toHaveBeenCalledOnce();
    expect(retired).toBe(true);
  }
  if (mode === "write failure" || mode === "close failure" || mode === "factory failure") expect(error).toContain("E_IO");
  expect(await fs.readdir("/")).toEqual([]);
});
