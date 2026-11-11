import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const left = [1000, 2000, 3000, 4000];
const right = [-4000, -3000, -2000, -1000];
for (const [expression, expected] of [
  ["mono|c0=c1", [right]],
  ["stereo|c0=c1|c1=c0", [right, left]],
  ["stereo|FL=FR|FR=FL", [right, left]],
  ["stereo|FL=FL|FR=FR", [left, right]],
  ["stereo|FL=c0|c1=c1", [left, right]],
  ["stereo|c0=FL|FR=FR", [left, right]],
  ["stereo|FL=FL|FR=FR,pan=stereo|c0=c0|c1=c1", [left, right]],
  ["mono|c0=FL+c1", null],
  ["mono|c0=c0+FR", null],
  ["mono|c0<FL+c1", null],
  ["mono|c0=FL+0*c1", null],
  ["stereo|FL=FL|FR=c1", null],
  ["stereo|c0=c0|c1=FR", null],
  ["stereo|FL=c1|FR=c1", [right, right]],
  ["mono|c0=0*c0+c1", [right]],
  ["mono|c0<2*c0+c1", [[-667, 333, 1333, 2333]]],
  ["mono|c0=0.5*c0+0.5*c1", [[-1500, -500, 500, 1500]]],
  ["stereo|c1=c0", [[0, 0, 0, 0], left]],
  ["mono|c0=c2", [[0, 0, 0, 0]]],
  ["mono|c0=NaN*c0", [[0, 0, 0, 0]]],
  ["mono|c0=c0|c0=c1", null],
  ["mono|c0=c0+c0", null],
  ["mono|c0=0*c0+c0", null],
  ["mono|c0=c0+0*c0", null],
  ["mono|c0<0*c0+c0", null],
  ["mono|FC=FL+FL", null],
  ["stereo|FL=c0|FR=c1+c1", null],
  ["mono|c0=", null],
  ["unknown|c0=c0", null],
  ["quad|FC=c0", null],
  ["5.1|c6=c0", null],
  ["0x0|FL=c0", null],
  ["FL+FL|FL=c0", null],
  ["2 channels (FC)|c0=c1", null],
  ["0 channels (FC)|c0=c1", null],
  ["2 channels (FL+FL)|c0=c1", null],
  ["2 channels (FL+XX)|c0=c1", null],
  ["2 channels (stereo)|c0=c1", null],
  ["2 channels (FL+FR)junk|c0=c1", null]
] as const) {
  for (const complex of [false, true]) {
    it(`pans PCM channels (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const volume = Volume.fromJSON({ "/out.wav": "keep" });
      volume.writeFileSync("/twins.wav", encodeWav({ sampleRate: 8000,
        channels: [left, right].map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
      let stderr = "";
      const filters = complex
        ? ["-filter_complex", `[0:a]pan=${expression}[s]`, "-map", "[s]"]
        : ["-af", `pan=${expression}`];
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
        assert.equal(result.exitCode, 234, stderr);
        assert.ok(stderr.includes("pan:"), stderr);
        assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
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
