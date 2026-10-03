import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import type {FileSystem} from "@poe-code/safe-fs/core";
import {createPandocCommand} from "./command.js";
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
