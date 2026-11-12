import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const instance of ["", "@wave"]) {
  for (const labeled of [false, true]) {
    it(`renders native showwavespic pixels with instance '${instance}', labeled=${labeled}`, async () => {
      const samples = [32767, 0, -32768, 1000, 0, 7000, 1234, -20000, 400, 500, 32767, 0, -3000, 12000, 128, 128];
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
      const volume = Volume.fromJSON({ "/in.raw": input });
      const stdout: Buffer[] = [];
      let stderr = "";
      const expression = `showwavespic${instance}=s=2x4`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          "-filter_complex", labeled ? `[0:a]${expression}[pic]` : expression,
          ...(labeled ? ["-map", "[pic]"] : []), "-frames:v", "1", "-pix_fmt", "rgba", "-bitexact", "-f", "rawvideo", "-"],
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
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      // Native FFmpeg 7.0.2 RGBA output, identical with and without @wave.
      assert.equal(Buffer.concat(stdout).toString("hex"), "00000000000000007f3f00fe7f00007f7f00007f000000000000000000000000");
    });
  }
}
