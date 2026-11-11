import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 rejects s64le as a demuxer/muxer, and diagnoses the input first.
for (const [inputFormat, outputFormat] of [
  ["s64le", "s64le"], ["s64le", "s16le"], ["s16le", "s64le"]
] as const) {
  for (const existing of [false, true]) {
    it(`diagnoses ${inputFormat} input before ${outputFormat} output (existing=${existing})`, async () => {
      const input = Buffer.alloc(16);
      for (let index = 0; index < 8; index++) input.writeInt16LE(index + 1, index * 2);
      const volume = Volume.fromJSON(existing ? { "/out.bin": "KEEP" } : {});
      volume.writeFileSync("/in.raw", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", inputFormat, "-ar", "8000", "-ac", "1",
          "-i", "in.raw", "-f", outputFormat, "out.bin"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 234, stderr);
      if (inputFormat === "s64le") {
        assert.ok(stderr.includes("Unknown input format: 's64le'"), stderr);
        assert.ok(stderr.includes("Error opening input file in.raw"), stderr);
        assert.ok(!stderr.includes("output format"), stderr);
      } else {
        assert.ok(stderr.includes("Unable to find a suitable output format for 's64le'"), stderr);
        assert.ok(!stderr.includes("Unknown input format"), stderr);
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
      assert.equal(volume.existsSync("/out.bin"), existing);
      if (existing) assert.equal(volume.readFileSync("/out.bin", "utf8"), "KEEP");
    });
  }
}
