import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) for (const [filter, positions] of [
  ["crop=2:2:pos/64:0", [0, 1, 2]],
  ["crop=2:2:'mod(pos/64,3)':0", [0, 1, 2]],
  ["crop=2:2:pos:0", [0, 2, 2]],
  ["crop=2:2:n:0", [0, 1, 2]],
  ["crop=2:2:0:0", [0, 0, 0]],
  ["select=gt(n\\,0),setpts=PTS-STARTPTS,crop=2:2:pos/64:0", [1, 2]],
] as const) {
  it(`uses source packet positions for ${filter} (${complex ? "graph" : "simple"})`, async () => {
    const input = Buffer.from(Array.from({ length: 48 }, (_, i) => [16 + i, 32 + i, 64 + i, 128 + i]).flat());
    const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba",
        "-video_size", "4x4", "-framerate", "4", "-i", "/in.raw",
        ...(complex ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]), "-fps_mode", "passthrough", "-pix_fmt", "rgba",
        "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const expected = Buffer.concat(positions.flatMap((x, index) => {
      const frame = index + 3 - positions.length;
      return [0, 1].map(y => {
        const offset = (frame * 16 + y * 4 + x) * 4;
        return input.subarray(offset, offset + 8);
      });
    }));
    assert.deepEqual(volume.readFileSync("/out.raw"), expected);
  });
}

it("exposes unknown packet positions as NaN for generated frames", async () => {
  const volume = Volume.fromJSON({});
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-f", "lavfi", "-i", "color=red:s=4x4:d=1:r=1", "-vf",
      "format=rgba,crop=2:2:isnan(pos):0", "-pix_fmt", "rgba", "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  assert.equal((volume.readFileSync("/out.raw") as Uint8Array).length, 16);
});
