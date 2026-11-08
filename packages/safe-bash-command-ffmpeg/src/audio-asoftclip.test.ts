import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { softClipAudio } from "./audio-asoftclip.js";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = [0, 8192, 16384, 24576, 32767, 24576, 16384, 8192, 0, -8192, -16384, -24576, -32768, -24576, -16384, -8192];
// Signed PCM16 references from native FFmpeg.
for (const [filter, expected] of [
  ["anull", input],
  ["asoftclip", [0, 8025, 15143, 20813, 24955, 20813, 15143, 8025, 0, -8025, -15143, -20813, -24956, -20813, -15143, -8025]],
  ["asoftclip=type=tanh:threshold=0.5", [0, 7571, 12478, 14830, 15795, 14830, 12478, 7571, 0, -7571, -12478, -14830, -15795, -14830, -12478, -7571]],
  ["asoftclip=0:0.5:0.5:2:1", [0, 6239, 7897, 8151, 8187, 8151, 7897, 6239, 0, -6239, -7897, -8151, -8187, -8151, -7897, -6239]]
] as const) for (const graph of [false, true]) {
  it(`${filter} matches native signed PCM (${graph ? "graph" : "simple"})`, async () => {
    const { fs, result, stderr } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelData.length, 2);
    for (const [c, channel] of audio.channelData.entries()) {
      assert.equal(channel.length, 8000);
      for (let i = 0; i < channel.length; i++) {
        assert.equal(Math.round(channel[i]! * 32768), expected[(i + c * 8) % input.length]);
      }
    }
  });
}

for (const filter of ["asoftclip=threshold=0", "asoftclip=threshold=1.1", "asoftclip=threshold=NaN", "asoftclip=threshold=", "asoftclip=output=17", "asoftclip=param=0", "asoftclip=param=4", "asoftclip=type=unknown", "asoftclip=type=atan", "asoftclip=oversample=2", "asoftclip=unknown=1"]) {
  it(`${filter} fails without replacing output`, async () => {
    const { fs, result } = await run(filter);
    assert.equal(result.exitCode, 1);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
  });
}

async function run(filter: string, graph = false) {
  const fs = Volume.fromJSON({ "/out.wav": "keep" });
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [0, 8].map(offset =>
    Float64Array.from({ length: 8000 }, (_, i) => input[(i + offset) % input.length]! / 32768)) }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { fs, result, stderr };
}

it("bounds clipping memory and honors cancellation", async () => {
  const channels = [new Float32Array(32)];
  await assert.rejects(softClipAudio(channels, "asoftclip",
    new MediaBudgetTracker({ maxMemoryBytes: 128 })), /maxMemoryBytes/);
  await assert.rejects(softClipAudio(channels, "asoftclip",
    new MediaBudgetTracker(), AbortSignal.abort()));
});
