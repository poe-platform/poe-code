import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const first = Array.from({ length: 16 }, (_, i) => 100 + i);
const second = Array.from({ length: 16 }, (_, i) => 200 + i);
const samples = [...first, ...second];

for (const complex of [false, true]) {
  for (const { name, enabled = "1", chain, expected, outputArgs = [] } of [
    { name: "inside both segments", chain: "aselect=lt(concatdec_select\\,0)", expected: samples },
    { name: "known segment metadata", chain: "aselect=isnan(concatdec_select)", expected: [] },
    { name: "metadata control", chain: "ametadata=mode=select:key=lavf.concatdec.start_time:value=4000", expected: second },
    { name: "metadata disabled", enabled: "0", chain: "aselect=lt(concatdec_select\\,0)", expected: [] },
    { name: "missing metadata", enabled: "0", chain: "aselect=isnan(concatdec_select)", expected: samples },
    { name: "before start", chain: "asetpts=PTS-1,aselect=eq(concatdec_select\\,0)", expected: samples },
    { name: "exclusive end", chain: "asetpts=PTS+16,aselect=lt(concatdec_select\\,0)", expected: first },
    { name: "past end", chain: "asetpts=PTS+33,aselect=eq(concatdec_select\\,0)", expected: samples },
    { name: "changed time base", chain: "asettb=1/1000000,asetpts=PTS+2000,aselect=lt(concatdec_select\\,0)", expected: first },
    { name: "removed start", chain: "ametadata=delete:key=lavf.concatdec.start_time,aselect=isnan(concatdec_select)", expected: samples },
    { name: "unknown duration", chain: "ametadata=delete:key=lavf.concatdec.duration,asetpts=PTS+100,aselect=lt(concatdec_select\\,0)", expected: samples },
    { name: "missing timestamps", chain: "asetpts=NAN,aselect=eq(concatdec_select\\,0)", expected: samples },
    { name: "reframed metadata", chain: "asetnsamples=n=8:p=0,aselect=lt(concatdec_select\\,0)", expected: samples },
    { name: "selected metadata", chain: "aselect=eq(n\\,1),aselect=lt(concatdec_select\\,0)", expected: second },
    { name: "detector demand", chain: "astats,aselect=lt(concatdec_select\\,0)", expected: first, outputArgs: ["-frames:a", "1"] },
    { name: "padding demand", chain: "apad,aselect=lt(concatdec_select\\,0)", expected: first, outputArgs: ["-frames:a", "1"] },
    { name: "loop demand", chain: "aloop=loop=-1:size=16,aselect=lt(concatdec_select\\,0)", expected: first, outputArgs: ["-frames:a", "1"] },
    { name: "loop reframe demand", chain: "aloop=loop=-1:size=16,asetnsamples=n=8:p=0,aselect=lt(concatdec_select\\,0)", expected: first, outputArgs: ["-frames:a", "2"] },
    { name: "loop trim demand", chain: "aloop=loop=-1:size=16,atrim=end_sample=8,aselect=lt(concatdec_select\\,0)", expected: first.slice(0, 8), outputArgs: ["-frames:a", "1"] },
    { name: "loop partial reframe demand", chain: "aloop=loop=-1:size=16,atrim=end_sample=8,asetnsamples=n=16:p=0,aselect=lt(concatdec_select\\,0)", expected: first.slice(0, 8), outputArgs: ["-frames:a", "1"] },
    { name: "padding with duration demand", chain: "apad,aselect=lt(concatdec_select\\,0)", expected: first, outputArgs: ["-t", "0.002", "-frames:a", "1"] }
  ]) {
    it(`aselect concat metadata: ${name} (${complex ? "complex" : "simple"})`, async () => {
      const volume = Volume.fromJSON({
        "/list.ffconcat": "ffconcat version 1.0\nfile a.wav\nduration 0.004\nfile b.wav\nduration 0.002\n",
        "/a.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels: [Float64Array.from(first, value => value / 32768)] })),
        "/b.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels: [Float64Array.from(second, value => value / 32768)] }))
      });
      const before = volume.toJSON();
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "concat", "-segment_time_metadata", enabled, "-i", "/list.ffconcat", "-bitexact",
          ...(complex ? ["-filter_complex", `[0:a]${chain}[o]`, "-map", "[o]"] : ["-af", chain]),
          ...outputArgs, "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const bytes = Buffer.concat(output);
      assert.deepEqual(Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2)), expected);
      assert.deepEqual(volume.toJSON(), before);
    });
  }
}
