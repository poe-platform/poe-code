import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { encodeWav } from "@poe-code/audio-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

async function run(bytes: Uint8Array, args: string[], mode = "success") {
  const base = new MemoryFileSystem(); await base.writeFile("/audio.wav", bytes);
  let reads = 0, closed = 0, output = "", diagnostic = "";
  const controller = new AbortController();
  const fs = new Proxy(base, { get(target, key) {
    if (key === "readFile") return () => { throw new Error("whole input forbidden"); };
    if (key === "openReadFile") return async () => ({
      stat: async () => ({ ...await base.stat("/audio.wav"), size: bytes.length }),
      async read(offset: number, length: number) { reads++; expect(length).toBeLessThanOrEqual(16384); if (mode === "short" && reads > 5) return new Uint8Array(0); if (mode === "read") throw new Error("retained failure"); if (mode === "cancel") controller.abort(new Error("cancelled input")); return bytes.slice(offset, offset + length); },
      async close() { closed++; if (mode === "close") throw new Error("close failure"); }
    });
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  let error: unknown;
  const result = await Promise.resolve(createFfprobeCommand().execute({ command: "ffprobe", ...createCommandArguments([...args, "/audio.wav"]), cwd: "/", env: {}, fs, signal: controller.signal,
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { expect(closed).toBe(1); output += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
  })).catch(value => { error = value; });
  return { result, error, reads, closed, output, diagnostic };
}
for (const format of ["json", "compact", "csv", "flat", "default"]) it(`retains automatic WAV audio schema for ${format}`, async () => {
  const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array([0, .5, -.5])] }, { tags: { title: "héllo", artist: "artist" } });
  const args = ["-of", format, "-show_format", "-show_streams", "-show_entries", "stream_tags:format_tags"];
  const result = await run(bytes, args);
  expect(result.result?.exitCode, result.diagnostic).toBe(0); expect(result.reads).toBeGreaterThan(0);
  expect(result.output).toBe(evalSyncFfprobe(undefined, [...args, "/audio.wav"], () => bytes));
});
it("preserves permissive media fallback when strict WAV layout rejects the input", async () => {
  const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(3)] });
  new DataView(bytes.buffer).setUint16(32, 7, true);
  const args = ["-of", "json", "-show_format", "-show_streams"];
  const result = await run(bytes, args);
  expect(result.result?.exitCode, result.diagnostic).toBe(0); expect(result.output).toBe(evalSyncFfprobe(undefined, [...args, "/audio.wav"], () => bytes));
});
for (const mode of ["read", "cancel", "close", "short"]) it(`closes automatic retained source on ${mode} failure`, async () => {
  const result = await run(encodeWav({ sampleRate: 8000, channels: [new Float64Array(3)] }), ["-show_format"], mode);
  expect(result.closed).toBe(1); expect(result.output).toBe("");
  if (mode === "cancel") expect(result.error).toEqual(new Error("cancelled input"));
  else { expect(result.result?.exitCode).toBe(1); expect(result.diagnostic).toContain(mode === "read" ? "retained failure" : mode === "short" ? "Truncated" : "close failure"); }
});
