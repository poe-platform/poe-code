import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { virtualBassAudio } from "./audio-virtualbass.js";
import { createFfmpegCommand } from "./index.js";

const channels = [
  Float64Array.from({ length: 32 }, (_, i) => (701 * i - 12400) / 32768),
  Float64Array.from({ length: 32 }, (_, i) => (11000 - 537 * i) / 32768)
];

async function run(filter: string, graph = false) {
  const fs = Volume.fromJSON({ "/out.wav": "keep" });
  fs.writeFileSync("/in.wav", Buffer.from(encodeWav({ sampleRate: 8000, channels })));
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

// Native FFmpeg 7.0.2 PCM16 references, including every interleaved sample.
for (const [filter, hash] of [
  ["anull", "a5ba7dc50e54a30a591c6575e8030bf7d061655bfc6dde1e11e1e4aa2edb23fa"],
  ["virtualbass", "f2e17fb66a716832c1cc0006312372a931d717d85de1e3337205ad44b5641618"],
  ["virtualbass=cutoff=100:strength=0.5", "f7f77dc5e3520824f47a4df5148f79b50797f0f689d36fe128e61b8bf6b635cc"],
  ["virtualbass=cutoff=500:strength=2", "3d677cf97ba19e3c54bc0a18c9d3cae86acee8d1235a2aa0611c824f71384597"],
  ["virtualbass=100:0.5", "f7f77dc5e3520824f47a4df5148f79b50797f0f689d36fe128e61b8bf6b635cc"],
  ["virtualbass=cutoff=500:2", "3d677cf97ba19e3c54bc0a18c9d3cae86acee8d1235a2aa0611c824f71384597"],
  ["virtualbass=cutoff=min:strength=max", "8ee3c0527853aa2bf917b47f6be60bff2ba13a680e512a1fba063496010030a6"],
  ["virtualbass=100:", "8ee3c0527853aa2bf917b47f6be60bff2ba13a680e512a1fba063496010030a6"],
  ["virtualbass=enable=0", "f2e17fb66a716832c1cc0006312372a931d717d85de1e3337205ad44b5641618"],
  ["virtualbass=threads=2:thread_type=slice:extra_hw_frames=0", "f2e17fb66a716832c1cc0006312372a931d717d85de1e3337205ad44b5641618"],
  ["asetnsamples=n=7:p=0,virtualbass@bass", "f2e17fb66a716832c1cc0006312372a931d717d85de1e3337205ad44b5641618"],
  ["asetnsamples=n=8:p=0,asendcmd=c='0.002 virtualbass@bass strength 0.5',virtualbass@bass", "a284109929f4762dc889e499f1ce040007a7c93dbca92cd990d1782c55375314"],
  ["asetnsamples=n=8:p=0,asendcmd=c='0.002 virtualbass strength bad',virtualbass", "f2e17fb66a716832c1cc0006312372a931d717d85de1e3337205ad44b5641618"]
] as const) for (const graph of [false, true]) {
  it(`${filter} matches native samples and layout (graph=${graph})`, async () => {
    const { result, stderr, output } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(output).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, filter === "anull" ? 2 : 3);
    assert.equal(audio.sampleRate, 8000);
    if (filter !== "anull") assert.equal(audio.channelMask, 0xb);
    const pcm = Buffer.alloc(32 * audio.channels * 2);
    audio.channelData.forEach((channel, c) => {
      assert.equal(channel.length, 32);
      if (c < 2) assert.deepEqual(Array.from(channel), Array.from(channels[c]!));
      channel.forEach((sample, i) => pcm.writeInt16LE(sample * 32768, (i * audio.channels + c) * 2));
    });
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}

it("exposes the generated LFE to downstream channel selection", async () => {
  const { result, stderr, output } = await run("virtualbass,pan=mono|c0=LFE");
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(output).tracks[0]!.decodedAudio!;
  assert.equal(audio.channels, 1);
  const pcm = Buffer.alloc(64);
  audio.channelData[0]!.forEach((sample, i) => pcm.writeInt16LE(sample * 32768, i * 2));
  assert.equal(createHash("sha256").update(pcm).digest("hex"),
    "04d1b8fe33555ea3e93fc8ba4ea577eac17397f881a2e654c5828ae26add4744");
});

for (const [option, code] of [
  ["cutoff=99", 222], ["cutoff=501", 222], ["strength=0.4", 222], ["strength=4", 222],
  ["cutoff=1/0", 222], ["cutoff=NaN", 234], ["strength=bad", 234], ["unknown=1", 8]
] as const) it(`rejects ${option} without replacing output`, async () => {
  const { result, stderr, output } = await run(`virtualbass=${option}`);
  assert.equal(result.exitCode, code, stderr);
  assert.ok(stderr.includes("virtualbass"), stderr);
  assert.equal(output.toString(), "keep");
});

it("accounts for the LFE allocation and honors cancellation", async () => {
  await assert.rejects(virtualBassAudio(channels, 8000, "virtualbass",
    new MediaBudgetTracker({ maxMemoryBytes: 32 * 8 - 1 })), /maxMemoryBytes/);
  await assert.rejects(virtualBassAudio(channels, 8000, "virtualbass",
    new MediaBudgetTracker(), AbortSignal.abort()));
});
