import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 reference: compensationdelay requires planar double,
// so echo must retain fractional samples until the final PCM conversion.
for (const [prefix, suffix, firstSample] of [
  ["", "", 560],
  ["", ",compensationdelay", 561],
  ["aformat=dblp,", ",compensationdelay", 561],
  ["", ",anull,acopy,compensationdelay@delay=enable=0", 561],
  ["", ",aformat=sample_rates=8000,compensationdelay", 561],
  ["", ",aformat=s16p|dblp,compensationdelay", 561],
  ["", ",aformat=s16p,compensationdelay", 560],
  ["", ",aformat=s16,compensationdelay", 560]
] as const) {
  for (const graph of [false, true]) {
    const filter = `${prefix}aecho=0.7:0.8:0.25:0.3${suffix}`;
    it(`${filter} negotiates native echo precision (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from([1001, 0, 0, 0, 0, 0, 0, 0], sample => sample / 32768)
      ] }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.pcm"],
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
      const pcm = volume.readFileSync("/out.pcm") as Buffer;
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)),
        [firstSample, 0, 240, 0, 0, 0, 0, 0, 0, 0]);
    });
  }
}
