import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const channels of [1, 2]) {
    for (const count of [9, 4097]) for (const smallChanges of [false, true]) {
      it(`${sync ? "sync" : "async"} encodes ${count} samples of ${channels}-channel IMA WAV (${smallChanges ? "small" : "large"} changes)`, async () => {
        const samples = smallChanges ? Array.from({ length: 13 }, (_, i) => i - 6)
          : [-32768, -16385, -257, -1, 0, 1, 257, 16385, 32767];
        const input = encodeWav({ sampleRate: 8000, channels: Array.from({ length: channels }, (_, ch) =>
          Float64Array.from({ length: count }, (_, i) => samples[(i + ch) % samples.length]! / 32768)) });
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.wav", input);
        const args = ["-bitexact", "-v", "error", "-i", "/in.wav", "-c:a", "adpcm_ima_wav", "/out.wav"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
        }
        const output = volume.readFileSync("/out.wav") as Buffer;
        assert.equal(output.readUInt32LE(16), 20);
        assert.equal(output.readUInt16LE(20), 17);
        assert.equal(output.readUInt16LE(32), 1024);
        assert.equal(output.readUInt16LE(34), 4);
        assert.equal(output.readUInt16LE(36), 2);
        const frames = 1 + (1024 - 4 * channels) * 2 / channels;
        assert.equal(output.readUInt16LE(38), frames);
        assert.equal(output.toString("ascii", 40, 44), "fact");
        assert.equal(output.readUInt32LE(48), Math.ceil(count / frames) * frames);
        assert.equal(output.toString("ascii", 52, 56), "data");
        assert.equal(output.readUInt32LE(56), Math.ceil(count / frames) * 1024);
        if (smallChanges && channels === 1 && count === 9) {
          // Full native FFmpeg payload, including the padded tail.
          assert.equal(createHash("sha256").update(output.subarray(60)).digest("hex"),
            "dbb373355a474f4324bab2f15bb4b7d46a9cba6fecc5db7f5481c0d894e7f360");
        }
        const inspected = spawnSync("ffmpeg", ["-hide_banner", "-i", "pipe:0"], { input: output });
        assert.match(inspected.stderr.toString(), /Audio: adpcm_ima_wav/);
        const audio = parseWav(output).tracks[0]!.decodedAudio!;
        assert.equal(audio.channelData[0]!.length, Math.ceil(count / frames) * frames);
        const native = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-f", "s16le", "pipe:1"], { input: output });
        assert.equal(native.status, 0, native.stderr?.toString());
        assert.equal(native.stdout.length, audio.channelData[0]!.length * channels * 2);
        for (let i = 0; i < audio.channelData[0]!.length; i++) {
          for (let ch = 0; ch < channels; ch++) {
            assert.equal(native.stdout.readInt16LE((i * channels + ch) * 2), audio.channelData[ch]![i]! * 32768);
          }
        }
        if (channels === 1) assert.deepEqual(Array.from(audio.channelData[0]!.slice(0, 3), n => n * 32768),
          smallChanges ? [-6, -6, -5] : [-32768, -32757, -32727]);
      });
    }
  }
}
