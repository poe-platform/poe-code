import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 results for two frames of interleaved 2.1 PCM16.
for (const [format, remixedHash, originalHash] of [
  ["framecrc", "0x1028030c", "0x20c80456"],
  ["framehash", "5260a408b4473e1d404fd8d5392b9b1c559c234327a78f0c808f7a6bae1c9f27", undefined],
  ["framemd5", "c3d899f135ae7c96b79d18963a3c1d82", undefined]
] as const) {
  for (const mode of ["remix", "unchanged", "copy"] as const) {
    it(`${format} reports the output layout for ${mode} audio`, async () => {
      const input = Buffer.alloc(12);
      [1000, 2000, 3000, 4000, 5000, 6000].forEach((value, i) => input.writeInt16LE(value, i * 2));
      const fs = Volume.fromJSON({ "/in.raw": input });
      let stdout = "", stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "3", "-i", "/in.raw", "-bitexact",
          ...(mode === "remix" ? ["-ac", "2"] : mode === "copy" ? ["-ac", "2", "-c:a", "copy"] : []),
          "-f", format, "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0);
      assert.equal(stderr, "");
      assert.ok(stdout.includes(`#channel_layout_name 0: ${mode === "remix" ? "stereo" : "2.1"}\n`), stdout);
      const rows = stdout.split("\n").filter(line => line && !line.startsWith("#"));
      assert.equal(rows.length, 1);
      const fields = rows[0]!.split(",").map(field => field.trim());
      assert.deepEqual(fields.slice(0, 5), ["0", "0", "0", "2", mode === "remix" ? "8" : "12"]);
      if (mode === "remix" || originalHash) assert.equal(fields[5], mode === "remix" ? remixedHash : originalHash);
    });
  }
}
