import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: three raw sheets at 4 fps, without an upstream tile filter.
for (const layout of ["2x1", "2X1", "2/1", "2XX1", "2//1", "2X1/1", "2/", "/1", "0/1", "2/0"]) {
  for (const named of [false, true]) {
    const valid = ["2x1", "2X1", "2/1"].includes(layout);
    it(`${valid ? "extracts" : "rejects"} untile=${named ? "layout=" : ""}${layout}`, async () => {
      const input = Buffer.from(Array.from({ length: 24 }, (_, i) => (i * 53 + 39) % 256));
      const volume = Volume.fromJSON({ "/in.raw": input });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo",
          "-pixel_format", "gray", "-video_size", "4x2", "-framerate", "4", "-i", "/in.raw",
          "-vf", `untile=${named ? "layout=" : ""}${layout},showinfo`,
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (valid) {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(Buffer.concat(stdout).toString("hex"), "275cfb3091c6659acf04a3d8396e0d4277ac4b80e116b5ea");
        const frames = stderr.split("\n").filter(line => line.includes("pts_time:"));
        assert.equal(frames.length, 6, stderr);
        for (const [n, frame] of frames.entries()) {
          assert.ok(frame.includes(`pts:${n} pts_time:${n / 8} `), frame);
        }
      } else {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("untile: invalid layout"), stderr);
        assert.equal(Buffer.concat(stdout).length, 0);
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
      assert.deepEqual(volume.readdirSync("/"), ["in.raw"]);
    });
  }
}
