import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 astats Bit_depth tuples for IEEE float32 WAV input.
for (const [name, samples, depth] of [
  ["positive half steps", [0, 2 ** -32, 3 * 2 ** -32, 5 * 2 ** -32], "1/1/31/1"],
  ["negative half steps", [0, -(2 ** -32), -3 * 2 ** -32, -5 * 2 ** -32], "1/31/31/31"],
  ["above full scale", [0.125, 1.25, -1.75, 0.5], "4/4/4/4"],
  ["ordinary fractions", [0, 0.5, 0.75, 0.25], "2/2/3/2"]
] as const) {
  for (const loglevel of ["info", "error"]) {
    it(`matches astats float bit depth and preserves PCM for ${name} at ${loglevel} level`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples)] },
        { bitsPerSample: 32, float: true });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", loglevel, "-i", "/in.wav", "-af",
          "astats=metadata=1:measure_perchannel=Bit_depth:measure_overall=Bit_depth,ametadata=print:file=/tags.txt",
          "-f", loglevel === "info" ? "null" : "f32le", "-"],
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
      const pcm = Buffer.alloc(samples.length * 4);
      samples.forEach((sample, i) => pcm.writeFloatLE(sample, i * 4));
      assert.deepEqual([result.exitCode, Buffer.concat(stdout).toString("hex"),
        loglevel === "info" ? stderr.slice(stderr.indexOf("Channel: 1\n")) : stderr],
        loglevel === "info" ? [0, "", `Channel: 1\nBit depth: ${depth}\nOverall\nBit depth: ${depth}\n`]
          : [0, pcm.toString("hex"), ""]);
      assert.equal(volume.readFileSync("/tags.txt", "utf8"),
        "frame:0    pts:0       pts_time:0\n" + ["1", "Overall"].flatMap(section =>
          depth.split("/").map((value, i) =>
            `lavfi.astats.${section}.Bit_depth${i === 0 ? "" : i + 1}=${value}.000000\n`)).join(""));
    });
  }
}
