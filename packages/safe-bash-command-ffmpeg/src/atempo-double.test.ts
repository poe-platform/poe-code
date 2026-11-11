import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: stereo ramp with precision beyond float32.
for (const [filter, length, hash] of [
  ["anull", 6144, "319cf22c8dc717bab499e6cc3f8696da539c92598ff44fb0f7f2679300af836d"],
  ["atempo=1.2", 5136, "27f72b1c35affa4b3a47f41049795b799635ef8673e507d19261bf36f7a867ba"],
  ["aformat=flt,atempo=1.2", 5136, "95a4371facd3db300d909fbc8a47a3ab36cca29cd0dc61c6e89d8535f6f95b5f"]
] as const) {
  for (const graph of [false, true]) {
    for (const scheduled of [false, true]) {
      it(`matches native double ramp ${filter} (graph=${graph}, scheduled=${scheduled})`, async () => {
        const input = Buffer.alloc(768 * 8);
        for (let i = 0; i < 768; i++) input.writeDoubleLE((i * 1371 % 60001 - 30000) / 30001, i * 8);
        const fs = createMemoryFileSystem();
        await fs.writeFile("/in.pcm", input);
        // A command beyond EOF exercises scheduled processing without changing tempo.
        const filters = (scheduled ? "asendcmd=c='100 atempo tempo 1.2'," : "") + filter;
        const output: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "f64le", "-ar", "1000", "-ac", "2", "-i", "/in.pcm",
            ...(graph ? ["-filter_complex", `[0:a]${filters}[out]`, "-map", "[out]"] : ["-af", filters]),
            "-f", "f64le", "pipe:1"],
          command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
          stdin: (async function* () {})(),
          stdout: { async write(bytes) { output.push(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        const bytes = Buffer.concat(output);
        assert.equal(bytes.length, length);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
      });
    }
  }
}
