import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const adjusted of [false, true]) for (const quiet of [false, true]) for (const stereo of [false, true]) {
  it(`sidechaingate uses the key signal and shortest duration (quiet=${quiet}, stereo=${stereo}, adjusted=${adjusted})`, async () => {
    const fs = Volume.fromJSON({});
    const program = Float64Array.from({ length: adjusted ? 4096 : 8192 }, (_, i) => (i % 8 < 4 ? 8192 : -8192) / 32768);
    const key = Float64Array.from({ length: adjusted ? 8192 : 4096 }, (_, i) => quiet ? 0 : (i < 2048 ? -16384 : 1024) / 32768 / (adjusted ? 2 : 1));
    fs.writeFileSync("/a.wav", encodeWav({ sampleRate: 8000, channels: stereo ? [program, program.map(x => -x / 2)] : [program] }));
    fs.writeFileSync("/b.wav", encodeWav({ sampleRate: 8000, channels: [key] }));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/a.wav", "-i", "/b.wav", "-filter_complex", `[0:a][1:a]sidechaingate=threshold=0.1:ratio=8:attack=1:release=20${adjusted ? ":level_sc=2,volume=0.5" : ""}[mix]`, "-map", "[mix]", "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, stereo ? 2 : 1);
    const indices = [0, 4, 512, 2047, 2048, 2304, 4095];
    const expected = [8192, -8192, 8192, -8192, 8192, 502, -502];
    for (const [c, channel] of audio.channelData.entries()) {
      assert.equal(channel.length, 4096);
      indices.forEach((position, i) => {
        const value = (quiet ? program[position]! * 32768 : expected[i]!) * (c ? -0.5 : 1) * (adjusted ? 0.5 : 1);
        assert.ok(Math.abs(channel[position]! * 32768 - value) <= 1, `sample ${position}: ${channel[position]! * 32768}, expected ${value}`);
      });
    }
  });
}

for (const link of ["average", "maximum"]) {
  it(`sidechaingate links stereo key channels using ${link}`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/a.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array(128).fill(0.25)] }));
    fs.writeFileSync("/b.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array(128).fill(0.5), new Float64Array(128)] }));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/a.wav", "-i", "/b.wav", "-filter_complex", `[0:a][1:a]sidechaingate=threshold=0.375:ratio=8:knee=1:attack=0.01:release=0.01:detection=peak:range=0.25:link=${link}[mix]`, "-map", "[mix]", "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 1);
    assert.deepEqual(Array.from(audio.channelData[0]!, value => value * 32768), Array(128).fill(link === "average" ? 2048 : 8192));
  });
}

for (const [filter, status] of [
  ["sidechaingate=ratio=9001", 222],
  ["sidechaingate=attack=0", 222],
  ["sidechaingate=release=9001", 222],
  ["sidechaingate=knee=0", 222],
  ["sidechaingate=mix=2", 8],
  ["sidechaingate=detection=bad", 234],
  ["sidechaingate=link=2", 234],
  ["sidechaingate=mode=bad", 234],
  ["sidechaingate=threshold=NaN", 234],
  ["sidechaingate=attack=", 234],
  ["sidechaingate=unknown=1", 8]
] as const) {
  it(`${filter} fails without replacing output`, async () => {
    const fs = Volume.fromJSON({ "/out.wav": "keep" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25])] }));
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.wav", "-i", "/in.wav", "-filter_complex", `[0:a][1:a]${filter}[out]`, "-map", "[out]", "/out.wav"], cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    assert.equal(result.exitCode, status);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
  });
}
