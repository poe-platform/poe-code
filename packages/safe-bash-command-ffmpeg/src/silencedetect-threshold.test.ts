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
          assert.deepEqual(stderr.trim().split("\n").map(line => line.startsWith("[silencedetect") ? line.slice(line.indexOf("] ") + 2) : line).filter(line => line.includes("silence_")), silent ? [
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

// Native FFmpeg 7.0.2 wraps s16 thresholds above full scale; floating-point
// filters keep the original noise value. Every case preserves all 32 PCM bytes.
for (const noise of ["1.01", "2", "60dB", "1", "3"]) {
  for (const prefix of ["", "volume=1,"]) {
    for (const graph of [false, true]) {
      it(`matches native full-scale silencedetect at ${noise} (prefix=${prefix}, graph=${graph})`, async () => {
        const pcm = Buffer.alloc(32);
        for (let frame = 8; frame < 12; frame++) pcm.writeInt16LE(8000, frame * 2);
        const input = encodeWav({ sampleRate: 8,
          channels: [Float64Array.from({ length: 16 }, (_, frame) => pcm.readInt16LE(frame * 2) / 32768)] });
        const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
        const filter = `${prefix}silencedetect=d=0.25:n=${noise}`;
        const stdout: Uint8Array[] = [];
        let stderr = "";
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
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(Buffer.concat(stdout), pcm);
        assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
        const silent = prefix !== "" || noise === "1" || noise === "3";
        assert.deepEqual(stderr.trim().split("\n").map(line => line.startsWith("[silencedetect") ? line.slice(line.indexOf("] ") + 2) : line).filter(line => line.includes("silence_")), silent ? [
          "silence_start: 0",
          "silence_end: 2 | silence_duration: 2"
        ] : []);
      });
    }
  }
}
