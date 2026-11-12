import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const rgb48 = Buffer.alloc(24);
[0, 1, 257, 258, 32767, 32768, 33001, 45032, 65279, 65533, 65534, 65535]
  .forEach((sample, index) => rgb48.writeUInt16BE(sample, index * 2));

for (const fixture of [
  // Native FFmpeg 7.0.2: P4\n2 2\n followed by d5 8a; padding bits are unspecified.
  { format: "rgb48be", width: 2, height: 2, input: rgb48, raster: [0xd5, 0x8a] },
  // Exercise both bit polarity and row alignment across byte boundaries.
  { format: "rgb24", width: 9, height: 2,
    input: Buffer.from(Array.from({ length: 54 }, (_, i) => i < 27 ? 0 : 255)),
    raster: [0xff, 0x80, 0, 0] },
  // Native ordered dithering of mid-gray RGB repeats every eight rows and columns.
  { format: "rgb24", width: 9, height: 9, input: Buffer.alloc(243, 128),
    raster: Array.from({ length: 9 }, (_, y) => y % 2 ? [0xaa, 0x80] : [0x55, 0]).flat() }
]) {
  for (const pixelFormat of [undefined, "monow"]) {
    for (const target of ["pipe:1", "/out.bin", "/frame%d.pbm"]) {
      it(`encodes ${fixture.width}x${fixture.height} ${fixture.format} as ${pixelFormat ?? "default"} PBM to ${target}`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": Buffer.concat([fixture.input, fixture.input]) });
        const args = ["-v", "error", "-f", "rawvideo", "-pixel_format", fixture.format,
          "-video_size", `${fixture.width}x${fixture.height}`, "-i", "/in.raw",
          "-frames:v", "2", "-c:v", "pbm", ...(pixelFormat ? ["-pix_fmt", pixelFormat] : []),
          "-f", target.includes("%d") ? "image2" : "image2pipe", target];
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
        assert.equal(volume.existsSync("/frame1.pbm"), false);
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
        const header = Buffer.from(`P4\n${fixture.width} ${fixture.height}\n`);
        const size = header.length + fixture.raster.length;
        const output = target.includes("%d")
          ? Buffer.concat([volume.readFileSync("/frame1.pbm") as Buffer, volume.readFileSync("/frame2.pbm") as Buffer])
          : target === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(target) as Buffer;
        assert.equal(output.length, size * 2);
        for (let frame = 0; frame < 2; frame++) {
          assert.deepEqual(output.subarray(frame * size, frame * size + header.length), header);
          for (let y = 0; y < fixture.height; y++) {
            for (let x = 0; x < fixture.width; x++) {
              const offset = y * Math.ceil(fixture.width / 8) + (x >> 3);
              const mask = 1 << (7 - (x & 7));
              assert.equal(output[frame * size + header.length + offset]! & mask, fixture.raster[offset]! & mask);
            }
          }
        }
      });
    }
  }
}
