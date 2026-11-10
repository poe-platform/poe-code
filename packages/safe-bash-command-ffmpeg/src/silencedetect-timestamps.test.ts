import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: 16 mono PCM16 samples at 8 Hz, with tone at samples 8–11.
const samples = new Float64Array(16);
samples.fill(8000 / 32768, 8, 12);
const input = encodeWav({ sampleRate: 8, channels: [samples] });
const pcm = Buffer.alloc(32);
for (let i = 8; i < 12; i++) pcm.writeInt16LE(8000, i * 2);

for (const [prefix, offset, events] of [
  ["asetpts=PTS+2/TB", 0, ["silence_start: 2", "silence_end: 3 | silence_duration: 1", "silence_start: 3.5", "silence_end: 4 | silence_duration: 0.5"]],
  ["atrim=start=0.5", 8, ["silence_start: 0.5", "silence_end: 1 | silence_duration: 0.5", "silence_start: 1.5", "silence_end: 2 | silence_duration: 0.5"]],
  ["asetnsamples=n=4:p=0,asetpts=2*PTS", 0, ["silence_start: 0", "silence_end: 2 | silence_duration: 2", "silence_start: 3", "silence_end: 3.5 | silence_duration: 0.5"]],
  ["atrim=start=0.5,asetpts=PTS-STARTPTS", 8, ["silence_start: 0", "silence_end: 0.5 | silence_duration: 0.5", "silence_start: 1", "silence_end: 1.5 | silence_duration: 0.5"]]
] as const) {
  for (const graph of [false, true]) {
    it(`silencedetect preserves native timestamps after ${prefix} (graph=${graph})`, async () => {
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      const filter = `${prefix},silencedetect=d=0.25`;
      let stderr = "";
      const stdout: Buffer[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-loglevel", "info", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Buffer.concat(stdout), pcm.subarray(offset));
      assert.deepEqual(stderr.trim().split("\n").filter(line => line.includes("silence_")), events);
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
    });
  }
}
