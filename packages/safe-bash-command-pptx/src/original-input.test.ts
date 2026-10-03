import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createPptxCommand, type PptxCommandEngine } from "./index.js";
import { test, expect } from "vitest";
import { FsError, type FileSystem } from "@poe-code/safe-fs/core";
import { verifyOriginalInput } from "./original-input.js";

const size = 1024 * 1024 + 17;
const original = new Uint8Array(size).fill(42);

for (const mode of ["same", "changed", "short", "long", "error", "cancel"] as const) {
  test(`original input comparison streams reused chunks: ${mode}`, async () => {
    const controller = new AbortController();
    let closed = false;
    let reads = 0;
    const fs = createMemoryFileSystem();
    fs.capabilitiesFor = async () => ({ ...fs.capabilities, retainedRead: false });
    fs.readFile = async () => { throw new Error("payload-wide read forbidden"); };
    fs.readStream = async function* (_path, options) {
        expect(options?.chunkSize).toBe(65536);
        const chunk = new Uint8Array(options?.chunkSize ?? 65536);
        try {
          const length = size + (mode === "short" ? -1 : mode === "long" ? 1 : 0);
          for (let offset = 0; offset < length; offset += chunk.length) {
            reads++;
            chunk.fill(42);
            if (offset && mode === "error") throw new FsError("EIO");
            if (offset && mode === "cancel") controller.abort(new Error("cancelled"));
            if (offset && mode === "changed") chunk[0] = 43;
            yield chunk.subarray(0, Math.min(chunk.length, length - offset));
          }
        } finally { closed = true; }
    };
    const verification = verifyOriginalInput(fs, "/deck.pptx", original, controller.signal);
    if (mode === "same") await verification;
    else if (mode === "cancel") await expect(verification).rejects.toThrow("cancelled");
    else await expect(verification).rejects.toMatchObject({ code: mode === "error" ? "EIO" : "EAGAIN" });
    expect(closed).toBe(true);
    expect(reads).toBeLessThanOrEqual(Math.ceil((size + 1) / 65536));
  });
}

test("unsupported stream falls back only before yielding bytes", async () => {
  let bufferedReads = 0;
  const fs = {
    capabilities: { streamingRead: true },
    async *readStream() { throw new FsError("ENOTSUP"); yield new Uint8Array(); },
    async readFile() { bufferedReads++; return original; }
  } as unknown as FileSystem;
  await verifyOriginalInput(fs, "/deck.pptx", original, new AbortController().signal);
  expect(bufferedReads).toBe(1);
  fs.readStream = async function* () {
    yield original.subarray(0, 1);
    throw new FsError("ENOTSUP");
  };
  await expect(verifyOriginalInput(fs, "/deck.pptx", original, new AbortController().signal)).rejects.toMatchObject({ code: "ENOTSUP" });
  expect(bufferedReads).toBe(1);
});


for (const changed of [false, true]) test(`in-place publication uses streamed conflict verification: changed=${changed}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/deck.pptx", original);
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, retainedRead: false });
  const readStream = fs.readStream!.bind(fs);
  let reads = 0;
  fs.readFile = async () => { throw new Error("payload-wide read forbidden"); };
  fs.readStream = async function* (path, options) {
    reads++;
    for await (const chunk of readStream(path, options)) {
      if (changed && reads === 2 && chunk.length) chunk[0] = 43;
      yield chunk;
    }
  };
  let published = false;
  const write = fs.writeFileConditional!.bind(fs);
  fs.writeFileConditional = async (...args) => {
    published = true;
    return write(...args);
  };
  const engine: PptxCommandEngine = {
    async execute(request) {
      const before = await request.readInput("deck.pptx", Infinity);
      await request.publishOutput!({
        inputPath: "deck.pptx", outputPath: "deck.pptx",
        bytes: new Uint8Array([1, 2, 3]), originalBytes: before,
        inPlace: true, force: false, dryRun: false
      });
      return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
    }
  };
  const values = createCommandArguments([]);
  const execution = Promise.resolve(createPptxCommand({ engine }).execute({
    command: "pptx", args: values.args, argumentValues: values,
    cwd: "/", env: {}, fs, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} },
    signal: new AbortController().signal
  }));
  if (changed) await expect(execution).rejects.toMatchObject({ code: "stale-input" });
  else expect((await execution).exitCode).toBe(0);
  expect(reads).toBe(2);
  expect(published).toBe(!changed);
});

for (const mode of ["same", "changed", "error", "cancel", "oversized"] as const) {
  test(`retained verification closes and bounds each range: ${mode}`, async () => {
    const controller = new AbortController();
    let closed = 0;
    let reads = 0;
    const buffer = new Uint8Array(65537).fill(42);
    const fs = createMemoryFileSystem();
    expect(fs.capabilities.retainedRead).toBe(true);
    fs.readFile = async () => { throw new Error("payload-wide read forbidden"); };
    fs.readStream = async function* () { throw new Error("retained read required"); yield buffer; };
    fs.openReadFile = async () => ({
      stat: async () => { throw new Error("unneeded stat"); },
      async read(position, maximum) {
        reads++;
        expect(maximum).toBeLessThanOrEqual(65536);
        buffer.fill(mode === "changed" ? 43 : 42);
        if (reads > 1 && mode === "error") throw new FsError("EIO");
        if (reads > 1 && mode === "cancel") controller.abort(new Error("cancelled"));
        return buffer.subarray(0, mode === "oversized" ? maximum + 1 : Math.min(maximum, size - position));
      },
      async close() { closed++; }
    });
    const verification = verifyOriginalInput(fs, "/deck.pptx", original, controller.signal);
    if (mode === "same") await verification;
    else if (mode === "cancel") await expect(verification).rejects.toThrow("cancelled");
    else await expect(verification).rejects.toMatchObject({ code: mode === "changed" ? "EAGAIN" : "EIO" });
    expect(closed).toBe(1);
  });
}
