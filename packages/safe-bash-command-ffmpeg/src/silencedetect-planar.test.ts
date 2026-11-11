import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 truncates integer noise thresholds for both layouts.
for (const bits of [16, 32] as const) {
  for (const planar of [false, true]) {
    for (const threshold of [1.25, 2]) {
      it(`detects stereo s${bits}${planar ? "p" : ""} silence at threshold ${threshold}`, async () => {
        const scale = 2 ** (bits - 1);
        const input = encodeWav({ sampleRate: 1000, channels: [
          new Float64Array(4).fill(1 / scale), new Float64Array(4).fill(-1 / scale)
        ] }, { bitsPerSample: bits });
        const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
        let stderr = "";
        const output: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-nostats", "-v", "info", "-i", "/in.wav", "-af",
            `aformat=sample_fmts=s${bits}${planar ? "p" : ""},silencedetect=n=${threshold}/${scale - 1}:d=1ms`,
            "-f", `s${bits}le`, "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { output.push(bytes.slice()); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(stderr.trim().split("\n").filter(line => line.includes("silence_")), threshold === 2 ? [
          "silence_start: 0", "silence_end: 0.004 | silence_duration: 0.004"
        ] : []);
        const pcm = Buffer.concat(output);
        assert.equal(pcm.length, 8 * bits / 8);
        for (let sample = 0; sample < 8; sample++) {
          assert.equal(pcm.readIntLE(sample * bits / 8, bits / 8), sample % 2 === 0 ? 1 : -1);
        }
        assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
      });
    }
  }
}
