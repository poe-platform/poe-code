import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createFfmpegCommand } from "./index.js";

for (const samples of [1024, 2000, 2048]) {
  for (const format of ["s16le", "framecrc", "framehash", "framemd5"]) {
    it(`anullsrc emits exactly ${samples} samples as ${format}`, async () => {
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "lavfi", "-i",
          `anullsrc=r=8000:cl=mono:d=${samples / 8000}`, "-c:a", "pcm_s16le", "-f", format, "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const output = Buffer.concat(chunks);
      if (format === "s16le") {
        assert.deepEqual(output, Buffer.alloc(samples * 2));
        return;
      }
      const expected = [];
      for (let pts = 0; pts < samples; pts += 1024) {
        const duration = Math.min(1024, samples - pts);
        const checksum = format === "framecrc" ? "0x00000000"
          : createHash(format === "framemd5" ? "md5" : "sha256").update(Buffer.alloc(duration * 2)).digest("hex");
        expected.push(["0", String(pts), String(pts), String(duration), String(duration * 2), checksum]);
      }
      assert.deepEqual(output.toString().trim().split("\n").filter(line => !line.startsWith("#"))
        .map(line => line.split(",").map(column => column.trim())), expected);
    });
  }
}
