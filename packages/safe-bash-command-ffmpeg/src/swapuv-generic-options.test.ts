import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: preserve every byte of two 4x2 YUV420P frames except swapped chroma.
for (const [direction, flipped] of [
  ["swapuv", "2f3a45505b66717c9da88792b3bec9d4df18232e4f5a3944"]
] as const) {
  for (const [options, expected] of [
    ["", flipped],
    ["threads=1", flipped],
    ["thread_type=slice", flipped],
    ["extra_hw_frames=1", flipped],
    ["threads=1:thread_type=slice:extra_hw_frames=1", flipped],
    ["threads=0:thread_type=0:extra_hw_frames=-1", flipped],
    ["threads=1+1:thread_type=-1:extra_hw_frames=2", flipped],
    ["threads=1:", flipped],
    ...["threads=-1", "threads=2147483648", "threads=", "threads=bogus:threads=1",
      "thread_type=bogus", "thread_type=0.5", "extra_hw_frames=-2", "extra_hw_frames=2147483648",
      "threads=1:unknown=1", "threads=1:1", "threads=1::", "THREADS=1"]
      .map(option => [option, undefined] as const)
  ] as const) {
    for (const complex of [false, true]) {
      it(`${direction} generic options ${options || "(defaults)"} (${complex ? "named graph" : "simple"})`, async () => {
        const input = Buffer.from("2f3a45505b66717c87929da8b3bec9d4df18232e39444f5a", "hex");
        const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
        const before = volume.toJSON();
        const errors: Uint8Array[] = [];
        const filter = `${direction}${complex ? "@flip" : ""}${options ? `=${options}` : ""}`;
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", "4x2", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:v]${filter}[v]`, "-map", "[v]"] : ["-vf", filter]),
            "-pix_fmt", "yuv420p", "-f", "rawvideo", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
        } as never);
        if (expected !== undefined) {
          assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
          assert.equal(Buffer.concat(errors).length, 0);
          assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
          assert.deepEqual(volume.readFileSync("/in.raw"), input);
        } else {
          assert.notEqual(result.exitCode, 0);
          assert.ok(Buffer.concat(errors).toString().includes(direction));
          assert.deepEqual(volume.toJSON(), before);
        }
      });
    }
  }
}
