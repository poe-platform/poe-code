import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete native FFmpeg 7.0.2 PCM, including the fully named controls.
const trimmed = "fc08001900000000000098efec130000000000000820000000000000";
const cases = [
  ["start_periods=1:window=0:1", trimmed],
  ["start_threshold=0:window=0:1", trimmed],
  ["stop_periods=1:window=0:1", "fc080019"],
  ["stop_periods=1:window=0:start_periods=1", "fc080019"],
  ["start_periods=1:window=0", trimmed]
] as const;

for (const complex of [false, true]) {
  for (const [options, expected] of cases) {
    it(`silenceremove binds mixed options ${options} (complex=${complex})`, async () => {
      const volume = Volume.fromJSON({
        "/in.wav": Buffer.from(encodeWav({ sampleRate: 1000,
          channels: [Float64Array.from([0, 0, 2300, 6400, 0, 0, 0, -4200, 5100, 0, 0, 0, 8200, 0, 0, 0],
            value => value / 32768)] }))
      });
      const stdout: Uint8Array[] = [];
      const stderr: Uint8Array[] = [];
      const filter = `silenceremove=${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(complex
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
      assert.equal(Buffer.concat(stdout).toString("hex"), expected);
    });
  }
}
