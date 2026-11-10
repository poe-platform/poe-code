import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Byte-for-byte outputs from native FFmpeg 7.0.2 for six stereo float32 frames.
for (const [expression, frame] of [
  ["mono|c0=c0", "0000003f"],
  ["stereo|c0=c1|c1=c0", "0000c07f0000003f"],
  ["mono|c0=1*c0+0*c1", "0000003f"],
  ["mono|c0=c1", "0000c07f"],
  ["mono|c0=0.25*c0+0.75*c1", "0000c07f"]
] as const) {
  for (const complex of [false, true]) {
    it(`isolates unused NaN pan inputs (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const volume = Volume.fromJSON({
        "/in.raw": Buffer.from("0000003f0000c07f".repeat(6), "hex"),
        "/out.raw": "KEEP"
      });
      let stderr = "";
      const filter = `pan=${expression}`;
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "f32le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "f32le", "/out.raw"],
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
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(frame.repeat(6), "hex"));
    });
  }
}
