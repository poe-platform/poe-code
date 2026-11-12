import assert from "node:assert/strict";
import { it } from "node:test";
import { createFfmpegCommand } from "./index.js";

for (const option of ["cl", "channel_layout"]) {
  for (const [layout, channels] of [["5.1", 6], ["quad", 4], ["0x4", 1], ["mono", 1], ["stereo", 2]] as const) {
    it(`anullsrc preserves ${option}=${layout}`, async () => {
      const args = ["-v", "error", "-f", "lavfi", "-i",
        `anullsrc=r=8000:d=0.25:${option}=${layout}`, "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"];
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.deepEqual(Buffer.concat(chunks), Buffer.alloc(4000 * channels));
    });
  }
}
