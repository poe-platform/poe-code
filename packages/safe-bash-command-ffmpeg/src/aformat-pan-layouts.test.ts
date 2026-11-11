import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output for explicit pan speaker layouts.
const cases = [
  { pan: "3.0|FL=FR|FR=FL|FC=FR", expected: [-201, 503, -1001, 1343, 32767, -5622, 9000, 4900] },
  { pan: "quad|FL=FR|BR=FL", expected: [-118, 415, -586, 1243, 19194, -13573, 5272, 828] },
  { pan: "7.1|SR=FL|FL=FR", expected: [-64, 227, -321, 680, 10498, -7423, 2883, 453] },
  { pan: "2.1|FL=FR|FR=FL|LFE=FL", expected: [-201, 1001, -1001, 3001, 32767, -32768, 9000, 2000] }
];

for (const { pan, expected } of cases) {
  for (const graph of [false, true]) {
    for (const autoConvert of [true, false]) {
      it(`downmixes pan=${pan} to stereo (graph=${graph}, autoConvert=${autoConvert})`, async () => {
        const samples = [1001, -201, 3001, -1001, -32768, 32767, 2000, 9000];
        const input = Buffer.alloc(samples.length * 2);
        samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
        const volume = new Volume();
        const output: Buffer[] = [];
        let stderr = "";
        const filter = `pan=${pan},aformat=${graph ? "cl" : "channel_layouts"}=stereo`;
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-loglevel", "error", ...(!autoConvert ? ["-noauto_conversion_filters"] : []),
            "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "pipe:0",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () { yield input; })(),
          stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        const pcm = Buffer.concat(output);
        if (!autoConvert) {
          assert.notEqual(result.exitCode, 0);
          assert.match(stderr, /automatic conversion is disabled/);
          assert.equal(pcm.length, 0);
          return;
        }
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(pcm.length, expected.length * 2);
        assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, index) => pcm.readInt16LE(index * 2)), expected);
      });
    }
  }
}
