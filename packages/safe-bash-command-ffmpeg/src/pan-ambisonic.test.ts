import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const left = [-32768, 1, 567, 9501, -17581, 8192];
const right = [32767, -3, -719, 6061, 2131, -8192];
const silence = left.map(() => 0);

// PCM samples and invalid-channel statuses checked against native FFmpeg 7.0.2.
for (const [layout, count] of [
  ["ambisonic 1", 4], ["ambisonic 1+stereo", 6], ["4C", 4], ["6C", 6]
] as const) {
  for (const [equations, expected, exitCode] of [
    ["c0=c1", [right, ...Array.from({ length: count - 1 }, () => silence)], 0],
    [`c${count - 1}=c0`, [...Array.from({ length: count - 1 }, () => silence), left], 0],
    ["c0=0.5*c1", [[16384, -1, -359, 3031, 1066, -4096], ...Array.from({ length: count - 1 }, () => silence)], 0],
    [`c${count}=c0`, undefined, 234]
  ] as const) {
    for (const complex of [false, true]) {
      it(`routes first-order ambisonic pan (${layout}|${equations}, graph=${complex})`, async () => {
        const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [left, right].map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
        const filter = `pan=${layout}|${equations}`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-i", "/in.wav",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
            "-f", "s16le", "/out.pcm"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, exitCode, stderr);
        if (!expected) {
          assert.equal(volume.readFileSync("/out.pcm", "utf8"), "KEEP");
          return;
        }
        const bytes = Buffer.alloc(left.length * count * 2);
        left.forEach((_, frame) => expected.forEach((channel, index) => {
          bytes.writeInt16LE(channel[frame]!, (frame * count + index) * 2);
        }));
        assert.deepEqual(volume.readFileSync("/out.pcm"), bytes);
      });
    }
  }
}
