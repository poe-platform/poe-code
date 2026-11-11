import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 1024 }, (_, i) =>
  50 + 2 * Math.floor((i % 32) / 3) + Math.floor(i / 32 / 4)));

for (const graph of [false, true]) {
  for (const [options, valid] of [
    ["strength=5:radius=4", true],
    ["strength=5:radius=4:", true],
    ["5:4:", true],
    ["5:radius=4:", true],
    ["strength=5:radius=4:enable=1:", true],
    ["strength=5:radius=4::", false],
    ["5:4:1:", false],
    ["strength=5:radius=:", false],
    ["strength=5:radius=4:unknown=1:", false]
  ] as const) {
    it(`handles gradfun=${options} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input });
      const stdout: Buffer[] = [];
      let stderr = "";
      const filter = `gradfun=${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "error", "-f", "rawvideo", "-pixel_format", "gray",
          "-video_size", "32x32", "-framerate", "4", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      const output = Buffer.concat(stdout);
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
      if (!valid) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("gradfun"), stderr);
        assert.equal(output.length, 0);
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.length, 1024);
      // Complete raw output captured from native FFmpeg 7.0.2.
      assert.equal(createHash("sha256").update(output).digest("hex"),
        "f021f8f8032267309cd2b854e7c8b457db230bb5f9d95d11431579039b46c3d0");
    });
  }
}
