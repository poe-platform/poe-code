import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const explicit of [true, false]) for (const route of ["retained", "stream", "stdin"]) for (const writer of ["json", "json=c=1", "default", "csv", "flat", "compact"]) {
  it(`preserves ${explicit ? "explicit" : "automatic"} FLAC ${writer} output via injected ${route} input`, async () => {
    const bytes = new Uint8Array(131072); bytes.set([102, 76, 97, 67, 128, 0, 0, 34]);
    new DataView(bytes.buffer).setBigUint64(18, (48000n << 44n) | (1n << 41n) | (15n << 36n) | 96000n);
    const base = new MemoryFileSystem(); await base.writeFile("/input.flac", bytes);
    const args = [...(explicit ? ["-f", "flac"] : []), "-of", writer, "-show_format", "-show_streams", "-show_packets", "-show_frames", "-count_packets", "-count_frames", route === "stdin" ? "-" : "/input.flac"];
    const expected = evalSyncFfprobe(bytes, args, () => bytes);
    let closed = false, output = "", admitted = 0;
    const capabilities = { ...base.capabilities, retainedRead: route === "retained", streamingRead: route !== "retained" };
    async function* chunks() { const borrowed = new Uint8Array(13); try {
      for (let pos = 0; pos < bytes.length; pos += borrowed.length) { const size = Math.min(borrowed.length, bytes.length - pos); borrowed.set(bytes.subarray(pos, pos + size)); yield borrowed.subarray(0, size); }
    } finally { closed = true; } }
    const fs = new Proxy(base, { get(target, key) {
      if (key === "capabilities") return capabilities;
      if (key === "capabilitiesFor") return async () => capabilities;
      if (key === "readFile") return () => { throw new Error("whole input forbidden"); };
      if (key === "readStream") return () => chunks();
      if (key === "openReadFile") return async () => ({ stat: () => base.stat("/input.flac"), async read(offset: number, length: number) { expect(offset + length).toBeLessThanOrEqual(42); return bytes.slice(offset, offset + length); }, async close() { closed = true; } });
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = await createFfprobeCommand().execute({ command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs, signal: new AbortController().signal,
      inputBudget: { maxBytes: bytes.length, check(total) { admitted = total; } }, stdin: route === "stdin" ? chunks() : { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { expect(closed).toBe(true); output += new TextDecoder().decode(chunk); } }, stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
    });
    expect(result.exitCode).toBe(0); expect(output).toBe(expected); expect(admitted).toBe(bytes.length);
  });
}
