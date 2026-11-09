import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const left = [1000, 2000, 3000, 4000];
const right = [-4000, -3000, -2000, -1000];
for (const [expression, expected] of [
  ["val(1)|val(0)", [right, left]],
  ["val(0)||val(1)", [left, right]],
  ["|val(1)", [right]],
  ["val(0)|", [left]],
  ["val(0)||", [left]],
  ["||val(1)|||val(0)||", [right, left]],
  ["exprs=|val(1)||val(0)|", [right, left]],
  ["|val(ch)||:c=same", [left, right]],
  ["|val(1)||:c=stereo", [right, right]],
  ["|val(0)||:channel_layout=mono", [left]],
  ["|nb_out_channels/32768||", [[1, 1, 1, 1]]],
  ["exprs=val(1)|val(0)", [right, left]],
  ["val(0)+val(1)|val(0)-val(1)", [[-3000, -1000, 1000, 3000], [5000, 5000, 5000, 5000]]],
  ["val(1)|val(0),areverse", [[...right].reverse(), [...left].reverse()]],
  ["val(ch)|val(ch)", [left, right]],
  ["val(1)", [right]],
  ["val(1):channel_layout=mono", [right]],
  ["val(-1)|val(4)", [left, right]],
  ["val(1):c=stereo", [right, right]],
  ["val(ch):c=same", [left, right]],
  ["tanh(val(ch)):c=same", [[1000, 1998, 2992, 3980], [-3980, -2992, -1998, -1000]]],
  ["val(0)*0|val(1)", [[0, 0, 0, 0], right]],
  ["n/32768|t*s/32768", [[0, 1, 2, 3], [0, 1, 2, 3]]],
  ["st(0\\,ld(0)+1)/32768", [[1, 2, 3, 4]]],
  ["st(0\\,ld(0)+1)/32768|st(0\\,ld(0)+2)/32768", [[1, 2, 3, 4], [2, 4, 6, 8]]],
  ["st(0\\,ld(0)+1)/32768:c=same", [[1, 2, 3, 4], [1, 2, 3, 4]]],
  ["st(0\\,ld(0)+1)/32768,aeval=ld(0)", [[0, 0, 0, 0]]],
  ["val(0):c=unknown", undefined],
  ["val(0):unsupported=1", undefined],
  ["val(0)|missing(1)", undefined],
  ["", undefined],
  ["||", undefined],
  ["||:c=same", undefined],
  ["||:c=mono", undefined],
  ["||:c=stereo", undefined],
  ["val(0)| |val(1)", undefined]
] as const) {
  for (const complex of [false, true]) {
    it(`evaluates PCM channel expressions (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/twins.wav", encodeWav({ sampleRate: 8000,
        channels: [left, right].map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
      let stderr = "";
      const filters = complex
        ? ["-filter_complex", `[0:a]aeval=${expression}[s]`, "-map", "[s]"]
        : ["-af", `aeval=${expression}`];
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
      if (!expected) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.existsSync("/out.wav"), false);
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
