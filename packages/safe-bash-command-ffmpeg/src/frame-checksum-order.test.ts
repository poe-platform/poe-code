import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const format of ["framemd5", "framehash", "framecrc"]) {
  for (const differentRates of [false, true]) {
    for (const codec of ["pcm_s16le", "copy"]) {
      it(`${format} interleaves mapped ${codec} packets (different rates=${differentRates})`, async () => {
        const fs = Volume.fromJSON({});
        const channels = [Float64Array.from({ length: 1200 }, (_, i) => i / 32768)];
        fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
        fs.writeFileSync("/fast.wav", encodeWav({ sampleRate: 16000, channels }));
        let stdout = "", stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-i", "/in.wav", "-i", "/fast.wav", "-map", "0:a", "-map",
            differentRates ? "1:a" : "0:a", "-c:a", codec, "-f", format, "-"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const rows = stdout.split("\n").filter(line => line && !line.startsWith("#"));
        // At equal DTS, native FFmpeg emits the lower output stream index first.
        const order = differentRates
          ? [[0, 0], [1, 0], [0, 512], [1, 1024], [0, 1024]]
          : [[0, 0], [1, 0], [0, 512], [1, 512], [0, 1024], [1, 1024]];
        const expected = order.map(([stream, dts]) => {
          const duration = Math.min(differentRates && stream === 1 ? 1024 : 512, 1200 - dts!);
          const payload = new Uint8Array(duration * 2);
          for (let i = 0; i < duration; i++) new DataView(payload.buffer).setInt16(i * 2, dts! + i, true);
          let digest: string;
          if (format === "framecrc") {
            let a = 0, b = 0;
            for (const byte of payload) { a = (a + byte) % 65521; b = (b + a) % 65521; }
            digest = `0x${((b * 65536 + a) >>> 0).toString(16).padStart(8, "0")}`;
          } else digest = createHash(format === "framemd5" ? "md5" : "sha256").update(payload).digest("hex");
          return [String(stream), String(dts), String(dts), String(duration), String(payload.length), digest];
        });
        assert.deepEqual(rows.map(row => row.split(",").map(field => field.trim())), expected);
      });
    }
  }
}
