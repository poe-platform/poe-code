import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const adjusted of [false, true]) for (const quiet of [false, true]) for (const stereo of [false, true]) {
  it(`sidechaincompress uses the key signal and shortest duration (quiet=${quiet}, stereo=${stereo}, adjusted=${adjusted})`, async () => {
    const fs = Volume.fromJSON({});
    const program = Float64Array.from({ length: adjusted ? 4096 : 8192 }, (_, i) => (i % 8 < 4 ? 8192 : -8192) / 32768);
    const key = Float64Array.from({ length: adjusted ? 8192 : 4096 }, (_, i) => quiet ? 0 : (i < 2048 ? -16384 : 1024) / 32768 / (adjusted ? 2 : 1));
    fs.writeFileSync("/a.wav", encodeWav({ sampleRate: 8000, channels: stereo ? [program, program.map(x => -x / 2)] : [program] }));
    fs.writeFileSync("/b.wav", encodeWav({ sampleRate: 8000, channels: [key] }));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/a.wav", "-i", "/b.wav", "-filter_complex", `[0:a][1:a]sidechaincompress=threshold=0.05:ratio=8:attack=1:release=20${adjusted ? ":level_sc=2,volume=0.5" : ""}[mix]`, "-map", "[mix]", "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, stereo ? 2 : 1);
    const indices = [0, 4, 512, 2047, 2048, 2304, 4095];
    const expected = [1479, -1108, 1092, -1092, 1105, 8040, -8183];
    for (const [c, channel] of audio.channelData.entries()) {
      assert.equal(channel.length, 4096);
      indices.forEach((position, i) => {
        const value = (quiet ? program[position]! * 32768 : expected[i]!) * (c ? -0.5 : 1) * (adjusted ? 0.5 : 1);
        assert.ok(Math.abs(channel[position]! * 32768 - value) <= 1, `sample ${position}: ${channel[position]! * 32768}, expected ${value}`);
      });
    }
  });
}

for (const input of ["program", "detector", "both"]) {
  it(`sidechaincompress applies upstream filters to ${input} before compression`, async () => {
    const fs = Volume.fromJSON({});
    const program = Float64Array.from({ length: 2048 }, (_, i) => (i % 8 < 4 ? 8192 : -8192) / 32768);
    const key = Float64Array.from({ length: 3072 }, (_, i) => (i < 1024 ? 16384 : 1024) / 32768);
    const filterProgram = input !== "detector";
    const filterDetector = input !== "program";
    for (const [name, samples, filtered] of [["a", program, filterProgram], ["b", key, filterDetector]] as const) {
      fs.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000, channels: [samples] }));
      fs.writeFileSync(`/${name}-filtered.wav`, encodeWav({ sampleRate: 8000,
        channels: [filtered ? samples.slice(0, 1536).map(x => x * 0.5) : samples] }));
    }
    const upstream = [
      filterProgram ? "[0:a]volume=0.5,atrim=end_sample=1536[program];" : "",
      filterDetector ? "[1:a]volume=0.5,atrim=end_sample=1536[detector];" : ""
    ].join("");
    const compressor = "sidechaincompress,volume=0.5[out]";
    for (const reference of [true, false]) {
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-i", reference ? "/a-filtered.wav" : "/a.wav", "-i", reference ? "/b-filtered.wav" : "/b.wav",
          "-filter_complex", reference ? `[0:a][1:a]${compressor}`
            : `${upstream}[${filterProgram ? "program" : "0:a"}][${filterDetector ? "detector" : "1:a"}]${compressor}`,
          "-map", "[out]", "-c:a", "pcm_s16le", reference ? "/expected.wav" : "/actual.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    }
    const actual = parseWav(fs.readFileSync("/actual.wav") as Buffer).tracks[0]!.decodedAudio!;
    const expected = parseWav(fs.readFileSync("/expected.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(actual.channelData[0]!.length, 1536);
    assert.deepEqual(actual, expected);
  });
}
