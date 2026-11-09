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
  ["val(0)|val(1)|0", [left, right, [0, 0, 0, 0]]],
  ["val(0)|val(1)|0,aeval=val(ch):c=same", [left, right, [0, 0, 0, 0]]],
  ["val(0)|val(1)|nb_out_channels/32768|ch/32768", [left, right, [4, 4, 4, 4], [3, 3, 3, 3]]],
  [Array(6).fill("st(0\\,ld(0)+ch+1)/32768").join("|"),
    Array.from({ length: 6 }, (_, channel) => [1, 2, 3, 4].map(n => n * (channel + 1)))],
  [Array(9).fill("val(0)").join("|"), Array(9).fill(left)],
  [Array(64).fill("val(0)").join("|"), Array(64).fill(left)],
  [Array(65).fill("val(0)").join("|"), undefined],
  ["exprs=val(1)|val(0)", [right, left]],
  ["val(0)+val(1)|val(0)-val(1)", [[-3000, -1000, 1000, 3000], [5000, 5000, 5000, 5000]]],
  ["val(1)|val(0),areverse", [[...right].reverse(), [...left].reverse()]],
  ["val(ch)|val(ch)", [left, right]],
  ["val(1)", [right]],
  ["val(1):channel_layout=mono", [right]],
  ["val(-1)|val(4)", [[0, 0, 0, 0], right]],
  ["val(1):c=stereo", [right, right]],
  ["val(ch):c=same", [left, right]],
  ["sgn(val(ch))/10:c=same", [[3277, 3277, 3277, 3277], [-3277, -3277, -3277, -3277]]],
  ["sgn(0)/10", [[0, 0, 0, 0]]],
  ["sgn(-0)/10", [[0, 0, 0, 0]]],
  ["sgn(n-1)/10", [[-3277, 0, 3277, 3277]]],
  ["sgn()", undefined],
  ["sgn(1\\,2)", undefined],
  ...["0x3", "3", "FL+FR", "2c"].map(layout => [`val(ch):c=${layout}`, [left, right]] as const),
  ...["quad", "0x33", "FL+FR+BL+BR"].map(layout => [`val(ch):c=${layout}`, [left, right, right, right]] as const),
  ["val(ch):c=5.1", [left, right, right, right, right, right]],
  ["val(ch):c=quad,aeval=val(ch):c=same", [left, right, right, right]],
  ["val(0)|val(1):c=mono", undefined],
  ["val(ch):c=FL+FL", undefined],
  ["val(ch):c=0x0", undefined],
  ["val(ch):c=0x40000", undefined],
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
      if (["val(ch):c=quad", "val(ch):c=0x33", "val(ch):c=FL+FR+BL+BR",
        "val(ch):c=quad,aeval=val(ch):c=same"].includes(expression)) {
        assert.equal(audio.channelMask, 0x33);
      }
      if (expression === "val(ch):c=5.1") assert.equal(audio.channelMask, 0x3f);
      assert.equal(audio.sampleRate, 8000);
      assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), expected);
    });
  }
}

it("infers three aeval channels from raw stereo PCM", async () => {
  const volume = Volume.fromJSON({});
  const input = Buffer.alloc(16);
  [110, -550, 220, -660, 330, -770, 440, -880].forEach((sample, index) => input.writeInt16LE(sample, index * 2));
  volume.writeFileSync("/in.raw", input);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
      "-af", "aeval=val(0)|val(1)|0", "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const output = volume.readFileSync("/out.raw") as Buffer;
  assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)),
    [110, -550, 0, 220, -660, 0, 330, -770, 0, 440, -880, 0]);
});
