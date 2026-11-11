import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function runGate(enable: string | undefined, options = "", programLength = 1200, keyLength = 1024) {
  const fs = Volume.fromJSON({ "/out.wav": "keep" });
  fs.writeFileSync("/main.wav", encodeWav({ sampleRate: 8000, channels: [
    new Float64Array(programLength).fill(8000 / 32768),
    new Float64Array(programLength).fill(-4000 / 32768)
  ] }));
  fs.writeFileSync("/key.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array(keyLength).fill(2048 / 32768)] }));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/main.wav", "-i", "/key.wav", "-filter_complex",
      `[0:a][1:a]sidechaingate=attack=0.1:release=0.1:detection=peak:knee=1:link=maximum${options}${enable === undefined ? "" : `:enable='${enable}'`}[o]`,
      "-map", "[o]", "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  return { result, errors: Buffer.concat(errors).toString(), bytes: fs.readFileSync("/out.wav") as Buffer };
}

// Native FFmpeg 7.0.2 evaluates these expressions at 512-sample WAV frame boundaries.
for (const [enable, gains] of [
  [undefined, [0.5, 0.5]], ["0", [1, 1]], ["1", [0.5, 0.5]],
  ["gte(t,0.064)", [1, 0.5]], ["gte(t,0.001)", [1, 0.5]],
  ["between(t,0,0.063)", [0.5, 1]], ["eq(n,1)", [1, 0.5]],
  ["0.4", [1, 1]], ["-0.5", [0.5, 0.5]],
  ["eq(pos,44)", [0.5, 1]], ["eq(pos,0)", [1, 1]],
  ["eq(pos,2092)", [1, 0.5]], ["eq(pos,1068)", [1, 1]]
] as const) {
  it(`sidechaingate applies timeline enable=${enable} at audio frame boundaries`, async () => {
    const { result, errors, bytes } = await runGate(enable);
    assert.equal(result.exitCode, 0, errors);
    const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 2);
    for (const [c, channel] of audio.channelData.entries()) {
      assert.equal(channel.length, 1024);
      for (let i = 0; i < channel.length; i++) {
        assert.equal(channel[i]! * 32768, (c ? -4000 : 8000) * gains[i < 512 ? 0 : 1]!, `channel ${c}, sample ${i}`);
      }
    }
  });
}

it("disabled sidechaingate bypasses input and makeup gain and still stops at the shorter program", async () => {
  const { result, errors, bytes } = await runGate("0", ":level_in=2:makeup=2", 700, 1200);
  assert.equal(result.exitCode, 0, errors);
  const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
  assert.deepEqual(Array.from(audio.channelData[0]!, x => x * 32768), Array(700).fill(8000));
  assert.deepEqual(Array.from(audio.channelData[1]!, x => x * 32768), Array(700).fill(-4000));
});

it("sidechaingate keeps the detector warm while timeline enable is false", async () => {
  const always = await runGate("1", ":attack=1000");
  const timed = await runGate("gte(t,0.064)", ":attack=1000");
  assert.equal(always.result.exitCode, 0, always.errors);
  assert.equal(timed.result.exitCode, 0, timed.errors);
  const reference = parseWav(always.bytes).tracks[0]!.decodedAudio!;
  const audio = parseWav(timed.bytes).tracks[0]!.decodedAudio!;
  for (let c = 0; c < 2; c++) {
    assert.deepEqual(audio.channelData[c]!.slice(512), reference.channelData[c]!.slice(512));
    assert.equal(audio.channelData[c]![0]! * 32768, c ? -4000 : 8000);
  }
});

for (const enable of ["", "gte(t,)", "unknown", "gte(t,0.1"]) {
  it(`sidechaingate rejects invalid enable=${enable} without replacing output`, async () => {
    const { result, bytes } = await runGate(enable);
    assert.equal(result.exitCode, 1);
    assert.equal(bytes.toString(), "keep");
  });
}
