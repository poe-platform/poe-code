import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = "0d141b222930373e454c535a61686f76";

// Native FFmpeg rawvideo bytes: generic timeline predicates run twice per frame.
for (const [direction, threshold, first] of [
  ["hflip", "0d141b2230293e374c455a536861766f", "140d221b2930373e454c535a61686f76"],
  ["vflip", "0d141b22373e2930535a454c6f766168", "1b220d142930373e454c535a61686f76"]
] as const) {
  for (const [filter, expected] of [
    [`${direction}=enable='gte(st(0,ld(0)+1),4)'`, threshold],
    [`${direction}=enable='eq(st(0,ld(0)+1),2)'`, first],
    [`${direction}=enable='st(0,not(ld(0)))'`, input],
    [`${direction}=enable=ld(0)`, input],
    [`${direction}=enable='gte(st(0,ld(0)+1),4)',${direction}=enable=ld(0)`, threshold]
  ] as const) {
    for (const graph of [false, true]) {
      for (const frames of [2, 4]) {
        it(`${filter} retains local timeline state (${graph ? "graph" : "simple"}, ${frames} frames)`, async () => {
          const command = createFfmpegCommand();
          for (let run = 0; run < 2; run++) {
            const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input.slice(0, frames * 8), "hex") });
            const output: Uint8Array[] = [];
            const errors: Uint8Array[] = [];
            const result = await command.execute({
              args: ["-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-i", "/in.raw",
                ...(graph ? ["-filter_complex", `[0:v]${filter}[o]`, "-map", "[o]"] : ["-vf", filter]),
                "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
              cwd: "/", env: {}, signal: new AbortController().signal,
              fs: {
                async readFile(path: string) { return volume.readFileSync(path); },
                async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
                async stat(path: string) { return volume.statSync(path); }
              },
              stdin: (async function* () {})(),
              stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
              stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
            } as never);
            assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
            assert.equal(Buffer.concat(output).toString("hex"), expected.slice(0, frames * 8));
          }
        });
      }
    }
  }
}
