import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 16 }, (_, i) => 13 + 7 * i));

for (const graph of [false, true]) {
  for (const [expression, prefix, frames] of [
    ["1", "", [0, 2]],
    ["PI", "", [0, 2]],
    ["E", "", [0, 2]],
    ["PHI", "", [0, 2]],
    ["PI-PI", "", [0, 1, 2, 3]],
    ["E-E", "", [0, 1, 2, 3]],
    ["PHI-PHI", "", [0, 1, 2, 3]],
    ["gte(n,PI-2)", "", [0, 1, 2]],
    ["gte(n,E-1)", "", [0, 1, 2]],
    ["gte(n,PHI)", "", [0, 1, 2]],
    ["PI", "trim=end_frame=0,", []],
    ["E", "trim=end_frame=0,", []],
    ["PHI", "trim=end_frame=0,", []]
  ] as const) {
    const filter = `${prefix}framestep=step=2:enable='${expression}',showinfo`;
    it(`${filter} (${graph ? "graph" : "simple"}) preserves bytes and PTS`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input });
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
          "-s", "2x2", "-r", "6", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
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
      assert.deepEqual(Buffer.concat(output), Buffer.concat(frames.map(n => input.subarray(n * 4, (n + 1) * 4))));
      const timestamps = stderr.split("\n").filter(line => line.includes("pts_time:"));
      assert.deepEqual(timestamps.map(line => Number(line.split("pts:")[1]!.trim().split(" ")[0])), frames);
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
