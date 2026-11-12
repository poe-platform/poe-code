import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const start = "silence_start: 0.001";
const end = "silence_end: 0.004 | silence_duration: 0.003";
const tail = "silence_start: 0.005";
const eof = "silence_end: 0.008 | silence_duration: 0.003";
// Native FFmpeg 7.0.2: downstream metadata prints before the next frame and EOF.
for (const [prefix, suffix, pcm, events] of [
  ["", ",ametadata=print", "803e00000000000020d1000000000000", [start, end, tail,
    "lavfi.silence_duration=0.003", "lavfi.silence_end=0.004", "lavfi.silence_start=0.005", eof]],
  ["asetnsamples=n=2:p=0,", ",ametadata=print", "803e00000000000020d1000000000000", [start,
    "lavfi.silence_start=0.001", end, "lavfi.silence_end=0.004", "lavfi.silence_duration=0.003",
    tail, "lavfi.silence_start=0.005", eof]],
  ["asetnsamples=n=2:p=0,", "", "803e00000000000020d1000000000000", [start, end, tail, eof]],
  ["areverse,", ",ametadata=print", "00000000000020d1000000000000803e", ["silence_start: 0",
    "silence_end: 0.003 | silence_duration: 0.003", "silence_start: 0.004",
    "silence_end: 0.007 | silence_duration: 0.003", "lavfi.silence_end=0.007",
    "lavfi.silence_start=0.004", "lavfi.silence_duration=0.003"]]
] as const) {
  for (const graph of [false, true]) {
    it(`interleaves silence and metadata for ${prefix}silencedetect${suffix} (graph=${graph})`, async () => {
      const input = encodeWav({ sampleRate: 1000,
        channels: [Float64Array.from([16000, 0, 0, 0, -12000, 0, 0, 0], value => value / 32768)] });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      const chunks: Buffer[] = [];
      let stderr = "";
      const filter = `${prefix}silencedetect=n=0.01:d=2ms${suffix}`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(chunks).toString("hex"), pcm);
      assert.deepEqual(stderr.trim().split("\n")
        .map(line => line.startsWith("[silencedetect") ? line.slice(line.indexOf("] ") + 2) : line)
        .filter(line => line.includes("silence_")), events);
    });
  }
}
