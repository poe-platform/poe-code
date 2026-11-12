import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 retains samples 512..1024 for both seeks. The unaligned
// seek leaves 408 ticks before the first retained packet.
for (const start of [0.013, 0.064]) {
  for (const format of ["framecrc", "framemd5", "s16le"]) {
    it(`preserves copied PCM packet timing and bytes for ${format} after -ss ${start}`, async () => {
      const input = Buffer.alloc(1025 * 2);
      for (let i = 0; i < 1025; i++) input.writeInt16LE(i, i * 2);
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.raw", input);
      const output: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          "-bitexact", "-ss", String(start), "-c", "copy", "-f", format, "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const bytes = Buffer.concat(output);
      if (format === "s16le") {
        assert.deepEqual(bytes, input.subarray(512 * 2));
      } else {
        const offset = start === 0.013 ? 408 : 0;
        const hashes = format === "framecrc" ? ["0xc36e040f", "0x00040004"]
          : ["505a2333bd06f65e01bb422f962f0b4d", "c244b9cdf7853b5693a295e384c07367"];
        const rows = bytes.toString().split("\n").filter(line => line && !line.startsWith("#"));
        assert.deepEqual(rows.map(row => row.split(",").map(field => field.trim())), [
          ["0", String(offset), String(offset), "512", "1024", hashes[0]],
          ["0", String(offset + 512), String(offset + 512), "1", "2", hashes[1]]
        ]);
      }
    });
  }
}
