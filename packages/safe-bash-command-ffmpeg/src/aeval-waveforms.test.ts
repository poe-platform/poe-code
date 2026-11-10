import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output for four stereo frames at 8 kHz.
for (const [expression, expected] of [
  ["sin(PI*n/2)/2", [0, 16384, 0, -16384]],
  ["sin(n)", [0, 27573, 29796, 4624]],
  ["cosh(n/4)/2", [16384, 16899, 18475, 21212]],
  ["cosh(0)/2", [16384, 16384, 16384, 16384]],
  ["cosh(-n/4)/2", [16384, 16899, 18475, 21212]],
  ["PI/32768", [3, 3, 3, 3]],
  ["n/32768", [0, 1, 2, 3]],
  ["clip(1/0,0,0.5)", [16384, 16384, 16384, 16384]],
  ["if(-1/0,0.5,0)", [16384, 16384, 16384, 16384]],
  ["2/-0", [0, 0, 0, 0]],
  ["1/0", [0, 0, 0, 0]],
  ["if(1,0.5,1/0)", [16384, 16384, 16384, 16384]],
  ["n/8", [0, 4096, 8192, 12288]],
  ["gcd(n,6)/8", [24576, 4096, 8192, 12288]],
  ["gcd(6,n)/8", [24576, 4096, 8192, 12288]],
  ["gcd(n,0)/8", [0, 4096, 8192, 12288]],
  ["gcd(n+1,5)/8", [4096, 4096, 4096, 4096]],
  ["gcd(4294967296,6)/8", [8192, 8192, 8192, 8192]],
  ["gcd()", undefined],
  ["gcd(6)", undefined],
  ["gcd(6,2,1)", undefined],
  ["min(0/0,0.5)", [16384, 16384, 16384, 16384]],
  ["min(0.5,0/0)", [0, 0, 0, 0]],
  ["max(0/0,0.5)", [16384, 16384, 16384, 16384]],
  ["max(0.5,0/0)", [0, 0, 0, 0]],
  ["min(0.25,n/8)", [0, 4096, 8192, 8192]],
  ["max(0.25,n/8)", [8192, 8192, 8192, 12288]],
  ["1\t+\t2", [32767, 32767, 32767, 32767]],
  ["1 2 / 32", [12288, 12288, 12288, 12288]],
  ["s i n(PI/2)/2", [16384, 16384, 16384, 16384]],
  ["s\ti\nn\r(\fPI\v/2)/2", [16384, 16384, 16384, 16384]],
  ["pi/32768", undefined],
  ["PIbanana/32768", undefined],
  ["sin()", undefined],
  ["sin(0,1)", undefined],
  ["cosh()", undefined],
  ["cosh(0,1)", undefined]
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
