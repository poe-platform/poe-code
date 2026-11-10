import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const options of ["", ":threads=1", ":thread_type=slice", ":extra_hw_frames=1",
  ":threads=1:thread_type=slice:extra_hw_frames=1"]) {
  it(`transpose=clock${options} preserves native grayscale bytes`, async () => {
    const input = Buffer.from([16, 17, 18, 19, 20, 21, 22, 23]);
    const volume = Volume.fromJSON({ "/in.raw": input });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "4x2",
        "-i", "in.raw", "-vf", `transpose=clock${options}`, "-pix_fmt", "gray", "-f", "rawvideo", "out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), "1410151116121713");
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
