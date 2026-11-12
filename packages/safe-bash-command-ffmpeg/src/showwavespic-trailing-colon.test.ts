import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [options, expected] of [
  ["filter=peak", "7f00007f7f00007f7f3f00fe7f3f00fe7f3f00fe7f00007f7f00007f7f00007f"],
  ["colors=red|blue", "00000000000000007f007ffe7f00007f7f00007f000000000000000000000000"],
  ["colors=", "0000000000000000fefefefe7f7f7f7f7f7f7f7f000000000000000000000000"]
] as const) {
  for (const trailing of ["", ":", "::"]) {
    it(`handles showwavespic options ${options}${trailing}`, async () => {
      const samples = [32767, 0, -32768, 1000, 0, 7000, 1234, -20000, 400, 500, 32767, 0, -3000, 12000, 128, 128];
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
      const volume = Volume.fromJSON({ "/in.raw": input });
      const stdout: Buffer[] = [];
      let stderr = "";
      const expression = `showwavespic=s=2x4:${options}${trailing}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          "-filter_complex", expression, "-frames:v", "1", "-pix_fmt", "rgba", "-bitexact", "-f", "rawvideo", "-"],
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
      if (trailing === "::") {
        assert.equal(result.exitCode, 1);
        assert.equal(Buffer.concat(stdout).length, 0);
        assert.ok(stderr.length > 0);
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      // Native FFmpeg 7.0.2 RGBA output, identical with and without one trailing colon.
      assert.equal(Buffer.concat(stdout).toString("hex"), expected);
    });
  }
}
