import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const options of ["2:2", "2:2:", "2:2:1:1", "2:2:1:1:", "w=2:h=2:", "2:2:1:1:0:1:", "2:2::1"]) {
  it(`handles crop option separators in ${options}`, async () => {
    const input = Buffer.from(Array.from({ length: 48 }, (_, i) => [16 + i, 32 + i, 64 + i, 128 + i]).flat());
    const volume = Volume.fromJSON({ "/input.raw": input, "/output.raw": "KEEP" });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "4x4",
        "-framerate", "4", "-i", "/input.raw", "-vf", `crop=${options}`,
        "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "/output.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    if (options.includes("::")) {
      assert.equal(result.exitCode, 1);
      assert.equal(volume.readFileSync("/output.raw", "utf8"), "KEEP");
      return;
    }
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal((volume.readFileSync("/output.raw") as Buffer).toString("hex"),
      "1525458516264686192949891a2a4a8a2535559526365696293959992a3a5a9a354565a5364666a6394969a93a4a6aaa");
  });
}
