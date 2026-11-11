import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete PCM16 output from FFmpeg 7.0.2 for twelve samples of 1000 at 8 kHz.
const unchanged = [577, 1122, 1028, 1055, 1048, 1045, 1054, 1041, 1055, 1042, 1054, 1044];
for (const option of ["level_in", "level_out"]) {
  for (const value of ["0", "none", "all+1", "all+2", "all"]) {
    for (const timed of [false, true]) {
      for (const complex of [false, true]) {
        it(`resolves aemphasis ${option}=${value} (${timed ? "scheduled" : "static"}, ${complex ? "graph" : "simple"})`, async () => {
          const volume = Volume.fromJSON({ "/out.raw": "existing" });
          volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
            channels: [Float64Array.from({ length: 12 }, () => 1000 / 32768)] }));
          const filter = timed
            ? `asetnsamples=n=2:p=0,asendcmd=c='0.0005 aemphasis@x ${option} ${value}',aemphasis@x`
            : `aemphasis=${option}=${value}`;
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-y", "-v", "error", "-i", "/in.wav", ...(complex
              ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
              "-f", "s16le", "/out.raw"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          if (!timed && value === "all") {
            assert.equal(result.exitCode, 222, stderr);
            assert.equal(volume.readFileSync("/out.raw", "utf8"), "existing");
            return;
          }
          assert.equal(result.exitCode, 0, stderr);
          const expected = value === "all" || value === "all+2" ? unchanged
            : !timed ? Array(12).fill(0)
              : option === "level_in" ? [577, 1122, 1028, 1055, 471, -78, 26, -13, 7, -3, 0, 2]
                : [577, 1122, 1028, 1055, ...Array(8).fill(0)];
          const pcm = volume.readFileSync("/out.raw") as Buffer;
          assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)), expected);
        });
      }
    }
  }
}
