import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { surroundAudio } from "./audio-surround.js";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: 8192 stereo PCM16 frames at 16 kHz, shared 90 Hz and
// independent 440/700 Hz tones. References retain every decoded sample.
const input = readFileSync(new URL("./fixtures/surround-input.wav", import.meta.url));
async function run(filter: string, graph = false, source = input) {
  const fs = Volume.fromJSON({ "/out.wav": "keep" });
  fs.writeFileSync("/in.wav", source);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); },
      async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); },
      async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
  } as never);
  return { result, stderr, output: fs.readFileSync("/out.wav") as Buffer };
}

for (const [filter, fixture, lfe] of [
  ["surround", "default", true],
  ["surround=chl_out=5.1:win_size=1024", "1024", true],
  ["surround=chl_out=5.1:win_size=1024:lfe=0", "1024", false]
] as const) for (const graph of [false, true]) {
  it(`${filter} matches native per-speaker PCM (${graph ? "graph" : "simple"})`, async () => {
    const { result, stderr, output } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(output).tracks[0]!.decodedAudio!;
    const expected = parseWav(readFileSync(new URL(`./fixtures/surround-${fixture}.wav`, import.meta.url))).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 16000);
    assert.equal(audio.channels, 6);
    assert.equal(audio.channelMask, 0x3f);
    for (const [c, channel] of audio.channelData.entries()) {
      assert.equal(channel.length, 8192);
      for (const [i, sample] of channel.entries()) {
        const reference = !lfe && c === 3 ? 0 : expected.channelData[c]![i]!;
        assert.ok(Math.abs(sample - reference) * 32768 <= 1,
          `speaker ${c}, sample ${i}: ${sample * 32768}, expected ${reference * 32768}`);
      }
    }
  });
}

it("disabling LFE preserves the other five channels exactly", async () => {
  const on = await run("surround=win_size=1024");
  const off = await run("surround=win_size=1024:lfe=0");
  assert.equal(on.result.exitCode, 0, on.stderr);
  assert.equal(off.result.exitCode, 0, off.stderr);
  const a = parseWav(on.output).tracks[0]!.decodedAudio!;
  const b = parseWav(off.output).tracks[0]!.decodedAudio!;
  a.channelData.forEach((channel, c) => assert.deepEqual(b.channelData[c], c === 3 ? channel.map(() => 0) : channel));
});

for (const graph of [false, true]) {
  it(`equivalent surround layouts preserve exact PCM (${graph ? "graph" : "simple"})`, async () => {
    const channels = [0, 1].map(c => Float64Array.from({ length: 512 }, (_, i) =>
      (((2 * i + c) * 13129) % 30001 - 15000) / 32768));
    const source = Buffer.from(encodeWav({ sampleRate: 8000, channels }));
    const canonical = await run("surround=win_size=1024:chl_in=stereo:chl_out=5.1", graph, source);
    assert.equal(canonical.result.exitCode, 0, canonical.stderr);
    for (const layout of ["chl_in=FL+FR", "chl_in=0x3", "chl_in=2c", "chl_in=3",
      "chl_out=FL+FR+FC+LFE+BL+BR", "chl_out=0x3f", "chl_out=6c", "chl_out=63",
      "chl_in=0x3:chl_out=0x3f"]) {
      const actual = await run(`surround=win_size=1024:${layout}`, graph, source);
      assert.equal(actual.result.exitCode, 0, `${layout}: ${actual.stderr}`);
      assert.deepEqual(actual.output, canonical.output, layout);
    }
  });
}

for (const filter of ["surround=chl_in=FR+FL", "surround=chl_in=FC+LFE", "surround=chl_in=0x4",
  "surround=chl_out=5.1(side)", "surround=chl_out=0x60f", "surround=chl_out=invalid",
  "surround=win_size=0", "surround=win_size=65537", "surround=win_size=NaN", "surround=win_size=1024.5",
  "surround=win_size=1025", "surround=lfe=bad", "surround=chl_out=stereo", "surround=unknown=1"]) {
  it(`${filter} fails without replacing output`, async () => {
    const { result, stderr, output } = await run(filter);
    assert.equal(result.exitCode, 1);
    assert.ok(stderr.includes("surround"), stderr);
    assert.equal(output.toString(), "keep");
  });
}

for (const filter of ["anull", "channelmap=map=1|0:channel_layout=stereo"]) {
  it(`${filter} preserves the stereo control PCM`, async () => {
    const { result, stderr, output } = await run(filter);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(output).tracks[0]!.decodedAudio!;
    const expected = parseWav(input).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, 2);
    assert.equal(audio.sampleRate, 16000);
    assert.deepEqual(audio.channelData, filter === "anull" ? expected.channelData : [...expected.channelData].reverse());
  });
}

it("preserves a partial final window and supports a following channelmap", async () => {
  const channels = parseWav(input).tracks[0]!.decodedAudio!.channelData.map(channel => Float64Array.from(channel.subarray(0, 777)));
  const source = Buffer.from(encodeWav({ sampleRate: 16000, channels }));
  const { result, stderr, output } = await run("surround=win_size=1024,channelmap=map=4|5:channel_layout=stereo", false, source);
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(output).tracks[0]!.decodedAudio!;
  const expected = parseWav(readFileSync(new URL("./fixtures/surround-short.wav", import.meta.url))).tracks[0]!.decodedAudio!;
  assert.equal(audio.channels, 2);
  audio.channelData.forEach((channel, c) => {
    assert.equal(channel.length, 777);
    channel.forEach((sample, i) => assert.ok(Math.abs(sample - expected.channelData[c + 4]![i]!) * 32768 <= 1));
  });
});

it("bounds surround workspace and honors cancellation", async () => {
  const channels = [new Float32Array(32), new Float32Array(32)];
  await assert.rejects(surroundAudio(channels, 16000, "surround",
    new MediaBudgetTracker({ maxMemoryBytes: 65536 })), /maxMemoryBytes/);
  await assert.rejects(surroundAudio(channels, 16000, "surround",
    new MediaBudgetTracker(), AbortSignal.abort()));
});
