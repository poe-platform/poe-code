import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// Exit statuses and reversed bytes checked against Linux FFmpeg 7.0.2.
for (const [option, status] of [
  ...["slice", "+slice", "-slice", "none", "all", "4294967295", "0xffffffff",
    "none+slice", "all-slice", "slice+slice", "slice-slice", "slice++slice",
    "slice--slice", "slice+-slice", "-1", "-2147483648", "-4294967295"]
    .map(flags => [`thread_type=${flags}`, 0] as const),
  ...["0.5", "1.5", "4294967296", "0x100000000"]
    .map(flags => [`thread_type=${flags}`, 222] as const),
  ...["", "bogus", "slice+bogus", "slice+", "slice+++slice"]
    .map(flags => [`thread_type=${flags}`, 234] as const),
  // Integer AVOptions accept fractions; flag validation must not change them.
  ["threads=1.5", 0],
  ["extra_hw_frames=0.5", 0]
] as const) {
  for (const graph of [false, true]) {
    it(`reverse ${option} preserves status, frames and PTS (${graph ? "graph" : "simple"})`, async () => {
      const fs = createMemoryFileSystem();
      const input = Buffer.from("0d141b222930373e", "hex");
      await fs.writeFile("/in.raw", input);
      const output: Uint8Array[] = [];
      let stderr = "";
      const filter = `${graph ? "reverse@flip" : "reverse"}=${option},showinfo`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
          "-s", "2x2", "-r", "2", "-i", "in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
        command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(chunk) { output.push(chunk.slice()); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      assert.equal(result.exitCode, status, stderr);
      assert.equal(Buffer.concat(output).toString("hex"), status === 0 ? "2930373e0d141b22" : "");
      const pts = stderr.split("\n").filter(line => line.includes(" pts:"))
        .map(line => Number(line.split(" pts:")[1]!.trimStart().split(" ")[0]));
      assert.deepEqual(pts, status === 0 ? [0, 1] : []);
      assert.deepEqual(Buffer.from(await fs.readFile("/in.raw")), input);
    });
  }
}
