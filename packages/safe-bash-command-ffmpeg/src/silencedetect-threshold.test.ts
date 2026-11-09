import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 truncates the s16 noise threshold after scaling by 32767.
for (const noise of [0.03125, 0.03126, 0.04]) {
  for (const sign of [1, -1]) {
    for (const prefix of ["", "anull,", "volume=1,"]) {
      for (const graph of [false, true]) {
        it(`matches native silencedetect at ${noise} (sign=${sign}, prefix=${prefix}, graph=${graph})`, async () => {
          const samples = new Float64Array(4000).fill(sign * 1024 / 32768);
          samples.set([32767, 16384, 16384, 8192, 8192, 8192, 8192].map(value => sign * value / 32768));
          const input = encodeWav({ sampleRate: 8000, channels: [samples] });
          const volume = Volume.fromJSON({});
          volume.writeFileSync("/input.wav", input);
          const filter = `${prefix}silencedetect=n=${noise}:d=0.125`;
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-hide_banner", "-nostats", "-y", "-v", "info", "-i", "/input.wav",
              ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
              "-c:a", "pcm_s16le", "/out.wav"],
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
          const silent = noise === 0.04 || prefix === "volume=1," && noise > 0.03125;
          assert.deepEqual(stderr.trim().split("\n").filter(line => line.includes("silence_")), silent ? [
            "silence_start: 0.000875",
            "silence_end: 0.5 | silence_duration: 0.499125"
          ] : []);
          assert.deepEqual(volume.readFileSync("/input.wav"), Buffer.from(input));
          const output = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
          assert.deepEqual(output.channelData, parseWav(input).tracks[0]!.decodedAudio!.channelData);
        });
      }
    }
  }
}
