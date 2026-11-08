import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const left = [1000, 2000, 3000, 4000];
const right = [-4000, -3000, -2000, -1000];
for (const [expression, expected] of [
  ["m=0", [[-1500, -500, 500, 1500], [-1500, -500, 500, 1500]]],
  ["m=-1", [right, left]],
  ["1", [left, right]],
  ["", [[4750, 5750, 6750, 7750], [-7750, -6750, -5750, -4750]]],
  ["m=10", [[23500, 24500, 25500, 26500], [-26500, -25500, -24500, -23500]]],
  ["m=10,volume=2,extrastereo=m=1:c=0,volume=0.5", [[23500, 24500, 25500, 26500], [-26500, -25500, -24500, -23500]]],
  ["m=10,volume=2,extrastereo=1:1,volume=0.5", [[16384, 16384, 16384, 16384], [-16384, -16384, -16384, -16384]]],
  ["m=NaN", null],
  ["m=11", null],
  ["c=invalid", null],
  ["unknown=1", null]
] as const) {
  for (const complex of [false, true]) {
    it(`changes stereo width (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const volume = Volume.fromJSON({ "/out.wav": "existing" });
      volume.writeFileSync("/twins.wav", encodeWav({ sampleRate: 8000,
        channels: [left, right].map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
      let stderr = "";
      const filters = complex
        ? ["-filter_complex", `[0:a]extrastereo${expression ? `=${expression}` : ""}[s]`, "-map", "[s]"]
        : ["-af", `extrastereo${expression ? `=${expression}` : ""}`];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/twins.wav", ...filters, "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (expected === null) {
        assert.equal(result.exitCode, 1);
        assert.ok(stderr.includes("extrastereo:"), stderr);
        assert.equal(volume.readFileSync("/out.wav", "utf8"), "existing");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.channels, expected.length);
      assert.equal(audio.sampleRate, 8000);
      assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), expected);
    });
  }
}
