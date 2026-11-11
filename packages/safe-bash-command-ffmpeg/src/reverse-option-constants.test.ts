import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 accepts AVOption bounds/defaults and mathematical constants.
for (const option of ["threads", "extra_hw_frames"]) {
  for (const [expression, status] of [
    ...["default", "min", "max", "PI", "E", "PHI", "default+1", "max-1", "0"]
      .map(expression => [expression, 0] as const),
    ["-1", option === "extra_hw_frames" ? 0 : 222],
    ["min-1", 222],
    ["max+1", 222],
    ["default-1", 222],
    ["unknown", 234],
    ["pi", 234]
  ] as const) {
    for (const graph of [false, true]) {
      it(`reverse ${option}=${expression} (${graph ? "graph" : "simple"})`, async () => {
        const fs = createMemoryFileSystem();
        const input = Buffer.from("0d141b222930373e", "hex");
        await fs.writeFile("/in.raw", input);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const filter = `reverse${graph ? "@rev" : ""}=${option}=${expression},showinfo`;
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
            "-s", "2x2", "-r", "2", "-i", "in.raw",
            ...(graph ? ["-filter_complex", `[0:v]${filter}[v]`, "-map", "[v]"] : ["-vf", filter]),
            "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
          command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
          stdin: (async function* () {})(),
          stdout: { async write(chunk) { stdout.push(chunk); } },
          stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        assert.equal(result.exitCode, status, stderr);
        assert.equal(Buffer.concat(stdout).toString("hex"), status === 0 ? "2930373e0d141b22" : "");
        if (status === 0) {
          const frames = stderr.split("\n").filter(line => line.includes("pts_time:"));
          assert.deepEqual(frames.map(line => Number(line.split("pts:")[1]!.trim().split(" ")[0])), [0, 1]);
        } else {
          assert.ok(stderr.includes("reverse:"), stderr);
        }
        assert.deepEqual(Buffer.from(await fs.readFile("/in.raw")), input);
      });
    }
  }
}
