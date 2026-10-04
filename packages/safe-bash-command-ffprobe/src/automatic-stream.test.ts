import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { encodeWav } from "@poe-code/audio-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

async function run(route: "file" | "stdin", mode = "success", extra: string[] = []) {
  const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(65536)] }, { tags: { title: "streamed title" } });
  if (mode === "fallback") new DataView(bytes.buffer).setUint16(32, 7, true);
  const args = ["-of", "json", "-show_streams", "-show_format", ...extra, route === "stdin" ? "-" : "/input.wav"];
  const expected = evalSyncFfprobe(route === "stdin" ? bytes : undefined, args, () => bytes);
  const base = new MemoryFileSystem(), controller = new AbortController();
  let reads = 0, sourceClosed = false, opened = 0, closed = 0, output = "", diagnostic = "", admitted = 0;
  async function* source() {
    const borrowed = new Uint8Array(8192);
    try {
      // Exercise a signature split across the first several chunks.
      for (let offset = 0; offset < bytes.length;) {
        const length = Math.min(offset < 12 ? 3 : borrowed.length, bytes.length - offset);
        borrowed.set(bytes.subarray(offset, offset + length)); offset += length; reads++;
        if (mode === "source" && reads === 10) throw new Error("source failed");
        if (mode === "cancel" && reads === 10) controller.abort(new Error("cancelled input"));
        yield borrowed.subarray(0, length);
      }
    } finally { sourceClosed = true; }
  }
  const capabilities = { ...base.capabilities, retainedRead: false, streamingRead: true };
  const fs = new Proxy(base, { get(target, key) {
    if (key === "capabilities") return capabilities;
    if (key === "capabilitiesFor") return async () => capabilities;
    if (key === "openReadFile") return undefined;
    if (key === "readFile") return () => { throw new Error("whole input forbidden"); };
    if (key === "readStream") return () => source();
    if (key === "open") return async (...args: Parameters<typeof base.open>) => {
      const handle = await base.open(...args); opened++;
      return new Proxy(handle, { get(resource, name) {
        if (name === "write") return async (...values: Parameters<typeof handle.write>) => { if (mode === "backing") throw new Error("backing failed"); return handle.write(...values); };
        if (name === "close") return async () => { closed++; await handle.close(); if (mode === "close") throw new Error("close failed"); };
        const value = Reflect.get(resource, name, resource); return typeof value === "function" ? value.bind(resource) : value;
      } });
    };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  let error: unknown;
  const result = await Promise.resolve(createFfprobeCommand({ limits: { maxInputBytes: mode === "tiny-limit" ? 5 : mode === "limit" ? 70000 : bytes.length } }).execute({
    command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs, signal: controller.signal,
    inputBudget: { maxBytes: bytes.length, check(size) { admitted = size; } },
    stdin: route === "stdin" ? source() : { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { expect(sourceClosed).toBe(true); expect(opened).toBe(closed); if (mode === "sink") throw Object.assign(new Error("sink failed"), { code: "EPIPE" }); output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  })).catch(reason => { error = reason; });
  return { result, error, reads, sourceClosed, opened, closed, output, diagnostic, admitted, expected, size: bytes.length, remaining: await base.readdir("/") };
}
for (const route of ["stdin", "file"] as const) {
  for (const mode of ["success", "fallback"]) it(`stages automatic WAV ${route} input with ${mode} schema`, async () => {
    const r = await run(route, mode); expect(r.result?.exitCode, r.diagnostic).toBe(0); expect(r.output).toBe(r.expected);
    expect(r.opened).toBe(1); expect(r.closed).toBe(1); expect(r.sourceClosed).toBe(true); expect(r.remaining).toEqual([]); expect(r.admitted).toBe(r.size);
  });
  for (const mode of ["source", "cancel", "backing", "close", "limit", "sink"]) it(`cleans automatic ${route} input on ${mode} failure`, async () => {
    const r = await run(route, mode); expect(r.output).toBe(""); expect(r.sourceClosed).toBe(true); expect(r.opened).toBe(r.closed); expect(r.remaining).toEqual([]);
    if (mode === "cancel") expect(r.error).toEqual(new Error("cancelled input"));
    else if (mode === "sink") expect(r.error).toMatchObject({ code: "EPIPE" });
    else { expect(r.result?.exitCode).toBe(1); expect(r.diagnostic).toContain(mode === "limit" ? "maxInputBytes" : mode + " failed"); }
  });
}

it("checks the input budget before reading beyond a split signature", async () => {
  const r = await run("stdin", "tiny-limit");
  expect(r.result?.exitCode).toBe(1); expect(r.reads).toBe(2); expect(r.sourceClosed).toBe(true); expect(r.opened).toBe(0);
});

it.each([{ extra: [] }, { extra: ["-show_packets"] }, { extra: ["-of", "json=c=1"] }])("preserves a non-WAV stdin probe after signature replay: $extra", async ({ extra }) => {
  const bytes = new Uint8Array(42); bytes.set([102, 76, 97, 67, 128, 0, 0, 34]);
  const view = new DataView(bytes.buffer); view.setUint16(8, 16); view.setUint16(10, 16);
  view.setBigUint64(18, (8000n << 44n) | (15n << 36n) | 8n);
  const args = ["-of", "json", "-show_streams", "-show_format", ...extra, "-"];
  const expected = evalSyncFfprobe(bytes, args); expect(expected).toBeTypeOf("string");
  let output = "", diagnostic = "", closed = false;
  const checks: number[] = [];
  async function* source() { const borrowed = new Uint8Array(3); try {
    for (let offset = 0; offset < bytes.length; offset += 3) { borrowed.set(bytes.subarray(offset, offset + 3)); yield borrowed; }
  } finally { closed = true; } }
  const result = await createFfprobeCommand().execute({ command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: new AbortController().signal,
    inputBudget: { maxBytes: bytes.length, check(total) { checks.push(total); } }, stdin: source(),
    stdout: { async write(chunk) { expect(closed).toBe(true); output += new TextDecoder().decode(chunk); } }, stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0); expect(output).toBe(expected);
  expect(checks).toEqual(Array.from({ length: 14 }, (_, i) => (i + 1) * 3));
});

for (const route of ["stdin", "file"] as const) {
  for (const extra of [["-show_packets", "-show_frames"], ["-count_packets", "-count_frames"], ["-of", "json=c=1"], ["-show_chapters", "-show_programs"]]) {
    it(`streams automatic media-only WAV ${route}: ${extra.join(" ")}`, async () => {
      const r = await run(route, "success", extra);
      expect(r.expected).toBeTypeOf("string");
      expect(r.result?.exitCode, r.diagnostic).toBe(0); expect(r.output).toBe(r.expected);
      expect(r.sourceClosed).toBe(true); expect(r.admitted).toBe(r.size);
      // This small result needs no spill; streaming media headers need no input backing.
      expect(r.opened).toBe(0); expect(r.remaining).toEqual([]);
    });
  }
}

for (const route of ["stdin", "file"] as const) {
  for (const mode of ["source", "cancel", "limit", "sink"]) it(`cleans automatic media-only ${route} on ${mode}`, async () => {
    const r = await run(route, mode, ["-show_packets", "-show_frames"]);
    expect(r.output).toBe(""); expect(r.sourceClosed).toBe(true); expect(r.opened).toBe(0); expect(r.remaining).toEqual([]);
    if (mode === "cancel") expect(r.error).toEqual(new Error("cancelled input"));
    else if (mode === "sink") expect(r.error).toMatchObject({ code: "EPIPE" });
    else { expect(r.result?.exitCode).toBe(1); expect(r.diagnostic).toContain(mode === "limit" ? "maxInputBytes" : "source failed"); }
  });
}
