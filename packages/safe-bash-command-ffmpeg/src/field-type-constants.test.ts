import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 selects the top (0d14) or bottom (1b22) row.
for (const [expression, expected] of [
  ["default", "0d14"],
  ["min", "0d14"],
  ["max", "1b22"],
  ["top", "0d14"],
  ["bottom", "1b22"],
  ["0", "0d14"],
  ["1", "1b22"],
  ["default+max-min", "1b22"],
  ["max/2", "0d14"],
  ["0.5", "0d14"],
  ["0.49", "0d14"],
  ["0.51", "1b22"],
  ["min-1", null],
  ["max+1", null],
  ["unknown", null]
] as const) {
  for (const named of [false, true]) {
    it(`field=${named ? "type=" : ""}${expression} preserves native row selection`, async () => {
      const fs = createMemoryFileSystem();
      const input = Buffer.from("0d141b22", "hex");
      await fs.writeFile("/in.raw", input);
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
          "-s", "2x2", "-i", "in.raw", "-vf", `field=${named ? "type=" : ""}${expression},showinfo`,
          "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
        command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout.push(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      if (expected === null) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("field:"), stderr);
        assert.equal(Buffer.concat(stdout).length, 0);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(Buffer.concat(stdout).toString("hex"), expected);
        const frames = stderr.split("\n").filter(line => line.includes("pts_time:"));
        assert.equal(frames.length, 1, stderr);
        assert.ok(frames[0]!.includes("s:2x1"), stderr);
        assert.ok(frames[0]!.includes("pts_time:0"), stderr);
      }
      assert.deepEqual(Buffer.from(await fs.readFile("/in.raw")), input);
    });
  }
}
