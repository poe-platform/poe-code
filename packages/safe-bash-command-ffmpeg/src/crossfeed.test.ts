import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  // Native FFmpeg decoded PCM16 hashes, excluding container headers.
  for (const [filter, digest] of [
    ["crossfeed=strength=0.5", "9bf42806f3d74fedfd6d928042213aad1462cfeee11bb498f69808969ba8ef36"],
    ["crossfeed", "d49cc7c40e814eed3ca7ab04daa2074198bfa2290648b7ed1315d752d37c18c2"],
    ["crossfeed=0.5:0.5:0.5:0.9:1", "9bf42806f3d74fedfd6d928042213aad1462cfeee11bb498f69808969ba8ef36"],
    ["crossfeed=strength=0:level_in=1:level_out=1", "27a4a79694997729ddfdb326d2f6eed655519c749116ba8b9348f0814e226324"],
    ["crossfeed=strength=0.8:range=0.2:slope=0.7:level_in=0.6:level_out=0.4", "c82d7cac75932912d30686580f8aecc12429b526df8e0276335437dd3d2bec5c"],
    ...["strength=-1", "strength=2", "range=2", "slope=0", "level_in=2", "level_out=-1", "strength=NaN", "unknown=1", "block_size=32"].map(option => [`crossfeed=${option}`, undefined] as const)
  ] as const) {
    it(`crossfeed ${complex ? "graph" : "simple"}: ${filter}`, async () => {
      const channels = [new Float64Array(8192), new Float64Array(8192)];
      channels[0]![0] = 12000 / 32768;
      channels[1]![2048] = -8000 / 32768;
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 44100, channels }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", ...(complex
          ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (!digest) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.existsSync("/out.wav"), false);
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.channels, 2);
      assert.equal(audio.sampleRate, 44100);
      assert.equal(audio.channelData[0]!.length, 8192);
      assert.equal(audio.channelData[1]!.length, 8192);
      const pcm = Buffer.alloc(8192 * 4);
      for (let i = 0; i < 8192; i++) {
        for (let c = 0; c < 2; c++) pcm.writeInt16LE(audio.channelData[c]![i]! * 32768, i * 4 + c * 2);
      }
      assert.equal(createHash("sha256").update(pcm).digest("hex"), digest);
      if (filter === "crossfeed=strength=0.5") {
        for (const [frame, left, right] of [[0, 10130, 670], [1, -1138, 1138], [2, -794, 794], [3, -555, 555], [2048, -447, -6753]]) {
          assert.equal(pcm.readInt16LE(frame! * 4), left);
          assert.equal(pcm.readInt16LE(frame! * 4 + 2), right);
        }
      }
    });
  }
}

for (const complex of [false, true]) {
  for (const [filter, channels, level] of [
    ["crossfeed", 2, 9546],
    ["crossfeed=level_in=0.5:level_out=0.5", 2, 2652],
    ["crossfeed,pan=mono|c0=FL", 1, 9546]
  ] as const) {
    it(`negotiates mono crossfeed ${complex ? "graph" : "simple"}: ${filter}`, async () => {
      const mono = new Float64Array(1100);
      const impulses = [0, 510, 512, 1022, 1024];
      for (const frame of impulses) mono[frame] = 15000 / 32768;
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [mono] }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", ...(complex
          ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channels, channels);
      // Native FFmpeg 7.0.2: equal-power stereo conversion followed by crossfeed gains.
      const expected = new Array<number>(1100).fill(0);
      for (const frame of impulses) expected[frame] = level;
      for (const channel of audio.channelData) {
        assert.equal(channel.length, expected.length);
        for (let frame = 0; frame < expected.length; frame++) {
          assert.equal(channel[frame]! * 32768, expected[frame], `frame ${frame}`);
        }
      }
    });
  }
}
