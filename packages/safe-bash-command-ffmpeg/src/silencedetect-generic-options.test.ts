import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [0, 500, 0, 500, 0, 0, 0, 0, 1000, 0, 1000, 0,
  0, 0, 0, 0, 0, 500, 0, 500, 0, 0, 0, 0];
const pcm = Buffer.alloc(samples.length * 2);
samples.forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
const input = encodeWav({ sampleRate: 1000, channels: [0, 1].map(channel =>
  Float64Array.from({ length: 12 }, (_, frame) => samples[frame * 2 + channel]! / 32768)) });

for (const graph of [false, true]) {
  for (const option of ["", "threads=1", "thread_type=slice", "extra_hw_frames=1",
    "threads=0:thread_type=none:extra_hw_frames=-1",
    "threads=default:thread_type=all-slice:extra_hw_frames=min",
    "threads=1+1:thread_type=+slice:extra_hw_frames=2-1",
    "threads=max:thread_type=4294967295:extra_hw_frames=max"]) {
    it(`silencedetect preserves stereo PCM and events with ${option || "defaults"} (graph=${graph})`, async () => {
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      let stderr = "";
      const filter = `silencedetect=n=0.001:d=2ms${option ? `:${option}` : ""}`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-i", "/in.wav",
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
      assert.deepEqual(volume.readFileSync("/out.raw"), pcm);
      assert.deepEqual(stderr.trim().split("\n").map(line => line.startsWith("[silencedetect") ? line.slice(line.indexOf("] ") + 2) : line).filter(line => line.includes("silence_")), [
        "silence_start: 0.002",
        "silence_end: 0.004 | silence_duration: 0.002",
        "silence_start: 0.006",
        "silence_end: 0.008 | silence_duration: 0.002",
        "silence_start: 0.01",
        "silence_end: 0.012 | silence_duration: 0.002"
      ]);
    });
  }
}
