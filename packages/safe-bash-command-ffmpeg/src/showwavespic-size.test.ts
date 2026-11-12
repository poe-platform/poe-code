import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const size of ["2x4", "2X4", "2/4", "0X4", "2/0", "2X4/3", "2//4"]) {
  for (const option of ["s=", "size=", ""]) {
    it(`parses showwavespic image size ${option}${size}`, async () => {
      const samples = [32767, 0, -32768, 1000, 0, 7000, 1234, -20000, 400, 500, 32767, 0, -3000, 12000, 128, 128];
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
      const volume = Volume.fromJSON({ "/in.raw": input });
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          "-filter_complex", `showwavespic=${option}${size}`, "-frames:v", "1", "-pix_fmt", "rgba",
          "-bitexact", "-f", "rawvideo", "-"],
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
      if (!["2x4", "2X4", "2/4"].includes(size)) {
        assert.equal(result.exitCode, 1);
        assert.ok(stderr.includes("invalid image size"), stderr);
        assert.equal(Buffer.concat(stdout).length, 0);
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      // Native FFmpeg 7.0.2 produces identical RGBA bytes for all three separators.
      assert.equal(Buffer.concat(stdout).toString("hex"),
        "00000000000000007f3f00fe7f00007f7f00007f000000000000000000000000");
    });
  }
}
