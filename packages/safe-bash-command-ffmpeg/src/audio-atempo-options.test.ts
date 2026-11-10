import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, mono PCM16LE at 8 kHz, repeating 32-sample ramp.
const cases: [string, number | null][] = [
  ["atempo=tempo=1:tempo=2", 2048],
  ["atempo=tempo=2:tempo=1", 4096],
  ["atempo=1:tempo=1", 4096],
  ["atempo=1:tempo=2", 2048],
  ["atempo=tempo = 1", 4096],
  ["atempo=  tempo = 2 : tempo = 1  ", 4096],
  ["atempo=", 4096],
  ["atempo=  ", 4096],
  ["atempo", 4096],
  ["atempo=tempo=1", 4096],
  ["atempo=1", 4096],
  ["atempo=2", 2048],
  ["atempo=tempo=", null],
  ["atempo=1:tempo=", null],
  ["atempo=tempo=:tempo=1", null],
  ["atempo=tempo=0.25:tempo=1", null],
  ["atempo=tempo=invalid:tempo=1", null],
  ["atempo=1:2", null],
  ["atempo=tempo=1:2", null],
  ["atempo=tempo=1:wrong=2", null]
];

for (const [filter, samples] of cases) {
  for (const graph of [false, true]) {
    it(`${filter} matches native atempo options (${graph ? "graph" : "simple"})`, async () => {
      const fs = createMemoryFileSystem();
      const input = Buffer.alloc(4096 * 2);
      for (let i = 0; i < 4096; i++) input.writeInt16LE(((i % 32) - 16) * 800, i * 2);
      await fs.writeFile("/in.raw", input);
      await fs.writeFile("/out.raw", Buffer.from("KEEP"));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      const output = Buffer.from(await fs.readFile("/out.raw"));
      assert.deepEqual(Buffer.from(await fs.readFile("/in.raw")), input);
      if (samples === null) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(output.toString(), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(output.length / 2, samples);
        assert.equal(createHash("sha256").update(output).digest("hex"), samples === 2048
          ? "f61092627006577921c7b7bf99182b6fde465a25eff9b50a490348c9e217c6dc"
          : "35968d68139814ab46248bd1e468da81e82d2e977a1c9f6cbfcc0078e45c6c6e");
      }
    });
  }
}
