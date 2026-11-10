import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

for (const filter of ["agate=level_in=1", "agate=threshold=0.125", "agate=level_in=1:", "agate=threshold=0.125:", "agate=1:", "agate=level_in=1::", "agate=level_in=1::ratio=2", "agate=level_in=:", "agate=:"]) {
  for (const graph of [false, true]) {
    it(`${filter} preserves PCM or rejects malformed options (${graph ? "graph" : "simple"})`, async () => {
      const fs = createMemoryFileSystem();
      const channels = [
        Float64Array.from({ length: 6400 }, (_, i) => ((i * 131) % 4001 - 2000) * [1, 6, 2, 0][Math.floor(i / 512) % 4]! / 32768),
        Float64Array.from({ length: 6400 }, (_, i) => ((i * 47) % 1801 - 900) * [2, 1, 16, 0][Math.floor(i / 512) % 4]! / 32768)
      ];
      await fs.writeFile("/in.wav", encodeWav({ sampleRate: 8000, channels }, { bitsPerSample: 16 }));
      await fs.writeFile("/out.raw", Buffer.from("KEEP"));
      let stderr = "";
      const argumentValues = createCommandArguments(["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "/out.raw"]);
      const result = await createFfmpegCommand().execute({
        command: "ffmpeg", args: argumentValues.args, argumentValues,
        cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      const output = await fs.readFile("/out.raw");
      if (filter.includes("::") || filter.endsWith("=:")) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(Buffer.from(output).toString(), "KEEP");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.length, 25600);
      // Native FFmpeg 7.0.2 reference for the complete PCM16 stereo output.
      assert.equal(createHash("sha256").update(output).digest("hex"), "080a910cf94a6c0fb40d244fbad9515d2ac1d1d14176886ba64b35076e9c06dc");
    });
  }
}
