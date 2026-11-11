import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7: framestep keeps packet durations and forwards the original EOF.
for (const [stepFilter, step] of [["framestep=2", 2], ["framestep=3", 3], ["framestep=2,framestep=2", 4]] as const) {
  for (const count of [1, 2, 3, 4]) {
    for (const resample of [false, true]) {
      for (const graph of [false, true]) {
        it(`${stepFilter} preserves ${count}-frame timing (${resample ? "fps" : "passthrough"}, ${graph ? "graph" : "simple"})`, async () => {
          const input = Buffer.from(Array.from({ length: count * 4 }, (_, i) => 13 + 7 * i));
          const volume = Volume.fromJSON({ "/in.raw": input });
          const output: Uint8Array[] = [];
          const errors: Uint8Array[] = [];
          const filter = `${stepFilter},${resample ? "fps=6," : ""}showinfo`;
          const result = await createFfmpegCommand().execute({
            args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
              "-s", "2x2", "-r", "6", "-i", "/in.raw",
              ...(graph ? ["-filter_complex", `[0:v]${filter}[v]`, "-map", "[v]"] : ["-vf", filter]),
              "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
            stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
          } as never);
          const stderr = Buffer.concat(errors).toString();
          assert.equal(result.exitCode, 0, stderr);
          const frames = Array.from({ length: resample ? count : Math.ceil(count / step) }, (_, i) =>
            resample ? Math.floor(i / step) * step : i * step);
          assert.deepEqual(Buffer.concat(output), Buffer.concat(frames.map(i => input.subarray(i * 4, i * 4 + 4))));
          const info = stderr.split("\n").filter(line => line.includes(" pts:"));
          assert.equal(info.length, frames.length, stderr);
          for (const [index, line] of info.entries()) {
            const tokens = line.split(" ").filter(Boolean);
            assert.equal(tokens.find(token => token.startsWith("pts:"))?.slice(4), String(resample ? index : frames[index]), line);
            assert.equal(tokens.find(token => token.startsWith("duration:"))?.slice(9), "1", line);
          }
          assert.deepEqual(volume.readFileSync("/in.raw"), input);
        });
      }
    }
  }
}
