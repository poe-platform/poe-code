import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 700 mono PCM16 samples at 8 kHz, slowed to 0.75.
for (const graph of [false, true]) {
  for (const [argument, valid] of [
    ["0.75", true], ["0.75:", true], ["tempo=0.75:", true], ["1:tempo=0.75:", true],
    ["0.75::", false], ["0.75::tempo=0.75", false]
  ] as const) {
    it(`matches native PCM for atempo=${argument} (${graph ? "graph" : "simple"})`, async () => {
      const fs = createMemoryFileSystem();
      const input = Buffer.alloc(700 * 2);
      for (let i = 0; i < 700; i++) input.writeInt16LE(i * 701 % 30001 - 15000, i * 2);
      await fs.writeFile("/in.raw", input);
      const filter = `atempo=${argument}`;
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(bytes) { chunks.push(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      const output = Buffer.concat(chunks);
      if (!valid) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(output.length, 0);
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.length, 872 * 2);
      assert.equal(createHash("sha256").update(output).digest("hex"),
        "0e760ca6b3779100aabc9d6da9d88aa18ac0a7c358c503cd54896579e32d9528");
    });
  }
}
