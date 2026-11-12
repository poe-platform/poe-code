import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const label of ["0", "0:0", "0:a", "0:a:0", "1", "1:0", "1:a:0",
  "2", "0:1", "0:v", "0:a:1", "0:0:0", "0:a:0:0", "", "0:", "0:a:", "-1", "0:0.0"]) {
  it(`resolves showwavespic input [${label}]`, async () => {
    const valid = ["0", "0:0", "0:a", "0:a:0", "1", "1:0", "1:a:0"].includes(label);
    const pcm = Buffer.alloc(32);
    [32767, 0, -32768, 1000, 0, 7000, 1234, -20000, 400, 500, 32767, 0, -3000, 12000, 128, 128]
      .forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
    const volume = Volume.fromJSON({ "/in.raw": pcm });
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error",
        "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
        "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
        "-filter_complex", `[${label}]showwavespic=s=2x4`,
        "-frames:v", "1", "-pix_fmt", "rgba", "-bitexact", "-f", "rawvideo", "-"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, valid ? 0 : 1, stderr);
    if (valid) {
      // Native FFmpeg 7.0.2 RGBA output for this stereo PCM fixture.
      assert.equal(Buffer.concat(stdout).toString("hex"), "00000000000000007f3f00fe7f00007f7f00007f000000000000000000000000");
      assert.equal(stderr, "");
    } else {
      assert.ok(stderr.includes(`showwavespic: invalid audio input ${label}`), stderr);
      assert.equal(Buffer.concat(stdout).length, 0);
    }
  });
}
