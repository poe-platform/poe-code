import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(
  [1000, -2000, 3000, -4000, 5000, -6000, 7000, -8000, 9000, -10000, 11000, -12000, 13000, -14000, 15000, -16000],
  sample => sample / 32768
)] });

// PCM16 references from native FFmpeg 7.0.2 with four-sample input frames.
const unchanged = [0, 0, 0, 1000, -2000, 3000, -4000, 5000, -6000, 7000, -8000, 9000, -10000, 11000, -12000, 13000];
const inputHalved = [0, 0, 0, 1000, -2000, 3000, -4000, 2500, -3000, 3500, -4000, 4500, -5000, 5500, -6000, 6500];
const outputHalved = [0, 0, 0, 1000, -1000, 1500, -2000, 2500, -3000, 3500, -4000, 4500, -5000, 5500, -6000, 6500];
const automatic = [0, 0, 0, 1000, -13277, 19032, -23714, 27351, -30073, 31879, -32768, 32741, -31798, 29939, -27163, 23472];

for (const graph of [false, true]) {
  for (const [commands, options, expected] of [
    ["", "", unchanged],
    ["0.0005 alimiter level_in 0.5", "", inputHalved],
    ["0.0005 alimiter level_out 0.5", "", outputHalved],
    ["0.0005 alimiter level 1", ":limit=0.15", automatic],
    ["0.0005 alimiter limit 0.125", "", [0, 0, 0, 1000, -1910, 2660, -3245, 3680, -3963, 4096, -4078, 3909, -3589, 3119, -2497, 1725]],
    ["", ":limit=0.15", [0, 0, 0, 1000, -1992, 2855, -3557, 4103, -4511, 4782, -4915, 4911, -4770, 4491, -4075, 3521]],
    ["0.0005 alimiter@cap level_in 1/2", "", inputHalved],
    ["0.0005 alimiter@cap level_out 1/2", "", outputHalved],
    ["0.0005 alimiter@other level_out 0.5", "", unchanged],
    ["0.0005 alimiter level_in 0.5;0.001 alimiter level_in 0;0.0015 alimiter level_in invalid", "", inputHalved],
    ["0.0005 alimiter level_out 0.5;0.001 alimiter level_out 65;0.0015 alimiter level_out 1/0", "", outputHalved],
    ["0.0005 alimiter level yes;0.001 alimiter level 1.0;0.0015 alimiter level 2", ":limit=0.15", automatic],
    ["0.0005 alimiter level true;0.001 alimiter level off", ":limit=0.15", [0, 0, 0, 1000, -13277, 19032, -23714, 27351, -4511, 4782, -4915, 4911, -4770, 4491, -4075, 3521]],
    ["0.0005 alimiter level_out 0.25,alimiter level_out 0.5", "", outputHalved]
  ] as const) {
    it(`applies limiter levels at frame boundaries: ${commands || "control"}${options} (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", input);
      let stderr = "";
      const filter = `asetnsamples=n=4:p=0,${commands ? `asendcmd=c='${commands}',` : ""}alimiter@cap=attack=0.5:level=0${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
          : ["-af", filter]), "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const output = fs.readFileSync("/out.pcm") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
    });
  }
}
