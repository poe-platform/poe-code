import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2: RGB48 PPM retains every sample, in network byte order.
const samples = [0, 1, 257, 258, 32767, 32768, 33001, 45032, 65279, 65533, 65534, 65535];
const raster = Buffer.alloc(samples.length * 2);
samples.forEach((value, index) => raster.writeUInt16BE(value, index * 2));

for (const source of ["rgb48be", "rgb48le"]) {
  for (const format of [undefined, "rgb48be", "rgb24"]) {
    for (const target of ["pipe:1", "/out.ppm", "/frame%d.ppm"]) {
      it(`writes exact ${format ?? "automatic"} PPM samples from ${source} to ${target}`, async () => {
        const input = source === "rgb48be" ? raster : Buffer.from(raster).swap16();
        const volume = Volume.fromJSON({ "/in.raw": Buffer.concat([input, input]) });
        const args = ["-v", "error", "-f", "rawvideo", "-pixel_format", source,
          "-video_size", "2x2", "-i", "/in.raw", "-frames:v", "2", "-c:v", "ppm",
          ...(format ? ["-pix_fmt", format] : []),
          "-f", target.includes("%d") ? "image2" : "image2pipe", target];
        if (target.includes("%d")) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
          assert.equal(volume.existsSync("/frame1.ppm"), false);
        }
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const expected = Buffer.concat([
          Buffer.from(`P6\n2 2\n${format === "rgb24" ? 255 : 65535}\n`),
          format === "rgb24" ? Buffer.from([0, 0, 1, 1, 128, 128, 129, 176, 255, 255, 255, 255]) : raster
        ]);
        if (target.includes("%d")) {
          assert.deepEqual(volume.readFileSync("/frame1.ppm"), expected);
          assert.deepEqual(volume.readFileSync("/frame2.ppm"), expected);
        } else {
          const output = target === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(target);
          assert.deepEqual(output, Buffer.concat([expected, expected]));
        }
      });
    }
  }
}

it("checks the complete 16-bit PPM size before replacing output", async () => {
  const volume = Volume.fromJSON({ "/in.raw": raster, "/out.ppm": "keep" });
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxOutputBytes: 36 } }).execute({
    args: ["-y", "-v", "error", "-f", "rawvideo", "-pixel_format", "rgb48be",
      "-video_size", "2x2", "-i", "/in.raw", "-frames:v", "1", "-c:v", "ppm",
      "-pix_fmt", "rgb48be", "-f", "image2pipe", "/out.ppm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.notEqual(result.exitCode, 0);
  assert.match(stderr, /maxOutputBytes/);
  assert.equal(volume.readFileSync("/out.ppm", "utf8"), "keep");
});
