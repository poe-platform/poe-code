import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const left = [1000, 2000, 3000, 4000];
const right = [-4000, -3000, -2000, -1000];
// Native FFmpeg 7.0.2 reference: the first four zero-seeded SFC64 draws.
for (const [expression, expected] of [
  ["val(0)*random(0)", [[230, 1920, 215, 178]]],
  ["val(0)*random(0)|val(0)*random(0)", [[230, 1920, 215, 178], [230, 1920, 215, 178]]],
  ["val(0)*random(0):c=same", [[230, 1920, 215, 178], [230, 1920, 215, 178]]],
  ["val(0)*(random(0)-random(1))", [[0, 0, 0, 0]]],
  ["val(0)*if(0\\,random(0)\\,random(0))", [[230, 1920, 215, 178]]],
  ["val(0)*ifnot(1\\,random(0)\\,random(0))", [[230, 1920, 215, 178]]],
  ["val(0)*random(-1)", [[230, 1920, 215, 178]]],
  ["val(0)*(random(9)-random(10))", [[-730, 54, -559, 1181]]],
  ["val(0)*(st(0\\,0)+random(0))", [[230, 459, 689, 919]]],
  ["val(ch):c=same", [left, right]],
  ["val(0)*0.5", [[500, 1000, 1500, 2000]]],
  ["val(0)*random()", undefined],
  ["val(0)*random(0\\,1)", undefined]
] as const) {
  for (const complex of [false, true]) {
    it(`preserves per-channel random state (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      for (let repeat = 0; repeat < 2; repeat++) {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/twins.wav", encodeWav({ sampleRate: 8000,
          channels: [left, right].map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
        let stderr = "";
        const filters = complex
          ? ["-filter_complex", `[0:a]aeval=${expression}[s]`, "-map", "[s]"]
          : ["-af", `aeval=${expression}`];
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/twins.wav", ...filters, "-c:a", "pcm_s16le", "/out.wav"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (!expected) {
          assert.notEqual(result.exitCode, 0);
          assert.equal(volume.existsSync("/out.wav"), false);
          continue;
        }
        assert.equal(result.exitCode, 0, stderr);
        const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        assert.equal(audio.channels, expected.length);
        assert.equal(audio.sampleRate, 8000);
        assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), expected);
      }
    });
  }
}
