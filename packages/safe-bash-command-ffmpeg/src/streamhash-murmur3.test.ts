import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const format of ["hash", "streamhash"]) {
  for (const [algorithm, expected] of [
    ["murmur3", "murmur3=81b0390e7c953515e71811328557c540"],
    ["MURMUR3", "murmur3=81b0390e7c953515e71811328557c540"],
    ["MuRmUr3", "murmur3=81b0390e7c953515e71811328557c540"],
    ["MD5", "MD5=2a320c6bc5da2cb4754423cad7b4ce18"],
    ["SHA160", "SHA160=7f3c7d30165a5e3d9c9b0ffe3034308f02253b1b"],
    ["unknown", undefined]
  ] as const) {
    for (const target of ["-", "/digest.txt"]) {
      it(`${format} ${algorithm} to ${target} matches native FFmpeg`, async () => {
        const volume = Volume.fromJSON({ "/digest.txt": "keep" });
        // Mono 8 kHz PCM16 fixture, verified against FFmpeg 7.0.2.
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length: 1600 }, (_, i) => (i * 8 - 6000) / 32768)] }));
        let stdout = "", stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav", "-hash", algorithm, "-f", format, target],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (expected === undefined) {
          assert.equal(result.exitCode, 234);
          assert.ok(stderr.includes("Unknown hash algorithm 'unknown'"), stderr);
          assert.equal(volume.readFileSync("/digest.txt", "utf8"), target === "-" ? "keep" : "");
          assert.equal(stdout, "");
        } else {
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
          assert.equal(target === "-" ? stdout : volume.readFileSync(target, "utf8"), `${format === "streamhash" ? "0,a," : ""}${expected}\n`);
          if (target !== "-") assert.equal(stdout, "");
        }
      });
    }
  }
}
