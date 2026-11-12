import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// Full PCM output hashes from native FFmpeg 7.0.2 for a deterministic PCM16 ramp.
for (const [rate, length, filter, samples, hash] of [
  [8000, 512, "asetnsamples=n=7:p=0,atempo=1", 512, "8feb7c0303b002e985f4df2bd15f3148ccc30537042ea1b1f206b9f98e184f00"],
  [8000, 511, "asetnsamples=n=7:p=0,atempo=1", 511, "73a9152c304d98d1acf0612d7b70b576230c7bb3e86e80ebac2142455789c376"],
  [8000, 513, "asetnsamples=n=7:p=0,atempo=1", 513, "3e67c17d4bc994c35b7cfb50b160b96ff8cd55b4eae43c5bf22370a4aef5f164"],
  [8000, 512, "atempo=1", 512, "efd69faaaf0b2f148093becac998103ba8eb2cd26e259e631ff72e5ce9190d5a"],
  [44100, 2048, "asetnsamples=n=7:p=0,atempo=1", 2048, "cf393a4dd517a20d011a27576ce5ec1829d3117576fb48afe46c11e033af6bbb"],
  [44100, 2048, "atempo=1", 2048, "3e007738b907c7a5abc84bf5a5d6d5e58bc6178fc3a3f044cec21c378d145f9d"],
  [44100, 2048, "asetnsamples=n=7:p=0,atempo=0.75", 2420, "0b436e9c5cef103a5c9bd069b76a2f740fc17ebde7f46ea9f5a4305c3f0d7d81"],
  [44100, 2048, "atempo=0.75", 2420, "e553fc39cfb43850f27d24a4bd8f74a0dbb96147eddcd3e76be5ee6e60986a02"]
] as const) {
  for (const graph of [false, true]) {
    for (const scheduled of [false, true]) {
      it(`matches short-frame PCM: ${rate} Hz, ${length} samples, ${filter}, graph=${graph}, scheduled=${scheduled}`, async () => {
        const input = Buffer.alloc(length * 2);
        for (let i = 0; i < length; i++) input.writeInt16LE(i * 2903 % 40001 - 20000, i * 2);
        const fs = createMemoryFileSystem();
        await fs.writeFile("/in.raw", input);
        // A rejected command exercises scheduled processing without changing tempo or its origin.
        const filters = (scheduled ? "asendcmd=c='0 atempo tempo invalid'," : "") + filter;
        const output: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", String(rate), "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filters}[out]`, "-map", "[out]"] : ["-af", filters]),
            "-f", "s16le", "pipe:1"],
          command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
          stdin: (async function* () {})(),
          stdout: { async write(bytes) { output.push(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        const bytes = Buffer.concat(output);
        assert.equal(bytes.length, samples * 2);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
      });
    }
  }
}
