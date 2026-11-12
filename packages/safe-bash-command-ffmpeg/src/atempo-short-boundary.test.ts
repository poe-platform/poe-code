import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// Complete native FFmpeg 7.0.2 PCM16 references at the 8 kHz overlap-window boundary.
for (const [length, filter, count, hash] of [
  [511, "atempo=0.75", 511, "73a9152c304d98d1acf0612d7b70b576230c7bb3e86e80ebac2142455789c376"],
  [512, "atempo=0.75", 636, "d865d57647815dcce202f8a4dd9985eabe8201a57b8c309b613bca068a7c5b04"],
  [513, "atempo=0.75", 637, "244bedc341458d10958f35e1ae79ec9b055a2f6198e6186d633c9771e655697f"],
  [512, "asetnsamples=n=7:p=0,atempo=0.75", 512, "8feb7c0303b002e985f4df2bd15f3148ccc30537042ea1b1f206b9f98e184f00"]
] as const) {
  for (const graph of [false, true]) {
    it(`matches native ${length}-sample boundary through ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const fs = createMemoryFileSystem();
      const input = Buffer.alloc(length * 2);
      for (let i = 0; i < length; i++) input.writeInt16LE(i * 2903 % 40001 - 20000, i * 2);
      await fs.writeFile("/in.raw", input);
      const output: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write(bytes) { output.push(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const pcm = Buffer.concat(output);
      assert.equal(pcm.length / 2, count);
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    });
  }
}
