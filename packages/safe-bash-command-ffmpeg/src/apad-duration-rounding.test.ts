import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 29 }, (_, index) => index + 1);
const input = encodeWav({ sampleRate: 44100,
  channels: [Float64Array.from(samples, sample => sample / 32768)] });

// FFmpeg rounds 175 ms at 44.1 kHz from exactly 7717.5 to 7718 samples.
for (const [option, count] of [
  ["pad_dur=0.175", 7747],
  ["whole_dur=0.175", 7718],
  ["pad_dur=175ms", 7747],
  ["whole_dur=175ms", 7718],
  ["pad_dur=175000us", 7747],
  ["whole_dur=175000us", 7718],
  ["pad_dur=0.174999", 7746],
  ["whole_dur=0.174999", 7717],
  ["pad_dur=0.175001", 7747],
  ["whole_dur=0.175001", 7718],
  ["pad_len=7718", 7747],
  ["whole_len=7718", 7718]
] as const) {
  for (const graph of [false, true]) {
    it(`apad=${option} rounds duration to samples (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      const filter = `apad=${option}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, count * 2);
      assert.deepEqual(Array.from({ length: count }, (_, index) => output.readInt16LE(index * 2)),
        [...samples, ...Array<number>(count - samples.length).fill(0)]);
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
    });
  }
}
