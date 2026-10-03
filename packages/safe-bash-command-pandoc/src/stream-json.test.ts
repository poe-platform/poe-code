import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
const encoder = new TextEncoder();

it("converts a complete Pandoc JSON tree without the input or document collectors", async () => {
  const input = encoder.encode('{"blocks":[{"c":[{"c":"' + "😀 text ".repeat(5000) + '","t":"Str"}],"t":"Para"}],"meta":{"z":{"t":"MetaString","c":"z"},"10":{"t":"MetaBool","c":true},"2":{"t":"MetaString","c":"two"}},"pandoc-api-version":[1e0,23,1,2]}');
  const expected = await convert([{bytes: input}], {from: "json", to: "json"}, {});
  const fs = new MemoryFileSystem();
  const open = vi.spyOn(fs, "open");
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("whole input forbidden"));
  const document = vi.spyOn(ExecutionContext.prototype, "decodeUtf8").mockRejectedValue(new Error("whole text forbidden"));
  let output = "", largest = 0;
  try {
    await convertToOutput([{chunks: (async function* () {for (let i = 0; i < input.length; i += 113) yield input.subarray(i, i + 113);})()}], {from: "json", to: "json"}, {
      workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {largest = Math.max(largest, bytes.length); output += new TextDecoder().decode(bytes); await Promise.resolve();}, async close() {}, async abort() {}}
    });
    expect(expected).toMatchObject({text: output});
    expect(largest).toBeLessThanOrEqual(16384);
    expect(open).toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
    expect(document).not.toHaveBeenCalled();
  } finally {acquire.mockRestore(); document.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("validates a late malformed node before publishing any prefix", async () => {
  const fs = new MemoryFileSystem(), write = vi.fn(async () => {});
  const text = JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "CodeBlock", c: [["",[],[]], "x".repeat(50000)]}, {t: "Header", c: [0,["",[],[]],[]]}]});
  await expect(convertToOutput([{bytes: encoder.encode(text)}], {from: "json", to: "json"}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, async close() {}, async abort() {}}
  })).rejects.toMatchObject({code: "E_AST"});
  expect(write).not.toHaveBeenCalled();
  expect(await fs.readdir("/")).toEqual([]);
});

