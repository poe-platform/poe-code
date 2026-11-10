import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { parseFilterExpression } from "./filter-expression.js";
import { createFfmpegCommand } from "./index.js";

it("preserves negative square roots as NaN during aeval evaluation", () => {
  assert.ok(Number.isNaN(parseFilterExpression("sqrt(val(0))", "aeval", {}, () => -0.25)));
  assert.equal(parseFilterExpression("isnan(sqrt(val(0)))", "aeval", {}, () => -0.25), 1);
});

// Native FFmpeg PCM16 results for four stereo frames at 8 kHz.
for (const [expression, expected] of [
  ["sqrt(val(ch)):c=same", [5724, 0, 8095, 0, 9915, 0, 11449, 0]],
  ["val(ch):c=same", [1000, -4000, 2000, -3000, 3000, -2000, 4000, -1000]],
  ["val(0)*0.5", [500, 1000, 1500, 2000]],
  ["sqrt(0)", [0, 0, 0, 0]],
  ["sqrt(0.25)", [16384, 16384, 16384, 16384]],
  ["isnan(sqrt(val(ch)))/32768:c=same", [0, 1, 0, 1, 0, 1, 0, 1]],
  ["sqrt()", undefined],
  ["sqrt(0,1)", undefined]
] as const) {
  for (const complex of [false, true]) {
    it(`evaluates aeval square roots (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const fs = Volume.fromJSON({ "/out.wav": "keep" });
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [[1000, 2000, 3000, 4000], [-4000, -3000, -2000, -1000]]
          .map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
      const filter = `aeval='${expression}'`;
      const filters = complex
        ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"]
        : ["-af", filter];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...filters, "-c:a", "pcm_s16le", "/out.wav"],
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
        assert.equal(result.exitCode, 234, stderr);
        assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      const output = Array.from({ length: audio.channelData[0]!.length }, (_, i) =>
        audio.channelData.map(channel => channel[i]! * 32768)).flat();
      assert.deepEqual(output, expected);
    });
  }
}
