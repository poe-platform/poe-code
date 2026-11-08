import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const format of ["hash", "streamhash"]) {
  for (const streams of [1, 2]) {
    for (const algorithm of ["CRC32", "crc32"]) {
      it(`${format} ${algorithm} hashes complete payloads for ${streams} audio streams`, async () => {
        const fs = Volume.fromJSON({});
        for (let stream = 0; stream < streams; stream++) {
          fs.writeFileSync(`/${stream}.wav`, encodeWav({ sampleRate: 8000,
            channels: [Float64Array.from({ length: 1200 }, (_, i) => (i + 2000 * stream) / 32768)] }));
        }
        let stdout = "", stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", ...Array.from({ length: streams }, (_, i) => ["-i", `/${i}.wav`]).flat(),
            ...Array.from({ length: streams }, (_, i) => ["-map", `${i}:a`]).flat(),
            "-f", format, "-hash", algorithm, "-"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        // Native FFmpeg digests; each input spans multiple packets.
        assert.equal(stdout, format === "hash"
          ? `CRC32=${streams === 1 ? "8932ba13" : "872675ac"}\n`
          : `0,a,CRC32=8932ba13\n${streams === 2 ? "1,a,CRC32=c9a71d84\n" : ""}`);
      });
    }
  }
}
