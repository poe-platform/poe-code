import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output for four stereo frames at 8 kHz.
for (const [expression, expected] of [
  ["sin(PI*n/2)/2", [0, 16384, 0, -16384]],
  ["sin(n)", [0, 27573, 29796, 4624]],
  ["PI/32768", [3, 3, 3, 3]],
  ["n/32768", [0, 1, 2, 3]],
  ["pi/32768", undefined],
  ["PIbanana/32768", undefined],
  ["sin()", undefined],
  ["sin(0,1)", undefined]
] as const) {
  for (const complex of [false, true]) {
    it(`evaluates aeval waveforms (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const fs = Volume.fromJSON({ "/out.raw": "keep" });
      const input = Buffer.alloc(16);
      [110, -550, 220, -660, 330, -770, 440, -880].forEach((sample, i) => input.writeInt16LE(sample, i * 2));
      fs.writeFileSync("/grid.raw", input);
      let stderr = "";
      const filter = `aeval=${expression.split(",").join("\\,")}`;
      const filters = complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/grid.raw", ...filters, "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (!expected) {
        assert.equal(result.exitCode, 1);
        assert.equal(fs.readFileSync("/out.raw", "utf8"), "keep");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const output = fs.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, expected.length * 2);
      assert.deepEqual(expected.map((_, i) => output.readInt16LE(i * 2)), expected);
    });
  }
}
