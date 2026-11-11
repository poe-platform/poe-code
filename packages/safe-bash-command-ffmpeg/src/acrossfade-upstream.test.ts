import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function crossfade(graph: string) {
  const volume = Volume.fromJSON({ "/out.wav": "sentinel" });
  for (const [name, value] of [["a", 12000], ["b", -4000]] as const) {
    volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
      channels: [new Float64Array(1000).fill(value / 32768)] }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex", graph,
      "-map", "[o]", "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, volume, stderr };
}

// Signed PCM16 samples captured from native FFmpeg 7.0.2 with 1,000-frame inputs.
for (const [first, second, prefix, transition, tail] of [
  ["volume=0.5", "anull", 6000, [4500, 2000, -500, -3000], -4000],
  ["anull", "volume=0.5", 12000, [9000, 5500, 2000, -1500], -2000],
  ["volume=0.5", "volume=0.5", 6000, [4500, 2500, 500, -1500], -2000],
  ["anull", "anull", 12000, [9000, 5000, 1000, -3000], -4000]
] as const) {
  it(`acrossfade applies each upstream branch (${first}; ${second})`, async () => {
    const { result, volume, stderr } = await crossfade(
      `[0:a]${first}[aa];[1:a]${second}[bb];[aa][bb]acrossfade=ns=4[o]`);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 1);
    assert.deepEqual(Array.from(audio.channelData[0]!, value => Math.round(value * 32768)), [
      ...Array<number>(996).fill(prefix), ...transition, ...Array<number>(996).fill(tail)
    ]);
  });
}

it("acrossfade applies linked upstream chains before combining and downstream filters afterward", async () => {
  const { result, volume, stderr } = await crossfade(
    "[0:a]atrim=end_sample=8[a];[a]volume=0.5[aa];" +
    "[1:a]volume=0.5,atrim=end_sample=8[bb];[aa][bb]acrossfade=ns=4,volume=0.5[o]");
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.deepEqual(Array.from(audio.channelData[0]!, value => Math.round(value * 32768)),
    [3000, 3000, 3000, 3000, 2250, 1250, 250, -750, -1000, -1000, -1000, -1000]);
});

for (const branch of [0, 1]) {
  it(`acrossfade preserves output when upstream branch ${branch} fails`, async () => {
    const { result, volume, stderr } = await crossfade(
      `[0:a]${branch === 0 ? "unsupported_audio_filter" : "anull"}[aa];` +
      `[1:a]${branch === 1 ? "unsupported_audio_filter" : "anull"}[bb];[aa][bb]acrossfade=ns=4[o]`);
    assert.equal(result.exitCode, 8);
    assert.ok(stderr.includes("unsupported_audio_filter"), stderr);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "sentinel");
  });
}
