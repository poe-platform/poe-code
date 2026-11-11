import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const option of ["threads=1", "thread_type=slice", "extra_hw_frames=1"]) {
    it(`shuffleframes accepts ${option} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from("1019222b343d464f", "hex") });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const filter = `shuffleframes=mapping=1 0:${option},showinfo`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-r", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(stdout).toString("hex"), "343d464f1019222b");
      const frames = stderr.split("\n").filter(line => line.includes("n:"));
      assert.equal(frames.length, 2, stderr);
      for (const [n, frame] of frames.entries()) {
        const fields = frame.split(" ").filter(Boolean);
        assert.ok(fields.includes(`pts:${n}`), frame);
      }
    });
  }
}
