import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Reference PCM16 values from native FFmpeg; indices include envelope transitions.
for (const [filter, indices, expected] of [
  ["compand", [0, 4000, 8000, 8010, 12000, 16000, 20000, 24000, 28000, 31999], [482, 726, 8703, -8709, 10793, 24945, 24945, 1559, 2290, -3277]],
  ["compand=attacks=0.01:decays=0.1:points=-80/-80|-40/-40|-20/-30|0/-20:volume=-20", [0, 4000, 8000, 8010, 12000, 16000, 20000, 24000, 28000, 31999], [158, 397, 3106, -2350, 1145, 4496, 2290, 143, 546, -572]],
  ["compand=attacks=0:decays=0:points=-80/-80|-40/-40|-20/-30|0/-20:soft-knee=6", [4000, 12000, 20000, 28000], [395, 1145, 2290, 572]],
  ["compand=attacks=0:decays=0:points=-80/-80|-40/-40|-20/-30|0/-20", [4000, 12000, 20000, 28000, 31999], [405, 1145, 2290, 572, -572]],
  ["compand=0:0:-80/-80|-40/-40|-20/-30|0/-20,volume=0.5", [4000, 12000, 20000, 28000], [202, 572, 1145, 286]],
  ["compand=attacks=0:decays=0:points=-80/-80|0/0:gain=-6.020599913", [4000, 12000, 20000, 28000], [250, 2000, 8000, 500]]
] as const) {
  for (const graph of [false, true]) it(`${filter} (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: Array.from({ length: 2 }, (_, c) =>
      Float64Array.from({ length: 32000 }, (_, i) => (c ? -1 : 1) * (i % 16 < 8 ? 1 : -1) * [500, 4000, 16000, 1000][Math.floor(i / 8000)]! / 32768))
    }));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    for (const [c, channel] of audio.channelData.entries()) {
      assert.equal(channel.length, 32000);
      indices.forEach((position, i) => assert.ok(Math.abs(channel[position]! * 32768 - expected[i]! * (c ? -1 : 1)) <= 1,
        `channel ${c}, sample ${position}: ${channel[position]! * 32768}`));
    }
  });
}

for (const filter of ["compand=points=bad", "compand=points=0/0|-20/-30", "compand=attacks=-1", "compand=decays=NaN", "compand=points=-20/-30|-20/0", "compand=unknown=1", "compand=soft-knee=0", "compand=delay=1"]) {
  it(`${filter} fails without replacing output`, async () => {
    const fs = Volume.fromJSON({ "/out.wav": "keep" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25])] }));
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.wav", "-af", filter, "/out.wav"], cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    assert.equal(result.exitCode, 1);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
  });
}
