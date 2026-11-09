import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const samples = Array.from({ length: 48 }, (_, i) => i * 200 - 4800);
const raw = Buffer.alloc(samples.length * 2);
samples.forEach((sample, i) => raw.writeInt16LE(sample, i * 2));
const stereo = [0, 1].map(channel => samples.filter((_, i) => i % 2 === channel));
const wav = encodeWav({ sampleRate: 8000,
  channels: stereo.map(channel => Float64Array.from(channel, sample => sample / 32768)) });

// Native FFmpeg 7.0.2: malformed counts leave existing output untouched.
for (const option of ["-ac", "-ac:a:0"]) for (const sync of [false, true]) {
  for (const input of [false, true]) {
    for (const [value, count] of [
      ["2junk", null], ["2.6", null], ["1+1", null], ["foo", null],
      ["NaN", null], ["Infinity", null], ["2147483648", null],
      [" ", null], ["2 ", null], ["0b10", null], ["0o2", null],
      ["2", 2], ["1.0", 1], ["0x10", 16], ["0x1", 1], ["1e1", 10],
      ["+0x2", 2], [" 2", 2],
      ["0", input ? null : 2], ["-1", input ? null : 2]
    ] as const) {
      it(`parses the whole ${input ? "input" : "output"} ${option} ${JSON.stringify(value)} (sync=${sync})`, async () => {
        const volume = Volume.fromJSON({ "/out.wav": "KEEP" });
        volume.writeFileSync("/in.raw", raw);
        volume.writeFileSync("/in.wav", wav);
        const args = ["-y", "-v", "error", ...(input
          ? ["-f", "s16le", "-ar", "8000", option, value, "-i", "/in.raw"]
          : ["-i", "/in.wav", option, value]), "/out.wav"];
        if (sync) {
          const result = evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
          // Output channel conversion deliberately falls back to the async command.
          if (count === null || !input) {
            assert.equal(result, undefined);
            assert.equal(volume.readFileSync("/out.wav", "utf8"), "KEEP");
            return;
          }
          assert.equal(result, "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          if (count === null) {
            assert.notEqual(result.exitCode, 0);
            assert.equal(volume.readFileSync("/out.wav", "utf8"), "KEEP");
            return;
          }
          assert.equal(result.exitCode, 0, stderr);
        }
        const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        assert.equal(audio.channels, count);
        assert.equal(audio.sampleRate, 8000);
        const expected = input
          ? Array.from({ length: count! }, (_, channel) =>
              samples.slice(0, Math.floor(samples.length / count!) * count!).filter((_, i) => i % count! === channel))
          : count === 1 ? [stereo[0]!.map((sample, i) => (sample + stereo[1]![i]!) / 2)]
          : Array.from({ length: count! }, (_, channel) => stereo[channel] ?? new Array<number>(24).fill(0));
        assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), expected);
      });
    }
  }
}
