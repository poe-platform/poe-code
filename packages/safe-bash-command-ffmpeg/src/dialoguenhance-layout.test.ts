import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: channelmap=0|1:LAYOUT,dialoguenhance, PCM16 at 16000 Hz.
const pattern = [[8000, 4000, -16000, 0], [-2000, 12000, 3000, -9000]];
for (const complex of [false, true]) {
  for (const [layout, exitCode] of [
    ["FL+FR", 0], ["FR+FL", 234], ["FC+LFE", 0], ["BL+BR", 234],
    ["DL+DR", 0], ["2C", 0], ["SL+SR", 234]
  ] as const) {
    for (const frames of exitCode === 0 ? [4, 8192] : [4]) {
      it(`negotiates dialogue layout ${layout}, ${frames} frames (${complex ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 16000,
          channels: pattern.map(samples => Float64Array.from({ length: frames }, (_, i) => samples[i % 4]! / 32768))
        })) });
        const filter = `channelmap=0|1:${layout},dialoguenhance`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
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
        assert.equal(result.exitCode, exitCode, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, exitCode === 0 ? frames * 6 : 0);
        if (exitCode !== 0) {
          assert.ok(stderr.includes("dialoguenhance: unsupported input channel layout"), stderr);
        } else if (frames === 4) {
          assert.deepEqual(output, Buffer.alloc(24));
        } else {
          assert.equal(output.subarray(16000, 16012).toString("hex"),
            layout === "FC+LFE" ? "34b000000000000019161916" : "5ffe0000d8dc2104401f30f8");
          for (let frame = 0; frame < frames; frame++) {
            for (let channel = 0; channel < 2; channel++) {
              const expected: number = frame < 1536 ? 0 : layout === "FC+LFE"
                ? [5657, 2828, -11314, 0][(frame - 1536) % 4]!
                : pattern[channel]![(frame - 1536) % 4]!;
              assert.equal(output.readInt16LE((frame * 3 + channel) * 2), expected, `frame ${frame}, channel ${channel}`);
            }
          }
        }
      });
    }
  }
}
