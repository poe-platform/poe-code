import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [options, firstPts] of [
  ["first_pts=0", 0],
  ["first_pts=256:first_pts=0", 0],
  ["first_pts=64", 64],
  ["first_pts=256:first_pts=64", 64],
  ["first_pts=256:first_pts=-64", -64],
  ["first_pts=-80000:first_pts=0", 0]
] as const) {
  for (const graph of [false, true]) {
    it(`aresample=${options} preserves PCM using the final timestamp (${graph ? "graph" : "simple"})`, async () => {
      const samples = new Float64Array(512);
      samples[128] = 24000 / 32768;
      const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
      let stderr = "";
      const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 1 } }).execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]aresample=${options}[out]`, "-map", "[out]"]
          : ["-af", `aresample=${options}`]), "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const expected = Buffer.alloc((512 - firstPts) * 2);
      expected.writeInt16LE(24000, (128 - firstPts) * 2);
      assert.deepEqual(volume.readFileSync("/out.pcm"), expected);
    });
  }
}
