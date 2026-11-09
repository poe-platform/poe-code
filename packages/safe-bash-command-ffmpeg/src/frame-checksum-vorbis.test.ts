import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

for (const format of ["framemd5", "framehash", "framecrc"]) {
  for (const codec of [undefined, "pcm_s16le", "pcm_f32le"]) {
    it(`${format} preserves decoded Vorbis frame timing and ${codec ?? "default PCM"} payloads`, async () => {
      const fs = createMemoryFileSystem();
      await fs.writeFile("/in.ogg", readFileSync(new URL("./fixtures/frame-checksum-vorbis.ogg", import.meta.url)));
      const run = async (args: string[]) => {
        let stdout = "", stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-i", "/in.ogg", ...(codec ? ["-c:a", codec] : []), ...args],
          command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
          stdin: (async function* () {})(),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        assert.equal(result.exitCode, 0, stderr);
        return stdout;
      };
      await run(["-f", (codec ?? "pcm_s16le").slice(4), "/pcm"]);
      const pcm = await fs.readFile("/pcm");
      const output = await run(["-f", format, "-"]);
      const rows = output.split("\n").filter(line => line.startsWith("0,")).map(line => line.split(",").map(field => field.trim()));
      // Native FFmpeg 7.0.2: 20 frames, with a priming window and final padding.
      const durations = [576, ...Array<number>(18).fill(1024), 64];
      const bytesPerSample = codec === "pcm_f32le" ? 4 : 2;
      let pts = 128, offset = 0;
      assert.equal(rows.length, durations.length);
      for (const [index, duration] of durations.entries()) {
        const size = duration * bytesPerSample;
        const row = rows[index]!;
        assert.deepEqual(row.slice(0, 5).map(Number), [0, pts, pts, duration, size]);
        const payload = pcm.subarray(offset, offset + size);
        if (format === "framecrc") {
          let a = 0, b = 0;
          for (const byte of payload) { a = (a + byte) % 65521; b = (b + a) % 65521; }
          assert.equal(row[5], `0x${((b * 65536 + a) >>> 0).toString(16).padStart(8, "0")}`);
        } else {
          assert.equal(row[5], createHash(format === "framemd5" ? "md5" : "sha256").update(payload).digest("hex"));
        }
        pts += duration;
        offset += size;
      }
      assert.equal(offset, pcm.length);
      assert.equal(offset, 19072 * bytesPerSample);
    });
  }
}
