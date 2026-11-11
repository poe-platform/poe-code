import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

for (const [expression, indices, exitCode] of [
  ["1", [0, 1, 2, 3], 0],
  ["default", [0, 1, 2, 3], 0],
  ["min", [0, 1, 2, 3], 0],
  ["max", [0], 0],
  ["default+min", [0, 2], 0],
  ["max-2147483645", [0, 2], 0],
  ["min-1", [], 222],
  ["max+1", [], 222],
  ["unknown", [], 234]
] as const) {
  for (const named of [false, true]) {
    for (const graph of [false, true]) {
      it(`framestep ${named ? "step=" : ""}${expression} (${graph ? "graph" : "simple"}) preserves bytes and PTS`, async () => {
        const fs = createMemoryFileSystem();
        const input = Buffer.from(Array.from({ length: 16 }, (_, index) => 13 + 7 * index));
        await fs.writeFile("/in.raw", input);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const filter = `framestep=${named ? "step=" : ""}${expression},showinfo`;
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
            "-s", "2x2", "-r", "6", "-i", "in.raw",
            ...(graph ? ["-filter_complex", `[0:v]${filter}[v]`, "-map", "[v]"] : ["-vf", filter]),
            "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
          command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
          stdin: (async function* () {})(),
          stdout: { async write(chunk) { stdout.push(chunk); } },
          stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        assert.equal(result.exitCode, exitCode, stderr);
        assert.deepEqual(Buffer.concat(stdout), Buffer.concat(indices.map(index => input.subarray(index * 4, index * 4 + 4))));
        if (exitCode === 0) {
          const frames = stderr.split("\n").filter(line => line.includes("pts_time:"));
          assert.deepEqual(frames.map(line => Number(line.split("pts:")[1]!.trim().split(" ")[0])), indices);
        } else {
          assert.ok(stderr.includes("framestep:"), stderr);
        }
        assert.deepEqual(Buffer.from(await fs.readFile("/in.raw")), input);
      });
    }
  }
}
