import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, channels = 1, secondLength = 4096) {
  const fs = Volume.fromJSON({});
  const a = Float64Array.from({ length: 8192 }, (_, i) => (i % 8 < 4 ? 8192 : -8192) / 32768);
  const b = Float64Array.from({ length: secondLength }, (_, i) => (i < 2048 ? -16384 : 1024) / 32768);
  fs.writeFileSync("/a.wav", encodeWav({ sampleRate: 8000, channels: Array.from({ length: channels }, () => a) }));
  fs.writeFileSync("/b.wav", encodeWav({ sampleRate: 8000, channels: Array.from({ length: channels }, (_, c) => c ? b.map(x => -x) : b) }));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-i", "/a.wav", "-i", "/b.wav", ...(filter.startsWith("[") ? ["-filter_complex", filter, "-map", "[mix]"] : ["-map", filter]), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  return { result, error: Buffer.concat(errors).toString(), audio: fs.existsSync("/out.wav") ? parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio! : undefined };
}

for (const channels of [1, 2]) for (const algo of ["slow", "best", "0", "2"]) {
  it(`axcorrelate ${algo} matches native PCM at steady regions and boundaries (${channels} channels)`, async () => {
    const { result, error, audio } = await run(`[0:a][1:a]axcorrelate=size=128:algo=${algo}[mix]`, channels);
    assert.equal(result.exitCode, 0, error);
    assert.equal(audio!.sampleRate, 8000);
    assert.equal(audio!.channels, channels);
    for (const [c, channel] of audio!.channelData.entries()) {
      assert.equal(channel.length, 4096);
      const expected = [0, 0, 0, 2908, 0, 0, -2908];
      [0, 4, 512, 2047, 2048, 2304, 4095].forEach((index, i) => {
        assert.ok(Math.abs(channel[index]! * 32768 - expected[i]! * (c ? -1 : 1)) <= 1, `sample ${index}: ${channel[index]! * 32768}`);
      });
    }
  });
}

it("direct input maps preserve their original PCM and lengths", async () => {
  for (const input of [0, 1]) {
    const { result, error, audio } = await run(`${input}:a`);
    assert.equal(result.exitCode, 0, error);
    assert.equal(audio!.channelData[0]!.length, input ? 4096 : 8192);
    assert.equal(audio!.channelData[0]![0]! * 32768, input ? -16384 : 8192);
  }
});

for (const option of ["size=1", "size=131073", "size=2.5", "algo=unknown", "unknown=1"]) {
  it(`axcorrelate rejects ${option}`, async () => {
    const { result, error, audio } = await run(`[0:a][1:a]axcorrelate=${option}[mix]`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(error.includes("axcorrelate"));
    assert.equal(audio, undefined);
  });
}

it("axcorrelate fast uses uncentered windows and applies following filters", async () => {
  const { result, error, audio } = await run("[0:a][1:a]axcorrelate=128:fast,volume=0.5[mix]");
  assert.equal(result.exitCode, 0, error);
  assert.equal(audio!.channelData[0]!.length, 4096);
  assert.equal(audio!.channelData[0]![0], 0);
  assert.ok(Math.abs(audio!.channelData[0]![4095]! * 32768 + 1448) <= 1);
});

it("axcorrelate defaults to best with a 256-sample window", async () => {
  const implicit = await run("[0:a][1:a]axcorrelate[mix]");
  const explicit = await run("[0:a][1:a]axcorrelate=256:best[mix]");
  assert.equal(implicit.result.exitCode, 0, implicit.error);
  assert.equal(explicit.result.exitCode, 0, explicit.error);
  assert.deepEqual(implicit.audio, explicit.audio);
});
