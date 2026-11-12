import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: 700 mono PCM16LE samples at 8 kHz, i * 701 % 30001 - 15000.
for (const [expression, samples, hash] of [
  ["min", 1213, "bc9b3d6bef6bcf6ea2c9ac75e6d28d87aa9721598b7504b8c22d92dd8f6413f2"],
  ["max", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["default", 700, "e208502386bc6c7aa6ec54379c1cc39ba0c50b3ecef842ded8c1f3fc1ebf8471"],
  ["min*2", 700, "e208502386bc6c7aa6ec54379c1cc39ba0c50b3ecef842ded8c1f3fc1ebf8471"],
  ["max/100", 700, "e208502386bc6c7aa6ec54379c1cc39ba0c50b3ecef842ded8c1f3fc1ebf8471"],
  ["default/2", 1213, "bc9b3d6bef6bcf6ea2c9ac75e6d28d87aa9721598b7504b8c22d92dd8f6413f2"]
] as const) {
  for (const filter of [`atempo=${expression}`, `atempo=tempo=${expression}`,
    `asendcmd=c='0 atempo@x tempo ${expression}',atempo@x=2`]) {
    for (const graph of [false, true]) {
      it(`${filter} matches native status and PCM (${graph ? "graph" : "simple"})`, async () => {
        const fs = createMemoryFileSystem();
        const input = Buffer.alloc(700 * 2);
        for (let i = 0; i < 700; i++) input.writeInt16LE(i * 701 % 30001 - 15000, i * 2);
        await fs.writeFile("/in.raw", input);
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
            "-f", "s16le", "/out.raw"],
          command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        assert.equal(result.exitCode, 0, stderr);
        const output = await fs.readFile("/out.raw");
        // Changing tempo at time zero retains the initial output-frame buffering.
        const scheduledSlowdown = filter.startsWith("asendcmd=") && samples === 1213;
        assert.equal(output.length / 2, scheduledSlowdown ? 957 : samples);
        assert.equal(createHash("sha256").update(output).digest("hex"), scheduledSlowdown
          ? "09fe3115711a37bfcff02428f57bf4c7c960f3b79887b8aa393cee9ca78d4160" : hash);
      });
    }
  }
}
