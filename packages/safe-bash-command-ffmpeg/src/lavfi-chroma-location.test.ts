import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const source of ["testsrc2", "testsrc", "color"]) {
  for (const target of ["pipe:1", "/out.y4m"]) {
    it(`uses default JPEG chroma siting for ${source} Y4M output to ${target}`, async () => {
      const volume = Volume.fromJSON({});
      const stdout: Uint8Array[] = [];
      const stderr: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "lavfi", "-i", `${source}=s=64x48:r=2:d=1`,
          "-pix_fmt", "yuv420p", "-f", "yuv4mpegpipe", target],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
      assert.equal(Buffer.concat(stderr).toString(), "");
      const output = target === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(target) as Buffer;
      const headerEnd = output.indexOf(10);
      // Native FFmpeg 7.0.2 leaves lavfi chroma location unspecified, yielding these tags.
      assert.equal(output.subarray(0, headerEnd).toString(),
        "YUV4MPEG2 W64 H48 F2:1 Ip A1:1 C420jpeg XYSCSS=420JPEG");
      const frameSize = 64 * 48 * 3 / 2;
      assert.equal(output.length, headerEnd + 1 + 2 * (6 + frameSize));
      for (let frame = 0; frame < 2; frame++) {
        const offset = headerEnd + 1 + frame * (6 + frameSize);
        assert.equal(output.subarray(offset, offset + 6).toString(), "FRAME\n");
      }
    });
  }
}
