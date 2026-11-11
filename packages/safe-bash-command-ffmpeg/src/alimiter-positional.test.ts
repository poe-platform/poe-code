import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const options of [
    "attack=0.5:level=0:level_in=0.5:0.2",
    "attack=0.5:level=0:level_in=0.5:level_out=0.2",
    "attack=0.5:level=0:0.5:0.2",
    "0.5:attack=0.5:0.5:0.2:level=0",
    "attack=0.5:level=0:enable=1:0.2:level_in=0.5",
    "0.5:0.2:1:0.5:50:0:0.5:0:0"
  ]) {
    it(`alimiter=${options} preserves gain and lookahead (${graph ? "graph" : "simple"})`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 16 }, (_, i) => 1000 * (i + 1) * (i % 2 ? -1 : 1) / 32768)
      ] });
      const fs = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      let stderr = "";
      const filter = `alimiter=${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
          : ["-af", filter]), "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const output = fs.readFileSync("/out.pcm") as Buffer;
      assert.equal(output.length, 32);
      // FFmpeg 7.0.2 reference: 0.5 input gain, 0.2 output gain, 0.5 ms attack.
      assert.deepEqual(Array.from({ length: 16 }, (_, i) => output.readInt16LE(i * 2)),
        [0, 0, 0, 100, -200, 300, -400, 500, -600, 700, -800, 900, -1000, 1100, -1200, 1300]);
    });
  }
}
