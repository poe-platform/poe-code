import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  // Complete PCM16 references from native FFmpeg 7.0.2 with these generated WAV inputs.
  for (const [pattern, length, filter, hash, samples] of [
    ["pulse", 2400, "alimiter=limit=0.25:level=0:latency=1:release=400:asc=0", "d5de19ef80ce8dc6471c82b0017828bfc910cca7f3ef3b17529ed349b5b964bd", 2400],
    ["pulse", 2400, "alimiter=limit=0.25:level=0:latency=1:release=400:asc=1:asc_level=0", "81c1ab70b0af8afed561184df4ce16a7ddac0e6e3a994a29a3067d7e042ac0ac", 2400],
    ["pulse", 2400, "alimiter=limit=0.25:level=0:latency=1:release=400:asc=1:asc_level=0.5", "81c1ab70b0af8afed561184df4ce16a7ddac0e6e3a994a29a3067d7e042ac0ac", 2400],
    ["pulse", 2400, "alimiter=limit=0.25:level=0:latency=1:release=400:asc=1:asc_level=1", "81c1ab70b0af8afed561184df4ce16a7ddac0e6e3a994a29a3067d7e042ac0ac", 2400],
    ["pulse", 2400, "alimiter=limit=0.25:level=0:release=400:asc=1", "24fd3d6f7a485a3af5b5b3a44ddcc3d7aba60ff68dd445df74657258052aa771", 2400],
    ["pulse", 2400, "alimiter=level_in=2:level_out=0.5:limit=0.4:attack=2:release=10:asc=1:latency=1", "1a82e37cce8a624b08d84864ffdfdc4f48214d20d89c4dcd8d2d54b18b0062a8", 2400],
    ["pulse", 2400, "alimiter=limit=0.25:attack=80:release=8000:level=0:asc=1:latency=1", "ad4f3aa1586469876db9f61ff7a1c7e16d23ce4939a3eb30683936d0fbc335ab", 2400],
    ["pulse", 2400, "alimiter=1:1:0.25:5:400:1:0.5:0:1", "81c1ab70b0af8afed561184df4ce16a7ddac0e6e3a994a29a3067d7e042ac0ac", 2400],
    ["pulse", 2400, "asetnsamples=n=200:p=0,alimiter=limit=0.25:level=0:latency=1:release=400:asc=1:enable=mod(n\\,2)", "11ef4bdfce6bbbdfae0e550bf39a27baa184ff4b53ba92554d6cbd89bc108de7", 2400],
    ["pulse", 2400, "alimiter=limit=0.25:level=0:latency=1:release=400:asc=1,aselect=eq(n\\,0)", "e30f489fc02eae80158e3d9dd2cb197f8896e944a01b9709cc51dfcd24a8f71f", 473],
    ["stereo", 2400, "alimiter=limit=0.25:level=0:latency=1:release=400:asc=1", "3a17345ef82cd628ac82c92ba2e79d10e13a4342965fab0482d23e57d411afa9", 2400],
    ["pulse", 7, "alimiter=limit=0.25:level=0:latency=1:release=400:asc=1", "a36a7ec4d8f640f297614a1f56b343e89cec1a9dbe739114b173e5cce085fdf5", 7],
    ["silence", 2400, "alimiter=limit=0.25:level=0:latency=1:release=400:asc=1", "24ddaa4710480313757f965c38d60208a334556cb244f830d5006a893edd8da7", 2400],
    ["quiet", 2400, "alimiter=limit=0.25:level=0:latency=1:release=400:asc=1", "c205fed8256ae8638fb235162d1a44706f12a802af9008393810bb011e35d5df", 2400]
  ] as const) {
    it(`${filter}, ${pattern}, ${length} samples (${graph ? "graph" : "simple"})`, async () => {
      const channels = Array.from({ length: pattern === "stereo" ? 2 : 1 }, (_, c) => Float64Array.from({ length }, (_, i) =>
        (pattern === "silence" ? 0 : pattern === "quiet" ? 1500 : (i + c * 120) % 240 < 80 ? 30000 : 1500) * (c ? -1 : 1) / 32768));
      const input = encodeWav({ sampleRate: 8000, channels });
      const fs = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
          : ["-af", filter]), "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); } },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = fs.readFileSync("/out.pcm") as Buffer;
      assert.equal(output.length, samples * channels.length * 2);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      if (pattern === "pulse" && length === 2400 && filter.endsWith("asc=1:asc_level=0.5")) {
        assert.deepEqual([80, 200].map(i => output.readInt16LE(i * 2)), [30, 85]);
      }
    });
  }
}
