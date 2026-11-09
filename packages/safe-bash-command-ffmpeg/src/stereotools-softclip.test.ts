import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const silence = Array.from({ length: 10 }, () => [0, 0]);
const input = [[10000, 0], [0, -6000], [8000, 8000], [8000, -8000],
  [30000, -29000], [-12000, 1200], ...silence];
// Signed PCM16 sample pairs from FFmpeg 7.0.2, including quiet and loud peaks.
const cases = [
  ["phasel=1", [[-10000, 0], [0, -6000], [-8000, 8000], [-8000, -8000], [-30000, -29000], [12000, 1200], ...silence]],
  ["mode=lr>rl", [[0, 10000], [-6000, 0], [8000, 8000], [-8000, 8000], [-29000, 30000], [1200, -12000], ...silence]],
  ["softclip=1", [[12358, 0], [0, -7556], [9990, 9990], [9990, -9990], [30929, -30226], [-14646, 1527], ...silence]],
  ["softclip=1:sclevel=2", [[16219, 0], [0, -10390], [13444, 13444], [13444, -13444], [31696, -31270], [-18710, 2164], ...silence]],
  ["softclip=1:sclevel=10", [[27935, 0], [0, -23854], [26329, 26329], [26329, -26329], [32565, -32482], [-29050, 7819], ...silence]],
  ["softclip=0:sclevel=10", [[10000, 0], [0, -6000], [8000, 8000], [8000, -8000], [30000, -29000], [-12000, 1200], ...silence]],
  // Boundary and ordering expectations from the native arctangent definition.
  ["softclip=TrUe:sclevel=100", [[32290, 0], [0, -31833], [32118, 32118], [32118, -32118],
    [32749, -32741], [-32405, 27382], ...silence]],
  ["softclip=1:sclevel=3/2", [[14313, 0], [0, -8937], [11704, 11704], [11704, -11704],
    [31388, -30848], [-16748, 1830], ...silence]],
  ["level_in=2:softclip=1:sclevel=2:mode=lr>ms:level_out=0.5",
    [[6544, 6544], [-4677, 4677], [11447, 0], [0, 11447], [65, 19236], [-6114, -8267], ...silence]],
  ["sclevel=101", undefined],
  ["sclevel=10", input],
  ["softclip=OFF:sclevel=100", input],
  ...["0", "0.999", "100.001", "NaN", "inf", "bad", ""].map(value =>
    [`sclevel=${value}`, undefined] as const),
  ...["2", "-1", "auto", "1.0"].map(value => [`softclip=${value}`, undefined] as const)
] as const;

for (const [expression, expected] of cases) {
  for (const complex of [false, true]) {
    it(`stereotools soft clipping (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/impulses.wav", encodeWav({ sampleRate: 8000,
        channels: [0, 1].map(channel => Float64Array.from(input, pair => pair[channel]! / 32768)) }));
      let stderr = "";
      const filters = complex
        ? ["-filter_complex", `[0:a]stereotools=${expression}[s]`, "-map", "[s]"]
        : ["-af", `stereotools=${expression}`];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/impulses.wav", ...filters, "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      const output = volume.readFileSync("/out.raw") as Buffer;
      if (!expected) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(output.toString(), "KEEP");
        assert.ok(stderr.includes("stereotools:"), stderr);
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.length, expected.length * 4);
      assert.deepEqual(Array.from({ length: expected.length }, (_, i) =>
        [output.readInt16LE(i * 4), output.readInt16LE(i * 4 + 2)]), expected);
    });
  }
}
