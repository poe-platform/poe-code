import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, three raw sheets at 4 fps, without an upstream tile filter.
for (const graph of [false, true]) {
  for (const [upstream, rate, hex] of [
    ["untile=2x1", 8, "275cfb3091c6659acf04a3d8396e0d4277ac4b80"],
    ["untile=2x1", 4, "275cfb30cf04a3d877ac4b80"],
    ["untile=2x1", 16, "275cfb30275cfb3091c6659a91c6659acf04a3d8cf04a3d8396e0d42396e0d4277ac4b8077ac4b80"],
    ["select=eq(n\\,0),untile=2x1", 8, "275cfb3091c6659a91c6659a"],
    ["untile=2x1,select=eq(n\\,0)", 8, "275cfb30275cfb30275cfb30"],
    ["settb=1/1000,untile=2x1", 8, "275cfb3091c6659acf04a3d8396e0d4277ac4b80e116b5ea"]
  ] as const) {
    it(`stops ${upstream},fps=${rate} at native EOF (graph=${graph})`, async () => {
      const input = Buffer.from(Array.from({ length: 24 }, (_, i) => (i * 53 + 39) % 256));
      const volume = Volume.fromJSON({ "/in.raw": input });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const filter = `${upstream},fps=${rate},showinfo`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo",
          "-pixel_format", "gray", "-video_size", "4x2", "-framerate", "4", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
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
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(stdout).toString("hex"), hex);
      const frames = stderr.split("\n").filter(line => line.includes("pts_time:"));
      assert.equal(frames.length, hex.length / 8, stderr);
      for (const [n, frame] of frames.entries()) {
        assert.ok(frame.includes(`pts:${n} pts_time:${n / rate} `), frame);
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
