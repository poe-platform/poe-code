import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 16 }, (_, i) => 13 + 7 * i));

// Native FFmpeg 7.0.2 evaluates the timeline twice per input frame.
for (const [filter, frames] of [
  ["framestep=step=2:enable='gte(st(0,ld(0)+1),3)'", [0, 2]],
  ["framestep=2:enable='gte(st(0,ld(0)+1),2)'", [0, 2]],
  ["framestep=2:enable='gte(n,2)'", [0, 1, 2]],
  ["framestep=2:enable='gte(st(0,ld(0)+1),5)'", [0, 1, 2]],
  ["framestep=2:enable='eq(st(0,ld(0)+1),4)'", [0, 2, 3]],
  ["framestep=2:enable='st(0,not(ld(0)))'", [0, 1, 2, 3]],
  ["framestep=2:enable='st(0,1)',framestep=2:enable='ld(0)'", [0, 2]],
  ["trim=end_frame=0,framestep=2:enable='st(0,ld(0)+1)'", []]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} retains timeline registers (${graph ? "graph" : "simple"})`, async () => {
      const command = createFfmpegCommand();
      for (let run = 0; run < 2; run++) {
        const volume = Volume.fromJSON({ "/in.raw": input });
        const output: Uint8Array[] = [];
        const errors: Uint8Array[] = [];
        const result = await command.execute({
          args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
            "-s", "2x2", "-r", "6", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:v]${filter},showinfo[o]`, "-map", "[o]"]
              : ["-vf", `${filter},showinfo`]),
            "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
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
        const stderr = Buffer.concat(errors).toString();
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(Buffer.concat(output), Buffer.concat(frames.map(n => input.subarray(n * 4, n * 4 + 4))));
        const pts = stderr.split("\n").filter(line => line.includes("pts_time:")).map(line =>
          Number(line.split("pts:")[1]!.trimStart().split(" ")[0]));
        assert.deepEqual(pts, frames, stderr);
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      }
    });
  }
}
