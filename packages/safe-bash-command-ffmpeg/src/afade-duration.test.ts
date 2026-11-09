import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, mono PCM16 at 8 kHz, constant 12000 samples.
const durations = ["0.001", "0.001s", "1ms", "1000us", "+0.001", "0.0010009", "0.0010629",
  String.raw`00\\:00\\:00.001`, String.raw`00\\:00.001`,
  String.raw`'00\:00\:00.001'`, String.raw`\'00:00:00.001\'`];
const invalid = ["1e-3", "0x1", ".001", "1e-3s", "0x1ms", "-0.001", "Infinity", "",
  String.raw`00\\:60\\:00`, String.raw`00\\:00\\:60`, String.raw`00\\:00\\:00.001junk`];

for (const graph of [false, true]) {
  for (const option of ["st", "start_time", "d", "duration", "positional", "positional_duration"]) {
    for (const value of [...durations, ...invalid]) {
      const start = option === "st" || option === "start_time" || option === "positional";
      const filter = option === "positional" ? `afade=in:0:4:${value}:0:tri`
        : option === "positional_duration" ? `afade=in:0:4:0:${value}:tri` : `afade=ns=4:${option}=${value}:c=tri`;
      it(`${filter} uses native duration syntax (${graph ? "graph" : "simple"})`, async () => {
        const fs = Volume.fromJSON({ "/out.wav": "keep" });
        fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [new Float64Array(16).fill(12000 / 32768)] }));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-c:a", "pcm_s16le", "/out.wav"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (invalid.includes(value)) {
          assert.equal(result.exitCode, 1, stderr);
          assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
        } else {
          assert.equal(result.exitCode, 0, stderr);
          const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
          const offset = start ? 8 : 0;
          const length = start ? 4 : 8;
          assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768),
            Array.from({ length: 16 }, (_, i) => 12000 * Math.max(0, Math.min(1, (i - offset) / length))));
        }
      });
    }
  }
}
