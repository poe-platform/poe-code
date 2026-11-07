import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// SHA-256 of decoded s16le PCM from native FFmpeg 9.0.1, 8 kHz stereo, 2048 frames.
// Input: ((i * 67) % 14000 - 7000, 6000 - (i * 53) % 12000).
// ffmpeg -f s16le -ar 8000 -ac 2 -i pipe:0 -af FILTER -f s16le pipe:1
// The reported FFmpeg 7.0.2 samples also match the first fixture.
for (const [filter, hash] of [
  ["compensationdelay=cm=34:mm=3:dry=0:wet=1", "4ce51f5a2ac1fee9abe14afaad24f7e5400faa6821dae39a53b5c4991a33746b"],
  ["compensationdelay", "2d1f2da800b2a477fbc52839146c0d3fd2c94a18c404a368f734448dbdf3d8ef"],
  ["compensationdelay=3:34:0:0.25:0.5:0", "b17e22de2240284a72145f47c078a0d4819d9ef02cddcb1b3679bd1bfa2119c2"],
  ["compensationdelay=m=1:temp=-50", "584bcd57fb73fce499afb7c7a70881ed5ea9195cf7b15b3b95e670ed6199fdd7"],
  ["compensationdelay=m=100:cm=100:mm=10", "9f1dcbc35c350d6027f98be0f5c8b43b42ca52b7604459c0c42be3aa88913d47"]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} matches native PCM and rate (${graph ? "graph" : "simple"})`, async () => {
      const { volume, result, stderr } = await run(filter, graph);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channelData.length, 2);
      assert.equal(audio.channelData[0]!.length, 2048);
      const pcm = Buffer.alloc(2048 * 4);
      for (let i = 0; i < 2048; i++) {
        for (let c = 0; c < 2; c++) pcm.writeInt16LE(Math.round(audio.channelData[c]![i]! * 32768), i * 4 + c * 2);
      }
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    });
  }
}

for (const filter of ["compensationdelay=mm=-1", "compensationdelay=cm=101", "compensationdelay=m=101", "compensationdelay=dry=1.1", "compensationdelay=wet=-1", "compensationdelay=temp=51", "compensationdelay=cm=NaN", "compensationdelay=cm=", "compensationdelay=unknown=1"]) {
  it(`${filter} rejects invalid options without replacing output`, async () => {
    const { volume, result, stderr } = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("compensationdelay: invalid option"), stderr);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

async function run(filter: string, graph = false) {
  const channels = [
    Float64Array.from({ length: 2048 }, (_, i) => ((i * 67) % 14000 - 7000) / 32768),
    Float64Array.from({ length: 2048 }, (_, i) => (6000 - (i * 53) % 12000) / 32768)
  ];
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 3 } }).execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { volume, result, stderr };
}
