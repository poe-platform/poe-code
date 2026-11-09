import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg truncates durations to microseconds before rounding to samples.
for (const [duration, fade] of [
  ["0.000001", 0], ["0.000062", 0], ["0.0000625", 0], ["0.0000629", 0],
  ["0.000063", 1], ["0.0001879", 1], ["0.000188", 2],
  ["0", 4], ["0.0000009", 4]
] as const) {
  for (const overlap of [true, false]) {
    it(`acrossfade d=${duration} overlap=${overlap} matches FFmpeg PCM at sub-sample boundaries`, async () => {
      const volume = Volume.fromJSON({});
      const a = Int16Array.from({ length: 1301 }, (_, i) => i * 17 - 12000);
      const b = Int16Array.from({ length: 891 }, (_, i) => 4000 - i * 7);
      for (const [name, samples] of [["a", a], ["b", b]] as const) {
        volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from(samples, value => value / 32768)] }));
      }
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
          `[0:a][1:a]acrossfade=ns=4:${overlap ? "d" : "duration"}=${duration}:o=${Number(overlap)}[o]`,
          "-map", "[o]", "-f", "s16le", "/out.pcm"],
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
      const output = volume.readFileSync("/out.pcm") as Buffer;
      const samples = Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2));
      if (fade === 0) {
        assert.deepEqual(samples, Array.from(a));
      } else {
        assert.equal(samples.length, a.length + b.length - (overlap ? fade : 0));
        assert.deepEqual(samples.slice(0, a.length - fade), Array.from(a.slice(0, -fade)));
        assert.deepEqual(samples.slice(-(b.length - fade)), Array.from(b.slice(fade)));
        if (fade === 1) assert.deepEqual(samples.slice(a.length - 1, a.length + Number(!overlap)), overlap ? [0] : [0, 0]);
      }
    });
  }
}
