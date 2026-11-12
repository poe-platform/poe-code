import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 converts to s16 before measuring waveform heights.
for (const amplitude of [4095.25, 4095.5, 4095.75, -4095.25, -4095.5, -4095.75]) {
  for (const upstream of ["", "aformat=sample_fmts=s16,", "volume=0.5,"]) {
    it(`renders the PCM16 rounding boundary at ${amplitude} with ${upstream || "implicit conversion"}`, async () => {
      const input = Buffer.alloc(16 * 4);
      for (let i = 0; i < 8; i++) {
        input.writeFloatLE(amplitude * (upstream === "volume=0.5," ? 2 : 1) / 32768, i * 8);
      }
      const volume = Volume.fromJSON({ "/in.raw": input });
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "f32le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          "-filter_complex", `${upstream}showwavespic=s=2x4`, "-frames:v", "1",
          "-pix_fmt", "rgba", "-bitexact", "-f", "rawvideo", "-"],
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
      assert.equal(Buffer.concat(stdout).toString("hex"), Math.abs(amplitude) >= 4095.5
        ? "00000000000000007f00007f7f00007f00000000000000000000000000000000"
        : "0000000000000000000000000000000000000000000000000000000000000000");
    });
  }
}
