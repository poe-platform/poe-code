import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const alpha of ["0", "0.5", "1"]) {
  it(`exports the default color source red@${alpha} as opaque RGBA`, async () => {
    const volume = Volume.fromJSON({});
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "lavfi", "-i", `color=red@${alpha}:s=4x4:r=1:d=1`,
        "-frames:v", "1", "-c:v", "rawvideo", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr.push(Buffer.from(bytes)); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
    // FFmpeg 7.0.2's default YUV420P source drops alpha before RGBA conversion.
    assert.deepEqual(Buffer.concat(stdout), Buffer.from("fd0000ff".repeat(16), "hex"));
  });
}
