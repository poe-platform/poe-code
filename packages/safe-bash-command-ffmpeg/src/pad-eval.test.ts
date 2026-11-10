import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from([50, 30, 212, 255, 120, 180, 60, 128, 80, 140, 190, 64, 18, 47, 199, 0]);
// Exact 4x4 RGBA output from native FFmpeg 7.0.2 for eval=0+1 and eval=frame.
const expected = Buffer.from(
  "321ed4ff78b43c80000000ff000000ff508cbe40122fc700000000ff000000ff" +
  "000000ff000000ff000000ff000000ff000000ff000000ff000000ff000000ff", "hex"
);

for (const [suffix, valid] of [
  ...["", ":eval=init", ":eval=frame", ":eval=0", ":eval=1", ":eval=0+1",
    ":0:0:black:0+1", ":eval=frame-init", ":eval=frame-1", ":eval=1/2",
    ":eval=0.51", ":eval=default", ":eval=min", ":eval=max", ":eval=PI/4",
    ":eval=+1", ":eval=-0", ":eval=1e0"].map(value => [value, true] as const),
  ...["", "bogus", "2", "1.01", "-0.01", "1+", "1junk", "1/0", "0/0", "NAN", "INF"]
    .map(value => [`:eval=${value}`, false] as const)
] as const) {
  for (const graph of [false, true]) {
    it(`pad eval ${suffix || "(default)"} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.rgba": input, "/out.raw": "KEEP" });
      const before = volume.toJSON();
      const errors: Uint8Array[] = [];
      const filter = `pad=4:4${suffix}`;
      const argumentValues = createCommandArguments([
        "-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "2x2",
        "-framerate", "4", "-i", "/in.rgba",
        ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
        "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "/out.raw"
      ]);
      const result = await createFfmpegCommand().execute({
        command: "ffmpeg", args: argumentValues.args, argumentValues,
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      const stderr = Buffer.concat(errors).toString();
      if (valid) {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"), expected);
        assert.deepEqual(volume.readFileSync("/in.rgba"), input);
      } else {
        assert.notEqual(result.exitCode, 0, stderr);
        assert.ok(stderr.includes("pad:"), stderr);
        assert.deepEqual(volume.toJSON(), before);
      }
    });
  }
}
