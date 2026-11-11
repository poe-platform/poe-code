import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 48 }, (_, i) => {
  const x = i % 8;
  const y = Math.floor(i / 8);
  return x === 0 && y === 0 ? 245 : x === 3 && y === 2 ? 4 : (x * 37 + y * 29 + x * y * 3) % 251;
}));

// Native FFmpeg 7.0.2 statuses and complete raw output, including borders.
for (const [filter, exitCode] of [
  ["median=bogus=2", 8],
  ["median=radius=x", 234],
  ["median=radius=0", 222],
  ["median=radius=128", 222],
  ["median=radiusV=-1", 222],
  ["median=planes=16", 222],
  ["median=percentile=1.1", 222],
  ["median", 0]
] as const) {
  for (const destination of ["pipe:1", "/out.raw"]) {
    it(`${filter} returns ${exitCode} writing to ${destination}`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "error", "-y", "-f", "rawvideo",
          "-pixel_format", "gray", "-video_size", "8x6", "-framerate", "4", "-i", "/in.raw",
          "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", destination],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      const output = destination === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(destination) as Buffer;
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
      if (exitCode === 0) {
        assert.equal(output.length, 48);
        assert.equal(createHash("sha256").update(output).digest("hex"),
          "7209ba8789b5b7c6a1326c193341e8c77c40e493badf1eba6e41aa38741e3b99");
      } else {
        assert.deepEqual(output, destination === "pipe:1" ? Buffer.alloc(0) : Buffer.from("KEEP"));
        assert.ok(stderr.includes("median"), stderr);
      }
      assert.equal(result.exitCode, exitCode, stderr);
    });
  }
}