it.each([4, 32])("keeps producer, backing I/O and sink chunks bounded as input grows (%i chunks)", async count => {
  const fs = new MemoryFileSystem();
  const open = fs.open.bind(fs);
  let liveHandles = 0, largestRead = 0, largestWrite = 0, backingWrites = 0;
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole-file read forbidden"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const descriptor = await open(...args);
    liveHandles++;
    const read = descriptor.read.bind(descriptor), write = descriptor.write.bind(descriptor), close = descriptor.close.bind(descriptor);
    vi.spyOn(descriptor, "read").mockImplementation(async (bytes, ...rest) => {largestRead = Math.max(largestRead, bytes.length); return read(bytes, ...rest);});
    vi.spyOn(descriptor, "write").mockImplementation(async (bytes, ...rest) => {largestWrite = Math.max(largestWrite, bytes.length); backingWrites += bytes.length; return write(bytes, ...rest);});
    vi.spyOn(descriptor, "close").mockImplementation(async options => {try {await close(options);} finally {liveHandles--;}});
    return descriptor;
  });
  let sinkBytes = 0, outstanding = 0, highWater = 0;
  const prefix = '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"CodeBlock","c":[["",[],[]],"';
  const suffix = '"]}]}\n';
  await convertToOutput([{chunks: (async function* () {
    yield encoder.encode(prefix);
    const reused = new Uint8Array(8192);
    for (let i = 0; i < count; i++) {reused.fill(97 + i % 26); yield reused;}
    yield encoder.encode(suffix);
  })()}], {from: "json", to: "json"}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
      async write(chunk) {
        outstanding += chunk.length; highWater = Math.max(highWater, outstanding);
        await Promise.resolve();
        for (const byte of chunk) {
          if (sinkBytes >= prefix.length && sinkBytes < prefix.length + count * 8192 && byte !== 97 + Math.floor((sinkBytes - prefix.length) / 8192) % 26) throw new Error("Borrowed input buffer was not owned");
          sinkBytes++;
        }
        outstanding -= chunk.length;
      }, async close() {}, async abort() {}
    }
  });
  expect(sinkBytes).toBe(prefix.length + count * 8192 + suffix.length);
  expect(highWater).toBeLessThanOrEqual(16384);
  expect(largestRead).toBeLessThanOrEqual(16384);
  expect(largestWrite).toBeLessThanOrEqual(16384);
  expect(backingWrites).toBeGreaterThan(count * 8192);
  expect(liveHandles).toBe(0);
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["lf", "crlf"] as const)("preflights finite JSON output limits (%s)", async eol => {
  const input = [{bytes: encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Para","c":[{"t":"Str","c":"😀"}]}]}')}];
  const expected = await convert(input, {from: "json", to: "json", eol}, {});
  if (expected.kind !== "text") throw new Error("Expected JSON");
  const bytes = encoder.encode(expected.text).length;
  for (const outputBytes of [bytes, bytes - 1]) {
    const fs = new MemoryFileSystem();
    let output = "";
    const write = vi.fn(async (chunk: Uint8Array) => {output += new TextDecoder().decode(chunk);});
    const conversion = convertToOutput(input, {from: "json", to: "json", eol}, {
      limits: {outputBytes}, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, async close() {}, async abort() {}}
    });
    if (outputBytes === bytes) {await conversion; expect(output).toBe(expected.text);}
    else {await expect(conversion).rejects.toMatchObject({code: "E_LIMIT"}); expect(write).not.toHaveBeenCalled();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});

it.each(["input", "output", "cancel"])("cleans retained documents on %s failure", async failure => {
  const fs = new MemoryFileSystem(), controller = new AbortController();
  const closed = vi.fn(), abort = vi.fn(async () => {});
  const write = vi.fn(async () => {if (failure === "output") throw new Error("sink failed");});
  const source = (async function* () {
    try {
      yield encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Para","c":[{"t":"Str","c":"');
      const chunk = new Uint8Array(8192).fill(97);
      for (let index = 0; index < 8; index++) yield chunk;
      if (failure === "input") throw new Error("source failed");
      if (failure === "cancel") controller.abort();
      yield encoder.encode('"}]}]}');
    } finally {closed();}
  })();
  await expect(convertToOutput([{chunks: source}], {from: "json", to: "json"}, {
    signal: controller.signal, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write, async close() {}, abort}
  })).rejects.toMatchObject({code: failure === "cancel" ? "E_CANCELLED" : "E_IO"});
  expect(closed).toHaveBeenCalledOnce();
  if (failure !== "output") expect(write).not.toHaveBeenCalled();
  else expect(abort).toHaveBeenCalledOnce();
  expect(await fs.readdir("/")).toEqual([]);
});

it("traverses deeply nested document blocks without a resident recursion stack", async () => {
  const fs = new MemoryFileSystem();
  const depth = 1200;
  let length = 0;
  await convertToOutput([{chunks: (async function* () {
    yield encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[');
    const opening = encoder.encode('{"t":"BlockQuote","c":['), closing = encoder.encode(']}');
    for (let i = 0; i < depth; i++) yield opening;
    yield encoder.encode('{"t":"HorizontalRule"}');
    for (let i = 0; i < depth; i++) yield closing;
    yield encoder.encode(']}');
  })()}], {from: "json", to: "json"}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384},
    output: {async write(chunk) {length += chunk.length;}, async close() {}, async abort() {}}
  });
  expect(length).toBeGreaterThan(depth * 20);
  expect(await fs.readdir("/")).toEqual([]);
});

it("uses the same retained document path from the command", async () => {
  const {createPandocCommand} = await import("./command.js");
  const fs = new MemoryFileSystem();
  const text = '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"HorizontalRule"}]}';
  await fs.writeFile("/document.json", encoder.encode(text));
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  const read = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file forbidden"));
  let output = "", error = "";
  try {
    expect(await createPandocCommand().execute({
      command: "pandoc", args: ["-f", "json", "-t", "json", "/document.json"],
      cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
      stderr: {async write(bytes) {error += new TextDecoder().decode(bytes);}}
    })).toEqual({exitCode: 0});
    expect(error).toBe("");
    expect(output).toBe(text + "\n");
    expect(read).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
});

it("preserves the parser failure when the input iterator also fails cleanup", async () => {
  const fs = new MemoryFileSystem();
  let reads = 0;
  const close = vi.fn(async (): Promise<IteratorResult<Uint8Array>> => {throw new Error("cleanup failure");});
  const chunks: AsyncIterableIterator<Uint8Array> = {
    [Symbol.asyncIterator]() {return this;},
    async next() {reads++; return {done: false as const, value: encoder.encode("?")};},
    return: close
  };
  await expect(convertToOutput([{chunks}], {from: "json", to: "json"}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384},
    output: {async write() {}, async close() {}, async abort() {}}
  })).rejects.toMatchObject({code: "E_AST", message: "Expected JSON value"});
  expect(reads).toBe(1);
  expect(close).toHaveBeenCalledOnce();
  expect(await fs.readdir("/")).toEqual([]);
});

it("preserves normalized BOM and CRLF syntax error offsets across chunks", async () => {
  const bytes = encoder.encode("\ufeff\r\n \r?");
  let legacy: unknown;
  try {await convert([{bytes}], {from: "json", to: "json"}, {});} catch (error) {legacy = error;}
  expect(legacy).toMatchObject({code: "E_AST"});
  const fs = new MemoryFileSystem();
  await expect(convertToOutput([{chunks: (async function* () {for (const byte of bytes) yield Uint8Array.of(byte);})()}], {from: "json", to: "json"}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384},
    output: {async write() {}, async close() {}, async abort() {}}
  })).rejects.toMatchObject({code: "E_AST", location: (legacy as {location: string}).location});
});

it("retains operand identity on JSON parse errors", async () => {
  const input = {source: "docs/broken.json", bytes: encoder.encode("?")};
  let legacy: unknown;
  try {await convert([input], {from: "json", to: "json"}, {});} catch (error) {legacy = error;}
  await expect(convertToOutput([input], {from: "json", to: "json"}, {
    workingFiles: {fs: new MemoryFileSystem(), directory: "/"},
    output: {async write() {}, async close() {}, async abort() {}}
  })).rejects.toMatchObject({code: "E_AST", location: (legacy as {location: string}).location});
});


it("preserves AST diagnostics for a forbidden metadata key after a valid value", async () => {
  const bytes = encoder.encode('{"pandoc-api-version":[1,23,1,2],"meta":{"valid":{"t":"MetaString","c":"ok"},"constructor":{"t":"MetaString","c":"bad"}},"blocks":[]}');
  const fs = new MemoryFileSystem(), write = vi.fn(async () => {});
  await expect(convertToOutput([{bytes}], {from: "json", to: "json"}, {
    workingFiles: {fs, directory: "/", cacheBytes: 16384},
    output: {write, async close() {}, async abort() {}}
  })).rejects.toMatchObject({code: "E_AST", location: "$.meta.constructor"});
  expect(write).not.toHaveBeenCalled();
  expect(await fs.readdir("/")).toEqual([]);
});
