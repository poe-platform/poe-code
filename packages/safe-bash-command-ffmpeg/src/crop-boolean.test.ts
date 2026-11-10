import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const options of ["n:y", "N:Y", "no:yes", "", "keep_aspect=n:exact=Y", "keep_aspect=Y:exact=N", "keep_aspect=invalid", "exact=invalid",
  ...["exact", "keep_aspect"].flatMap(key => ["+1", "01", "+01", "-0", "00", "enable", "disable", "ENABLED", "DISABLED", "1"].map(value => `${key}=${value}`)),
  "-0:+1", "disable:enable"]) {
  it(`handles crop boolean options ${options || "(defaults)"}`, async () => {
    const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
    volume.writeFileSync("/in.raw", Buffer.from(Array.from({ length: 48 }, (_, i) => [16 + i, 32 + i, 64 + i, 128 + i]).flat()));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "4x4", "-framerate", "4", "-i", "/in.raw",
        "-vf", `crop=2:2:1:1${options ? `:${options}` : ""}`, "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    if (options.endsWith("=invalid")) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(Buffer.concat(errors).toString().includes(`crop: ${options.split("=")[0]} must be a boolean`));
      assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
    } else {
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      // FFmpeg 7.0.2 output for the three 4x4 RGBA frames, cropped to 2x2 at (1, 1).
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(
        "1525458516264686192949891a2a4a8a2535559526365696293959992a3a5a9a354565a5364666a6394969a93a4a6aaa", "hex"));
    }
  });
}
