import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 RGB24 output for white@0.5 blended over pixel (1, 1).
const blended = Buffer.from("0724415e7b98b5d2ef0c294663809ddceaf9112e4b6885a2bfdcf91633506d8aa7c4e1fe1b3855728facc9e603203d5a", "hex");

for (const graph of [false, true]) {
  for (const positional of [false, true]) {
    for (const replace of ["0", "false", "FALSE", "n", "N", "+0", "-0", "disabled", "OFF", "true", "TRUE", "y", "+1", "bogus", "2", "0.0", "1+0"]) {
      it(`drawbox replace=${replace} (${graph ? "graph" : "simple"}, ${positional ? "positional" : "named"})`, async () => {
        const enabled = ["true", "TRUE", "y", "+1"].includes(replace);
        const invalid = ["bogus", "2", "0.0", "1+0"].includes(replace);
        const format = enabled ? "rgba" : "rgb24";
        const input = Buffer.from(Array.from({ length: enabled ? 64 : 48 }, (_, i) => (7 + 29 * i) % 256));
        const volume = Volume.fromJSON({ "/in.raw": input });
        const output: Uint8Array[] = [];
        const errors: Uint8Array[] = [];
        const filter = positional
          ? `drawbox=1:1:1:1:white@0.5:fill:${replace}`
          : `drawbox=x=1:y=1:w=1:h=1:t=fill:c=white@0.5:replace=${replace}`;
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "rawvideo", "-pixel_format", format, "-video_size", "4x4",
            "-framerate", "2", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
            "-fps_mode", "passthrough", "-pix_fmt", format, "-bitexact", "-f", "rawvideo", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
        } as never);
        if (invalid) {
          assert.notEqual(result.exitCode, 0);
          assert.ok(Buffer.concat(errors).toString().includes("drawbox: invalid replace boolean"));
          assert.equal(Buffer.concat(output).length, 0);
        } else {
          assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
          const expected = enabled ? Buffer.from(input) : blended;
          if (enabled) expected.set([255, 255, 255, 127], 20);
          assert.deepEqual(Buffer.concat(output), expected);
        }
      });
    }
  }
}
