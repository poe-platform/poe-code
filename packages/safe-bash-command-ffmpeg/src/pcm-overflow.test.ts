import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

for (const input of ["f32le", "f64le"]) {
  for (const output of ["s16le", "s32le", input, "copy"]) {
    it(`converts large finite ${input} samples to ${output} like FFmpeg 7.0.2 x86_64`, async () => {
      const width = input === "f32le" ? 4 : 8;
      const bytes = Buffer.alloc(4 * width);
      [1e10, -1e10, 1.5, -1.5].forEach((value, i) => {
        if (width === 4) bytes.writeFloatLE(value, i * width);
        else bytes.writeDoubleLE(value, i * width);
      });
      const fs = createMemoryFileSystem();
      await fs.writeFile("/in.raw", bytes);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", input, "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(output === "copy" ? ["-c:a", "copy"] : []), "-f", output === "copy" ? input : output, "/out.raw"],
        command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      assert.equal(result.exitCode, 0, stderr);
      const actual = Buffer.from(await fs.readFile("/out.raw"));
      if (output === "s16le") {
        assert.deepEqual(Array.from({ length: 4 }, (_, i) => actual.readInt16LE(i * 2)),
          [-32768, 32767, 32767, -32768]);
      } else if (output === "s32le") {
        assert.deepEqual(Array.from({ length: 4 }, (_, i) => actual.readInt32LE(i * 4)),
          [-2147483648, -2147483648, 2147483647, -2147483648]);
      } else assert.deepEqual(actual, bytes);
    });
  }
}
