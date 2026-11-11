import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const left = [1000, 2000, 3000, 4000];
const right = [-4000, -3000, -2000, -1000];
for (const [expression, expected] of [
  ["", [left, right]],
  ["mode=", undefined],
  ["mutel=1", [[0, 0, 0, 0], right]],
  ["muter=true", [left, [0, 0, 0, 0]]],
  ["phasel=yes", [left.map(x => -x), right]],
  ["phaser=1", [left, right.map(x => -x)]],
  ["mutel=0:muter=false:phasel=no:phaser=off", [left, right]],
  ...["true", "True", "TRUE", "YeS", "ON", "Y", "Enable", "ENABLED", "+01"].flatMap(value => [
    [`mutel=${value}`, [[0, 0, 0, 0], right]] as const,
    [`muter=${value}`, [left, [0, 0, 0, 0]]] as const,
    [`phasel=${value}`, [left.map(x => -x), right]] as const,
    [`phaser=${value}`, [left, right.map(x => -x)]] as const
  ]),
  ...["false", "False", "FALSE", "No", "OFF", "N", "Disable", "DISABLED", "-0", ""].map(value => [
    `mutel=${value}:muter=${value}:phasel=${value}:phaser=${value}`, [left, right]
  ] as const),
  ...["mutel", "muter", "phasel", "phaser"].flatMap(key =>
    ["2", "-1", "auto", "1.0", "0x1", "1e0", "+", "Trueish", "Nope"].map(value => [`${key}=${value}`, undefined] as const)),
  ["mode=lr>lr", [left, right]],
  ["mode=lr>ms", [[-1500, -500, 500, 1500], [2500, 2500, 2500, 2500]]],
  ["mode=ms>lr", [[-3000, -1000, 1000, 3000], [5000, 5000, 5000, 5000]]],
  ["mode=lr>ll", [left, left]],
  ["mode=lr>rr", [right, right]],
  ["mode=lr>l+r", [[-1500, -500, 500, 1500], [-1500, -500, 500, 1500]]],
  ["mode=lr>rl", [right, left]],
  ["mode=ms>ll", [[-3000, -1000, 1000, 3000], [-3000, -1000, 1000, 3000]]],
  ["mode=ms>rr", [[5000, 5000, 5000, 5000], [5000, 5000, 5000, 5000]]],
  ["mode=ms>rl", [[5000, 5000, 5000, 5000], [-3000, -1000, 1000, 3000]]],
  ["mode=lr>l-r", [[2500, 2500, 2500, 2500], [2500, 2500, 2500, 2500]]],
  ["mode=1:mutel=1:phaser=on", [[0, 0, 0, 0], [-2500, -2500, -2500, -2500]]],
  ["mode=lr>ms,stereotools=mode=ms>lr", [left, right]],
  ["mutel=2", undefined],
  ["phaser=maybe", undefined],
  ["mode=11", undefined],
  ...["1+1", "1.5", "2.5"].map(value => [
    `mode=${value}`, [[-3000, -1000, 1000, 3000], [5000, 5000, 5000, 5000]]
  ] as const),
  ...["0.5", "default", "min"].map(value => [`mode=${value}`, [left, right]] as const),
  ["mode=max", [[2500, 2500, 2500, 2500], [2500, 2500, 2500, 2500]]],
  ...["-0.1", "10.1", "1/0", "NaN"].map(value => [`mode=${value}`, undefined] as const),
  ["mode=unknown", undefined],
  ["mode=LR>LR", undefined],
  ["MUTEL=True", undefined],
  ["delay=1", [left, [0, 0, 0, 0]]]
] as const) {
  for (const complex of [false, true]) {
    it(`applies stereotools (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/twins.wav", encodeWav({ sampleRate: 8000,
        channels: [left, right].map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
      let stderr = "";
      const filters = complex
        ? ["-filter_complex", `[0:a]stereotools=${expression}[s]`, "-map", "[s]"]
        : ["-af", `stereotools=${expression}`];
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
