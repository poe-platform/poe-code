import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// 79 alternating +/-1000 PCM16 samples at 8 kHz fit in one dynaudnorm frame.
// Native FFmpeg 7.0.2 reports 207F6BC2 for dblp and 77CC4EC4 for s16.
// Stereo Adler-32 references use contiguous little-endian doubles per plane.
for (const graph of [false, true]) {
  for (const [filter, format, scales, checksum, planes] of [
    ["ashowinfo", "s16", [1], "77CC4EC4", "77CC4EC4"],
    ["dynaudnorm=f=10:g=3,ashowinfo", "dblp", [1], "207F6BC2", "207F6BC2"],
    ["dynaudnorm=f=10:g=3,ashowinfo", "dblp", [1, -0.5], "E54AD314", "207F6BC2 AE456752"],
    ["dynaudnorm=f=10:g=3,anull,ashowinfo", "dblp", [1], "207F6BC2", "207F6BC2"],
    ["dynaudnorm=f=10:g=3,aformat=f=s16,ashowinfo", "s16", [1], "77CC4EC4", "77CC4EC4"]
  ] as const) it(`${filter} (${scales.length} channels) reports the intermediate format (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({});
    const samples = Float64Array.from({ length: 79 }, (_, i) => (i % 2 ? -1000 : 1000) / 32768);
    const wav = encodeWav({ sampleRate: 8000, channels: scales.map(scale => samples.map(value => value * scale)) });
    fs.writeFileSync("/in.wav", wav);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "info", "-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    const stderr = Buffer.concat(errors).toString();
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr.trim(), (scales.length === 1 ? "ffmpeg: Guessed Channel Layout: mono\n" : "") + `[ashowinfo] n:0 pts:0 pts_time:0 fmt:${format} channels:${scales.length} chlayout:${scales.length === 1 ? "mono" : "stereo"} rate:8000 nb_samples:79 checksum:${checksum} plane_checksums: [ ${planes} ]`);
    assert.deepEqual(fs.readFileSync("/out.pcm"), Buffer.from(wav.subarray(wav.length - 158 * scales.length)));
  });
}
