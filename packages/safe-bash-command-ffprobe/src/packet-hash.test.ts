import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const route of ["file", "stdin", "explicit", "sync"]) {
  it(`hashes only WAV packet bytes through ${route}`, async () => {
    const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] });
    bytes.set(Uint8Array.from({ length: 32 }, (_, i) => i), 44);
    const args = ["-v", "error", "-of", "json", "-show_data_hash", "sha256", "-show_entries", "packet=data_hash,size",
      ...(route === "explicit" ? ["-f", "wav"] : []), route === "stdin" ? "-" : "/input.wav"];
    let output = "", error = "";
    if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input.wav", bytes);
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { error += new TextDecoder().decode(chunk); } }
      });
      expect(error).toBe(""); expect(result.exitCode).toBe(0);
    }
    expect(JSON.parse(output)).toEqual({ packets: [{ size: "32", data_hash: "SHA256:630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd" }] });
  });
}

it("hashes large payloads with bounded reads and excludes surrounding bytes", async () => {
  const { packetSourceHash, packetHash } = await import("./packet-hash.js");
  const bytes = Uint8Array.from({ length: 150010 }, (_, i) => i % 251);
  const reads: number[] = [];
  const value = packetSourceHash({ size: bytes.length, async read(offset, length) {
    reads.push(length); return bytes.subarray(offset, offset + length);
  } }, 5, 150000, "sha256");
  let actual = "";
  for await (const chunk of value.chunks()) actual += chunk;
  expect(actual).toBe(packetHash(bytes.subarray(5, 150005), "sha256"));
  expect(Math.max(...reads)).toBeLessThanOrEqual(65536);
  expect(reads.reduce((a, b) => a + b, 0)).toBe(150000);
});

it("rejects unsupported algorithms before reading input", async () => {
  const fs = new MemoryFileSystem();
  let error = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(["-show_data_hash", "invalid", "/missing.wav"]), cwd: "/", env: {}, fs,
    signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} },
    stderr: { async write(chunk) { error += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode).toBe(1);
  expect(error).toContain("Unknown hash algorithm 'invalid'");
});

it("supports uppercase algorithm names and field selection", () => {
  const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] });
  bytes.set(Uint8Array.from({ length: 32 }, (_, i) => i), 44);
  const args = ["-of", "json", "-show_data_hash", "MD5", "-show_entries"];
  const combined = JSON.parse(evalSyncFfprobe(undefined, [...args, "packet=data_hash,size", "/i.wav"], () => bytes)!);
  expect(combined.packets[0].data_hash).toBe("MD5:b4ffcb23737cec315a4a4d1aa2a620ce");
  expect(JSON.parse(evalSyncFfprobe(undefined, [...args, "packet=size", "/i.wav"], () => bytes)!))
    .toEqual({ packets: [{ size: "32" }] });
});
