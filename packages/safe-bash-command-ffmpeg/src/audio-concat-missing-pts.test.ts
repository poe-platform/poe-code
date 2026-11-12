import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const first = [1, 2, 3, 4, 5, 6, 7, 8];
const second = [101, 102, 103, 104];

// Native FFmpeg 7.0.2 adds concat's microsecond offset to AV_NOPTS_VALUE.
for (const separated of [false, true]) {
  for (const [firstFilter, secondFilter, selector, expected, timestamps] of [
    ["anull", "asetpts=NAN", "anull", [...first, ...second], ["0", "-9223372036854767808"]],
    ["anull", "asetpts=NAN", "aselect=isnan(pts)", [], []],
    ["anull", "asetpts=NAN", "aselect=not(isnan(pts))", [...first, ...second], ["0", "-9223372036854767808"]],
    ["anull", "anull", "aselect=not(isnan(pts))", [...first, ...second], ["0", "8000"]],
    ["atrim=end_sample=0", "asetpts=NAN", "aselect=isnan(pts)", second, ["NOPTS"]]
  ] as const) {
    it(`concat missing PTS: ${firstFilter}, ${secondFilter}, ${selector} (separate node=${separated})`, async () => {
      const volume = Volume.fromJSON(Object.fromEntries([first, second].map((samples, i) =>
        [`/${i}.wav`, Buffer.from(encodeWav({ sampleRate: 1000,
          channels: [Float64Array.from(samples, sample => sample / 32768)] }))])));
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-nostats", "-v", "info", "-i", "/0.wav", "-i", "/1.wav", "-filter_complex",
          `[0:a]${firstFilter}[a];[1:a]${secondFilter}[b];[a][b]concat=n=2:v=0:a=1${separated ? "[joined];[joined]" : ","}${selector},ashowinfo[out]`,
          "-map", "[out]", "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = Buffer.concat(output);
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)), expected);
      const frames = stderr.split("\n").filter(line => line.startsWith("[ashowinfo]"));
      assert.deepEqual(frames.map(line => line.split(" pts:")[1]!.split(" ")[0]), timestamps);
      assert.deepEqual(frames.map(line => Number(line.split(" nb_samples:")[1]!.split(" ")[0])),
        expected.length === 0 ? [] : expected.length === 4 ? [4] : [8, 4]);
    });
  }
}
