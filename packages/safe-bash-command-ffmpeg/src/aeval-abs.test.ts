import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// The reported native FFmpeg repro uses four PCM16 stereo frames.
for (const [expression, expected] of [
  ["abs(val(1))", [550, 660, 770, 880]],
  ["abs(-0.5)", [16384, 16384, 16384, 16384]],
  ["abs(val(0))", [110, 220, 330, 440]],
  ["abs(0)", [0, 0, 0, 0]],
  ["abs(val(0)+0.5*val(1))", [165, 110, 55, 0]],
  ["val(0)+0.5*val(1)", [-165, -110, -55, 0]],
  ["abs(val(ch)):c=same", [110, 550, 220, 660, 330, 770, 440, 880]],
  ["abs()", undefined],
  ["abs(0,1)", undefined]
] as const) {
  for (const complex of [false, true]) {
    it(`evaluates aeval absolute values (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const fs = Volume.fromJSON({ "/out.raw": "keep" });
      const input = Buffer.alloc(16);
      [110, -550, 220, -660, 330, -770, 440, -880].forEach((sample, i) => input.writeInt16LE(sample, i * 2));
      fs.writeFileSync("/in.raw", input);
      const filter = `aeval='${expression}'`;
      const filters = complex
        ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"]
        : ["-af", filter];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw", ...filters, "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
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
